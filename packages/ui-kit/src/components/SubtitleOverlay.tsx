import React, { useEffect, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { colors } from "../tokens";

export type SubtitleMode = "Both" | "OriginalOnly" | "TranslationOnly";

export interface SubtitleSegment {
  id: string;
  original: string;
  translated?: string;
  isFinal: boolean;
}

export interface SubtitleOverlayProps {
  segments: readonly SubtitleSegment[];
  mode: SubtitleMode;
  isDark?: boolean;
}

export function SubtitleOverlay({
  segments,
  mode,
  isDark = true,
}: SubtitleOverlayProps) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [segments]);

  const subtitleBg = isDark ? colors.dark.subtitleBg : colors.light.subtitleBg;
  const originalColor = isDark ? colors.dark.subtitleOriginal : colors.light.subtitleOriginal;
  const translatedColor = isDark ? colors.dark.subtitleTranslated : colors.light.subtitleTranslated;

  return (
    <View
      style={[styles.container, { backgroundColor: subtitleBg }]}
      accessibilityLabel="Subtitles"
      accessibilityRole="none"
      pointerEvents="none"
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          scrollRef.current?.scrollToEnd({ animated: true });
        }}
      >
        {segments.map((seg) => (
          <View key={seg.id} style={styles.segment}>
            {(mode === "Both" || mode === "OriginalOnly") && (
              <Text
                style={[
                  styles.text,
                  styles.originalText,
                  {
                    color: originalColor,
                    opacity: seg.isFinal ? 1 : 0.7,
                  },
                ]}
                accessibilityLabel={`Original: ${seg.original}`}
              >
                {seg.original}
              </Text>
            )}
            {(mode === "Both" || mode === "TranslationOnly") &&
              seg.translated != null &&
              seg.translated.length > 0 && (
                <Text
                  style={[
                    styles.text,
                    {
                      color: translatedColor,
                      opacity: seg.isFinal ? 1 : 0.7,
                      textDecorationLine: seg.isFinal ? "none" : "underline",
                    },
                  ]}
                  accessibilityLabel={`Translation: ${seg.translated}`}
                >
                  {seg.translated}
                </Text>
              )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    maxHeight: 160,
    padding: 12,
  },
  scroll: {
    flexGrow: 0,
  },
  segment: {
    marginBottom: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  originalText: {
    fontSize: 13,
    marginBottom: 2,
  },
});
