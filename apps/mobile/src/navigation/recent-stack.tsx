import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/home-screen.js";
import { ContactProfileScreen } from "../screens/contact-profile-screen.js";
import { AddContactScreen } from "../screens/add-contact-screen.js";
import type { ContactEntry } from "../api/contacts-api.js";

export type RecentStackParamList = {
  HomeMain: undefined;
  ContactProfile: { contact: ContactEntry };
  AddContact: undefined;
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
