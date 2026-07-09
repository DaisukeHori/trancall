import type { Router, Request, Response } from "express";
import { z } from "zod";
import {
  getState,
  getSessionByToken,
  getUserById,
} from "../state.js";
import {
  MOCK_LIVEKIT_TOKEN,
  MOCK_LIVEKIT_URL,
} from "../fixtures.js";

const CreateRoomBodySchema = z.object({
  inviteeIds: z.array(z.string()).optional(),
  roomType: z.enum(["audio", "video"]).optional(),
  translationEnabled: z.boolean().optional(),
});

function extractBearerToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function requireAuth(req: Request, res: Response): string | null {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Missing token", retryable: false },
    });
    return null;
  }
  const session = getSessionByToken(token);
  if (!session) {
    res.status(401).json({
      ok: false,
      error: { code: "AUTH_TOKEN_EXPIRED", message: "Token expired or invalid", retryable: false },
    });
    return null;
  }
  return session.userId;
}

function buildRoomState(roomId: string, userId: string) {
  const state = getState();
  const room = state.rooms.find((r) => r.roomId === roomId);
  if (!room) return null;

  const participants = room.participantIds.map((pid) => {
    const u = getUserById(pid);
    return {
      userId: pid,
      displayName: u?.displayName ?? "Unknown",
      trancallId: u?.trancallId ?? "@unknown",
      avatarUrl: u?.avatarUrl ?? null,
      isHost: pid === room.hostUserId,
    };
  });

  return {
    roomId: room.roomId,
    status: room.status,
    roomType: room.roomType,
    translationEnabled: room.translationEnabled,
    participants,
    myRole: room.hostUserId === userId ? "host" : "member",
    startedAt: room.startedAt,
    endedAt: room.endedAt,
  };
}

export function registerRoomRoutes(router: Router): void {
  router.post("/rooms", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const parsedBody = CreateRoomBodySchema.safeParse(req.body);
    const { inviteeIds, roomType, translationEnabled } = parsedBody.success
      ? parsedBody.data
      : {};

    if (!inviteeIds || inviteeIds.length === 0) {
      res.status(400).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "inviteeIds required", retryable: false },
      });
      return;
    }

    const state = getState();
    const callerUser = getUserById(userId);
    if (callerUser && callerUser.remainingMinutes <= 0) {
      res.status(402).json({
        ok: false,
        error: {
          code: "BILLING_INSUFFICIENT_BALANCE",
          message: "Insufficient translation minutes",
          retryable: false,
        },
      });
      return;
    }

    const newRoom = {
      roomId: `room-${Date.now()}`,
      status: "active" as const,
      roomType: roomType ?? "audio",
      translationEnabled: translationEnabled ?? true,
      hostUserId: userId,
      participantIds: [userId, ...(inviteeIds ?? [])],
      startedAt: new Date().toISOString(),
      endedAt: null,
    };
    state.rooms.push(newRoom);

    setTimeout(() => {
      const r = state.rooms.find((r) => r.roomId === newRoom.roomId);
      if (r && r.status === "active") {
        r.status = "active";
      }
    }, 1500);

    res.status(200).json({ ok: true, data: buildRoomState(newRoom.roomId, userId) });
  });

  router.get("/rooms/history", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const state = getState();
    const endedRooms = state.rooms
      .filter((r) => r.status === "ended" && r.participantIds.includes(userId))
      .map((r) => {
        const participants = r.participantIds.map((pid) => {
          const u = getUserById(pid);
          return {
            userId: pid,
            displayName: u?.displayName ?? "Unknown",
            trancallId: u?.trancallId ?? "@unknown",
            avatarUrl: u?.avatarUrl ?? null,
            isHost: pid === r.hostUserId,
          };
        });
        return {
          roomId: r.roomId,
          status: "ended",
          roomType: r.roomType,
          translationEnabled: r.translationEnabled,
          startedAt: r.startedAt ?? new Date().toISOString(),
          endedAt: r.endedAt ?? new Date().toISOString(),
          durationSeconds: 932,
          participants,
          myRole: r.hostUserId === userId ? "host" : "member",
          costYen: 0,
          hasTranscript: true,
        };
      });

    res.status(200).json({ ok: true, data: { rooms: endedRooms, nextCursor: null } });
  });

  router.get("/rooms/:id", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.params;
    const roomState = buildRoomState(id ?? "", userId);
    if (!roomState) {
      res.status(404).json({
        ok: false,
        error: { code: "ROOM_NOT_FOUND", message: "Room not found", retryable: false },
      });
      return;
    }

    res.status(200).json({ ok: true, data: roomState });
  });

  router.post("/rooms/:id/join", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.params;
    const state = getState();
    const room = state.rooms.find((r) => r.roomId === id);
    if (!room) {
      res.status(404).json({
        ok: false,
        error: { code: "ROOM_NOT_FOUND", message: "Room not found", retryable: false },
      });
      return;
    }

    if (!room.participantIds.includes(userId)) {
      room.participantIds.push(userId);
    }
    if (room.status === "pending") {
      room.status = "active";
      room.startedAt = new Date().toISOString();
    }

    res.status(200).json({ ok: true, data: buildRoomState(id ?? "", userId) });
  });

  router.post("/rooms/:id/leave", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.params;
    const state = getState();
    const room = state.rooms.find((r) => r.roomId === id);
    if (!room) {
      res.status(404).json({
        ok: false,
        error: { code: "ROOM_NOT_FOUND", message: "Room not found", retryable: false },
      });
      return;
    }

    room.status = "ended";
    room.endedAt = new Date().toISOString();

    res.status(200).json({ ok: true, data: buildRoomState(id ?? "", userId) });
  });

  router.post("/rooms/:id/token", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    res.status(200).json({
      ok: true,
      data: {
        token: MOCK_LIVEKIT_TOKEN,
        livekitUrl: MOCK_LIVEKIT_URL,
      },
    });
  });
}
