// SCR-FAQ — FAQ (Frequently Asked Questions)
// canonical: docs/support-flow.md §8
// 5 カテゴリ × 各 3-5 Q&A, i18n ja/en/zh 対応, Accordion 形式

import React, { useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTheme } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { i18n } from "../i18n/index.js";
import {
  FAQ_ENTRIES,
  FAQ_CATEGORIES,
  type FaqCategory,
  type FaqEntry,
} from "../data/faq.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { SettingsStackParamList } from "../navigation/settings-stack.js";

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export type FaqScreenProps = NativeStackScreenProps<
  SettingsStackParamList,
  "Faq"
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SupportedLocale = "ja" | "en" | "zh";

function resolveLocale(): SupportedLocale {
  const lang = i18n.language ?? "ja";
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("en")) return "en";
  return "ja";
}

function getLocalizedText(
  obj: { ja: string; en: string; zh: string },
  locale: SupportedLocale,
): string {
  return obj[locale];
}

// ---------------------------------------------------------------------------
// AccordionItem — single Q&A row
// ---------------------------------------------------------------------------

interface AccordionItemProps {
  entry: FaqEntry;
  locale: SupportedLocale;
  isOpen: boolean;
  onToggle: () => void;
}

function AccordionItem({
  entry,
  locale,
  isOpen,
  onToggle,
}: AccordionItemProps) {
  const theme = useTheme();
  const c = theme.colors;

  const question = getLocalizedText(entry.question, locale);
  const answer = getLocalizedText(entry.answer, locale);

  return (
    <View
      style={[
        accordionStyles.container,
        { borderBottomColor: c.border },
      ]}
    >
      <Pressable
        accessibilityLabel={question}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityHint={isOpen ? "タップして閉じる" : "タップして回答を表示"}
        onPress={onToggle}
        style={({ pressed }) => [
          accordionStyles.questionRow,
          {
            backgroundColor: pressed ? c.bgSecondary : c.bgPrimary,
          },
        ]}
      >
        <Text style={[accordionStyles.questionText, { color: c.textPrimary }]}>
          {question}
        </Text>
        <Text style={[accordionStyles.chevron, { color: c.textTertiary }]}>
          {isOpen ? "▲" : "▼"}
        </Text>
      </Pressable>

      {isOpen && (
        <View
          style={[
            accordionStyles.answerContainer,
            { backgroundColor: c.bgSecondary },
          ]}
        >
          <Text
            style={[accordionStyles.answerText, { color: c.textSecondary }]}
          >
            {answer}
          </Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// CategorySection — group of Q&A items per category
// ---------------------------------------------------------------------------

interface CategorySectionProps {
  category: FaqCategory;
  entries: FaqEntry[];
  locale: SupportedLocale;
  categoryLabel: string;
}

function CategorySection({
  category: _category,
  entries,
  locale,
  categoryLabel,
}: CategorySectionProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  function toggleItem(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <View style={sectionStyles.container}>
      <Text
        style={[sectionStyles.header, { color: c.textSecondary }]}
      >
        {categoryLabel.toUpperCase()}
      </Text>
      <View
        style={[
          sectionStyles.group,
          {
            backgroundColor: c.bgPrimary,
            borderColor: c.border,
            borderRadius: theme.radii[12],
          },
        ]}
      >
        {entries.map((entry) => (
          <AccordionItem
            key={entry.id}
            entry={entry}
            locale={locale}
            isOpen={openIds.has(entry.id)}
            onToggle={() => { toggleItem(entry.id); }}
          />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// FaqScreen — main screen
// ---------------------------------------------------------------------------

export function FaqScreen(_props: FaqScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const locale = resolveLocale();

  // FAQ entries grouped by category
  const entriesByCategory = FAQ_CATEGORIES.reduce<
    Record<FaqCategory, FaqEntry[]>
  >(
    (acc, cat) => {
      acc[cat] = FAQ_ENTRIES.filter((e) => e.category === cat);
      return acc;
    },
    {
      account: [],
      call: [],
      translation: [],
      billing: [],
      privacy: [],
    },
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: c.bgSecondary }]}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingHorizontal: s[16] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: c.textPrimary }]}
        >
          {t("faq.title")}
        </Text>

        {FAQ_CATEGORIES.map((category) => {
          const entries = entriesByCategory[category];
          if (entries.length === 0) return null;
          const categoryLabel = t(`faq.category.${category}`);
          return (
            <CategorySection
              key={category}
              category={category}
              entries={entries}
              locale={locale}
              categoryLabel={categoryLabel}
            />
          );
        })}

        <View style={styles.bottomPad} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    paddingTop: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  bottomPad: {
    height: 32,
  },
});

const sectionStyles = StyleSheet.create({
  container: {
    marginBottom: 4,
  },
  header: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    paddingTop: 20,
    paddingBottom: 8,
    paddingHorizontal: 4,
  },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
});

const accordionStyles = StyleSheet.create({
  container: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  questionText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
    lineHeight: 21,
  },
  chevron: {
    fontSize: 12,
    fontWeight: "600",
  },
  answerContainer: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  answerText: {
    fontSize: 14,
    lineHeight: 21,
  },
});
