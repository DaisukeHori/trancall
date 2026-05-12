/**
 * TranscriptSegmentRow — single row in the Full Transcript list
 *
 * Displays: speaker avatar + name + timestamp + original text + translated text
 * Supports search highlight.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Avatar, useTheme } from "@trancall/ui-kit";
import type { TranscriptSegment } from "../api/transcript-api.js";

export interface TranscriptSegmentRowProps {
  segment: TranscriptSegment;
  searchQuery?: string;
}

/** Format ms offset from call start to mm:ss string */
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Highlight matching substrings in text.
 * Returns array of {text, highlight} objects.
 */
function buildHighlightParts(
  text: string,
  query: string,
): Array<{ text: string; highlight: boolean }> {
  if (query.trim().length === 0) {
    return [{ text, highlight: false }];
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const idx = lowerText.indexOf(lowerQuery, cursor);
    if (idx === -1) {
      parts.push({ text: text.slice(cursor), highlight: false });
      break;
    }
    if (idx > cursor) {
      parts.push({ text: text.slice(cursor, idx), highlight: false });
    }
    parts.push({ text: text.slice(idx, idx + query.length), highlight: true });
    cursor = idx + query.length;
  }

  return parts;
}

interface HighlightedTextProps {
  text: string;
  searchQuery: string;
  style: object;
  highlightStyle: object;
}

function HighlightedText({ text, searchQuery, style, highlightStyle }: HighlightedTextProps) {
  const parts = buildHighlightParts(text, searchQuery);
  return (
    <Text style={style} accessibilityRole="text">
      {parts.map((part, i) => (
        <Text
          key={i}
          style={part.highlight ? highlightStyle : undefined}
        >
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

export function TranscriptSegmentRow({
  segment,
  searchQuery = "",
}: TranscriptSegmentRowProps) {
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const timestamp = formatTimestamp(segment.startTimeMs);
  const initials = segment.speakerName.slice(0, 1).toUpperCase();

  return (
    <View
      style={[styles.container, { paddingVertical: s[12], paddingHorizontal: s[16] }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${segment.speakerName} ${timestamp}: ${segment.originalText}`}
    >
      {/* Avatar + header row */}
      <View style={styles.header}>
        <Avatar
          size="sm"
          fallbackInitials={initials}
          accessibilityLabel={segment.speakerName}
        />
        <Text style={[styles.speakerName, { color: c.textPrimary, marginLeft: s[8] }]}>
          {segment.speakerName}
        </Text>
        <Text
          style={[
            styles.timestamp,
            { color: c.textTertiary, marginLeft: s[8], fontFamily: "monospace" },
          ]}
        >
          {timestamp}
        </Text>
      </View>

      {/* Original text */}
      <HighlightedText
        text={segment.originalText}
        searchQuery={searchQuery}
        style={[styles.originalText, { color: c.textSecondary, marginTop: s[4] }]}
        highlightStyle={[styles.highlight, { backgroundColor: c.warningBg, color: c.warning }]}
      />

      {/* Translated text */}
      {segment.translatedText != null && segment.translatedText.length > 0 && (
        <HighlightedText
          text={segment.translatedText}
          searchQuery={searchQuery}
          style={[styles.translatedText, { color: c.textPrimary, marginTop: s[4] }]}
          highlightStyle={[styles.highlight, { backgroundColor: c.warningBg, color: c.warning }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  speakerName: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  timestamp: {
    fontSize: 12,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  originalText: {
    fontSize: 13,
    lineHeight: 18,
    paddingLeft: 40,
  },
  translatedText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "400",
    paddingLeft: 40,
  },
  highlight: {
    borderRadius: 2,
  },
});
