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
 *      NOTE: auth.users の直接削除は Supabase Admin API 経由 (service_role key が必要)
 *
 * 完了後、trancall_audit.retention_runs テーブルに実行記録を書き込む。
 * docs/production-runbook.md §10 / §10.1 / §10.2 / §16.4 canonical
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  //    → auth.users を Supabase Admin API で削除 (CASCADE で profiles も削除)
  //    docs/account-deletion.md §猶予期間 / §Supabase Auth
  //    NOTE: この処理は最後に実行 (profiles が物理削除されると FK が壊れるため)
  // -------------------------------------------------------------------------
  {
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
      // Supabase Admin API で auth.users を削除 (service_role key 使用)
      let deletedCount = 0;
      for (const profile of deletedProfiles) {
        const { error: deleteError } = await supabase.auth.admin.deleteUser(profile.user_id);
        if (deleteError) {
          errors.push(`auth_user_delete(${profile.user_id}): ${deleteError.message}`);
          console.error(
            `[retention-cleanup] auth.users delete error for ${profile.user_id}:`,
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
