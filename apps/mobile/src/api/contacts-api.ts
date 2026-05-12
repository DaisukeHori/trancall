import { z } from "zod";
import { OutputLanguage } from "@trancall/shared-kernel";
import type { Result } from "@trancall/shared-kernel";
import { apiFetch } from "./client.js";
import { useAuthStore } from "../stores/auth-store.js";

// --- Schemas ---

const ContactEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  contactUserId: z.string(),
  displayName: z.string(),
  trancallId: z.string(),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().nullable().optional(),
  isFavorite: z.boolean().default(false),
  isBlocked: z.boolean().default(false),
  createdAt: z.string(),
});

export type ContactEntry = z.infer<typeof ContactEntrySchema>;

const ContactEntryArraySchema = z.array(ContactEntrySchema);

const PublicProfileSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  trancallId: z.string(),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().nullable().optional(),
});

export type PublicProfile = z.infer<typeof PublicProfileSchema>;

const PublicProfileArraySchema = z.array(PublicProfileSchema);

const InviteLinkResponseSchema = z.object({
  inviteUrl: z.string(),
  expiresAt: z.string().optional(),
});

export type InviteLinkResponse = z.infer<typeof InviteLinkResponseSchema>;

const SuccessResponseSchema = z.object({
  success: z.boolean(),
});

// --- Helpers ---

function getAccessToken(): string {
  const session = useAuthStore.getState().session;
  return session?.accessToken ?? "";
}

// --- API Functions ---

/**
 * GET /api/contacts
 * Returns all contacts for the current user.
 */
export async function getContacts(): Promise<Result<ContactEntry[]>> {
  return apiFetch("/api/contacts", ContactEntryArraySchema, {
    method: "GET",
    accessToken: getAccessToken(),
  });
}

/**
 * POST /api/contacts
 * Add a contact by their userId.
 */
export async function addContact(contactUserId: string): Promise<Result<ContactEntry>> {
  return apiFetch("/api/contacts", ContactEntrySchema, {
    method: "POST",
    body: { contactUserId },
    accessToken: getAccessToken(),
  });
}

/**
 * DELETE /api/contacts/:id
 * Remove a contact by entry id.
 */
export async function removeContact(id: string): Promise<Result<{ success: boolean }>> {
  return apiFetch(`/api/contacts/${encodeURIComponent(id)}`, SuccessResponseSchema, {
    method: "DELETE",
    accessToken: getAccessToken(),
  });
}

/**
 * GET /api/contacts/search?q=
 * Search for users by name or trancallId.
 */
export async function searchUsers(q: string): Promise<Result<PublicProfile[]>> {
  return apiFetch(
    `/api/contacts/search?q=${encodeURIComponent(q)}`,
    PublicProfileArraySchema,
    {
      method: "GET",
      accessToken: getAccessToken(),
    },
  );
}

/**
 * POST /api/contacts/invite-link
 * Create a shareable invite link for the current user.
 */
export async function createInviteLink(): Promise<Result<InviteLinkResponse>> {
  return apiFetch("/api/contacts/invite-link", InviteLinkResponseSchema, {
    method: "POST",
    accessToken: getAccessToken(),
  });
}

/**
 * POST /api/contacts/block
 * Block a user.
 */
export async function blockUser(userId: string): Promise<Result<{ success: boolean }>> {
  return apiFetch("/api/contacts/block", SuccessResponseSchema, {
    method: "POST",
    body: { userId },
    accessToken: getAccessToken(),
  });
}

/**
 * POST /api/contacts/report
 * Report a user.
 */
export async function reportUser(
  userId: string,
  reason?: string,
): Promise<Result<{ success: boolean }>> {
  return apiFetch("/api/contacts/report", SuccessResponseSchema, {
    method: "POST",
    body: { userId, reason },
    accessToken: getAccessToken(),
  });
}
