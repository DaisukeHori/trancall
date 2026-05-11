import { z } from "zod";

// --- Branded Type Schemas ---

export const UserIdSchema = z.string().uuid().brand<"UserId">();
export const RoomIdSchema = z.string().uuid().brand<"RoomId">();
export const TrackIdSchema = z.string().uuid().brand<"TrackId">();
export const ParticipantIdSchema = z.string().uuid().brand<"ParticipantId">();
export const TranslationSessionIdSchema = z.string().uuid().brand<"TranslationSessionId">();
export const LiveKitTrackSidSchema = z.string().min(1).brand<"LiveKitTrackSid">();
export const OpenAISessionIdSchema = z.string().min(1).brand<"OpenAISessionId">();

// --- Inferred Types ---

export type UserId = z.infer<typeof UserIdSchema>;
export type RoomId = z.infer<typeof RoomIdSchema>;
export type TrackId = z.infer<typeof TrackIdSchema>;
export type ParticipantId = z.infer<typeof ParticipantIdSchema>;
export type TranslationSessionId = z.infer<typeof TranslationSessionIdSchema>;
export type LiveKitTrackSid = z.infer<typeof LiveKitTrackSidSchema>;
export type OpenAISessionId = z.infer<typeof OpenAISessionIdSchema>;

// --- Brand Factory Helpers ---
// 外部入力からBranded Typeを安全に生成する唯一の経路。
// `as UserId` のような型アサーションの代わりにこれらを使う。

export function brandUserId(raw: string) {
  return UserIdSchema.safeParse(raw);
}

export function brandRoomId(raw: string) {
  return RoomIdSchema.safeParse(raw);
}

export function brandParticipantId(raw: string) {
  return ParticipantIdSchema.safeParse(raw);
}

export function brandTrackId(raw: string) {
  return TrackIdSchema.safeParse(raw);
}

export function brandTranslationSessionId(raw: string) {
  return TranslationSessionIdSchema.safeParse(raw);
}

export function brandLiveKitTrackSid(raw: string) {
  return LiveKitTrackSidSchema.safeParse(raw);
}

export function brandOpenAISessionId(raw: string) {
  return OpenAISessionIdSchema.safeParse(raw);
}
