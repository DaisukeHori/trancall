import { z } from "zod";

export const OutputLanguage = z.enum([
  "en", "es", "pt", "fr", "ja", "ru", "zh",
  "de", "ko", "hi", "id", "vi", "it",
]);
export type OutputLanguage = z.infer<typeof OutputLanguage>;

export const InputLanguage = z.union([
  z.literal("auto"),
  z.string().regex(/^[a-z]{2,3}(-[A-Z][a-zA-Z]{1,7})?$/),
]);
export type InputLanguage = z.infer<typeof InputLanguage>;
