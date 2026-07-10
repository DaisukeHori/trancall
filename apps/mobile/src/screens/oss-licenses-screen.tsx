// SCR-OSS — Open Source Licenses
// Displays OSS license information from auto-generated licenses.json
// support-flow.md §9 準拠
import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { z } from "zod";
import { useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";
import licensesRaw from "../assets/licenses.json";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

const LicenseEntrySchema = z.object({
  licenses: z.string(),
  repository: z.string().optional(),
  publisher: z.string().optional(),
  email: z.string().optional(),
  description: z.string().optional(),
  licenseText: z.string().optional(),
});

const LicensesJsonSchema = z.record(z.string(), LicenseEntrySchema);

interface OssPackage {
  packageName: string;
  version: string;
  licenses: string;
  repository?: string;
  publisher?: string;
  licenseText?: string;
}

// ----------------------------------------------------------------
// Parse licenses.json
// keys are "packageName@version"
// ----------------------------------------------------------------

function parseLicensesJson(): OssPackage[] {
  const parsed = LicensesJsonSchema.safeParse(licensesRaw);
  const entries = parsed.success ? parsed.data : {};
  return Object.entries(entries)
    .map(([key, entry]) => {
      const atIdx = key.lastIndexOf("@");
      const packageName = atIdx > 0 ? key.slice(0, atIdx) : key;
      const version = atIdx > 0 ? key.slice(atIdx + 1) : "";
      return {
        packageName,
        version,
        licenses: entry.licenses,
        repository: entry.repository,
        publisher: entry.publisher,
        licenseText: entry.licenseText,
      };
    })
    .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

const ALL_PACKAGES: OssPackage[] = parseLicensesJson();

// ----------------------------------------------------------------
// LicenseDetailModal
// ----------------------------------------------------------------

interface LicenseDetailModalProps {
  pkg: OssPackage | null;
  onClose: () => void;
}

function LicenseDetailModal({ pkg, onClose }: LicenseDetailModalProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  if (pkg === null) return null;

  return (
    <Modal
      visible={true}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[modalStyles.container, { backgroundColor: c.bgSecondary }]}>
        {/* Header */}
        <View
          style={[
            modalStyles.header,
            { borderBottomColor: c.border, paddingHorizontal: s[16] },
          ]}
        >
          <View style={modalStyles.headerContent}>
            <Text
              style={[modalStyles.headerTitle, { color: c.textPrimary }]}
              numberOfLines={1}
            >
              {pkg.packageName}
            </Text>
            <Text style={[modalStyles.headerSubtitle, { color: c.textSecondary }]}>
              {t("oss.licenseTextTitle")}
            </Text>
          </View>
          <Pressable
            accessibilityLabel={t("common.close")}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              modalStyles.closeButton,
              {
                backgroundColor: pressed ? c.bgTertiary : c.bgSecondary,
                borderRadius: theme.radii[16],
              },
            ]}
          >
            <Text style={[modalStyles.closeButtonText, { color: c.primary }]}>
              {t("common.close")}
            </Text>
          </Pressable>
        </View>

        {/* License text */}
        <ScrollView
          contentContainerStyle={[modalStyles.body, { padding: s[16] }]}
          showsVerticalScrollIndicator={true}
        >
          {pkg.licenseText != null ? (
            <Text
              style={[
                modalStyles.licenseText,
                { color: c.textSecondary },
              ]}
              selectable
            >
              {pkg.licenseText}
            </Text>
          ) : (
            <Text style={[modalStyles.licenseText, { color: c.textTertiary }]}>
              {t("oss.licenseTextUnavailable")}
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 44,
    justifyContent: "center",
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: "500",
  },
  body: {
    flexGrow: 1,
  },
  licenseText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
});

// ----------------------------------------------------------------
// PackageRow
// ----------------------------------------------------------------

interface PackageRowProps {
  pkg: OssPackage;
  onPress: (pkg: OssPackage) => void;
}

function PackageRow({ pkg, onPress }: PackageRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  return (
    <Pressable
      accessibilityLabel={`${pkg.packageName} ${pkg.version} ${pkg.licenses}`}
      accessibilityRole="button"
      onPress={() => { onPress(pkg); }}
      style={({ pressed }) => [
        rowStyles.container,
        {
          backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
          borderBottomColor: c.border,
          paddingHorizontal: s[16],
          paddingVertical: s[12],
        },
      ]}
    >
      <View style={rowStyles.nameRow}>
        <Text
          style={[rowStyles.packageName, { color: c.textPrimary }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {pkg.packageName}
        </Text>
        <Text style={[rowStyles.version, { color: c.textTertiary }]}>
          {pkg.version}
        </Text>
      </View>
      <View style={rowStyles.metaRow}>
        <Text style={[rowStyles.licenseTag, { color: c.primary }]}>
          {t("oss.license")}: {pkg.licenses}
        </Text>
        {pkg.publisher != null && (
          <Text
            style={[rowStyles.author, { color: c.textSecondary }]}
            numberOfLines={1}
          >
            {t("oss.author")}: {pkg.publisher}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.textTertiary} />
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "column",
    justifyContent: "center",
    minHeight: 64,
    position: "relative",
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 24,
  },
  packageName: {
    fontSize: 15,
    fontWeight: "500",
    flexShrink: 1,
  },
  version: {
    fontSize: 12,
    flexShrink: 0,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 2,
    paddingRight: 24,
  },
  licenseTag: {
    fontSize: 13,
    fontWeight: "500",
  },
  author: {
    fontSize: 13,
    flexShrink: 1,
  },
  chevron: {
    position: "absolute",
    right: 14,
    top: "50%",
    fontSize: 20,
    fontWeight: "300",
    marginTop: -12,
  },
});

// ----------------------------------------------------------------
// OssLicensesScreen
// ----------------------------------------------------------------

export function OssLicensesScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const [query, setQuery] = useState("");
  const [selectedPkg, setSelectedPkg] = useState<OssPackage | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return ALL_PACKAGES;
    return ALL_PACKAGES.filter((pkg) =>
      pkg.packageName.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgSecondary }]}>
      {/* Search bar */}
      <View
        style={[
          styles.searchContainer,
          {
            backgroundColor: c.bgSecondary,
            borderBottomColor: c.border,
            paddingHorizontal: s[16],
            paddingVertical: s[8],
          },
        ]}
      >
        <TextInput
          accessibilityLabel={t("oss.search_placeholder")}
          accessibilityRole="search"
          placeholder={t("oss.search_placeholder")}
          placeholderTextColor={c.textTertiary}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[
            styles.searchInput,
            {
              backgroundColor: c.bgPrimary,
              borderColor: c.border,
              color: c.textPrimary,
              borderRadius: theme.radii[8],
              paddingHorizontal: s[12],
              height: 44,
            },
          ]}
        />
      </View>

      {/* Package count */}
      <View
        style={[
          styles.countContainer,
          { paddingHorizontal: s[16], paddingVertical: s[8] },
        ]}
      >
        <Text style={[styles.countText, { color: c.textSecondary }]}>
          {filtered.length} / {ALL_PACKAGES.length}
        </Text>
      </View>

      {/* Package list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => `${item.packageName}@${item.version}`}
        renderItem={({ item }) => (
          <PackageRow pkg={item} onPress={setSelectedPkg} />
        )}
        ListEmptyComponent={
          <View style={[styles.emptyContainer, { padding: s[32] }]}>
            <Text style={[styles.emptyText, { color: c.textSecondary }]}>
              {t("oss.noResults")}
            </Text>
          </View>
        }
        contentContainerStyle={filtered.length === 0 ? styles.emptyList : undefined}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
      />

      {/* License detail modal */}
      <LicenseDetailModal
        pkg={selectedPkg}
        onClose={() => { setSelectedPkg(null); }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  searchContainer: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
  },
  countContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  countText: {
    fontSize: 12,
  },
  emptyContainer: {
    alignItems: "center",
  },
  emptyText: {
    fontSize: 15,
  },
  emptyList: {
    flexGrow: 1,
  },
});
