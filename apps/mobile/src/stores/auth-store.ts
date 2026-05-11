import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { OutputLanguage } from "@trancall/shared-kernel";
import type { Result } from "@trancall/shared-kernel";
import type { UserProfile } from "../api/auth-api.js";
import {
  signInWithSupabase,
  signUpWithSupabase,
  signOut as supabaseSignOut,
  getProfile,
} from "../api/auth-api.js";

const SESSION_KEY = "trancall:session";

export interface Session {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export interface AuthState {
  session: Session | null;
  profile: UserProfile | null;
  preferredLanguage: OutputLanguage;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<Result<void>>;
  signup: (
    email: string,
    password: string,
    displayName: string,
    nativeLanguage: OutputLanguage,
    consentAccepted: boolean,
  ) => Promise<Result<void>>;
  logout: () => Promise<void>;
  restore: () => Promise<void>;
  setPreferredLanguage: (lang: OutputLanguage) => void;
}

export const useAuthStore = create<AuthState>()((set, _get) => ({
  session: null,
  profile: null,
  preferredLanguage: "ja",
  isLoading: false,

  setPreferredLanguage: (lang: OutputLanguage) => {
    set({ preferredLanguage: lang });
  },

  login: async (email: string, password: string): Promise<Result<void>> => {
    set({ isLoading: true });

    const signInResult = await signInWithSupabase(email, password);
    if (!signInResult.ok) {
      set({ isLoading: false });
      return signInResult;
    }

    const session: Session = {
      accessToken: signInResult.data.accessToken,
      refreshToken: signInResult.data.refreshToken,
      userId: signInResult.data.userId,
    };

    // Persist session
    try {
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    } catch {
      // SecureStore failure is non-fatal; session lives in memory
    }

    // Fetch profile
    const profileResult = await getProfile(session.userId, session.accessToken);

    set({
      session,
      profile: profileResult.ok ? profileResult.data : null,
      isLoading: false,
    });

    return { ok: true, data: undefined };
  },

  signup: async (
    email: string,
    password: string,
    displayName: string,
    nativeLanguage: OutputLanguage,
    consentAccepted: boolean,
  ): Promise<Result<void>> => {
    if (!consentAccepted) {
      return {
        ok: false,
        error: {
          code: "AUTH_CONSENT_REQUIRED",
          message: "AUTH_CONSENT_REQUIRED",
          retryable: false,
        },
      };
    }

    set({ isLoading: true });

    const signUpResult = await signUpWithSupabase(
      email,
      password,
      displayName,
      nativeLanguage,
    );

    if (!signUpResult.ok) {
      set({ isLoading: false });
      return signUpResult;
    }

    const session: Session = {
      accessToken: signUpResult.data.accessToken,
      refreshToken: signUpResult.data.refreshToken,
      userId: signUpResult.data.userId,
    };

    try {
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Non-fatal
    }

    const profileResult = await getProfile(session.userId, session.accessToken);

    set({
      session,
      profile: profileResult.ok ? profileResult.data : null,
      isLoading: false,
    });

    return { ok: true, data: undefined };
  },

  logout: async () => {
    try {
      await supabaseSignOut();
    } catch {
      // Best-effort sign out
    }
    try {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    } catch {
      // Non-fatal
    }
    set({ session: null, profile: null });
  },

  restore: async () => {
    set({ isLoading: true });
    try {
      const raw = await SecureStore.getItemAsync(SESSION_KEY);
      if (raw == null) {
        set({ isLoading: false });
        return;
      }

      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) {
        set({ isLoading: false });
        return;
      }

      const accessToken: unknown = Reflect.get(parsed, "accessToken");
      const refreshToken: unknown = Reflect.get(parsed, "refreshToken");
      const userId: unknown = Reflect.get(parsed, "userId");

      if (
        typeof accessToken !== "string" ||
        typeof refreshToken !== "string" ||
        typeof userId !== "string"
      ) {
        set({ isLoading: false });
        return;
      }

      const session: Session = {
        accessToken,
        refreshToken,
        userId,
      };

      const profileResult = await getProfile(session.userId, session.accessToken);

      set({
        session,
        profile: profileResult.ok ? profileResult.data : null,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },
}));

// Selector helpers
export const selectIsAuthenticated = (state: AuthState): boolean =>
  state.session != null;

export const selectSession = (state: AuthState): Session | null => state.session;

export const selectProfile = (state: AuthState): UserProfile | null => state.profile;
