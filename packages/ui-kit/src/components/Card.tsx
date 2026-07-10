import React from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useTheme } from "../theme/index";

export interface CardProps extends Omit<ViewProps, "style"> {
  padding?: number;
  shadow?: boolean;
  children: React.ReactNode;
}

export function Card({
  padding,
  shadow = true,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const c = theme.colors;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.bgPrimary,
          borderRadius: theme.radii[12],
          borderColor: c.border,
          padding: padding ?? theme.spacing[16],
        },
        shadow && styles.shadow,
        shadow && { shadowColor: c.shadowColor },
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
  },
  shadow: {
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
});
