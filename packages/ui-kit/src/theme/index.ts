import { useColorScheme } from "react-native";
import { lightTheme } from "./light.js";
import { darkTheme } from "./dark.js";

export { lightTheme, darkTheme };
export type { Theme } from "./light.js";

export function useTheme() {
  const colorScheme = useColorScheme();
  return colorScheme === "dark" ? darkTheme : lightTheme;
}
