// SCR-007 — Add Contact: ID Search / QR (Phase 2) / Invite Link / Device Import
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar, Button, Input, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useContactsStore } from "../stores/contacts-store.js";
import { searchUsers, createInviteLink } from "../api/contacts-api.js";
import type { PublicProfile } from "../api/contacts-api.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RecentStackParamList } from "../navigation/recent-stack.js";

// Note: add-contact-screen is shared between RecentStack and ContactsStack.
// Using RecentStackParamList as primary; ContactsStack uses the same screen.
type Props = NativeStackScreenProps<RecentStackParamList, "AddContact">;

type TabId = "search" | "qr" | "invite" | "import";

export function AddContactScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const [activeTab, setActiveTab] = useState<TabId>("search");
  const add = useContactsStore((state) => state.add);

  // --- ID Search state ---
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PublicProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);

  // --- Invite Link state ---
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  const tabs: { id: TabId; label: string }[] = [
    { id: "search", label: t("addContact.tab.search") },
    { id: "qr", label: t("addContact.tab.qr") },
    { id: "invite", label: t("addContact.tab.invite") },
    { id: "import", label: t("addContact.tab.import") },
  ];

  const handleSearch = async () => {
    if (searchQuery.trim().length === 0) return;
    setIsSearching(true);
    setSearchResults([]);
    const result = await searchUsers(searchQuery.trim());
    if (result.ok) {
      setSearchResults(result.data);
    }
    setIsSearching(false);
  };

  const handleAddContact = async (profile: PublicProfile) => {
    setAddingUserId(profile.userId);
    const added = await add(profile.userId);
    setAddingUserId(null);
    if (added != null) {
      Alert.alert(t("addContact.successMessage"));
      navigation.goBack();
    }
  };

  const handleGenerateInviteLink = async () => {
    setIsGeneratingLink(true);
    const result = await createInviteLink();
    setIsGeneratingLink(false);
    if (result.ok) {
      setInviteUrl(result.data.inviteUrl);
    }
  };

  const handleShareInviteLink = async () => {
    if (inviteUrl == null) return;
    await Share.share({ url: inviteUrl, message: inviteUrl });
  };

  const renderSearchTab = () => (
    <View style={[styles.tabContent, { paddingHorizontal: s[16] }]}>
      <View style={[styles.searchRow, { marginTop: s[16] }]}>
        <View style={styles.searchInput}>
          <Input
            placeholder={t("addContact.search.placeholder")}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("addContact.search.placeholder")}
            onSubmitEditing={() => { void handleSearch(); }}
            returnKeyType="search"
          />
        </View>
        <Button
          variant="primary"
          size="md"
          onPress={() => { void handleSearch(); }}
          loading={isSearching}
          accessibilityLabel={t("common.search")}
        >
          {t("common.search")}
        </Button>
      </View>

      {isSearching ? (
        <ActivityIndicator
          style={styles.loader}
          color={c.primary}
          accessibilityLabel={t("common.loading")}
        />
      ) : searchResults.length === 0 && searchQuery.trim().length > 0 ? (
        <Text style={[styles.emptyText, { color: c.textSecondary }]}>
          {t("addContact.search.noResults")}
        </Text>
      ) : (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.userId}
          renderItem={({ item }) => (
            <View style={[styles.resultRow, { borderBottomColor: c.border }]}>
              <Avatar
                size="md"
                {...(item.avatarUrl != null ? { uri: item.avatarUrl } : {})}
                fallbackInitials={item.displayName.slice(0, 2)}
                accessibilityLabel={item.displayName}
              />
              <View style={styles.resultInfo}>
                <Text style={[styles.resultName, { color: c.textPrimary }]}>
                  {item.displayName}
                </Text>
                <Text style={[styles.resultId, { color: c.textSecondary }]}>
                  {item.trancallId}
                </Text>
              </View>
              <Button
                variant="primary"
                size="sm"
                onPress={() => { void handleAddContact(item); }}
                loading={addingUserId === item.userId}
                accessibilityLabel={`${t("addContact.search.addButton")} ${item.displayName}`}
              >
                {t("addContact.search.addButton")}
              </Button>
            </View>
          )}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );

  const renderQrTab = () => (
    <View style={[styles.tabContent, styles.centeredContent, { paddingHorizontal: s[16] }]}>
      <Text style={[styles.comingSoonText, { color: c.textSecondary }]}>
        {t("addContact.qr.comingSoon")}
      </Text>
    </View>
  );

  const renderInviteTab = () => (
    <View style={[styles.tabContent, { paddingHorizontal: s[16], paddingTop: s[24] }]}>
      <Text style={[styles.inviteTitle, { color: c.textPrimary }]}>
        {t("addContact.invite.title")}
      </Text>

      {inviteUrl != null ? (
        <View style={[styles.linkBox, { backgroundColor: c.bgSecondary, borderRadius: theme.radii[8], borderColor: c.border, marginTop: s[16] }]}>
          <Text
            selectable
            style={[styles.linkText, { color: c.textPrimary, fontFamily: "monospace" }]}
          >
            {inviteUrl}
          </Text>
        </View>
      ) : null}

      <View style={[styles.buttonStack, { marginTop: s[16] }]}>
        {inviteUrl == null ? (
          <Button
            variant="primary"
            size="lg"
            onPress={() => { void handleGenerateInviteLink(); }}
            loading={isGeneratingLink}
            accessibilityLabel={t("addContact.invite.generate")}
          >
            {t("addContact.invite.generate")}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            onPress={() => { void handleShareInviteLink(); }}
            accessibilityLabel={t("addContact.invite.share")}
          >
            {t("addContact.invite.share")}
          </Button>
        )}
      </View>
    </View>
  );

  const renderImportTab = () => (
    <View style={[styles.tabContent, styles.centeredContent, { paddingHorizontal: s[16] }]}>
      <Text style={[styles.importTitle, { color: c.textPrimary }]}>
        {t("addContact.import.title")}
      </Text>
      <Text style={[styles.importSubtitle, { color: c.textSecondary, marginTop: s[8] }]}>
        {t("addContact.import.permissionRequired")}
      </Text>
      <View style={[styles.buttonStack, { marginTop: s[16] }]}>
        <Button
          variant="primary"
          size="lg"
          onPress={() => {
            // TODO Phase 2: expo-contacts permission + import flow
          }}
          accessibilityLabel={t("addContact.import.allow")}
        >
          {t("addContact.import.allow")}
        </Button>
      </View>
    </View>
  );

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
        <Text
          accessibilityRole="header"
          style={[styles.navTitle, { color: c.textPrimary }]}
        >
          {t("addContact.title")}
        </Text>
        <View style={styles.backButton} />
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { borderBottomColor: c.border }]}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.id}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.id }}
            onPress={() => { setActiveTab(tab.id); }}
            style={[
              styles.tab,
              {
                borderBottomWidth: activeTab === tab.id ? 2 : 0,
                borderBottomColor: c.primary,
              },
            ]}
          >
            <Text
              style={[
                styles.tabLabel,
                { color: activeTab === tab.id ? c.primary : c.textSecondary },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Tab content */}
      {activeTab === "search" && renderSearchTab()}
      {activeTab === "qr" && renderQrTab()}
      {activeTab === "invite" && renderInviteTab()}
      {activeTab === "import" && renderImportTab()}
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
  navTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  tabContent: {
    flex: 1,
  },
  centeredContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-end",
  },
  searchInput: {
    flex: 1,
  },
  loader: {
    marginTop: 32,
  },
  emptyText: {
    marginTop: 32,
    textAlign: "center",
    fontSize: 14,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 0,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultInfo: {
    flex: 1,
  },
  resultName: {
    fontSize: 15,
    fontWeight: "500",
  },
  resultId: {
    fontSize: 13,
  },
  comingSoonText: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  inviteTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  linkBox: {
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  linkText: {
    fontSize: 13,
    lineHeight: 18,
  },
  buttonStack: {
    width: "100%",
  },
  importTitle: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  importSubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
