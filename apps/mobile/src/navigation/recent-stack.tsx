import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/home-screen";
import { ContactProfileScreen } from "../screens/contact-profile-screen";
import { AddContactScreen } from "../screens/add-contact-screen";
import type { ContactEntry } from "../api/contacts-api";

export type RecentStackParamList = {
  HomeMain: undefined;
  ContactProfile: { contact: ContactEntry };
  // L-1: mode/contactId は contact-profile-screen.tsx の編集ボタンから
  // 「編集モード」で遷移する際に渡す (add-contact-screen.tsx は RecentStack/ContactsStack
  // 間で共有されているファイル内コメント参照)。
  AddContact: { mode?: "add" | "edit"; contactId?: string } | undefined;
};

const Stack = createNativeStackNavigator<RecentStackParamList>();

export function RecentStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="ContactProfile" component={ContactProfileScreen} />
      <Stack.Screen name="AddContact" component={AddContactScreen} />
    </Stack.Navigator>
  );
}
