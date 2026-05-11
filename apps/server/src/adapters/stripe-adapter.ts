/**
 * Stripe Adapter ファクトリ
 *
 * 環境変数から StripeAdapter を構築する。
 */

import { createStripeAdapter } from "@trancall/billing";
import type { StripeAdapter } from "@trancall/billing";
import type { Config } from "../config.js";

export function buildStripeAdapter(config: Config): StripeAdapter {
  return createStripeAdapter({
    secretKey: config.STRIPE_SECRET_KEY,
    webhookSecret: config.STRIPE_WEBHOOK_SECRET,
    priceIds: {
      light: config.STRIPE_PRICE_ID_LIGHT,
      standard: config.STRIPE_PRICE_ID_STANDARD,
      business: config.STRIPE_PRICE_ID_BUSINESS,
    },
    successUrl: config.STRIPE_SUCCESS_URL,
    cancelUrl: config.STRIPE_CANCEL_URL,
  });
}
