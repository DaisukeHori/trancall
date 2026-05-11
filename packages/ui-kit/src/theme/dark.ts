import { colors, spacing, typography, radii } from "../tokens.js";
import type { Theme } from "./light.js";

export const darkTheme: Theme = {
  colors: colors.dark,
  spacing,
  typography,
  radii,
  isDark: true,
};
