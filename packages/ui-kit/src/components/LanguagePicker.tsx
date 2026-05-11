import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { OutputLanguage } from "@trancall/shared-kernel";
import { useTheme } from "../theme/index.js";

export interface LanguageInfo {
  code: OutputLanguage;
  nativeName: string;
  flag: string;
  englishName: string;
}

export const LANGUAGE_LIST: readonly LanguageInfo[] = [
  { code: "en", nativeName: "English", flag: "🇺🇸", englishName: "English" },
  { code: "es", nativeName: "Español", flag: "🇪🇸", englishName: "Spanish" },
  { code: "pt", nativeName: "Português", flag: "🇧🇷", englishName: "Portuguese" },
  { code: "fr", nativeName: "Français", flag: "🇫🇷", englishName: "French" },
  { code: "ja", nativeName: "日本語", flag: "🇯🇵", englishName: "Japanese" },
  { code: "ru", nativeName: "Русский", flag: "🇷🇺", englishName: "Russian" },
  { code: "zh", nativeName: "中文", flag: "🇨🇳", englishName: "Chinese" },
  { code: "de", nativeName: "Deutsch", flag: "🇩🇪", englishName: "German" },
  { code: "ko", nativeName: "한국어", flag: "🇰🇷", englishName: "Korean" },
  { code: "hi", nativeName: "हिन्दी", flag: "🇮🇳", englishName: "Hindi" },
  { code: "id", nativeName: "Bahasa Indonesia", flag: "🇮🇩", englishName: "Indonesian" },
  { code: "vi", nativeName: "Tiếng Việt", flag: "🇻🇳", englishName: "Vietnamese" },
  { code: "it", nativeName: "Italiano", flag: "🇮🇹", englishName: "Italian" },
] as const;

export interface LanguagePickerProps {
  value: OutputLanguage;
  onChange: (language: OutputLanguage) => void;
  label?: string;
  accessibilityLabel?: string;
}

export function getLanguageInfo(code: OutputLanguage): LanguageInfo | undefined {
  return LANGUAGE_LIST.find((l) => l.code === code);
}

export function LanguagePicker({
  value,
  onChange,
  label,
  accessibilityLabel = "Select language",
}: LanguagePickerProps) {
  const theme = useTheme();
  const c = theme.colors;
  const [open, setOpen] = React.useState(false);
  const selectedLang = getLanguageInfo(value);

  return (
    <View style={styles.container}>
      {label != null && label.length > 0 && (
        <Text style={[styles.label, { color: c.textSecondary }]}>{label}</Text>
      )}
      <TouchableOpacity
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityHint="Double tap to open language picker"
        onPress={() => setOpen(true)}
        style={[
          styles.trigger,
          {
            borderColor: c.border,
            borderRadius: theme.radii[8],
            backgroundColor: c.bgPrimary,
            minHeight: 44,
          },
        ]}
      >
        <Text style={[styles.triggerText, { color: c.textPrimary }]}>
          {selectedLang != null
            ? `${selectedLang.flag} ${selectedLang.nativeName}`
            : value}
        </Text>
        <Text style={{ color: c.textSecondary }}>▾</Text>
      </TouchableOpacity>
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        accessibilityViewIsModal
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityLabel="Close language picker"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: c.bgPrimary,
              borderTopLeftRadius: theme.radii[16],
              borderTopRightRadius: theme.radii[16],
            },
          ]}
        >
          <ScrollView>
            {LANGUAGE_LIST.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                accessibilityLabel={`${lang.englishName} (${lang.nativeName})`}
                accessibilityRole="button"
                accessibilityState={{ selected: lang.code === value }}
                onPress={() => {
                  onChange(lang.code);
                  setOpen(false);
                }}
                style={[
                  styles.item,
                  {
                    backgroundColor:
                      lang.code === value ? c.primaryBg : "transparent",
                    borderBottomColor: c.border,
                  },
                ]}
              >
                <Text style={styles.flag}>{lang.flag}</Text>
                <View>
                  <Text
                    style={[styles.nativeName, { color: c.textPrimary }]}
                  >
                    {lang.nativeName}
                  </Text>
                  <Text
                    style={[styles.englishName, { color: c.textSecondary }]}
                  >
                    {lang.englishName}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  trigger: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  triggerText: {
    fontSize: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    maxHeight: "60%",
    paddingBottom: 32,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 56,
  },
  flag: {
    fontSize: 24,
    marginRight: 12,
  },
  nativeName: {
    fontSize: 16,
    fontWeight: "500",
  },
  englishName: {
    fontSize: 12,
  },
});
