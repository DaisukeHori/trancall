import { z } from "zod";

// --- AppError ---

export const AppError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
  httpStatus: z.number().int().optional(),
  provider: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type AppError = z.infer<typeof AppError>;

// --- Result Type ---

export type ResultOk<T> = { ok: true; data: T };
export type ResultErr<E = AppError> = { ok: false; error: E };
export type Result<T, E = AppError> = ResultOk<T> | ResultErr<E>;

// Zodスキーマから推論した型でResultを生成するユーティリティ型
export type ResultOf<S extends z.ZodType> = Result<z.infer<S>>;

// --- Validation Helper ---

export function validate<T extends z.ZodType>(
  schema: T,
  data: unknown,
): Result<z.infer<T>> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    error: {
      code: "VALIDATION_ERROR",
      message: result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
      retryable: false,
      details: { issues: result.error.issues },
    },
  };
}

// --- Result Factory Helpers ---

export function ok<T>(data: T): ResultOk<T> {
  return { ok: true, data };
}

export function err(error: AppError): ResultErr {
  return { ok: false, error };
}
