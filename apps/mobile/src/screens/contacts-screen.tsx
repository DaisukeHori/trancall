// SCR-005 — Contacts: favorites + all contacts, search, swipe-to-delete
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ContactRow, Input, useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useContactsStore } from "../stores/contacts-store.js";
import { EmptyState } from "../components/empty-state.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { ContactsStackParamList } from "../navigation/contacts-stack.js";
import type { ContactEntry } from "../api/contacts-api.js";

type Props = NativeStackScreenProps<ContactsStackParamList, "ContactsMain">;

interface SectionData {
  title: string;
  data: ContactEntry[];
}

export function ContactsScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const [searchQuery, setSearchQuery] = useState("");

  const contacts = useContactsStore((state) => state.contacts);
  const load = useContactsStore((state) => state.load);
  const isLoading = useContactsStore((state) => state.isLoading);
  const toggleFavorite = useContactsStore((state) => state.toggleFavorite);
  const search = useContactsStore((state) => state.search);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleContacts = searchQuery.trim().length === 0
    ? contacts.filter((c) => !c.isBlocked)
    : search(searchQuery);

  const favorites = visibleContacts.filter((c) => c.isFavorite);
  const nonFavorites = visibleContacts.filter((c) => !c.isFavorite);

  const sections: SectionData[] = [];
  if (favorites.length > 0) {
    sections.push({ title: t("contacts.favorites"), data: favorites });
  }
  sections.push({ title: t("contacts.allContacts"), data: nonFavorites });

  const handleContactPress = useCallback(
    (contact: ContactEntry) => {
      navigation.navigate("ContactProfile", { contact });
    },
    [navigation],
  );

  const renderContact = ({ item }: { item: ContactEntry }) => (
    <ContactRow
      name={item.displayName}
      trancallId={item.trancallId}
      {...(item.avatarUrl != null ? { avatarUri: item.avatarUrl } : {})}
      isFavorite={item.isFavorite}
      onPress={() => { handleContactPress(item); }}
      onFavoritePress={() => { toggleFavorite(item.contactUserId); }}
      accessibilityLabel={`${item.displayName}, ${item.trancallId}`}
    />
  );

  const renderSectionHeader = ({ section }: { section: SectionData }) => (
    <View style={[styles.sectionHeader, { backgroundColor: c.bgSecondary }]}>
      <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>
        {section.title.toUpperCase()}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgPrimary }]}>
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: s[16] }]}>
        <View style={styles.headerRow}>
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: c.textPrimary }]}
          >
            {t("contacts.title")}
          </Text>
          <Pressable
            accessibilityLabel={t("contacts.addContact")}
            accessibilityRole="button"
            onPress={() => { navigation.navigate("AddContact"); }}
            style={styles.addButton}
          >
            <Text style={[styles.addButtonText, { color: c.primary }]}>
              + {t("contacts.addContact")}
            </Text>
          </Pressable>
        </View>

        <View style={[styles.searchContainer, { marginTop: s[12] }]}>
          <Input
            placeholder={t("contacts.searchById")}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel={t("contacts.searchById")}
          />
        </View>
      </View>

      {/* Contact list */}
      {!isLoading && visibleContacts.length === 0 ? (
        <EmptyState
          title={t("contacts.empty.title")}
          subtitle={t("contacts.empty.subtitle")}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderContact}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}
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
  addButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  searchContainer: {
    width: "100%",
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
  },
  listContent: {
    paddingBottom: 24,
  },
});
