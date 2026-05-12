// SCR-008 — Contact Profile: avatar / info / call history / actions
import React from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar, Button, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useContactsStore } from "../stores/contacts-store.js";
import { useRecentCallsStore } from "../stores/recent-calls-store.js";
import { reportUser } from "../api/contacts-api.js";
import { RecentCallRow } from "../components/recent-call-row.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RecentStackParamList } from "../navigation/recent-stack.js";

type Props = NativeStackScreenProps<RecentStackParamList, "ContactProfile">;

export function ContactProfileScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const { contact } = route.params;

  const contacts = useContactsStore((state) => state.contacts);
  const remove = useContactsStore((state) => state.remove);
  const toggleFavorite = useContactsStore((state) => state.toggleFavorite);
  const block = useContactsStore((state) => state.block);

  const recentCalls = useRecentCallsStore((state) => state.recentCalls);

  // Find the live contact entry (may have been updated in store)
  const liveContact = contacts.find((c) => c.contactUserId === contact.contactUserId) ?? contact;

  // Filter call history for this contact
  const contactCallHistory = recentCalls.filter(
    (call) => call.contactUserId === contact.contactUserId,
  );

  const handleCall = () => {
    // TODO Phase 2: navigate to pre-call screen / initiate call
  };

  const handleToggleFavorite = () => {
    toggleFavorite(liveContact.contactUserId);
  };

  const handleBlock = () => {
    Alert.alert(
      t("contactProfile.blockConfirmTitle"),
      t("contactProfile.blockConfirmMessage", { name: liveContact.displayName }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: liveContact.isBlocked ? t("contacts.unblock") : t("contacts.block"),
          style: "destructive",
          onPress: () => { void block(liveContact.contactUserId); },
        },
      ],
    );
  };

  const handleReport = () => {
    Alert.alert(
      t("contactProfile.reportConfirmTitle"),
      t("contactProfile.reportConfirmMessage", { name: liveContact.displayName }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("contacts.report"),
          style: "destructive",
          onPress: () => {
            void reportUser(liveContact.contactUserId);
          },
        },
      ],
    );
  };

  const handleRemove = () => {
    Alert.alert(
      t("contactProfile.deleteConfirmTitle"),
      t("contactProfile.deleteConfirmMessage", { name: liveContact.displayName }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            void remove(liveContact.id).then((success) => {
              if (success) {
                navigation.goBack();
              }
            });
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      {/* Navigation header */}
      <View style={[styles.navHeader, { borderBottomColor: c.border }]}>
        <Pressable
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
          onPress={() => { navigation.goBack(); }}
          style={styles.backButton}
        >
          <Text style={[styles.backText, { color: c.primary }]}>{t("common.back")}</Text>
        </Pressable>
        <View style={styles.backButton} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile header */}
        <View style={[styles.profileHeader, { paddingTop: s[24], paddingHorizontal: s[16] }]}>
          <Avatar
            size="xl"
            {...(liveContact.avatarUrl != null ? { uri: liveContact.avatarUrl } : {})}
            fallbackInitials={liveContact.displayName.slice(0, 2)}
            accessibilityLabel={liveContact.displayName}
          />
          <Text style={[styles.profileName, { color: c.textPrimary, marginTop: s[12] }]}>
            {liveContact.displayName}
          </Text>
          <Text style={[styles.profileId, { color: c.textSecondary, fontFamily: "monospace" }]}>
            {liveContact.trancallId}
          </Text>
          <Text style={[styles.profileLang, { color: c.textSecondary, marginTop: s[4] }]}>
            {t(`language.${liveContact.nativeLanguage}`)}
          </Text>
        </View>

        {/* Action buttons: Call / Message (disabled) / Edit */}
        <View style={[styles.actionRow, { paddingHorizontal: s[16], marginTop: s[24] }]}>
          <Button
            variant="primary"
            size="lg"
            onPress={handleCall}
            accessibilityLabel={t("contactProfile.call")}
          >
            {t("contactProfile.call")}
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onPress={() => {
              Alert.alert(t("contactProfile.messageComingSoon"));
            }}
            accessibilityLabel={t("contactProfile.message")}
          >
            {t("contactProfile.message")}
          </Button>
        </View>

        {/* Call history */}
        <View style={[styles.section, { paddingHorizontal: s[16], marginTop: s[24] }]}>
          <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>
            {t("contactProfile.callHistory").toUpperCase()}
          </Text>
        </View>

        {contactCallHistory.length === 0 ? (
          <View style={styles.emptyHistory}>
            <Text style={[styles.emptyHistoryText, { color: c.textSecondary }]}>
              {t("contactProfile.noCallHistory")}
            </Text>
          </View>
        ) : (
          contactCallHistory.slice(0, 10).map((call) => (
            <RecentCallRow
              key={call.id}
              call={call}
            />
          ))
        )}

        {/* Actions: favorite / block / report / remove */}
        <View style={[styles.section, { paddingHorizontal: s[16], marginTop: s[24] }]}>
          <View
            style={[
              styles.actionsGroup,
              {
                backgroundColor: c.bgPrimary,
                borderColor: c.border,
                borderRadius: theme.radii[12],
              },
            ]}
          >
            <Pressable
              accessibilityLabel={liveContact.isFavorite ? t("contactProfile.unfavorite") : t("contactProfile.favorite")}
              accessibilityRole="button"
              onPress={handleToggleFavorite}
              style={({ pressed }) => [
                styles.actionRow2,
                {
                  borderBottomColor: c.border,
                  backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
                },
              ]}
            >
              <Text style={[styles.actionText, { color: c.primary }]}>
                {liveContact.isFavorite
                  ? t("contactProfile.unfavorite")
                  : t("contactProfile.favorite")}
              </Text>
            </Pressable>

            <Pressable
              accessibilityLabel={liveContact.isBlocked ? t("contacts.unblock") : t("contactProfile.block")}
              accessibilityRole="button"
              onPress={handleBlock}
              style={({ pressed }) => [
                styles.actionRow2,
                {
                  borderBottomColor: c.border,
                  backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
                },
              ]}
            >
              <Text style={[styles.actionText, { color: c.warning }]}>
                {liveContact.isBlocked ? t("contacts.unblock") : t("contactProfile.block")}
              </Text>
            </Pressable>

            <Pressable
              accessibilityLabel={t("contactProfile.report")}
              accessibilityRole="button"
              onPress={handleReport}
              style={({ pressed }) => [
                styles.actionRow2,
                {
                  borderBottomColor: c.border,
                  backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
                },
              ]}
            >
              <Text style={[styles.actionText, { color: c.warning }]}>
                {t("contactProfile.report")}
              </Text>
            </Pressable>

            <Pressable
              accessibilityLabel={t("contactProfile.remove")}
              accessibilityRole="button"
              onPress={handleRemove}
              style={({ pressed }) => [
                styles.actionRow2Last,
                {
                  backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
                },
              ]}
            >
              <Text style={[styles.actionText, { color: c.danger }]}>
                {t("contactProfile.remove")}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    minWidth: 60,
    minHeight: 44,
    justifyContent: "center",
  },
  backText: {
    fontSize: 15,
    fontWeight: "500",
  },
  profileHeader: {
    alignItems: "center",
  },
  profileName: {
    fontSize: 24,
    fontWeight: "700",
  },
  profileId: {
    fontSize: 14,
    marginTop: 4,
  },
  profileLang: {
    fontSize: 14,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  section: {
    paddingVertical: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  emptyHistory: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: "center",
  },
  emptyHistoryText: {
    fontSize: 14,
    textAlign: "center",
  },
  actionsGroup: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  actionRow2: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
    justifyContent: "center",
  },
  actionRow2Last: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    justifyContent: "center",
  },
  actionText: {
    fontSize: 15,
    fontWeight: "500",
  },
  bottomPad: {
    height: 40,
  },
});
