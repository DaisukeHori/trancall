import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Result } from "@trancall/shared-kernel";
import { OutputLanguage } from "@trancall/shared-kernel";
import { apiFetch } from "./client.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Supabase client (singleton)
let _supabaseClient: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient(): ReturnType<typeof createClient> {
  if (_supabaseClient == null) {
    _supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabaseClient;
}

// --- Schemas ---

const SupabaseSessionSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: z.object({
    id: z.uuid(),
    email: z.email().optional(),
  }),
});

const UserProfileSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  display_name: z.string(),
  native_language: OutputLanguage,
  avatar_url: z.string().nullable().optional(),
  created_at: z.string(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export interface SignInResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/**
 * Sign in via Supabase Auth directly (not via apps/server).
 * Per docs/module-contracts.md Section 2.1.
 */
export async function signInWithSupabase(
  email: string,
  password: string,
): Promise<Result<SignInResult>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error != null) {
    return {
      ok: false,
      error: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: error.message,
        retryable: false,
      },
    };
  }

  const session = data.session;
  if (session == null) {
    return {
      ok: false,
      error: {
        code: "AUTH_SESSION_MISSING",
        message: "AUTH_SESSION_MISSING",
        retryable: false,
      },
    };
  }

  const parsed = SupabaseSessionSchema.safeParse({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user: { id: session.user.id, email: session.user.email },
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "AUTH_SESSION_INVALID",
        message: "AUTH_SESSION_INVALID",
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    data: {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      userId: parsed.data.user.id,
    },
  };
}

/**
 * Sign up via Supabase Auth. Profile creation is handled by server trigger.
 */
export async function signUpWithSupabase(
  email: string,
  password: string,
  displayName: string,
  nativeLanguage: OutputLanguage,
): Promise<Result<SignInResult>> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        native_language: nativeLanguage,
      },
    },
  });

  if (error != null) {
    return {
      ok: false,
      error: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: error.message,
        retryable: false,
      },
    };
  }

  const session = data.session;
  if (session == null) {
    // Email verification required — UI resolves i18n key "auth.signupVerificationEmailSent"
    return {
      ok: false,
      error: {
        code: "AUTH_EMAIL_NOT_VERIFIED",
        message: "AUTH_EMAIL_NOT_VERIFIED",
        retryable: false,
      },
    };
  }

  return {
    ok: true,
    data: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      userId: session.user.id,
    },
  };
}

/**
 * Fetch user profile from apps/server REST API.
 * GET /api/auth/profile
 */
export async function getProfile(
  userId: string,
  accessToken: string,
): Promise<Result<UserProfile>> {
  return apiFetch(`/api/auth/profile?userId=${encodeURIComponent(userId)}`, UserProfileSchema, {
    method: "GET",
    accessToken,
  });
}

/**
 * Sign out from Supabase.
 */
export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient();
  await supabase.auth.signOut();
}
