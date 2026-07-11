/**
 * Transcript Access Subscriber — Issue #69 (2)
 *
 * `room.participant_joined` DomainEvent を購読し、通話が成立した時点 (参加者が
 * join した瞬間) で、その room に現在 join 済みの参加者全員に対して
 * `transcript.grantAccess` を呼び、`trancall_transcript.transcript_access` 行を
 * 作成する。
 *
 * ---------------------------------------------------------------------------
 * 【設計判断】なぜ room.participant_joined を購読するか
 * ---------------------------------------------------------------------------
 * `packages/transcript/src/facade.ts` には `accessService.canView()` /
 * `accessService.deleteAccess()` はあったが、アクセス権を「付与/作成」する呼び出しが
 * コードベースのどこにも存在しなかった (Issue #69 調査で判明)。
 * docs/module-contracts.md §3.1 は `room.participant_joined` の購読者を `translation`
 * のみと定義しているが、同 §0.2「モジュール間の通信は facade 経由 / 複数モジュールに
 * またがる場合は server オーケストレーション層で組み合わせる」の原則に従い、
 * room → transcript の直接依存を追加せず apps/server (Layer 3) が
 * `room.getState` + `transcript.grantAccess` を組み合わせて実装する
 * (module-contracts.md 側もこの購読を追記して同期する)。
 *
 * ---------------------------------------------------------------------------
 * 【なぜ host にも grant するのか】
 * ---------------------------------------------------------------------------
 * createCall 時点では host の participant 行だけが登録され、`room.participant_joined`
 * は発行されない (host は joinCall を経由しない)。「通話成立」= 2 人目の参加者が join
 * した瞬間なので、その時点で `room.getState` により room 全体の現在 join 済み参加者
 * 一覧 (host を含む) を取得し、全員に grantAccess する (grantAccess は insert-if-absent
 * で冪等なので、既に付与済みのユーザーに再度呼んでも安全)。
 *
 * ---------------------------------------------------------------------------
 * 【冪等性 / エラー方針】
 * ---------------------------------------------------------------------------
 * grantAccess は「行が無ければ作る」の insert-if-absent (既存行 — 論理削除済みを含む —
 * があれば何もしない) なので、同一 room で複数回発行されても安全。
 * 失敗は best-effort ログのみ (apps/server/src/adapters/usage-metering-subscriber.ts と
 * 同じ方針 — 字幕アクセス権限の作成失敗で通話自体を失敗させない。EventBus.publish は
 * 全 handler を Promise.all で待ち失敗を rethrow するため、ここで投げると
 * room.participant_joined を発行した joinCall のレスポンス自体が失敗してしまう)。
 *
 * ---------------------------------------------------------------------------
 * 【consentVersion】
 * ---------------------------------------------------------------------------
 * legalDocRepo (auth 所有 trancall_auth.consent_versions への読み取り専用リポジトリ、
 * 既に exportTranscript の termsVersion 解決に使われているものを再利用) から
 * `legal_terms` の最新バージョンを取得する。取得できない場合は "unknown" にフォールバック
 * する (exportTranscript と同じフォールバック方針)。
 */
import type { EventBus } from "./event-bus.js";
import type { TranscriptFacade, LegalDocVersionRepository } from "@trancall/transcript";
import type { RoomFacade } from "@trancall/room";
import { logger } from "../logger.js";

export interface TranscriptAccessSubscriberDeps {
  transcript: TranscriptFacade;
  room: RoomFacade;
  legalDocRepo?: LegalDocVersionRepository;
}

/**
 * `room.participant_joined` の購読を開始する。戻り値は unsubscribe 関数。
 */
export function registerTranscriptAccessSubscriber(
  eventBus: EventBus,
  deps: TranscriptAccessSubscriberDeps,
): () => void {
  const { transcript, room, legalDocRepo } = deps;

  return eventBus.subscribe("room.participant_joined", async (event) => {
    const { roomId } = event.payload;

    const stateResult = await room.getState(roomId);
    if (!stateResult.ok) {
      logger.warn("transcript access grant skipped: room.getState failed", {
        roomId,
        errorCode: stateResult.error.code,
      });
      return;
    }

    // consentVersion を legalDocRepo から解決する (未注入 / 取得失敗時は "unknown")
    let consentVersion = "unknown";
    if (legalDocRepo) {
      const versionResult = await legalDocRepo.findLatest("legal_terms");
      if (versionResult.ok && versionResult.data !== null) {
        consentVersion = versionResult.data.version;
      } else if (!versionResult.ok) {
        logger.warn("transcript access grant: legalDocRepo.findLatest failed, using fallback", {
          roomId,
          errorCode: versionResult.error.code,
        });
      }
    }

    // room に現在 join 済み (退会済みの null userId は除外) の参加者全員に grantAccess する。
    const joinedUserIds = stateResult.data.participants
      .map((p) => p.userId)
      .filter((id): id is NonNullable<typeof id> => id !== null);

    const grantResults = await Promise.allSettled(
      joinedUserIds.map((userId) => transcript.grantAccess(roomId, userId, consentVersion)),
    );

    grantResults.forEach((result, index) => {
      const userId = joinedUserIds[index];
      if (result.status === "rejected") {
        logger.warn("transcript.grantAccess threw (best-effort)", {
          roomId,
          userId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        return;
      }
      if (!result.value.ok) {
        logger.warn("transcript.grantAccess failed (best-effort)", {
          roomId,
          userId,
          errorCode: result.value.error.code,
        });
      }
    });
  });
}
