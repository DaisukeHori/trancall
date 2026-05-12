/**
 * サポート問い合わせエンドポイント (Sprint 3 T-10 新規)
 *
 * POST /api/support/inquiry — お問い合わせ送信
 *
 * docs/support-flow.md §6 に基づく実装
 * Rate limit: 5 req / hour / userId (support-flow.md §6.2)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
// =============================================================================
// Zod スキーマ (docs/support-flow.md §6.1)
// =============================================================================

const SupportCategorySchema = z.enum([
  "bug",
  "billing",
  "feature_request",
  "privacy",
  "other",
]);

const DiagnosticDataSchema = z.object({
  appVersion: z.string().max(32),
  osVersion: z.string().max(64),
  deviceModel: z.string().max(128),
  submittedAt: z.iso.datetime(),
  locale: z.string().max(16),
  callHistoryLast7d: z.number().int().nonnegative(),
  subscriptionTier: z.enum(["free", "light", "standard", "business"]).optional(),
});

const SupportInquirySchema = z.object({
  category: SupportCategorySchema,
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
  diagnosticData: DiagnosticDataSchema,
});

// SUPPORT_LIMIT_PER_HOUR は registerSupportRoutes スコープ内に移動 (テスト間汚染防止)

// =============================================================================
// ヘルパー
// =============================================================================

function generateTicketId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `TC-${date}-${suffix}`;
}

function estimateResponseHours(category: z.infer<typeof SupportCategorySchema>): number {
  switch (category) {
    case "billing": return 24;
    case "bug":
    case "privacy":
    case "other": return 48;
    case "feature_request": return 120;
  }
}

function anonymizeUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 8);
}

type SupportInquiry = z.infer<typeof SupportInquirySchema>;

function buildEmailHtml(params: {
  inquiry: SupportInquiry;
  ticketId: string;
  anonymizedUserId: string;
  userEmail: string;
}): string {
  const { inquiry, ticketId, anonymizedUserId, userEmail } = params;
  const categoryLabel: Record<string, string> = {
    bug: "バグ報告",
    billing: "課金・お支払い",
    feature_request: "機能要望",
    privacy: "プライバシー",
    other: "その他",
  };
  const label = categoryLabel[inquiry.category] ?? inquiry.category;
  const subjectText = inquiry.subject ?? "（なし）";
  const tierText = inquiry.diagnosticData.subscriptionTier ?? "不明";

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8" /></head>
<body style="font-family: sans-serif; max-width: 640px; margin: auto; padding: 24px;">
  <h2 style="color: #0A7AFF;">TranCall サポートリクエスト</h2>
  <p><strong>チケット ID:</strong> ${ticketId}</p>
  <p><strong>カテゴリ:</strong> ${label}</p>
  <p><strong>件名:</strong> ${subjectText}</p>
  <hr />
  <h3>本文</h3>
  <pre style="white-space: pre-wrap; background: #f5f5f5; padding: 16px; border-radius: 8px;">${inquiry.body}</pre>
  <hr />
  <h3>診断情報 (自動添付)</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 8px;"><strong>User ID (匿名化)</strong></td><td>${anonymizedUserId}</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>アプリバージョン</strong></td><td>${inquiry.diagnosticData.appVersion}</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>OS / 端末</strong></td><td>${inquiry.diagnosticData.osVersion} / ${inquiry.diagnosticData.deviceModel}</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>送信日時</strong></td><td>${inquiry.diagnosticData.submittedAt} (UTC)</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>ロケール</strong></td><td>${inquiry.diagnosticData.locale}</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>直近 7 日の通話数</strong></td><td>${inquiry.diagnosticData.callHistoryLast7d} 件</td></tr>
    <tr><td style="padding: 4px 8px;"><strong>プラン</strong></td><td>${tierText}</td></tr>
  </table>
  <hr />
  <p style="color: #999; font-size: 12px;">
    このメールは TranCall アプリから自動送信されました。
    返信すると ${userEmail} に届きます。
  </p>
</body>
</html>`;
}

function buildEmailText(params: {
  inquiry: SupportInquiry;
  ticketId: string;
  anonymizedUserId: string;
  userEmail: string;
}): string {
  const { inquiry, ticketId, anonymizedUserId, userEmail } = params;
  const tierText = inquiry.diagnosticData.subscriptionTier ?? "不明";
  return [
    `TranCall サポートリクエスト`,
    `チケット ID: ${ticketId}`,
    `カテゴリ: ${inquiry.category}`,
    `件名: ${inquiry.subject ?? "（なし）"}`,
    ``,
    `本文:`,
    inquiry.body,
    ``,
    `診断情報:`,
    `User ID (匿名化): ${anonymizedUserId}`,
    `アプリバージョン: ${inquiry.diagnosticData.appVersion}`,
    `OS / 端末: ${inquiry.diagnosticData.osVersion} / ${inquiry.diagnosticData.deviceModel}`,
    `送信日時: ${inquiry.diagnosticData.submittedAt}`,
    `ロケール: ${inquiry.diagnosticData.locale}`,
    `直近 7 日の通話数: ${inquiry.diagnosticData.callHistoryLast7d} 件`,
    `プラン: ${tierText}`,
    ``,
    `返信先: ${userEmail}`,
  ].join("\n");
}

/**
 * Resend SDK を動的 import でロードする (任意の DI 注入のため)
 * RESEND_API_KEY が未設定の場合はログのみ出力して ok を返す (テスト環境用)
 */
async function sendSupportEmail(params: {
  userId: string;
  userEmail: string;
  inquiry: SupportInquiry;
  ticketId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resendApiKey = process.env["RESEND_API_KEY"];

  const anonymizedUserId = anonymizeUserId(params.userId);
  const htmlBody = buildEmailHtml({ ...params, anonymizedUserId });
  const textBody = buildEmailText({ ...params, anonymizedUserId });

  const categoryLabel: Record<string, string> = {
    bug: "バグ報告",
    billing: "課金・お支払い",
    feature_request: "機能要望",
    privacy: "プライバシー",
    other: "その他",
  };
  const label = categoryLabel[params.inquiry.category] ?? params.inquiry.category;
  const subject = `[TranCall][${label}] ${params.inquiry.subject ?? "件名なし"} - Ticket #${params.ticketId}`;

  if (!resendApiKey) {
    // テスト/開発環境: ログ出力のみ
    console.info("[support] email (dev mode, not sent):", { subject, to: "support@trancall.app" });
    return { ok: true };
  }

  try {
    // Resend SDK を動的 import (optional peer dependency)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resend } = require("resend") as { Resend: new (key: string) => { emails: { send: (opts: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } } };
    const resend = new Resend(resendApiKey);
    const result = await resend.emails.send({
      from: "TranCall サポート <support-bot@trancall.app>",
      replyTo: params.userEmail,
      to: "support@trancall.app",
      subject,
      html: htmlBody,
      text: textBody,
    });

    if (result.error != null) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

// =============================================================================
// Route 登録
// =============================================================================

export function registerSupportRoutes(
  fastify: FastifyInstance,
  _deps: Record<string, never>,
): void {
  /**
   * Rate limit カウンター (in-memory, per-user, per-instance)
   * support 5 req / hour — support-flow.md §6.2
   * NOTE: Map を関数スコープに置くことでテスト時のインスタンス間汚染を防ぐ
   */
  const supportRateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const SUPPORT_LIMIT_PER_HOUR = 5;

  function checkSupportRateLimit(userId: string): boolean {
    const now = Date.now();
    const entry = supportRateLimitMap.get(userId);
    if (!entry || now > entry.resetAt) {
      supportRateLimitMap.set(userId, { count: 1, resetAt: now + 3_600_000 });
      return true;
    }
    if (entry.count >= SUPPORT_LIMIT_PER_HOUR) return false;
    entry.count++;
    return true;
  }

  // POST /api/support/inquiry
  fastify.post("/api/support/inquiry", async (request: FastifyRequest, reply: FastifyReply) => {
    // Rate limit チェック (5 req/hour/user)
    if (!checkSupportRateLimit(request.userId)) {
      return reply.status(429).send({
        ok: false,
        error: {
          code: "SUPPORT_RATE_LIMIT_EXCEEDED",
          message: "送信上限に達しました。1時間後に再試行してください。",
          retryable: false,
        },
      });
    }

    // リクエストボディのバリデーション
    const parsed = SupportInquirySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        ok: false,
        error: {
          code: "SUPPORT_INVALID_BODY",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          retryable: false,
        },
      });
    }

    const inquiry = parsed.data;
    const ticketId = generateTicketId();

    // userId から userEmail を取得 (JWT のメタデータから、または Supabase Auth 経由)
    // request.userEmail は auth-middleware で設定される想定
    // 未設定の場合は "unknown@trancall.app" を代替として使用
    const userEmail = (request as FastifyRequest & { userEmail?: string }).userEmail ?? "unknown@trancall.app";

    // メール送信
    const emailResult = await sendSupportEmail({
      userId: request.userId,
      userEmail,
      inquiry,
      ticketId,
    });

    if (!emailResult.ok) {
      return reply.status(503).send({
        ok: false,
        error: {
          code: "SUPPORT_MAIL_SEND_FAILED",
          message: `メール送信に失敗しました。しばらくしてから再試行するか、support@trancall.app に直接メールをお送りください。`,
          retryable: true,
        },
      });
    }

    const estimatedResponseHours = estimateResponseHours(inquiry.category);

    return reply.status(200).send({
      ok: true,
      data: {
        ticketId,
        estimatedResponseHours,
      },
    });
  });
}
