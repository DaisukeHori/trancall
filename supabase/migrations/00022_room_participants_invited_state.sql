-- =============================================================================
-- 00022: trancall_room.participants.joined_at を NULL 許容化 (確定#2 認可バイパス修正)
-- =============================================================================
--
-- 背景:
--   敵対的レビュー確定#2: POST /api/rooms/:id/join (packages/room/src/services/
--   join-service.ts) は room の存在/ended チェックのみ行い、招待検証をせず
--   任意の認証済みユーザーを participants に upsert していた。createCall は host
--   のみ participants に登録し、invitee (招待された側) は push 通知を受け取るだけで
--   participants 行を持たなかったため、「招待されているかどうか」を判定する手段が
--   存在しなかった。結果として、roomId さえ入手すれば第三者が自由に join でき、
--   LiveKit token を取得して通話を盗聴したり、POST /leave で通話参加者全員を
--   強制切断する DoS が可能だった。
--
-- 対応方針 (レビュー提案 b):
--   createCall が host に加えて invitee 全員を participants に
--   「招待済み・未参加」ステータスで事前登録する (joined_at: NULL)。
--   joinCall は「既に participant 行がある (= 招待済み or host) ユーザーのみ」
--   join を許可し、行が存在しないユーザーは ROOM_USER_NOT_INVITED で拒否する。
--   実際に join した時点で該当行の joined_at を now() に更新する (role は書き換えない
--   ことで host の再 join による role 降格を防ぐ)。
--
-- 本 migration の変更:
--   joined_at は元々 `NOT NULL DEFAULT now()` だったが、「招待済み・未参加」状態を
--   表現するために NULL を許容する必要があるため NOT NULL 制約を外す。
--   DEFAULT も削除する — 万一アプリ側が誤って joined_at を明示せずに INSERT した場合、
--   従来の DEFAULT now() だと「実際には参加していないのに参加済み」という
--   fail-open な状態が暗黙に生まれてしまう。DEFAULT を外すことで、そのような
--   INSERT は「明示的に値を渡さなければならない」形に倒し、fail-closed にする
--   (トランザクション的には NOT NULL 制約がない列で DEFAULT を省略すると NULL が
--   入るだけなので、これは「未参加」として安全側に倒れる)。
--
-- 影響:
--   - 既存の joined_at 値 (常に非 NULL) はそのまま維持される (ALTER COLUMN は
--     既存行のデータを書き換えない)。
--   - アプリ側の型定義は既に対応済み:
--     - packages/room/src/schemas.ts (ParticipantRowSchema.joined_at: nullable)
--     - apps/server/src/adapters/repositories/room/participant-repository.supabase.ts
--       (ParticipantRow.joined_at: string | null、findOne/markJoined 追加)
--   - 公開契約 (RoomState.participants / Participant.joinedAt) は非 null のまま
--     (buildRoomState が joined_at === null の行を公開 participants から除外するため、
--     招待済み・未参加の行がクライアントに漏れることはない)。
-- =============================================================================

ALTER TABLE trancall_room.participants
  ALTER COLUMN joined_at DROP NOT NULL,
  ALTER COLUMN joined_at DROP DEFAULT;

COMMENT ON COLUMN trancall_room.participants.joined_at IS
  'NULL は「招待済みだがまだ join していない」ことを表す (確定#2 認可バイパス修正)。'
  'createCall が invitee をこの状態で事前登録し、joinCall (実際の参加) 時に '
  'markJoined が now() を設定する。DEFAULT は意図的に外してある '
  '(未指定 INSERT は fail-closed で NULL=未参加になるようにするため)。';
