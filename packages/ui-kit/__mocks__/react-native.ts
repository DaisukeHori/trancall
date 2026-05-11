// Minimal mock of react-native for vitest (node environment)
export function useColorScheme(): "light" | "dark" | null {
  return "light";
}

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  hairlineWidth: 1,
  flatten: (style: unknown) => style,
};

export const Platform = {
  OS: "ios" as const,
  select: <T>(obj: { ios?: T; android?: T; default?: T }): T | undefined =>
    obj["ios"] ?? obj["default"],
};

export function View() { return null; }
export function Text() { return null; }
export function TouchableOpacity() { return null; }
export function ScrollView() { return null; }
export function TextInput() { return null; }
export function Image() { return null; }
export function Pressable() { return null; }
export function Modal() { return null; }
export function ActivityIndicator() { return null; }
