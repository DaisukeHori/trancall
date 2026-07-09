/**
 * retention-cleanup — Supabase Edge Function
 *
 * 日次 retention 削除バッチ (Sprint 3 T-60)
 * UTC 17:00 (JST 02:00) に pg_cron から呼び出される。
 *
 * 削除対象テーブルと根拠:
 *   1. trancall_transcript.segments          — retention_until < now()
 *      (プラン別保持期間超過: Free=7d / Light=30d / Standard=90d / Business=365d)
 *      docs/production-runbook.md §10.1 canonical
 *   2. trancall_transcript.transcript_access — deleted_at IS NOT NULL AND deleted_at < now() - 30d
 *      (退会 grace period 30日経過後の論理削除行を物理削除)
 *      docs/account-deletion.md §猶予期間
 *   3. trancall_event.agent_metrics          — collected_at < now() - 30d
 *      (メトリクスは 30 日で不要)
 *   4. trancall_billing.external_purchase_tokens — expires_at + 7d < now()
 *      (TTL 切れ後 7 日バッファ付きで削除)
 *      docs/production-runbook.md §10.1 + docs/billing-ui-flow.md §15.3
 *   5. trancall_billing.webhook_events       — received_at < now() - 30d
 *      (処理済みイベントは 30 日で削除)
 *   6. trancall_billing.usage_reservations  — status IN ('reconciled','expired')
 *                                              AND reconciled_at < now() - 7d
 *      (完了後 7 日経過した reservations を削除)
 *   7. auth.users の物理削除 (退会 grace period 30 日経過済 + deleted_at IS NOT NULL)
 *      docs/account-deletion.md §猶予期間
 *      NOTE (Issue #07/#45): trancall_auth.profiles(user_id) は auth.users(id) を
 *            ON DELETE CASCADE で参照しているが、profiles(user_id) を
 *            ON DELETE NO ACTION で参照する子テーブルが残っている限り、
 *            auth.admin.deleteUser() は必ず FK 違反で失敗する。
 *            そのため deleteUser() 実行前に以下を順に処理する:
 *            (a) rooms.created_by / participants.user_id /
 *                report_events.reporter_id・reported_id / subscriptions.user_id /
 *                usage_windows.user_id を NULL 化 (00019 migration で NULL 許容化済み)
 *            (b) usage_reservations / transcript_access / external_purchase_tokens /
 *                room_reservation_sessions の残存行を DELETE、invite_links.used_by を
 *                NULL 化 (フォールバック。通常は退会リクエスト直後の即時処理、または
 *                room_reservation_sessions は 00020 migration の ON DELETE CASCADE で
 *                既に空になっている想定。多層防御として明示 DELETE も行う)
 *            (c) user_consents.user_id を per-user 決定論的 UUID に anonymize
 *                (00019 migration で FK 制約を削除済みのため実在しない UUID でも成功する)
 *                anonymize: SHA-256(userId + ANONYMIZE_SALT) の先頭 16 バイトを UUID v4 に整形。
 *                docs/account-deletion.md §TODO (T-29) 対処案 1 採用
 *            (d) auth.admin.deleteUser() で auth.users を削除 (service_role key が必要)。
 *                CASCADE で trancall_auth.profiles、および profiles を
 *                ON DELETE CASCADE で参照する contacts / block_list / device_tokens /
 *                invite_links(所有者側) も連動して削除される。
 *            いずれかのステップが失敗したユーザーは以降のステップをスキップし
 *            安全側に倒す (次回実行でリトライされる)。
 *
 * 完了後、trancall_audit.retention_runs テーブルに実行記録を書き込む。
 * docs/production-runbook.md §10 / §10.1 / §10.2 / §16.4 canonical
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

interface DeletionCounts {
  segments: number;
  transcript_access: number;
  agent_metrics: number;
  external_purchase_tokens: number;
  webhook_events: number;
  usage_reservations: number;
  deleted_auth_users: number;
  /**
   * auth.admin.deleteUser() 実行前に行った、profiles(user_id) を
   * ON DELETE NO ACTION で参照する子テーブルの NULL 化/DELETE 件数の累計
   * (Issue #07/#45 — 全 purge 対象ユーザー分の合計)。
   */
  pre_delete_cleanup: {
    rooms_created_by_nulled: number;
    participants_nulled: number;
    report_events_reporter_nulled: number;
    report_events_reported_nulled: number;
    subscriptions_nulled: number;
    usage_windows_nulled: number;
    usage_reservations_deleted_fallback: number;
    transcript_access_deleted_fallback: number;
    external_purchase_tokens_deleted_fallback: number;
    invite_links_used_by_nulled: number;
    /**
     * room_reservation_sessions の DELETE 件数フォールバック
     * (確定#7 / #07 リグレッション対応。00020 migration の
     * user_id FK は ON DELETE CASCADE のため通常はここで 0 件になるが、
     * 多層防御として明示 DELETE も行う)。
     */
    room_reservation_sessions_deleted_fallback: number;
  };
}

interface RetentionResult {
  ok: boolean;
  run_id: string;
  started_at: string;
  ended_at: string;
  deletion_counts: DeletionCounts;
  errors: string[];
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

/** now から指定日数前の ISO 文字列を返す */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * per-user 決定論的匿名化 UUID を生成する (案 1 採用)。
 * SHA-256(userId + salt) の先頭 16 バイトを UUID v4 形式に整形する。
 * 同一 userId は常に同じ UUID になるため UNIQUE(user_id, scope, version) 制約を保持。
 * docs/account-deletion.md §TODO (T-29) 対処案 1
 */
async function deriveAnonymizedUserId(userId: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userId + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // 先頭 32 hex 文字 (16 バイト) を使用
  const b0 = hex.slice(0, 8);
  const b1 = hex.slice(8, 12);
  // version 4: バイト 6 の上位 4 ビットを 0100 に設定
  const b2 = "4" + hex.slice(13, 16);
  // variant 10xx: バイト 8 の上位 2 ビットを 10 に設定 (8, 9, a, b のいずれか)
  const variantNibble = (parseInt(hex[16]!, 16) & 0x3) | 0x8;
  const b3 = variantNibble.toString(16) + hex.slice(17, 20);
  const b4 = hex.slice(20, 32);

  return `${b0}-${b1}-${b2}-${b3}-${b4}`;
}

/**
 * ある userId を profiles(user_id) を ON DELETE NO ACTION で参照している
 * 全子テーブルから切り離す (Issue #07/#45)。
 * 00019_relax_account_deletion_fk_constraints.sql で NULL 許容化した列は NULL 化、
 * 「即座に削除/revoke される」設計の行は念のためのフォールバックとして DELETE/NULL 化する。
 *
 * auth.admin.deleteUser() 実行前に必ず呼び出すこと。
 * いずれかのステップが失敗した場合は即座にエラーを返し、以降のステップ
 * (user_consents anonymize / auth.users 削除) を実行しないこと。
 */
async function clearFkBlockingReferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<
  | { ok: true; counts: DeletionCounts["pre_delete_cleanup"] }
  | { ok: false; step: string; message: string }
> {
  const stepCounts: DeletionCounts["pre_delete_cleanup"] = {
    rooms_created_by_nulled: 0,
    participants_nulled: 0,
    report_events_reporter_nulled: 0,
    report_events_reported_nulled: 0,
    subscriptions_nulled: 0,
    usage_windows_nulled: 0,
    usage_reservations_deleted_fallback: 0,
    transcript_access_deleted_fallback: 0,
    external_purchase_tokens_deleted_fallback: 0,
    invite_links_used_by_nulled: 0,
    room_reservation_sessions_deleted_fallback: 0,
  };

  // rooms.created_by — NULL 化 (docs/account-deletion.md: rooms は変更なし)
  {
    const { count, error } = await supabase
      .schema("trancall_room")
      .from("rooms")
      .update({ created_by: null }, { count: "exact" })
      .eq("created_by", userId);
    if (error) return { ok: false, step: "rooms.created_by", message: error.message };
    stepCounts.rooms_created_by_nulled = count ?? 0;
  }

  // participants.user_id — NULL 化 (docs/account-deletion.md: participants は行を維持)
  {
    const { count, error } = await supabase
      .schema("trancall_room")
      .from("participants")
      .update({ user_id: null }, { count: "exact" })
      .eq("user_id", userId);
    if (error) return { ok: false, step: "participants.user_id", message: error.message };
    stepCounts.participants_nulled = count ?? 0;
  }

  // report_events.reporter_id / reported_id — NULL 化 (abuse 対応用に行自体は保持)
  {
    const { count, error } = await supabase
      .schema("trancall_contact")
      .from("report_events")
      .update({ reporter_id: null }, { count: "exact" })
      .eq("reporter_id", userId);
    if (error) return { ok: false, step: "report_events.reporter_id", message: error.message };
    stepCounts.report_events_reporter_nulled = count ?? 0;
  }
  {
    const { count, error } = await supabase
      .schema("trancall_contact")
      .from("report_events")
      .update({ reported_id: null }, { count: "exact" })
      .eq("reported_id", userId);
    if (error) return { ok: false, step: "report_events.reported_id", message: error.message };
    stepCounts.report_events_reported_nulled = count ?? 0;
  }

  // subscriptions.user_id — NULL 化 (課金監査のため行自体は保持)
  {
    const { count, error } = await supabase
      .schema("trancall_billing")
      .from("subscriptions")
      .update({ user_id: null }, { count: "exact" })
      .eq("user_id", userId);
    if (error) return { ok: false, step: "subscriptions.user_id", message: error.message };
    stepCounts.subscriptions_nulled = count ?? 0;
  }

  // usage_windows.user_id — NULL 化 (docs/account-deletion.md: 保持・匿名化・30日後にnull)
  {
    const { count, error } = await supabase
      .schema("trancall_billing")
      .from("usage_windows")
      .update({ user_id: null }, { count: "exact" })
      .eq("user_id", userId);
    if (error) return { ok: false, step: "usage_windows.user_id", message: error.message };
    stepCounts.usage_windows_nulled = count ?? 0;
  }

  // usage_reservations — フォールバック DELETE
  // (docs/account-deletion.md: 退会即座に reconcile→削除される想定。取りこぼし保険)
  {
    const { count, error } = await supabase
      .schema("trancall_billing")
      .from("usage_reservations")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) {
      return { ok: false, step: "usage_reservations", message: error.message };
    }
    stepCounts.usage_reservations_deleted_fallback = count ?? 0;
  }

  // transcript_access — フォールバック DELETE
  // (docs/account-deletion.md: 退会即座に自分の access 行を削除される想定。取りこぼし保険)
  {
    const { count, error } = await supabase
      .schema("trancall_transcript")
      .from("transcript_access")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) {
      return { ok: false, step: "transcript_access", message: error.message };
    }
    stepCounts.transcript_access_deleted_fallback = count ?? 0;
  }

  // external_purchase_tokens — フォールバック DELETE (TTL切れ後7日で通常は既に削除済み)
  {
    const { count, error } = await supabase
      .schema("trancall_billing")
      .from("external_purchase_tokens")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) {
      return { ok: false, step: "external_purchase_tokens", message: error.message };
    }
    stepCounts.external_purchase_tokens_deleted_fallback = count ?? 0;
  }

  // room_reservation_sessions — フォールバック DELETE (確定#7 / #07 リグレッション対応)
  // 00020 migration の user_id FK は ON DELETE CASCADE のため通常は
  // profiles 削除 (auth.admin.deleteUser CASCADE) で自動的に消えるが、
  // 万一 CASCADE 前提が崩れた場合の多層防御として明示 DELETE も行う。
  {
    const { count, error } = await supabase
      .schema("trancall_billing")
      .from("room_reservation_sessions")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) {
      return { ok: false, step: "room_reservation_sessions", message: error.message };
    }
    stepCounts.room_reservation_sessions_deleted_fallback = count ?? 0;
  }

  // invite_links.used_by — NULL 化 (このユーザーが他人の招待リンクを使用済みの場合)
  {
    const { count, error } = await supabase
      .schema("trancall_contact")
      .from("invite_links")
      .update({ used_by: null }, { count: "exact" })
      .eq("used_by", userId);
    if (error) return { ok: false, step: "invite_links.used_by", message: error.message };
    stepCounts.invite_links_used_by_nulled = count ?? 0;
  }

  return { ok: true, counts: stepCounts };
}

// ---------------------------------------------------------------------------
// メインハンドラ
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // POST 以外は拒否 (pg_cron は GET / POST どちらも送れるが、明示的に制限)
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const started_at = new Date().toISOString();
  const errors: string[] = [];
  const counts: DeletionCounts = {
    segments: 0,
    transcript_access: 0,
    agent_metrics: 0,
    external_purchase_tokens: 0,
    webhook_events: 0,
    usage_reservations: 0,
    deleted_auth_users: 0,
    pre_delete_cleanup: {
      rooms_created_by_nulled: 0,
      participants_nulled: 0,
      report_events_reporter_nulled: 0,
      report_events_reported_nulled: 0,
      subscriptions_nulled: 0,
      usage_windows_nulled: 0,
      usage_reservations_deleted_fallback: 0,
      transcript_access_deleted_fallback: 0,
      external_purchase_tokens_deleted_fallback: 0,
      invite_links_used_by_nulled: 0,
      room_reservation_sessions_deleted_fallback: 0,
    },
  };

  // service_role key で初期化 (RLS bypass)
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // -------------------------------------------------------------------------
  // 1. trancall_transcript.segments — retention_until < now()
  //    プラン別保持期間超過セグメントを物理削除
  //    docs/production-runbook.md §10.1
  // -------------------------------------------------------------------------
  {
    const { count, error } = await supabase
      .schema("trancall_transcript")
      .from("segments")
      .delete({ count: "exact" })
      .lt("retention_until", new Date().toISOString());

    if (error) {
      errors.push(`segments: ${error.message}`);
      console.error("[retention-cleanup] segments delete error:", error);
    } else {
      counts.segments = count ?? 0;
      console.log(`[retention-cleanup] segments deleted: ${counts.segments}`);
    }
  }

  // -------------------------------------------------------------------------
  // 2. trancall_transcript.transcript_access — deleted_at IS NOT NULL AND deleted_at < 30d ago
  //    退会 grace period (30日) 経過後の論理削除行を物理削除
  //    docs/account-deletion.md §猶予期間 / docs/production-runbook.md §10.1
  // -------------------------------------------------------------------------
  {
    const gracePeriodCutoff = daysAgo(30);
    const { count, error } = await supabase
      .schema("trancall_transcript")
      .from("transcript_access")
      .delete({ count: "exact" })
      .not("deleted_at", "is", null)
      .lt("deleted_at", gracePeriodCutoff);

    if (error) {
      errors.push(`transcript_access: ${error.message}`);
      console.error("[retention-cleanup] transcript_access delete error:", error);
    } else {
      counts.transcript_access = count ?? 0;
      console.log(`[retention-cleanup] transcript_access deleted: ${counts.transcript_access}`);
    }
  }

  // -------------------------------------------------------------------------
  // 3. trancall_event.agent_metrics — collected_at < 30d ago
  //    パフォーマンスメトリクスは 30 日で削除
  //    (実装方針: T-60 仕様 / 00003_add_agent_metrics_table.sql)
  // -------------------------------------------------------------------------
  {
    const thirtyDaysAgo = daysAgo(30);
    const { count, error } = await supabase
      .schema("trancall_event")
      .from("agent_metrics")
      .delete({ count: "exact" })
      .lt("collected_at", thirtyDaysAgo);

    if (error) {
      errors.push(`agent_metrics: ${error.message}`);
      console.error("[retention-cleanup] agent_metrics delete error:", error);
    } else {
      counts.agent_metrics = count ?? 0;
      console.log(`[retention-cleanup] agent_metrics deleted: ${counts.agent_metrics}`);
    }
  }

  // -------------------------------------------------------------------------
  // 4. trancall_billing.external_purchase_tokens — expires_at + 7d < now()
  //    TTL 切れ後 7 日バッファ付きで削除
  //    docs/production-runbook.md §10.1 / docs/billing-ui-flow.md §15.3
  // -------------------------------------------------------------------------
  {
    const sevenDaysAgo = daysAgo(7);
    const { count, error } = await supabase
      .schema("trancall_billing")
      .from("external_purchase_tokens")
      .delete({ count: "exact" })
      .lt("expires_at", sevenDaysAgo);

    if (error) {
      errors.push(`external_purchase_tokens: ${error.message}`);
      console.error("[retention-cleanup] external_purchase_tokens delete error:", error);
    } else {
      counts.external_purchase_tokens = count ?? 0;
      console.log(
        `[retention-cleanup] external_purchase_tokens deleted: ${counts.external_purchase_tokens}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 5. trancall_billing.webhook_events — received_at < 30d ago
  //    処理済み webhook イベントは 30 日で削除
  //    (監査要件: billing-detail.md / production-runbook.md §10.1)
  // -------------------------------------------------------------------------
  {
    const thirtyDaysAgo = daysAgo(30);
    const { count, error } = await supabase
      .schema("trancall_billing")
      .from("webhook_events")
      .delete({ count: "exact" })
      .lt("received_at", thirtyDaysAgo);

    if (error) {
      errors.push(`webhook_events: ${error.message}`);
      console.error("[retention-cleanup] webhook_events delete error:", error);
    } else {
      counts.webhook_events = count ?? 0;
      console.log(`[retention-cleanup] webhook_events deleted: ${counts.webhook_events}`);
    }
  }

  // -------------------------------------------------------------------------
  // 6. trancall_billing.usage_reservations — completed 7 日以上前
  //    status IN ('reconciled','expired') AND reconciled_at < 7d ago
  //    (T-60 仕様 / 00001_initial_schema.sql §9)
  // -------------------------------------------------------------------------
  {
    const sevenDaysAgo = daysAgo(7);
    const { count, error } = await supabase
      .schema("trancall_billing")
      .from("usage_reservations")
      .delete({ count: "exact" })
      .in("status", ["reconciled", "expired"])
      .lt("reconciled_at", sevenDaysAgo);

    if (error) {
      errors.push(`usage_reservations: ${error.message}`);
      console.error("[retention-cleanup] usage_reservations delete error:", error);
    } else {
      counts.usage_reservations = count ?? 0;
      console.log(`[retention-cleanup] usage_reservations deleted: ${counts.usage_reservations}`);
    }
  }

  // -------------------------------------------------------------------------
  // 7. 退会 grace period 経過済みユーザーの物理削除
  //    trancall_auth.profiles の deleted_at IS NOT NULL AND deleted_at < 30d ago
  //    → (a) profiles(user_id) を NO ACTION で参照する子テーブルを NULL 化/DELETE
  //    → (b) user_consents.user_id を per-user 決定論的 UUID に anonymize
  //    → (c) auth.users を Supabase Admin API で削除 (CASCADE で profiles も削除)
  //    docs/account-deletion.md §猶予期間 / §Supabase Auth / §TODO (T-29)
  //    Issue #07/#45: (a) を追加しないと (c) が必ず FK 違反で失敗する。
  //    NOTE: この処理は最後に実行 (profiles が物理削除されると FK が壊れるため)
  // -------------------------------------------------------------------------
  {
    const anonymizeSalt = Deno.env.get("ANONYMIZE_SALT");
    if (!anonymizeSalt || anonymizeSalt.length < 32) {
      errors.push("anonymize_salt: ANONYMIZE_SALT が未設定または 32 文字未満です");
      console.error("[retention-cleanup] ANONYMIZE_SALT is missing or too short");
    } else {
      const gracePeriodCutoff = daysAgo(30);

      // deleted_at が grace period を過ぎた profiles を取得
      const { data: deletedProfiles, error: fetchError } = await supabase
        .schema("trancall_auth")
        .from("profiles")
        .select("user_id")
        .not("deleted_at", "is", null)
        .lt("deleted_at", gracePeriodCutoff);

      if (fetchError) {
        errors.push(`deleted_users_fetch: ${fetchError.message}`);
        console.error("[retention-cleanup] deleted_users fetch error:", fetchError);
      } else if (deletedProfiles && deletedProfiles.length > 0) {
        let deletedCount = 0;
        for (const profile of deletedProfiles) {
          const originalUserId: string = profile.user_id;

          // (a) profiles(user_id) を ON DELETE NO ACTION で参照する子テーブルを
          //     NULL 化/DELETE して切り離す (Issue #07/#45)。
          //     00019_relax_account_deletion_fk_constraints.sql で対象列を NULL 許容化済み。
          const cleanupResult = await clearFkBlockingReferences(supabase, originalUserId);
          if (!cleanupResult.ok) {
            errors.push(
              `fk_cleanup(${originalUserId}) step=${cleanupResult.step}: ${cleanupResult.message}`,
            );
            console.error(
              `[retention-cleanup] FK cleanup error for ${originalUserId} at step ${cleanupResult.step}:`,
              cleanupResult.message,
            );
            // FK 切り離しに失敗したユーザーは以降の anonymize / 削除をスキップし安全側に倒す
            // (次回実行でリトライされる)
            continue;
          }
          const c = cleanupResult.counts;
          counts.pre_delete_cleanup.rooms_created_by_nulled += c.rooms_created_by_nulled;
          counts.pre_delete_cleanup.participants_nulled += c.participants_nulled;
          counts.pre_delete_cleanup.report_events_reporter_nulled += c.report_events_reporter_nulled;
          counts.pre_delete_cleanup.report_events_reported_nulled += c.report_events_reported_nulled;
          counts.pre_delete_cleanup.subscriptions_nulled += c.subscriptions_nulled;
          counts.pre_delete_cleanup.usage_windows_nulled += c.usage_windows_nulled;
          counts.pre_delete_cleanup.usage_reservations_deleted_fallback +=
            c.usage_reservations_deleted_fallback;
          counts.pre_delete_cleanup.transcript_access_deleted_fallback +=
            c.transcript_access_deleted_fallback;
          counts.pre_delete_cleanup.external_purchase_tokens_deleted_fallback +=
            c.external_purchase_tokens_deleted_fallback;
          counts.pre_delete_cleanup.invite_links_used_by_nulled += c.invite_links_used_by_nulled;
          counts.pre_delete_cleanup.room_reservation_sessions_deleted_fallback +=
            c.room_reservation_sessions_deleted_fallback;
          console.log(`[retention-cleanup] FK references cleared for ${originalUserId}:`, c);

          // (b) user_consents.user_id を per-user 決定論的 UUID に anonymize
          //     UNIQUE(user_id, scope, version) 制約を保持するため per-user 固定 UUID を使用。
          //     00019 migration で user_consents.user_id の FK 制約を削除済みのため、
          //     profiles に実在しない匿名 UUID への UPDATE も成功する。
          //     docs/account-deletion.md §TODO (T-29) 対処案 1 採用
          const anonymizedId = await deriveAnonymizedUserId(originalUserId, anonymizeSalt);
          const { error: anonymizeError } = await supabase
            .schema("trancall_auth")
            .from("user_consents")
            .update({ user_id: anonymizedId })
            .eq("user_id", originalUserId);

          if (anonymizeError) {
            errors.push(`user_consents_anonymize(${originalUserId}): ${anonymizeError.message}`);
            console.error(
              `[retention-cleanup] user_consents anonymize error for ${originalUserId}:`,
              anonymizeError,
            );
            // anonymize に失敗したユーザーは削除をスキップして安全側に倒す
            continue;
          }
          console.log(`[retention-cleanup] user_consents anonymized: ${originalUserId} → ${anonymizedId}`);

          // (c) auth.users を Supabase Admin API で削除
          //     CASCADE で trancall_auth.profiles、および profiles を
          //     ON DELETE CASCADE で参照する contacts / block_list / device_tokens /
          //     invite_links(所有者側) も連動して削除される。
          //     (a) で NO ACTION FK は全て切り離し済みのため、ここで FK 違反は発生しない。
          const { error: deleteError } = await supabase.auth.admin.deleteUser(originalUserId);
          if (deleteError) {
            errors.push(`auth_user_delete(${originalUserId}): ${deleteError.message}`);
            console.error(
              `[retention-cleanup] auth.users delete error for ${originalUserId}:`,
              deleteError,
            );
          } else {
            deletedCount++;
          }
        }
        counts.deleted_auth_users = deletedCount;
        console.log(`[retention-cleanup] auth.users deleted: ${counts.deleted_auth_users}`);
      } else {
        console.log("[retention-cleanup] no expired deleted users found");
      }
    }
  }

  // -------------------------------------------------------------------------
  // 実行記録を trancall_audit.retention_runs に書き込む
  // 00011_add_retention_audit_table.sql で作成するテーブル
  // -------------------------------------------------------------------------
  const ended_at = new Date().toISOString();
  const run_id = crypto.randomUUID();

  {
    const { error: auditError } = await supabase
      .schema("trancall_audit")
      .from("retention_runs")
      .insert({
        run_id,
        started_at,
        ended_at,
        deletion_counts: counts,
        errors: errors.length > 0 ? errors : null,
      });

    if (auditError) {
      // 監査ログの書き込み失敗は warning として記録するが、全体の成否には影響させない
      console.error("[retention-cleanup] audit log write error:", auditError);
      errors.push(`audit_log: ${auditError.message}`);
    } else {
      console.log(`[retention-cleanup] audit log written: run_id=${run_id}`);
    }
  }

  // -------------------------------------------------------------------------
  // 結果返却
  // -------------------------------------------------------------------------
  const result: RetentionResult = {
    ok: errors.length === 0,
    run_id,
    started_at,
    ended_at,
    deletion_counts: counts,
    errors,
  };

  console.log("[retention-cleanup] completed", result);

  if (errors.length > 0) {
    // 部分失敗: Sentry に通知させるため 500 を返す
    // docs/production-runbook.md §10.3 / §14.6 retention_batch_failure alert
    return new Response(JSON.stringify(result), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
