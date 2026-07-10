import { colors, spacing, typography, radii } from "../tokens.ts";
import type { Theme } from "./light.ts";

export const darkTheme: Theme = {
  colors: colors.dark,
  spacing,
  typography,
  radii,
  isDark: true,
};
