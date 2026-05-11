/**
 * 通知エンドポイント
 *
 * POST /api/notifications/register
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { NotificationFacade } from "@trancall/notification";
import { getHttpStatus } from "../middleware/error-handler.js";

const RegisterIosSchema = z.object({
  platform: z.literal("ios"),
  voipToken: z.string().min(1),
  bundleId: z.string().min(1),
});

const RegisterAndroidSchema = z.object({
  platform: z.literal("android"),
  fcmToken: z.string().min(1),
});

const RegisterDeviceSchema = z.discriminatedUnion("platform", [
  RegisterIosSchema,
  RegisterAndroidSchema,
]);

export function registerNotificationRoutes(
  fastify: FastifyInstance,
  deps: { notification: NotificationFacade },
): void {
  const { notification } = deps;

  // POST /api/notifications/register
  fastify.post("/api/notifications/register", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = RegisterDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          retryable: false,
        },
      });
    }

    const result = await notification.registerDevice(request.userId, parsed.data);
    if (!result.ok) {
      return reply.status(getHttpStatus(result.error.code)).send({ ok: false, error: result.error });
    }
    return reply.send({ ok: true, data: true });
  });
}
