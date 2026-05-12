// SCR-002 — Home: Recent calls + search
import React, { useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Badge, Input, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useRecentCallsStore } from "../stores/recent-calls-store.js";
import { RecentCallRow } from "../components/recent-call-row.js";
import { EmptyState } from "../components/empty-state.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RecentStackParamList } from "../navigation/recent-stack.js";

type Props = NativeStackScreenProps<RecentStackParamList, "HomeMain">;

// Low-balance threshold in minutes for free plan users
const LOW_BALANCE_THRESHOLD_MINUTES = 1;

export function HomeScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const [searchQuery, setSearchQuery] = useState("");

  const recentCalls = useRecentCallsStore((state) => state.recentCalls);
  const load = useRecentCallsStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredCalls = searchQuery.trim().length === 0
    ? recentCalls
    : recentCalls.filter(
        (call) =>
          call.contactDisplayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          call.contactTrancallId.toLowerCase().includes(searchQuery.toLowerCase()),
      );

  // TODO Phase 2: replace with billing store selector
  // e.g. const remainingMinutes = useBillingStore(state => state.remainingMinutes);
  const remainingMinutes: number = useRecentCallsStore((state) => state.recentCalls.length > 1000 ? 0 : 0);
  const showLowBalanceWarning = remainingMinutes > 0 && remainingMinutes <= LOW_BALANCE_THRESHOLD_MINUTES;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: s[16] }]}>
        <View style={styles.headerRow}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: c.textPrimary }]}
          >
            {t("home.recentCalls")}
          </Text>
          {showLowBalanceWarning && (
            <Badge variant="warning">
              {t("home.lowBalanceWarning", { minutes: String(remainingMinutes) })}
            </Badge>
          )}
        </View>

        <View style={[styles.searchContainer, { marginTop: s[12] }]}>
          <Input
            placeholder={t("home.searchPlaceholder")}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("home.searchPlaceholder")}
          />
        </View>
      </View>

      {/* Call list */}
      {filteredCalls.length === 0 ? (
        <EmptyState
          title={t("home.empty.title")}
          subtitle={t("home.empty.subtitle")}
        />
      ) : (
        <FlatList
          data={filteredCalls}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <RecentCallRow
              call={item}
              onPress={() => {
                // TODO Phase 2: navigate to ContactProfile when contacts store integrates
                // For now, find contact by userId and navigate
                navigation.navigate("ContactProfile", {
                  contact: {
                    id: item.contactUserId,
                    userId: item.contactUserId,
                    contactUserId: item.contactUserId,
                    displayName: item.contactDisplayName,
                    trancallId: item.contactTrancallId,
                    nativeLanguage: "ja",
                    avatarUrl: item.contactAvatarUrl,
                    isFavorite: false,
                    isBlocked: false,
                    createdAt: item.startedAt,
                  },
                });
              }}
              onLongPress={() => {
                // Long press: re-dial (Phase 2)
              }}
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* FAB: Add contact / Start new call */}
      <Pressable
        accessibilityLabel={t("contacts.addContact")}
        accessibilityRole="button"
        onPress={() => { navigation.navigate("AddContact"); }}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: pressed ? c.primaryBg : c.primary,
            shadowColor: c.primary,
          },
        ]}
      >
        <Text style={styles.fabIcon}>+</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  searchContainer: {
    width: "100%",
  },
  listContent: {
    paddingBottom: 100,
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 9999,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 8,
  },
  fabIcon: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "400",
    lineHeight: 32,
  },
});
