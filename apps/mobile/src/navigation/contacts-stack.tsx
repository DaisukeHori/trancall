import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ContactsScreen } from "../screens/contacts-screen";
import { ContactProfileScreen } from "../screens/contact-profile-screen";
import { AddContactScreen } from "../screens/add-contact-screen";
import type { ContactEntry } from "../api/contacts-api";

export type ContactsStackParamList = {
  ContactsMain: undefined;
  ContactProfile: { contact: ContactEntry };
  // L-1: RecentStackParamList["AddContact"] と同じ形にする
  // (add-contact-screen.tsx が両スタックで共有されているため)。
  AddContact: { mode?: "add" | "edit"; contactId?: string } | undefined;
};

const Stack = createNativeStackNavigator<ContactsStackParamList>();

export function ContactsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ContactsMain" component={ContactsScreen} />
      <Stack.Screen name="ContactProfile" component={ContactProfileScreen} />
      <Stack.Screen name="AddContact" component={AddContactScreen} />
    </Stack.Navigator>
  );
}
