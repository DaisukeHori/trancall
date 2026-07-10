/**
 * 連絡先エンドポイント
 *
 * GET    /api/contacts
 * POST   /api/contacts
 * DELETE /api/contacts/:id
 * GET    /api/contacts/search?q=
 * POST   /api/contacts/invite-link
 * POST   /api/contacts/block
 * POST   /api/contacts/report
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { ContactFacade } from "@trancall/contact";
import { brandUserId } from "@trancall/shared-kernel";
import { getHttpStatus } from "../middleware/error-handler.js";
import { createInMemoryRateLimitStore, createRateLimiter } from "../lib/rate-limit.js";

const AddContactSchema = z.object({
  contactUserId: z.uuid(),
});

const BlockSchema = z.object({
  blockedUserId: z.uuid(),
  reason: z.string().optional(),
});

const ReportSchema = z.object({
  reportedUserId: z.uuid(),
  reason: z.enum(["spam", "harassment", "impersonation", "other"]),
  details: z.string().optional(),
});

// 確定#3: 最小 1 文字は既存要件のまま維持しつつ、上限なしだと DB への ILIKE 検索に
// 任意長の文字列 (エスケープ処理コストや意図しない負荷) を渡せてしまうため、
// 上限のみ追加する (display_name は DB 上 VARCHAR(50) のため、それより十分大きい値に設定)。
const SearchQuerySchema = z.object({
  q: z.string().min(1).max(100),
});

export function registerContactRoutes(
  fastify: FastifyInstance,
  deps: { contact: ContactFacade },
): void {
  const { contact } = deps;

  // #34: docs/security-detail.md canonical — /api/contacts/search は 10 req/min/user、
  // /api/contacts/invite-link は 10 req/hour/user。
  // NOTE: in-memory store は Vercel serverless ではインスタンスごとに分断されるため
  // グローバルな制限としては実効性が限定的 (rate-limit.ts の JSDoc 参照)。
  const searchRateLimiter = createRateLimiter(createInMemoryRateLimitStore(), 10, 60_000);
  const inviteLinkRateLimiter = createRateLimiter(createInMemoryRateLimitStore(), 10, 60 * 60_000);

  // GET /api/contacts
  fastify.get("/api/contacts", async (request: FastifyRequest, reply: FastifyReply) => {
    const entries = await contact.listContacts(request.userId);
    return reply.send({ ok: true, data: entries });
  });

  // POST /api/contacts
  fastify.post("/api/contacts", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = AddContactSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "contactUserId は必須です", retryable: false },
      });
    }

    const contactUserIdResult = brandUserId(parsed.data.contactUserId);
    if (!contactUserIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "contactUserId は UUID 形式です", retryable: false },
      });
    }

    const result = await contact.addContact({
      userId: request.userId,
      contactUserId: contactUserIdResult.data,
    });

    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(201).send({ ok: true, data: result.data });
  });

  // DELETE /api/contacts/:id
  fastify.delete("/api/contacts/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsedParams = z.object({ id: z.string() }).safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "id は必須です", retryable: false } });
    }
    const { id } = parsedParams.data;
    const result = await contact.removeContact(request.userId, id);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: true });
  });

  // GET /api/contacts/search
  fastify.get("/api/contacts/search", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!searchRateLimiter.check(request.userId)) {
      return reply.status(429).send({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "検索リクエストが多すぎます。しばらくお待ちください。",
          retryable: true,
        },
      });
    }

    const parsed = SearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "q パラメータは必須です", retryable: false },
      });
    }

    const results = await contact.searchUsers(parsed.data.q, request.userId);
    return reply.send({ ok: true, data: results });
  });

  // POST /api/contacts/invite-link
  fastify.post("/api/contacts/invite-link", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!inviteLinkRateLimiter.check(request.userId)) {
      return reply.status(429).send({
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "招待リンクの発行上限に達しました。しばらくお待ちください。",
          retryable: true,
        },
      });
    }

    const result = await contact.createInviteLink(request.userId);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.status(201).send({ ok: true, data: { url: result.data.url, expiresAt: result.data.expiresAt } });
  });

  // POST /api/contacts/block
  fastify.post("/api/contacts/block", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = BlockSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "blockedUserId は必須です", retryable: false },
      });
    }

    const blockedUserIdResult = brandUserId(parsed.data.blockedUserId);
    if (!blockedUserIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "blockedUserId は UUID 形式です", retryable: false },
      });
    }

    const result = await contact.blockUser({
      userId: request.userId,
      blockedUserId: blockedUserIdResult.data,
      reason: parsed.data.reason,
    });

    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: true });
  });

  // POST /api/contacts/report
  fastify.post("/api/contacts/report", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = ReportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "入力が無効です", retryable: false },
      });
    }

    const reportedUserIdResult = brandUserId(parsed.data.reportedUserId);
    if (!reportedUserIdResult.success) {
      return reply.status(400).send({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "reportedUserId は UUID 形式です", retryable: false },
      });
    }

    const result = await contact.reportUser({
      userId: request.userId,
      reportedUserId: reportedUserIdResult.data,
      reason: parsed.data.reason,
      details: parsed.data.details,
    });

    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: true });
  });
}
