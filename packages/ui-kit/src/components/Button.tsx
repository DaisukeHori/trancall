import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  type TouchableOpacityProps,
} from "react-native";
import { useTheme } from "../theme/index";
import { useTranslation } from "../i18n/index";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<TouchableOpacityProps, "style"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: React.ReactNode;
  accessibilityLabel: string;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  children,
  accessibilityLabel,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const c = theme.colors;
  const { t } = useTranslation();

  const bgColor: Record<ButtonVariant, string> = {
    primary: c.primary,
    secondary: c.bgSecondary,
    danger: c.danger,
    ghost: "transparent",
  };

  const textColor: Record<ButtonVariant, string> = {
    primary: c.textOnColor,
    secondary: c.textPrimary,
    danger: c.textOnColor,
    ghost: c.primary,
  };

  const paddingVertical: Record<ButtonSize, number> = {
    sm: 8,
    md: 12,
    lg: 16,
  };

  const paddingHorizontal: Record<ButtonSize, number> = {
    sm: 12,
    md: 16,
    lg: 24,
  };

  const fontSize: Record<ButtonSize, number> = {
    sm: 14,
    md: 16,
    lg: 18,
  };

  // 最小タップ領域 44×44 (iOS HIG) を全サイズで確保
  const minHeight: Record<ButtonSize, number> = {
    sm: 44,
    md: 44,
    lg: 52,
  };

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.base,
        {
          backgroundColor: bgColor[variant],
          paddingVertical: paddingVertical[size],
          paddingHorizontal: paddingHorizontal[size],
          minHeight: minHeight[size],
          opacity: isDisabled ? 0.5 : 1,
          borderRadius: theme.radii[8],
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: variant === "ghost" ? c.primary : undefined,
        },
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={textColor[variant]}
          size="small"
          accessibilityLabel={t("common.loading")}
        />
      ) : (
        <Text
          style={[
            styles.text,
            {
              color: textColor[variant],
              fontSize: fontSize[size],
            },
          ]}
        >
          {children}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  text: {
    fontWeight: "600",
  },
});
