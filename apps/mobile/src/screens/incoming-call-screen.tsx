/**
 * SCR-004 Incoming call
 *
 * 着信画面: 大 Avatar + 名前 + 翻訳バッジ + 応答/拒否ボタン
 *
 * iOS: CallKit native UI が OS レベルで表示される。
 *      アプリが前面にあるときのみ JS 側の SCR-004 が表示される。
 * Android: ConnectionService + heads-up notification
 *
 * 応答 → joinCall → InCall に遷移
 * 拒否 → endCall (CallKit 経由で OS に通知)
 */
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Avatar, Badge, useTheme, callTokens } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";
import { useCallStore } from "../stores/call-store";
import { useAuthStore } from "../stores/auth-store";
import { joinCall, endCall as apiEndCall } from "../api/room-api";
import { getCallKeep } from "../lib/callkit/index";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CallStackParamList } from "../navigation/call-overlay";

type Props = NativeStackScreenProps<CallStackParamList, "IncomingCall">;

export function IncomingCallScreen({ route, navigation }: Props) {
  const { roomId, callerName, callerLanguage, callerAvatarUri, callUuid, translationEnabled } =
    route.params;

  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);

  const acceptIncomingAction = useCallStore((state) => state.acceptIncoming);
  const declineIncomingAction = useCallStore((state) => state.declineIncoming);
  const setError = useCallStore((state) => state.setError);

  const myLanguage = profile?.native_language ?? "ja";
  const langPair = `${callerLanguage.toUpperCase()} → ${myLanguage.toUpperCase()}`;

  // Ring pulse animation (Reconnecting opacity pulse — allowed by design-system)
  const pulseAnim1 = useRef(new Animated.Value(0.7)).current;
  const pulseAnim2 = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop1 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim1, {
          toValue: 0,
          duration: 1600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim1, {
          toValue: 0.7,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    const loop2 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim2, {
          toValue: 0,
          duration: 1600,
          delay: 400,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim2, {
          toValue: 0.5,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop1.start();
    loop2.start();
    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [pulseAnim1, pulseAnim2]);

  const handleAccept = async () => {
    if (session == null) return;

    acceptIncomingAction(roomId);

    // Notify CallKit
    if (callUuid != null) {
      getCallKeep().answerIncomingCall(callUuid);
    }

    const result = await joinCall(roomId, session.accessToken);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    navigation.replace("InCall", {
      roomId,
      callerName,
      callerLanguage,
      callerAvatarUri,
      livekitToken: result.data.token,
      livekitUrl: result.data.livekitUrl,
      translationEnabled: translationEnabled ?? true,
    });
  };

  const handleDecline = async () => {
    // Notify CallKit
    if (callUuid != null) {
      getCallKeep().endCall(callUuid);
    }

    if (session != null) {
      await apiEndCall(roomId, session.accessToken);
    }

    declineIncomingAction();
    navigation.goBack();
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: c.callBg }]}
      accessibilityLabel={t("call.incomingCall")}
    >
      {/* Status header */}
      <View style={[styles.header, { paddingTop: s[48] }]}>
        <Text
          style={[
            styles.headerText,
            { color: c.textSecondary, fontSize: theme.typography.caption.fontSize },
          ]}
        >
          {t("call.incomingCall")} · {t("call.translationReady")}
        </Text>
      </View>

      {/* Avatar with ring animation */}
      <View style={[styles.avatarSection, { marginTop: s[32] }]}>
        <View style={styles.avatarWrapper}>
          <Animated.View
            style={[
              styles.ringOuter,
              { opacity: pulseAnim2, backgroundColor: c.primaryBg },
            ]}
          />
          <Animated.View
            style={[
              styles.ringInner,
              { opacity: pulseAnim1, backgroundColor: c.primaryBg },
            ]}
          />
          <Avatar
            size="xl"
            fallbackInitials={callerName.slice(0, 2)}
            {...(callerAvatarUri != null ? { uri: callerAvatarUri } : {})}
            accessibilityLabel={callerName}
          />
        </View>
      </View>

      {/* Caller name */}
      <Text
        style={[
          styles.callerName,
          {
            color: c.subtitleText,
            marginTop: s[24],
            fontSize: theme.typography.heading1.fontSize,
          },
        ]}
        accessibilityRole="header"
      >
        {callerName}
      </Text>

      {/* Translation badges */}
      <View style={[styles.badgeRow, { marginTop: s[8] }]}>
        <Badge variant="default">{langPair}</Badge>
        <Badge variant={translationEnabled ? "success" : "danger"}>
          {translationEnabled ? t("translation.enabled") : t("translation.disabled")}
        </Badge>
      </View>

      <View style={{ flex: 1 }} />

      {/* Action buttons */}
      <View style={[styles.actionsRow, { paddingBottom: s[48] }]}>
        {/* Decline */}
        <View style={styles.actionItem}>
          <Pressable
            onPress={() => { void handleDecline(); }}
            accessibilityLabel={t("call.decline")}
            accessibilityRole="button"
            style={[
              styles.actionButton,
              {
                width: callTokens.actionSize,
                height: callTokens.actionSize,
                borderRadius: theme.radii.full,
                backgroundColor: c.danger,
              },
            ]}
          >
            <Ionicons name="close" size={28} color={c.subtitleText} />
          </Pressable>
          <Text style={[styles.actionLabel, { color: c.textSecondary, marginTop: s[8] }]}>
            {t("call.decline")}
          </Text>
        </View>

        {/* Accept */}
        <View style={styles.actionItem}>
          <Pressable
            onPress={() => { void handleAccept(); }}
            accessibilityLabel={t("call.accept")}
            accessibilityRole="button"
            style={[
              styles.actionButton,
              {
                width: callTokens.actionSize,
                height: callTokens.actionSize,
                borderRadius: theme.radii.full,
                backgroundColor: c.success,
              },
            ]}
          >
            <Ionicons name="call" size={26} color={c.subtitleText} />
          </Pressable>
          <Text style={[styles.actionLabel, { color: c.textSecondary, marginTop: s[8] }]}>
            {t("call.accept")}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    alignItems: "center",
  },
  header: {
    alignItems: "center",
  },
  headerText: {
    letterSpacing: 0.3,
  },
  avatarSection: {
    alignItems: "center",
  },
  avatarWrapper: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: 120,
    height: 120,
  },
  ringInner: {
    position: "absolute",
    width: 116,
    height: 116,
    borderRadius: 58,
  },
  ringOuter: {
    position: "absolute",
    width: 152,
    height: 152,
    borderRadius: 76,
  },
  callerName: {
    fontWeight: "700",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    paddingHorizontal: 48,
  },
  actionItem: {
    alignItems: "center",
  },
  actionButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 13,
  },
});
