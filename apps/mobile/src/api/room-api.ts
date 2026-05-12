/**
 * Room (Call) API wrapper
 * Calls apps/server REST endpoints for call lifecycle.
 */
import { z } from "zod";
import type { Result } from "@trancall/shared-kernel";
import { apiFetch } from "./client.js";

// --- Response Schemas ---

const ParticipantInfoSchema = z.object({
  userId: z.string(),
  displayName: z.string().optional(),
  nativeLanguage: z.string().optional(),
  joined: z.boolean().optional(),
});

const RoomStateSchema = z.object({
  roomId: z.string(),
  status: z.string(),
  participants: z.array(ParticipantInfoSchema).optional(),
  livekitUrl: z.string().optional(),
  livekitToken: z.string().optional(),
  translationEnabled: z.boolean().optional(),
  createdAt: z.string().optional(),
  endedAt: z.string().nullable().optional(),
});

export type RoomState = z.infer<typeof RoomStateSchema>;
export type ParticipantInfo = z.infer<typeof ParticipantInfoSchema>;

const RoomStateResponseSchema = z.object({
  ok: z.literal(true),
  data: RoomStateSchema,
});

const JoinResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    token: z.string(),
    livekitUrl: z.string().optional(),
    roomId: z.string().optional(),
  }),
});

const EndResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    roomId: z.string().optional(),
    status: z.string().optional(),
    durationSeconds: z.number().optional(),
  }),
});

export interface CreateCallOptions {
  calleeId: string;
  creatorId: string;
  translationEnabled: boolean;
}

export interface JoinCallResult {
  token: string;
  livekitUrl?: string;
  roomId?: string;
}

export interface EndCallResult {
  roomId?: string;
  status?: string;
  durationSeconds?: number;
}

/**
 * POST /api/rooms — create a call
 */
export async function createCall(
  opts: CreateCallOptions,
  accessToken: string,
): Promise<Result<RoomState>> {
  return apiFetch("/api/rooms", RoomStateResponseSchema.transform((r) => r.data), {
    method: "POST",
    accessToken,
    body: {
      inviteeIds: [opts.calleeId],
      roomType: "audio",
      translationEnabled: opts.translationEnabled,
    },
  });
}

/**
 * POST /api/rooms/:roomId/join — join a call as callee
 */
export async function joinCall(
  roomId: string,
  accessToken: string,
): Promise<Result<JoinCallResult>> {
  return apiFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/join`,
    JoinResponseSchema.transform((r) => r.data),
    { method: "POST", accessToken },
  );
}

/**
 * POST /api/rooms/:roomId/leave — end/leave a call
 */
export async function endCall(
  roomId: string,
  accessToken: string,
): Promise<Result<EndCallResult>> {
  return apiFetch(
    `/api/rooms/${encodeURIComponent(roomId)}/leave`,
    EndResponseSchema.transform((r) => r.data),
    { method: "POST", accessToken },
  );
}

/**
 * GET /api/rooms/:roomId — get current call state
 */
export async function getRoomState(
  roomId: string,
  accessToken: string,
): Promise<Result<RoomState>> {
  return apiFetch(
    `/api/rooms/${encodeURIComponent(roomId)}`,
    RoomStateResponseSchema.transform((r) => r.data),
    { method: "GET", accessToken },
  );
}
