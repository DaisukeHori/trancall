/**
 * TranscriptSearchBar — search input for SCR-012 Full Transcript
 */
import React from "react";
import { Input } from "@trancall/ui-kit";

export interface TranscriptSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
}

export function TranscriptSearchBar({
  value,
  onChangeText,
  placeholder,
}: TranscriptSearchBarProps) {
  return (
    <Input
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      accessibilityLabel={placeholder}
      returnKeyType="search"
      clearButtonMode="while-editing"
      autoCorrect={false}
      autoCapitalize="none"
    />
  );
}
