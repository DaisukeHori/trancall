import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useTheme } from "../theme/index";

export interface InputProps extends Omit<TextInputProps, "style"> {
  label?: string;
  error?: string;
  helperText?: string;
  secureTextEntry?: boolean;
}

export function Input({
  label,
  error,
  helperText,
  secureTextEntry = false,
  placeholder,
  ...rest
}: InputProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [isFocused, setIsFocused] = useState(false);

  const borderColor = error
    ? c.danger
    : isFocused
      ? c.primary
      : c.border;

  return (
    <View style={styles.container}>
      {label != null && label.length > 0 && (
        <Text
          style={[styles.label, { color: c.textSecondary }]}
          accessibilityRole="text"
        >
          {label}
        </Text>
      )}
      <TextInput
        accessibilityLabel={label ?? placeholder}
        accessibilityHint={helperText}
        accessibilityState={{ disabled: rest.editable === false }}
        secureTextEntry={secureTextEntry}
        placeholder={placeholder}
        placeholderTextColor={c.textTertiary}
        onFocus={() => { setIsFocused(true); }}
        onBlur={() => { setIsFocused(false); }}
        style={[
          styles.input,
          {
            borderColor,
            borderRadius: theme.radii[8],
            backgroundColor: c.bgPrimary,
            color: c.textPrimary,
            fontSize: theme.typography.body.fontSize,
            minHeight: 44,
          },
        ]}
        {...rest}
      />
      {error != null && error.length > 0 && (
        <Text
          style={[styles.helperText, { color: c.danger }]}
          accessibilityRole="alert"
        >
          {error}
        </Text>
      )}
      {(helperText != null && helperText.length > 0) && error == null && (
        <Text
          style={[styles.helperText, { color: c.textSecondary }]}
          accessibilityRole="text"
        >
          {helperText}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  helperText: {
    fontSize: 12,
    marginTop: 4,
  },
});
