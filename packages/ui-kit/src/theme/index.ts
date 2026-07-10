import { useColorScheme } from "react-native";
import { lightTheme } from "./light";
import { darkTheme } from "./dark";

export { lightTheme, darkTheme };
export type { Theme } from "./light";

export function useTheme() {
  const colorScheme = useColorScheme();
  return colorScheme === "dark" ? darkTheme : lightTheme;
}
