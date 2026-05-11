/**
 * IAP Adapters — Apple IAP / Google Play ファクトリ
 *
 * 環境変数から各 IAP アダプターを構築する。
 * これらは設定依存なし（billing パッケージ内のファクトリを呼ぶだけ）。
 */

import { createAppleIapAdapter, createGooglePlayAdapter } from "@trancall/billing";
import type { AppleIapAdapter, GooglePlayAdapter } from "@trancall/billing";

export function buildAppleIapAdapter(): AppleIapAdapter {
  return createAppleIapAdapter();
}

export function buildGooglePlayAdapter(): GooglePlayAdapter {
  return createGooglePlayAdapter();
}
