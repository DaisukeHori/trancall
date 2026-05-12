/**
 * 配信ログリポジトリ インターフェース
 */

import type { Result } from "@trancall/shared-kernel";

import type { PushLogWrite } from "../schemas.js";

export interface PushLogRepository {
  /**
   * 配信ログを書き込む。
   */
  write(log: PushLogWrite): Promise<Result<true>>;
}
