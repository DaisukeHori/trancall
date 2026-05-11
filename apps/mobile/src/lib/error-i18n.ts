import type { AppError } from "@trancall/shared-kernel";
import type { TFunction } from "i18next";

/**
 * Resolve a user-facing error message from an AppError.
 *
 * Looks up `errors.<code>` in the i18n resources.
 * Falls back to the error code itself if no translation key is found.
 * `error.details` is passed as interpolation params (e.g. { status: 404 }).
 */
export function resolveErrorMessage(error: AppError, t: TFunction): string {
  const key = `errors.${error.code}`;
  const translated = t(key, error.details ?? {});
  // i18next returns the key itself when the translation is missing
  return translated !== key ? translated : error.code;
}
