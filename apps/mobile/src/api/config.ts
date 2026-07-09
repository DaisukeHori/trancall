// API configuration from environment variables
// Expo exposes env vars prefixed with EXPO_PUBLIC_ to client
//
// expo-modules-core の global.d.ts が `ProcessEnv` に `[key: string]: any` という
// index signature を追加しているため、素の `process.env["KEY"]` アクセスは `any` 型になる。
// Zod safeParse で明示的に検証することで any の伝播を断ち切る。
import { z } from "zod";

const EnvSchema = z.object({
  EXPO_PUBLIC_API_BASE_URL: z.string().optional(),
  EXPO_PUBLIC_SUPABASE_URL: z.string().optional(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

const parsedEnv = EnvSchema.safeParse(process.env);
const env = parsedEnv.success ? parsedEnv.data : {};

export const API_BASE_URL = env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

export const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
