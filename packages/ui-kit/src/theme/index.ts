import { useColorScheme } from "react-native";
import { lightTheme } from "./light.ts";
import { darkTheme } from "./dark.ts";

export { lightTheme, darkTheme };
export type { Theme } from "./light.ts";

export function useTheme() {
  const colorScheme = useColorScheme();
  return colorScheme === "dark" ? darkTheme : lightTheme;
}
