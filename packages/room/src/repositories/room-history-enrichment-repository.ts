/**
 * RoomHistoryEnrichmentRepository — DI 要求 (read-only, best-effort)
 *
 * L-13 (通話履歴 GET /api/rooms/history) が必要とする、room モジュール外が所有する
 * データへの read-only アクセス。docs/module-contracts.md §6 依存方向マトリクスでは
 * room → auth / room → billing / room → transcript の facade 直接 import は禁止
 * (❌、`packages/room/CLAUDE.md` 「transcript を直接importしない」等) のため、
 * room は自身の境界としてこのインターフェースを独自定義し、apps/server (Layer 3) が
 * 各モジュール所有の read-only view (auth の `public_profiles`、billing の
 * `usage_windows`、transcript の既存 `AccessRepository.canView`) を満たす形で実装を
 * 注入する。
 *
 * これは `BlockListRepository` (room 自己定義、contact の block_list への
 * read-only view) および `ProfileSearchRepository` (contact 自己定義、auth の
 * profiles への read-only view) と同型の「他モジュール所有データを読むための
 * repository」パターンを踏襲する。
 *
 * **best-effort**: 3 メソッドとも表示上の補足情報 (プロフィール名/課金額/文字起こし有無)
 * のみに使われ、取得失敗が通話履歴一覧の表示そのものを止めてはならない。
 * `RoomFacadeDeps.historyEnrichmentRepo` は optional — 未注入時は
 * `services/history-service.ts` がフォールバック値 (displayName 不明時は userId 由来の
 * プレースホルダ、costYen=0、hasTranscript=false) を用いる。
 */
import type { Result, RoomId, UserId } from "@trancall/shared-kernel";

export interface RoomHistoryParticipantProfile {
  displayName: string;
  trancallId: string;
  avatarUrl: string | null;
}

export interface RoomHistoryEnrichmentRepository {
  /**
   * userId のプロフィール (auth 所有 `trancall_auth.public_profiles` の read-only view)。
   * 見つからない場合 (退会済み等) は data: null。
   */
  getProfile(userId: UserId): Promise<Result<RoomHistoryParticipantProfile | null>>;

  /**
   * 当該 room・当該ユーザーの billing usage 合計額 (円)
   * (billing 所有 `trancall_billing.usage_windows` の read-only 集計)。
   */
  getCostYen(roomId: RoomId, userId: UserId): Promise<Result<number>>;

  /**
   * 当該 room・当該ユーザーの transcript_access.can_view=true かどうか。
   */
  hasTranscript(roomId: RoomId, userId: UserId): Promise<Result<boolean>>;
}
