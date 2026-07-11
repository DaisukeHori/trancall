/**
 * Call overlay navigator
 *
 * SCR-004 Incoming call は全画面 overlay として実装。
 * Modal presentation で現在の画面の上に重ねる。
 *
 * CallStack: PreCall → Calling → InCall
 *            (incoming call は IncomingCall で独立)
 */
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { PreCallScreen } from "../screens/pre-call-screen";
import { CallingScreen } from "../screens/calling-screen";
import { IncomingCallScreen } from "../screens/incoming-call-screen";
import { InCallScreen } from "../screens/in-call-screen";
import { useTheme } from "@trancall/ui-kit";

// --- Param list ---

export type CallStackParamList = {
  PreCall: {
    calleeId: string;
    calleeName: string;
    calleeLanguage: string;
    calleeAvatarUri?: string;
  };
  Calling: {
    roomId: string;
    calleeName: string;
    calleeLanguage: string;
    calleeAvatarUri?: string;
    translationEnabled: boolean;
  };
  IncomingCall: {
    roomId: string;
    callerName: string;
    callerLanguage: string;
    callerAvatarUri?: string;
    callUuid?: string;
    translationEnabled?: boolean;
  };
  InCall: {
    roomId: string;
    callerName: string;
    callerLanguage: string;
    callerAvatarUri?: string;
    livekitToken: string;
    livekitUrl?: string;
    translationEnabled: boolean;
    callUuid?: string;
  };
};

const Stack = createNativeStackNavigator<CallStackParamList>();

export function CallStack() {
  const theme = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: theme.colors.bgPrimary },
      }}
    >
      <Stack.Screen name="PreCall" component={PreCallScreen} />
      <Stack.Screen name="Calling" component={CallingScreen} />
      <Stack.Screen
        name="IncomingCall"
        component={IncomingCallScreen}
        options={{
          // Full screen modal for incoming call
          presentation: "fullScreenModal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="InCall"
        component={InCallScreen}
        options={{
          // Prevent swipe back during call
          gestureEnabled: false,
          animation: "fade",
        }}
      />
    </Stack.Navigator>
  );
}
