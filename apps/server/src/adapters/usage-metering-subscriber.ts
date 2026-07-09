/**
 * Usage Metering Subscriber — #46
 *
 * `translation.ended` DomainEvent を購読し、`billing.recordUsage` (+ `billing.reconcile`) を
 * 呼び出す。packages/billing/CLAUDE.md が定義する「購読するドメインイベント: translation.ended」を
 * 実装するのはこのファイルであり、container.ts の buildContainer() から配線される。
 *
 * ---------------------------------------------------------------------------
 * 【設計判断】sessionId 対応付け (#46 申し送り事項への回答)
 * ---------------------------------------------------------------------------
 * `translation.ended` の payload.sessionId は Agent が採番した
 * `trancall_event.translation_sessions.id` (packages/translation 管掌) である。一方、billing の
 * 予約 (reserveMinutes) / 精算 (reconcile) は apps/server/src/routes/room-routes.ts が通話作成時に
 * 独自採番して billing.reserveMinutes に渡す sessionId (TranslationSessionId) を使う。この 2 つの
 * sessionId は無関係の別 UUID であり、そのまま recordUsage に渡すと usage_windows.session_id が
 * 予約の session_id と一致せず、reconcile の `usageRepo.findBySessionId(sessionId)` (packages/
 * billing/src/services/reservation-service.ts) が対象を見つけられなくなる。
 *
 * 「packages/billing のインターフェースは変更しない」方針のため、billing 側に roomId → 予約を
 * 引く手段を追加すること (案 (a): reserveMinutes 時に usage_reservations へ roomId を保存し
 * roomId で引けるようにする) はできない。そのため案 (b) を採用する: apps/server 層
 * (RoomReservationSessionRepository, trancall_billing.room_reservation_sessions テーブル、
 * supabase/migrations/00020_add_room_reservation_sessions_table.sql) に roomId → 予約 sessionId /
 * userId の対応付けを持たせ、本購読者が roomId からこれを解決してから recordUsage / reconcile を
 * 呼ぶ。room-routes.ts 内 in-memory Map (roomSessionMap) だった旧実装はサーバー再起動や
 * マルチインスタンス (Vercel 等) で失われるため、DB ベースに置き換えた
 * (room-routes.ts も同じ RoomReservationSessionRepository を使うよう更新済み)。
 *
 * ---------------------------------------------------------------------------
 * languagePair
 * ---------------------------------------------------------------------------
 * `translation.ended` payload には outputLanguage のみ含まれ、話者の原語 (sourceLanguage) は
 * 含まれない。auth.getProfile(sourceParticipantId) で話者の nativeLanguage を best-effort で
 * 解決し `${nativeLanguage}-${outputLanguage}` を組み立てる (取得失敗時は "unknown-<output>" に
 * フォールバック。apps/server/src/routes/agent-routes.ts の persistFinalTranscriptSegment と
 * 同じパターン)。
 *
 * ---------------------------------------------------------------------------
 * 冪等性 (二重記録防止)
 * ---------------------------------------------------------------------------
 * idempotencyKey は `translation-ended:${payload.sessionId}` (Agent 採番の translation
 * sessionId、1 セッションにつき 1 回だけ ended が発行される想定) から導出する。
 * usage_windows.idempotency_key の UNIQUE 制約により、translation.ended の重複配信
 * (Agent の HTTP リトライ等) があっても insertWindowIdempotent が 23505 を吸収し、
 * usage_windows への二重挿入は起きない (apps/server/src/adapters/repositories/billing/
 * usage-repository.supabase.ts 参照)。
 *
 * ---------------------------------------------------------------------------
 * エラー方針 (best-effort, rethrow しない)
 * ---------------------------------------------------------------------------
 * EventBus.publish (apps/server/src/adapters/event-bus.ts) は全 handler を Promise.all で待ち、
 * 失敗を rethrow する実装である。このハンドラで投げると `/internal/agent/events`
 * (translation.session_ended) のレスポンス自体が 500 になり Agent のリトライを誘発し、
 * transcript 永続化等ほかの副作用まで巻き込みかねない。課金メータリングの失敗はここで
 * 握りつぶし warn ログのみ残す (billing.reserveMinutes / billing.reconcile 失敗時の
 * room-routes.ts の既存 best-effort パターンと同じ)。
 *
 * reconcile については、room-routes.ts の /leave (#53) が通常 translation.ended より先に
 * (client 主導の同期処理として) reconcile を呼ぶため、ここでの reconcile 呼び出しは
 * 「status='active' の予約が既に無い」ことによる Result エラーで空振りすることがある
 * (packages/billing の ReservationRepository.reconcile は再 reconcile 時に見つからない行を
 * エラーとして返す非 null 契約のため)。これは usage_reservations.consumed_minutes の
 * 更新が遅延/省略されるだけで、月次利用量の正とする usage_windows
 * (subscriptionRepo.getUsedSecondsInPeriod が参照する) には影響しない — recordUsage が
 * usage_windows へ挿入できていれば #46 の核心 (「全プラン実質無制限」) は解消される。
 * この残存レースは W2d への申し送り事項として報告する。
 */
import type { EventBus } from "./event-bus.js";
import type { BillingFacade } from "@trancall/billing";
import type { AuthFacade } from "@trancall/auth";
import type { RoomReservationSessionRepository } from "./repositories/billing/room-reservation-session-repository.supabase.js";
import { brandUserId, brandTranslationSessionId } from "@trancall/shared-kernel";
import { logger } from "../logger.js";

export interface UsageMeteringSubscriberDeps {
  billing: BillingFacade;
  auth: AuthFacade;
  roomReservationSessionRepo: RoomReservationSessionRepository;
}

/**
 * `translation.ended` の購読を開始する。戻り値は unsubscribe 関数
 * (EventBus.subscribe の戻り値をそのまま返す。呼び出し元 (container.ts) は通常プロセス生存中
 * 購読し続けるため使わないが、テストや将来の再構築のために公開しておく)。
 */
export function registerUsageMeteringSubscriber(
  eventBus: EventBus,
  deps: UsageMeteringSubscriberDeps,
): () => void {
  const { billing, auth, roomReservationSessionRepo } = deps;

  return eventBus.subscribe("translation.ended", async (event) => {
    const { payload } = event;

    // roomId → billing 予約の (userId, sessionId) を解決する
    const mappingResult = await roomReservationSessionRepo.findByRoomId(payload.roomId);
    if (!mappingResult.ok) {
      logger.warn("usage metering skipped: room_reservation_sessions lookup failed", {
        roomId: payload.roomId,
        errorCode: mappingResult.error.code,
      });
      return;
    }
    if (mappingResult.data === null) {
      // translationEnabled=false の room / billing.reserveMinutes 失敗 (残高不足等) /
      // 対応付け保存前にプロセスが落ちた等では対応付けが存在しない。billing 予約自体が
      // 存在しない可能性が高く、recordUsage を呼んでも reconcile と整合しないため
      // best-effort でスキップする。
      logger.warn("usage metering skipped: no room_reservation_sessions mapping found", {
        roomId: payload.roomId,
      });
      return;
    }

    const { userId: mappedUserId, sessionId: mappedSessionId } = mappingResult.data;
    const userIdResult = brandUserId(mappedUserId);
    const sessionIdResult = brandTranslationSessionId(mappedSessionId);
    if (!userIdResult.success || !sessionIdResult.success) {
      logger.warn("usage metering skipped: invalid userId/sessionId in room_reservation_sessions", {
        roomId: payload.roomId,
      });
      return;
    }

    // languagePair: 話者の nativeLanguage を best-effort で解決する
    let sourceLanguage = "unknown";
    const speakerUserIdResult = brandUserId(payload.sourceParticipantId);
    if (speakerUserIdResult.success) {
      const profileResult = await auth.getProfile(speakerUserIdResult.data);
      if (profileResult.ok) {
        sourceLanguage = profileResult.data.nativeLanguage;
      } else {
        logger.warn("usage metering: auth.getProfile failed, using fallback languagePair", {
          roomId: payload.roomId,
          errorCode: profileResult.error.code,
        });
      }
    }

    const recordResult = await billing.recordUsage({
      userId: userIdResult.data,
      sessionId: sessionIdResult.data,
      roomId: payload.roomId,
      windowStart: payload.startedAt,
      windowEnd: payload.endedAt,
      durationSeconds: payload.billableSeconds,
      languagePair: `${sourceLanguage}-${payload.outputLanguage}`,
      idempotencyKey: `translation-ended:${payload.sessionId}`,
    });

    if (!recordResult.ok) {
      logger.warn("billing.recordUsage failed (best-effort)", {
        roomId: payload.roomId,
        sessionId: mappedSessionId,
        errorCode: recordResult.error.code,
      });
      return;
    }

    logger.info("usage metering recorded", {
      roomId: payload.roomId,
      sessionId: mappedSessionId,
      billableSeconds: payload.billableSeconds,
    });

    // 予約を reconciled にする (best-effort。room-routes.ts /leave 側の reconcile と
    // レースし得るが、月次利用量の正は usage_windows であるため billing 精度には影響しない。
    // 詳細はファイル先頭の設計判断コメント参照)。
    const reconcileResult = await billing.reconcile(userIdResult.data, sessionIdResult.data);
    if (!reconcileResult.ok) {
      logger.warn("billing.reconcile failed after recordUsage (best-effort, may race with /leave)", {
        roomId: payload.roomId,
        sessionId: mappedSessionId,
        errorCode: reconcileResult.error.code,
      });
    }
  });
}
