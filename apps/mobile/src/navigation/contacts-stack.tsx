import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ContactsScreen } from "../screens/contacts-screen.js";
import { ContactProfileScreen } from "../screens/contact-profile-screen.js";
import { AddContactScreen } from "../screens/add-contact-screen.js";
import type { ContactEntry } from "../api/contacts-api.js";

export type ContactsStackParamList = {
  ContactsMain: undefined;
  ContactProfile: { contact: ContactEntry };
  AddContact: undefined;
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
