/**
 * ReportService — 通報ドメインサービス
 */

import {
  type Result,
  err,
} from "@trancall/shared-kernel";

import type { ReportUserCommand } from "../schemas.ts";
import type { ReportRepository } from "../repositories/report-repository.ts";

export interface ReportService {
  reportUser(cmd: ReportUserCommand): Promise<Result<true>>;
}

export function createReportService(
  reportRepo: ReportRepository,
): ReportService {
  return {
    reportUser: async (
      cmd: ReportUserCommand,
    ): Promise<Result<true>> => {
      // 自分自身の通報は不可
      if (cmd.userId === cmd.reportedUserId) {
        return err({
          code: "VALIDATION_ERROR",
          message: "自分を通報することはできません",
          retryable: false,
          httpStatus: 400,
        });
      }

      return reportRepo.create(cmd);
    },
  };
}
