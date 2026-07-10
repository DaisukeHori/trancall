/**
 * SCR-012 — Full Transcript
 *
 * Displays the complete transcript for a completed call with:
 *   - Compact header (caller name + date + duration + export button)
 *   - Search bar
 *   - Speaker filter (All / Self / Other)
 *   - Transcript segment list with search highlighting
 *   - Export bottom-sheet (PDF / TXT)
 *   - expo-file-system: base64 → cacheDirectory file
 *   - expo-sharing: shareAsync() 共有シート
 *   - Access revoked banner
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
// SDK54 (expo-file-system v19) では legacy API (cacheDirectory / writeAsStringAsync /
// EncodingType) は "expo-file-system/legacy" サブパスに移動 (#54)
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Badge, Button, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";
import { TranscriptSearchBar } from "../components/transcript-search-bar";
import { TranscriptSegmentRow } from "../components/transcript-segment-row";
import { useTranscriptStore, type TranscriptFilter } from "../stores/transcript-store";
import { useAuthStore } from "../stores/auth-store";
import type { TranscriptSegment } from "../api/transcript-api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { PostCallStackParamList } from "./call-summary-screen";

type Props = NativeStackScreenProps<PostCallStackParamList, "FullTranscript">;

type ExportFormat = "pdf" | "txt";

/** Format ms to mm:ss */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Format ISO datetime string to locale date string */
function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}

export function FullTranscriptScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const { roomId, callDurationMs, callerName, calledAt } = route.params;

  const session = useAuthStore((state) => state.session);
  const {
    load,
    search,
    setFilter,
    filter,
    searchQuery,
    isLoading,
    error,
    revokedRooms,
    export: exportTranscript,
    transcripts,
    getFilteredSegments,
  } = useTranscriptStore();

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMessage, setExportMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isAccessRevoked = revokedRooms.has(roomId);
  const transcript = transcripts.get(roomId);

  // Load transcript on mount
  useEffect(() => {
    if (session == null) return;
    void load(roomId, session.accessToken);
  }, [roomId, session, load]);

  const segments = getFilteredSegments(roomId, session?.userId ?? undefined);

  const handleSearchChange = useCallback(
    (text: string) => {
      search(text);
    },
    [search],
  );

  const handleFilterChange = useCallback(
    (newFilter: TranscriptFilter) => {
      setFilter(newFilter);
    },
    [setFilter],
  );

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (session == null) return;
      setExportLoading(true);
      setExportMessage(null);

      const result = await exportTranscript(roomId, format, session.accessToken);

      if (!result.ok) {
        setExportLoading(false);
        setShowExportModal(false);
        setExportMessage({ type: "error", text: t("transcript.export.error") });
        return;
      }

      // Determine filename: use server-provided or build a default
      const ext = format === "pdf" ? "pdf" : "txt";
      const filename = result.data.filename ?? `trancall-transcript-${roomId.slice(0, 8)}.${ext}`;
      const fileUri = `${FileSystem.cacheDirectory ?? ""}${filename}`;

      try {
        await FileSystem.writeAsStringAsync(fileUri, result.data.contentBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });

        const isAvailable = await Sharing.isAvailableAsync();
        if (!isAvailable) {
          setExportLoading(false);
          setShowExportModal(false);
          setExportMessage({ type: "error", text: t("transcript.export.error") });
          return;
        }

        setExportLoading(false);
        setShowExportModal(false);

        await Sharing.shareAsync(fileUri, {
          mimeType: result.data.mime,
          dialogTitle: t("transcript.export.share"),
          UTI: format === "pdf" ? "com.adobe.pdf" : "public.plain-text",
        });
      } catch {
        setExportLoading(false);
        setShowExportModal(false);
        setExportMessage({ type: "error", text: t("transcript.export.error") });
      }
    },
    [session, exportTranscript, roomId, t],
  );

  const filterOptions: Array<{ key: TranscriptFilter; label: string }> = [
    { key: "all", label: t("transcript.filter.all") },
    { key: "self", label: t("transcript.filter.self") },
    { key: "other", label: t("transcript.filter.other") },
  ];

  const renderSegment = useCallback(
    ({ item }: { item: TranscriptSegment }) => (
      <TranscriptSegmentRow segment={item} searchQuery={searchQuery} />
    ),
    [searchQuery],
  );

  const keyExtractor = useCallback(
    (item: TranscriptSegment) => item.segmentId,
    [],
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      {/* Compact header */}
      <View
        style={[
          styles.header,
          {
            borderBottomColor: c.border,
            paddingHorizontal: s[16],
            paddingVertical: s[12],
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <TouchableOpacity
            accessibilityLabel={t("common.back")}
            accessibilityRole="button"
            onPress={() => { navigation.goBack(); }}
            style={styles.backButton}
          >
            <Text style={[styles.backText, { color: c.primary }]}>{"<"} {t("common.back")}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerCenter}>
          <Text
            style={[styles.headerCallerName, { color: c.textPrimary }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {callerName}
          </Text>
          <Text style={[styles.headerMeta, { color: c.textSecondary }]}>
            {formatDate(calledAt)} · {formatDuration(callDurationMs)}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {!isAccessRevoked && transcript != null && (
            <TouchableOpacity
              accessibilityLabel={t("transcript.export.button")}
              accessibilityRole="button"
              onPress={() => { setShowExportModal(true); }}
              style={styles.exportHeaderButton}
            >
              <Text style={[styles.exportHeaderText, { color: c.primary }]}>
                {t("transcript.export.button")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Access revoked banner */}
      {isAccessRevoked && (
        <View
          style={[styles.revokedBanner, { backgroundColor: c.dangerBg }]}
          accessibilityRole="alert"
          accessible
          accessibilityLabel={t("transcript.accessRevoked")}
        >
          <Text style={[styles.revokedText, { color: c.danger }]}>
            {t("transcript.accessRevoked")}
          </Text>
        </View>
      )}

      {/* Export result message */}
      {exportMessage != null && (
        <View
          style={[
            styles.exportMessageBanner,
            {
              backgroundColor: exportMessage.type === "success" ? c.successBg : c.dangerBg,
            },
          ]}
          accessibilityRole="alert"
          accessible
          accessibilityLabel={exportMessage.text}
        >
          <Text
            style={[
              styles.exportMessageText,
              { color: exportMessage.type === "success" ? c.success : c.danger },
            ]}
          >
            {exportMessage.text}
          </Text>
          <TouchableOpacity
            onPress={() => { setExportMessage(null); }}
            accessibilityLabel={t("common.close")}
            accessibilityRole="button"
            style={styles.dismissButton}
          >
            <Text style={{ color: exportMessage.type === "success" ? c.success : c.danger }}>
              x
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search bar */}
      <View style={[styles.searchContainer, { paddingHorizontal: s[16], paddingTop: s[12] }]}>
        <TranscriptSearchBar
          value={searchQuery}
          onChangeText={handleSearchChange}
          placeholder={t("transcript.searchPlaceholder")}
        />
      </View>

      {/* Filter segmented control */}
      <View style={[styles.filterRow, { paddingHorizontal: s[16], marginTop: s[12] }]}>
        {filterOptions.map((opt) => {
          const isActive = filter === opt.key;
          return (
            <Pressable
              key={opt.key}
              accessibilityLabel={opt.label}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              onPress={() => { handleFilterChange(opt.key); }}
              style={[
                styles.filterChip,
                {
                  backgroundColor: isActive ? c.primary : c.bgSecondary,
                  borderRadius: theme.radii.full,
                  paddingHorizontal: s[12],
                  paddingVertical: s[8],
                },
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  { color: isActive ? c.subtitleText : c.textSecondary },
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Language pair badge */}
      {transcript != null && (
        <View style={[styles.metaBadgeRow, { paddingHorizontal: s[16], marginTop: s[8] }]}>
          <Badge variant="default">
            {t("translation.enabled")}
          </Badge>
          <Text style={[styles.segmentCount, { color: c.textTertiary, marginLeft: s[8] }]}>
            {segments.length} {segments.length === 1 ? "segment" : "segments"}
          </Text>
        </View>
      )}

      {/* Loading state */}
      {isLoading && (
        <View style={styles.centerContent} accessibilityRole="none">
          <ActivityIndicator size="large" color={c.primary} />
          <Text style={[styles.loadingText, { color: c.textSecondary, marginTop: s[12] }]}>
            {t("common.loading")}
          </Text>
        </View>
      )}

      {/* Error state */}
      {!isLoading && error != null && (
        <View style={styles.centerContent} accessibilityRole="alert" accessible>
          <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
        </View>
      )}

      {/* Empty state */}
      {!isLoading && error == null && segments.length === 0 && transcript != null && (
        <View style={styles.centerContent} accessibilityRole="text" accessible>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>
            {t("transcript.empty")}
          </Text>
        </View>
      )}

      {/* Transcript list */}
      {!isLoading && error == null && segments.length > 0 && (
        <FlatList
          data={segments}
          renderItem={renderSegment}
          keyExtractor={keyExtractor}
          style={[styles.list, { borderTopColor: c.border }]}
          ItemSeparatorComponent={null}
          accessibilityLabel={t("transcript.title")}
        />
      )}

      {/* Export button */}
      {!isAccessRevoked && transcript != null && (
        <View
          style={[
            styles.exportBar,
            {
              borderTopColor: c.border,
              backgroundColor: c.bgPrimary,
              paddingHorizontal: s[16],
              paddingVertical: s[12],
            },
          ]}
        >
          <Button
            variant="ghost"
            size="md"
            accessibilityLabel={t("transcript.exportTitle")}
            onPress={() => { setShowExportModal(true); }}
          >
            {t("summary.exportTranscript")}
          </Button>
        </View>
      )}

      {/* Export format bottom-sheet modal */}
      <Modal
        visible={showExportModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowExportModal(false); }}
        accessibilityViewIsModal
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => { setShowExportModal(false); }}
          accessibilityLabel={t("common.close")}
          accessibilityRole="button"
        >
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: c.bgPrimary,
                shadowColor: c.shadowColor,
                borderTopLeftRadius: theme.radii[16],
                borderTopRightRadius: theme.radii[16],
                paddingHorizontal: s[24],
                paddingTop: s[24],
                paddingBottom: s[48],
              },
            ]}
            accessible={false}
          >
            <Text
              style={[styles.modalTitle, { color: c.textPrimary, marginBottom: s[24] }]}
              accessibilityRole="header"
            >
              {t("transcript.exportTitle")}
            </Text>

            {exportLoading ? (
              <ActivityIndicator size="large" color={c.primary} />
            ) : (
              <View style={{ gap: s[12] }}>
                <Button
                  variant="primary"
                  size="lg"
                  accessibilityLabel={t("transcript.export.pdf")}
                  onPress={() => { void handleExport("pdf"); }}
                >
                  {t("transcript.export.pdf")}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  accessibilityLabel={t("transcript.export.txt")}
                  onPress={() => { void handleExport("txt"); }}
                >
                  {t("transcript.export.txt")}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  accessibilityLabel={t("common.cancel")}
                  onPress={() => { setShowExportModal(false); }}
                >
                  {t("common.cancel")}
                </Button>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flex: 1,
  },
  headerCenter: {
    flex: 2,
    alignItems: "center",
  },
  headerRight: {
    flex: 1,
  },
  backButton: {
    minHeight: 44,
    justifyContent: "center",
  },
  backText: {
    fontSize: 16,
    fontWeight: "500",
  },
  headerCallerName: {
    fontSize: 16,
    fontWeight: "600",
  },
  headerMeta: {
    fontSize: 12,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  revokedBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  revokedText: {
    fontSize: 13,
    fontWeight: "500",
  },
  exportMessageBanner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  exportMessageText: {
    fontSize: 13,
    fontWeight: "500",
    flex: 1,
  },
  dismissButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {},
  filterRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  filterChip: {
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  metaBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  segmentCount: {
    fontSize: 12,
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
  },
  errorText: {
    fontSize: 14,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
  },
  list: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  exportBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  exportHeaderButton: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "flex-end",
  },
  exportHeaderText: {
    fontSize: 16,
    fontWeight: "500",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
});
