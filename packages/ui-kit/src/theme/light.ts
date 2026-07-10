import { colors, spacing, typography, radii } from "../tokens";

export interface Theme {
  colors: typeof colors.light | typeof colors.dark;
  spacing: typeof spacing;
  typography: typeof typography;
  radii: typeof radii;
  isDark: boolean;
}

export const lightTheme: Theme = {
  colors: colors.light,
  spacing,
  typography,
  radii,
  isDark: false,
};
