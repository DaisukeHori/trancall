/**
 * call-controls — ミュート/スピーカー/翻訳切替/終話 コントロール行
 *
 * 仕様:
 *   - 通常コントロール 48×48 (callTokens.controlSize)
 *   - 終話ボタン 56×56 (callTokens.actionSize)
 *   - 全ボタン accessibilityLabel + accessibilityRole 必須
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme, callTokens } from "@trancall/ui-kit";

export interface CallControlsProps {
  isMuted: boolean;
  isSpeakerOn: boolean;
  translationEnabled: boolean;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onToggleTranslation: () => void;
  onEndCall: () => void;
  muteLabel: string;
  speakerLabel: string;
  translationLabel: string;
  endCallLabel: string;
}

interface ControlButtonProps {
  active: boolean;
  onPress: () => void;
  label: string;
  iconChar: string;
  size?: number;
  isDanger?: boolean;
}

function ControlButton({
  active,
  onPress,
  label,
  iconChar,
  size = callTokens.controlSize,
  isDanger = false,
}: ControlButtonProps) {
  const theme = useTheme();
  const c = theme.colors;

  const bgColor = isDanger
    ? c.danger
    : active
    ? c.controlSurfaceActive
    : c.controlSurface;

  const iconColor = isDanger ? c.subtitleText : active ? c.textPrimary : c.controlText;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.button,
        {
          width: size,
          height: size,
          borderRadius: theme.radii.full,
          backgroundColor: bgColor,
          borderWidth: isDanger ? 0 : StyleSheet.hairlineWidth,
          borderColor: active ? "transparent" : c.controlSurfaceBorder,
        },
      ]}
    >
      <Text style={[styles.icon, { color: iconColor, fontSize: size * 0.43 }]}>
        {iconChar}
      </Text>
    </Pressable>
  );
}

export function CallControls({
  isMuted,
  isSpeakerOn,
  translationEnabled,
  onToggleMute,
  onToggleSpeaker,
  onToggleTranslation,
  onEndCall,
  muteLabel,
  speakerLabel,
  translationLabel,
  endCallLabel,
}: CallControlsProps) {
  return (
    <View style={styles.row}>
      <View style={styles.controlItem}>
        <ControlButton
          active={isMuted}
          onPress={onToggleMute}
          label={muteLabel}
          iconChar={isMuted ? "M" : "m"}
          size={callTokens.controlSize}
        />
      </View>

      <View style={styles.controlItem}>
        <ControlButton
          active={isSpeakerOn}
          onPress={onToggleSpeaker}
          label={speakerLabel}
          iconChar="S"
          size={callTokens.controlSize}
        />
      </View>

      <View style={styles.controlItem}>
        <ControlButton
          active={translationEnabled}
          onPress={onToggleTranslation}
          label={translationLabel}
          iconChar="T"
          size={callTokens.controlSize}
        />
      </View>

      <View style={styles.controlItem}>
        <ControlButton
          active={false}
          onPress={onEndCall}
          label={endCallLabel}
          iconChar="X"
          size={callTokens.actionSize}
          isDanger
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  controlItem: {
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontWeight: "700",
    textAlign: "center",
  },
});
