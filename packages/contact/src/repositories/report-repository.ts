/**
 * ReportRepository — 通報データアクセスインターフェース
 */

import type { Result, UserId } from "@trancall/shared-kernel";
import type { ReportUserCommand } from "../schemas.js";

export interface ReportRepository {
  /**
   * 通報を記録する。
   */
  create(cmd: ReportUserCommand): Promise<Result<true>>;

  /**
   * reporter → reported の通報がすでに存在するか確認する。
   */
  exists(
    reporterId: UserId,
    reportedId: UserId,
  ): Promise<boolean>;
}
