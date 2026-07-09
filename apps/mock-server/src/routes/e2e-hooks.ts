import type { Router, Request, Response } from "express";
import { z } from "zod";
import { getState, resetState } from "../state.js";
import { E2E_ROOM_ID } from "../fixtures.js";

const TriggerIncomingCallBodySchema = z.object({
  targetUserId: z.string().optional(),
});

const InjectSubtitleDeltaBodySchema = z.object({
  roomId: z.string().optional(),
  speakerId: z.string().optional(),
  text: z.string().optional(),
  isFinal: z.boolean().optional(),
});

const SetBillingZeroBodySchema = z.object({
  userId: z.string().optional(),
});

export function registerE2eHookRoutes(router: Router): void {
  router.post("/__e2e__/reset", (_req: Request, res: Response) => {
    resetState();
    res.status(200).json({ ok: true, data: { reset: true } });
  });

  router.post("/__e2e__/trigger-incoming-call", (req: Request, res: Response) => {
    const parsedBody = TriggerIncomingCallBodySchema.safeParse(req.body);
    const { targetUserId } = parsedBody.success ? parsedBody.data : {};

    const state = getState();
    state.pendingIncomingCallTarget = targetUserId ?? null;

    res.status(200).json({
      ok: true,
      data: {
        roomId: E2E_ROOM_ID,
        callerId: "user-b-uuid-0000-0000-000000000002",
        callerDisplayName: "E2E User B",
        callerTrancallId: "@e2e_user_b",
        deepLink: `trancall://incoming-call/${E2E_ROOM_ID}`,
      },
    });
  });

  router.post("/__e2e__/inject-subtitle-delta", (req: Request, res: Response) => {
    const parsedBody = InjectSubtitleDeltaBodySchema.safeParse(req.body);
    const { roomId, speakerId, text, isFinal } = parsedBody.success
      ? parsedBody.data
      : {};

    res.status(200).json({
      ok: true,
      data: {
        injected: true,
        roomId: roomId ?? E2E_ROOM_ID,
        speakerId: speakerId ?? "user-b-uuid-0000-0000-000000000002",
        text: text ?? "Mock subtitle delta",
        isFinal: isFinal ?? false,
      },
    });
  });

  router.post("/__e2e__/set-billing-zero", (req: Request, res: Response) => {
    const parsedBody = SetBillingZeroBodySchema.safeParse(req.body);
    const { userId } = parsedBody.success ? parsedBody.data : {};
    const state = getState();

    if (userId) {
      const user = state.users.find((u) => u.userId === userId);
      if (user) user.remainingMinutes = 0;
    } else {
      for (const user of state.users) {
        user.remainingMinutes = 0;
      }
    }

    res.status(200).json({ ok: true, data: { billingZeroed: true } });
  });

  router.get("/__e2e__/state", (_req: Request, res: Response) => {
    const state = getState();
    res.status(200).json({
      ok: true,
      data: {
        userCount: state.users.length,
        contactCount: state.contacts.length,
        roomCount: state.rooms.length,
        sessionCount: state.sessions.size,
        pendingIncomingCallTarget: state.pendingIncomingCallTarget,
      },
    });
  });
}
