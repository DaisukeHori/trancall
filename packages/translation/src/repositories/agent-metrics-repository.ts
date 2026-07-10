/**
 * Agent Metrics リポジトリ インターフェース
 *
 * agent_metrics テーブルへの INSERT のみ。集計は別サービス（BigQuery 等）が担う。
 */

import type { Result } from "@trancall/shared-kernel";

import type { AgentMetricsRecord } from "../schemas";

export interface AgentMetricsRepository {
  /**
   * メトリクスを保存する。
   * 冪等化は agentJobId + collectedAt の複合ユニーク制約で担保。
   */
  insert: (
    record: Omit<AgentMetricsRecord, "id" | "createdAt">,
  ) => Promise<Result<AgentMetricsRecord>>;
}
