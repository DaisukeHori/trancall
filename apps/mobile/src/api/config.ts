// API configuration from environment variables
// Expo exposes env vars prefixed with EXPO_PUBLIC_ to client

export const API_BASE_URL =
  process.env["EXPO_PUBLIC_API_BASE_URL"] ?? "http://localhost:3000";

export const SUPABASE_URL =
  process.env["EXPO_PUBLIC_SUPABASE_URL"] ?? "";

export const SUPABASE_ANON_KEY =
  process.env["EXPO_PUBLIC_SUPABASE_ANON_KEY"] ?? "";
