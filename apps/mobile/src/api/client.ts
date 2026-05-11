import type { z } from "zod";
import type { Result } from "@trancall/shared-kernel";
import { API_BASE_URL } from "./config.js";

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string;
}

/**
 * Core fetch wrapper that returns Result<T, AppError>.
 * Never throws — all errors are captured and returned as ResultErr.
 */
/** Safely extract a string field from an unknown value without type assertions. */
function extractStringField(value: unknown, field: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  // Use Object.entries to avoid type assertion while keeping type safety
  const entry = Object.entries(value).find(([k]) => k === field);
  if (entry == null) return undefined;
  const fieldValue: unknown = entry[1];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<Result<T>> {
  const { method = "GET", body, accessToken } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (accessToken != null && accessToken.length > 0) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (fetchError) {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message:
          fetchError instanceof Error
            ? fetchError.message
            : "接続できません。ネットワークを確認してください",
        retryable: true,
      },
    };
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "サーバーからの応答を解析できませんでした",
        retryable: false,
        httpStatus: response.status,
      },
    };
  }

  if (!response.ok) {
    const code = extractStringField(rawJson, "code") ?? "INTERNAL_ERROR";
    const message =
      extractStringField(rawJson, "message") ?? `HTTPエラー: ${String(response.status)}`;
    return {
      ok: false,
      error: {
        code,
        message,
        retryable: response.status >= 500,
        httpStatus: response.status,
      },
    };
  }

  const parsed = schema.safeParse(rawJson);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
        retryable: false,
        details: { issues: parsed.error.issues },
      },
    };
  }

  return { ok: true, data: parsed.data };
}
