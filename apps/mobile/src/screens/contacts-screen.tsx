// SCR-005 — Contacts: favorites + all contacts, search, swipe-to-delete
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
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

const SWIPE_THRESHOLD = 80;
const DELETE_BUTTON_WIDTH = 80;

interface SwipeableContactRowProps {
  item: ContactEntry;
  deleteLabel: string;
  onPress: () => void;
  onFavoritePress: () => void;
  onDelete: () => void;
}

function SwipeableContactRow({
  item,
  deleteLabel,
  onPress,
  onFavoritePress,
  onDelete,
}: SwipeableContactRowProps) {
  const theme = useTheme();
  const c = theme.colors;
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dx) > 5 && Math.abs(gestureState.dy) < Math.abs(gestureState.dx),
      onPanResponderMove: (_, gestureState) => {
        const dx = Math.min(0, gestureState.dx);
        translateX.setValue(dx);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          Animated.spring(translateX, {
            toValue: -DELETE_BUTTON_WIDTH,
            useNativeDriver: true,
          }).start();
          isOpen.current = true;
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
          isOpen.current = false;
        }
      },
    }),
  ).current;

  const handleClose = useCallback(() => {
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
    isOpen.current = false;
  }, [translateX]);

  return (
    <View style={swipeStyles.container}>
      {/* Delete action revealed on the right */}
      <Pressable
        accessibilityLabel={deleteLabel}
        accessibilityRole="button"
        onPress={() => {
          handleClose();
          onDelete();
        }}
        style={[swipeStyles.deleteButton, { backgroundColor: c.danger, width: DELETE_BUTTON_WIDTH }]}
      >
        <Text style={[swipeStyles.deleteText, { color: c.subtitleText }]}>{deleteLabel}</Text>
      </Pressable>

      {/* Swipeable contact row */}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <Pressable
          onPress={() => {
            if (isOpen.current) {
              handleClose();
            } else {
              onPress();
            }
          }}
        >
          <ContactRow
            testID={`contact-row-${item.trancallId}`}
            name={item.displayName}
            trancallId={item.trancallId}
            {...(item.avatarUrl != null ? { avatarUri: item.avatarUrl } : {})}
            isFavorite={item.isFavorite}
            onPress={() => {
              if (isOpen.current) {
                handleClose();
              } else {
                onPress();
              }
            }}
            onFavoritePress={onFavoritePress}
            accessibilityLabel={`${item.displayName}, ${item.trancallId}`}
          />
        </Pressable>
      </Animated.View>
    </View>
  );
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
  const removeContact = useContactsStore((state) => state.remove);
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
    <SwipeableContactRow
      item={item}
      deleteLabel={t("contacts.swipeDelete")}
      onPress={() => { handleContactPress(item); }}
      onFavoritePress={() => { toggleFavorite(item.contactUserId); }}
      onDelete={() => { void removeContact(item.id); }}
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
            testID="add-contact-button"
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

const swipeStyles = StyleSheet.create({
  container: {
    position: "relative",
    overflow: "hidden",
  },
  deleteButton: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

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
