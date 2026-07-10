/**
 * PlanCalculator — プラン別の分数・超過料金計算
 *
 * billing-detail.md の amount_yen 計算式に準拠:
 * - 含有分残あり: amount_yen = 0
 * - 含有分切れ:   amount_yen = ceil(seconds / 60 * overage_rate_yen)
 * - 跨ぎ window（残 N 秒 + 超過 M 秒）:
 *     含有部分: 0 円
 *     超過部分: ceil(M / 60 * overage_rate_yen) 円
 *
 * M-002-NEW: CEIL(SUM::numeric / 60) で整数除算回避（切り上げ）
 */

import type { PlanConfig } from "../schemas";

export interface AmountYenResult {
  amountYen: number;
  /** 含有分消費秒数 */
  includedSeconds: number;
  /** 超過秒数 */
  overageSeconds: number;
}

/**
 * heartbeat ウィンドウの amount_yen を計算する。
 *
 * @param plan プラン設定
 * @param remainingSeconds 含有分の残り秒数（0 以上）
 * @param windowSeconds このウィンドウの秒数（通常 30 秒）
 */
export function calcAmountYen(
  plan: PlanConfig,
  remainingSeconds: number,
  windowSeconds: number,
): AmountYenResult {
  if (remainingSeconds >= windowSeconds) {
    // 全て含有分で賄える
    return {
      amountYen: 0,
      includedSeconds: windowSeconds,
      overageSeconds: 0,
    };
  }

  // 超過分
  const includedSeconds = Math.max(0, remainingSeconds);
  const overageSeconds = windowSeconds - includedSeconds;

  const amountYen =
    plan.overageRateYen === 0
      ? 0
      : Math.ceil((overageSeconds / 60) * plan.overageRateYen);

  return {
    amountYen,
    includedSeconds,
    overageSeconds,
  };
}

/**
 * 消費秒数合計から使用分数を切り上げで計算する。
 * M-002-NEW: CEIL(SUM::numeric / 60)
 */
export function calcUsedMinutes(usedSeconds: number): number {
  if (usedSeconds <= 0) return 0;
  return Math.ceil(usedSeconds / 60);
}

/**
 * 含有分の残り秒数を計算する。
 * usedSeconds から含有分秒数を引いた残り（0 以上）。
 */
export function calcRemainingSeconds(
  plan: PlanConfig,
  usedSeconds: number,
): number {
  const includedSeconds = plan.includedMinutes * 60;
  return Math.max(0, includedSeconds - usedSeconds);
}

/**
 * 残り分数（切り捨て）を計算する。
 */
export function calcRemainingMinutes(
  plan: PlanConfig,
  usedSeconds: number,
): number {
  const remainingSeconds = calcRemainingSeconds(plan, usedSeconds);
  return Math.floor(remainingSeconds / 60);
}

/**
 * shouldContinue の判定:
 * 残量 > 0 または支払い方法が登録されている場合は継続可。
 * Free プランでは超過課金がないため、残量 0 で停止。
 */
export function shouldContinue(
  plan: PlanConfig,
  remainingSeconds: number,
  hasPaymentMethod: boolean,
): boolean {
  if (remainingSeconds > 0) return true;
  // Free プランは超過課金なし → 残量 0 で停止
  if (plan.overageRateYen === 0) return false;
  return hasPaymentMethod;
}
