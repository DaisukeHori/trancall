import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Result } from "@trancall/shared-kernel";
import { OutputLanguage } from "@trancall/shared-kernel";
import { apiFetch } from "./client";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

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

// ============================================================================
// E2E test-mode auth (apps/mock-server)
// ============================================================================
//
// signInWithSupabase / signUpWithSupabase / getProfile above talk to real
// Supabase Auth + apps/server. The Maestro E2E suite (apps/mobile/e2e/) runs
// against apps/mock-server instead, using fixture accounts
// (apps/mock-server/src/fixtures.ts) that only exist in the mock server's
// in-memory state — they are not real Supabase users. Without this branch,
// every E2E flow that logs in would call real Supabase with credentials it
// doesn't recognize (or, since EXPO_PUBLIC_SUPABASE_URL is intentionally left
// unset for E2E builds, would call createClient("") and fail before ever
// reaching the network).
//
// This branch is gated on EXPO_PUBLIC_E2E_TEST_MODE === "true", which
// .github/workflows/e2e.yml sets for the E2E-only build steps and which is never
// set for production (EAS / app-store) builds. Production login/signup always
// uses the Supabase path above, unchanged.
//
// NOTE: this was originally gated on NODE_ENV === "test", but Metro statically
// inlines `process.env.NODE_ENV` based on its own dev/prod bundling mode
// (via babel-preset-expo's environment-variable transform), NOT from the
// invoking shell's NODE_ENV at `xcodebuild`/`gradlew` time — so that check
// never actually evaluated to true in a real compiled bundle (confirmed via
// PR #75 CI: the mock-login branch never activated, flows fell through to the
// real Supabase path and failed to find "Email"/"Sign In" on screen).
// EXPO_PUBLIC_-prefixed vars ARE guaranteed by Expo's babel transform to be
// inlined from the actual build-time shell env, which is the officially
// documented mechanism for this exact use case.

const MockAuthUserSchema = z.object({
  userId: z.string(),
  email: z.string(),
  displayName: z.string(),
  nativeLanguage: OutputLanguage,
  avatarUrl: z.string().nullable(),
  createdAt: z.string(),
});

const MockSignInEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    user: MockAuthUserSchema,
  }),
});

const MockProfileEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: MockAuthUserSchema,
});

/** True only for the Maestro E2E build/run (see .github/workflows/e2e.yml). */
export function isE2eTestMode(): boolean {
  return process.env["EXPO_PUBLIC_E2E_TEST_MODE"] === "true";
}

function mockUserToProfile(user: z.infer<typeof MockAuthUserSchema>): UserProfile {
  return {
    id: user.userId,
    email: user.email,
    display_name: user.displayName,
    native_language: user.nativeLanguage,
    avatar_url: user.avatarUrl,
    created_at: user.createdAt,
  };
}

/**
 * E2E test-mode sign-in — POST /api/auth/signin against apps/mock-server.
 */
export async function signInViaMockServer(
  email: string,
  password: string,
): Promise<Result<SignInResult>> {
  const result = await apiFetch(
    "/api/auth/signin",
    MockSignInEnvelopeSchema.transform((r) => r.data),
    { method: "POST", body: { email, password } },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
      userId: result.data.user.userId,
    },
  };
}

/**
 * E2E test-mode sign-up — POST /api/auth/signup against apps/mock-server.
 */
export async function signUpViaMockServer(
  email: string,
  password: string,
  displayName: string,
  nativeLanguage: OutputLanguage,
): Promise<Result<SignInResult>> {
  const result = await apiFetch(
    "/api/auth/signup",
    MockSignInEnvelopeSchema.transform((r) => r.data),
    { method: "POST", body: { email, password, displayName, nativeLanguage } },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      accessToken: result.data.accessToken,
      refreshToken: result.data.refreshToken,
      userId: result.data.user.userId,
    },
  };
}

/**
 * E2E test-mode profile fetch — GET /api/auth/profile against apps/mock-server.
 * (mock-server resolves the user from the bearer token; userId param kept for
 * signature parity with getProfile().)
 */
export async function getProfileViaMockServer(
  _userId: string,
  accessToken: string,
): Promise<Result<UserProfile>> {
  const result = await apiFetch(
    "/api/auth/profile",
    MockProfileEnvelopeSchema.transform((r) => r.data),
    { method: "GET", accessToken },
  );
  if (!result.ok) return result;
  return { ok: true, data: mockUserToProfile(result.data) };
}

/**
 * E2E test-mode sign-out — mock-server sessions are in-memory and keyed by
 * bearer token only; there is no server-side revoke endpoint, so this is a
 * client-side no-op (caller still clears the persisted session).
 */
export async function signOutViaMockServer(): Promise<void> {
  return Promise.resolve();
}

// --- Extended auth/profile endpoints ---

export interface UpdateProfilePatch {
  display_name?: string;
  native_language?: z.infer<typeof OutputLanguage>;
  avatar_url?: string | null;
}

/**
 * PATCH /api/auth/profile
 * Update the current user's profile.
 */
export async function updateProfile(
  patch: UpdateProfilePatch,
  accessToken: string,
): Promise<Result<UserProfile>> {
  return apiFetch("/api/auth/profile", UserProfileSchema, {
    method: "PATCH",
    body: patch,
    accessToken,
  });
}

const DeleteSuccessSchema = z.object({
  success: z.boolean(),
});

/**
 * POST /api/account/delete
 * Delete the current user's account.
 */
export async function deleteAccount(
  accessToken: string,
): Promise<Result<{ success: boolean }>> {
  return apiFetch("/api/account/delete", DeleteSuccessSchema, {
    method: "POST",
    accessToken,
  });
}

/**
 * POST /api/auth/consent
 * Revoke the user's AI translation consent.
 */
export async function revokeConsent(
  accessToken: string,
): Promise<Result<{ success: boolean }>> {
  return apiFetch("/api/auth/consent", DeleteSuccessSchema, {
    method: "POST",
    body: { revoke: true },
    accessToken,
  });
}
