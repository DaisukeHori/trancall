import type { Router, Request, Response } from "express";
import { getState, resetState } from "../state.js";
import { E2E_ROOM_ID } from "../fixtures.js";

export function registerE2eHookRoutes(router: Router): void {
  router.post("/__e2e__/reset", (_req: Request, res: Response) => {
    resetState();
    res.status(200).json({ ok: true, data: { reset: true } });
  });

  router.post("/__e2e__/trigger-incoming-call", (req: Request, res: Response) => {
    const { targetUserId } = req.body as { targetUserId?: string };

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
    const { roomId, speakerId, text, isFinal } = req.body as {
      roomId?: string;
      speakerId?: string;
      text?: string;
      isFinal?: boolean;
    };

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
    const { userId } = req.body as { userId?: string };
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
