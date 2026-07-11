/**
 * SCR-010 Calling (ringing)
 *
 * 発信中画面: 大 Avatar、名前、呼び出し中表示、キャンセルボタン
 * 翻訳 ON バッジと語ペア常時表示
 */
import React, { useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar, Badge, useTheme, callTokens } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index";
import { useCallStore } from "../stores/call-store";
import { useAuthStore } from "../stores/auth-store";
import { endCall as apiEndCall, getRoomState, getCallToken } from "../api/room-api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CallStackParamList } from "../navigation/call-overlay";

type Props = NativeStackScreenProps<CallStackParamList, "Calling">;

/** room.status ポーリング間隔 (ms) — Phase 2 で WebSocket/push ベースの signaling に置き換え予定 */
const ANSWER_POLL_INTERVAL_MS = 2000;

export type CallingScreenPollAction = "wait" | "navigate_to_in_call" | "call_ended";

/**
 * room.status から発信中画面が取るべきアクションを決める純粋関数 (テスト用に export)。
 * - "active" (callee が /join した) → InCall へ遷移
 * - "ended" (callee 拒否 / タイムアウト等) → 呼び出し元へ戻る
 * - それ以外 ("waiting" 等) → ポーリング継続
 */
export function decideCallingScreenPollAction(status: string): CallingScreenPollAction {
  if (status === "active") return "navigate_to_in_call";
  if (status === "ended") return "call_ended";
  return "wait";
}

export function CallingScreen({ route, navigation }: Props) {
  const { roomId, calleeName, calleeLanguage, calleeAvatarUri, translationEnabled } = route.params;
  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);
  const endCallAction = useCallStore((state) => state.endCall);
  const resetToIdle = useCallStore((state) => state.resetToIdle);
  const setCallError = useCallStore((state) => state.setError);

  const myLanguage = profile?.native_language ?? "ja";
  const langPair = `${myLanguage.toUpperCase()} → ${calleeLanguage.toUpperCase()}`;

  // callee 応答シグナリングの購読。
  //
  // room/signaling facade は LiveKit Data Channel/WebSocket ベースの push ではなく、
  // room.status (waiting → active) を REST (GET /api/rooms/:id) で確認する構成のため、
  // ここでは既存の room-api.ts (getRoomState/getCallToken、incoming-call-screen.tsx や
  // in-call-screen.tsx と同じ REST クライアント) を使ったポーリングで応答を検知する。
  // Phase 2 で WebSocket/push ベースの即時通知に置き換え予定 (旧 TODO コメント参照)。
  //
  // - room.status === "active" (callee が /join した) → caller 用 token を取得して InCall へ遷移
  // - room.status === "ended" (callee 拒否 / タイムアウト等) → 発信中画面を終了して呼び出し元に戻る
  useEffect(() => {
    if (session == null || roomId == null) return;

    let cancelled = false;

    const intervalId = setInterval(() => {
      void (async () => {
        if (cancelled) return;
        const stateResult = await getRoomState(roomId, session.accessToken);
        if (cancelled || !stateResult.ok) {
          // 一時的なネットワークエラーはポーリングを継続する
          return;
        }

        const action = decideCallingScreenPollAction(stateResult.data.status);

        if (action === "navigate_to_in_call") {
          cancelled = true;
          clearInterval(intervalId);

          const tokenResult = await getCallToken(roomId, session.accessToken);
          if (cancelled) return;
          if (!tokenResult.ok) {
            setCallError(tokenResult.error.message);
            return;
          }

          navigation.replace("InCall", {
            roomId,
            callerName: calleeName,
            callerLanguage: calleeLanguage,
            ...(calleeAvatarUri != null ? { callerAvatarUri: calleeAvatarUri } : {}),
            livekitToken: tokenResult.data.token,
            ...(tokenResult.data.livekitUrl != null
              ? { livekitUrl: tokenResult.data.livekitUrl }
              : {}),
            translationEnabled,
          });
        } else if (action === "call_ended") {
          // callee が応答せず拒否 (endCall) した、またはタイムアウト等で通話が終了した
          cancelled = true;
          clearInterval(intervalId);
          endCallAction();
          resetToIdle();
          navigation.goBack();
        }
      })();
    }, ANSWER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [
    session,
    roomId,
    calleeName,
    calleeLanguage,
    calleeAvatarUri,
    translationEnabled,
    navigation,
    endCallAction,
    resetToIdle,
    setCallError,
  ]);

  const handleCancel = async () => {
    if (session != null && roomId != null) {
      await apiEndCall(roomId, session.accessToken);
    }
    endCallAction();
    setTimeout(() => {
      resetToIdle();
    }, 500);
    navigation.goBack();
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: c.callBg }]}
      accessibilityLabel={t("call.calling")}
    >
      {/* Status */}
      <View style={[styles.statusRow, { paddingTop: s[48] }]}>
        <Text style={[styles.statusText, { color: c.textSecondary }]}>
          {t("call.calling")}
        </Text>
      </View>

      {/* Translation badge + lang pair — always visible */}
      <View style={styles.badgeRow}>
        <Badge variant={translationEnabled ? "default" : "danger"}>
          {translationEnabled ? t("translation.enabled") : t("translation.disabled")}
        </Badge>
        <Text style={[styles.langPair, { color: c.textSecondary }]}>
          {langPair}
        </Text>
      </View>

      {/* Hero avatar */}
      <View style={[styles.heroSection, { marginTop: s[48] }]}>
        <Avatar
          size="xl"
          fallbackInitials={calleeName.slice(0, 2)}
          {...(calleeAvatarUri != null ? { uri: calleeAvatarUri } : {})}
          accessibilityLabel={calleeName}
        />
        <Text
          style={[styles.calleeName, { color: c.subtitleText, marginTop: s[16] }]}
          accessibilityRole="header"
        >
          {calleeName}
        </Text>
        <Text style={[styles.ringing, { color: c.textSecondary, marginTop: s[8] }]}>
          {t("call.ringing")}
        </Text>
      </View>

      {/* Cancel button */}
      <View style={[styles.footer, { paddingBottom: s[48] }]}>
        <Pressable
          onPress={() => { void handleCancel(); }}
          accessibilityLabel={t("common.cancel")}
          accessibilityRole="button"
          style={[
            styles.cancelButton,
            {
              width: callTokens.actionSize,
              height: callTokens.actionSize,
              borderRadius: theme.radii.full,
              backgroundColor: c.danger,
            },
          ]}
        >
          <Ionicons name="close" size={24} color={c.subtitleText} />
        </Pressable>
        <Text style={[styles.cancelLabel, { color: c.textSecondary, marginTop: s[8] }]}>
          {t("common.cancel")}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    alignItems: "center",
  },
  statusRow: {
    alignItems: "center",
  },
  statusText: {
    fontSize: 13,
    letterSpacing: 0.3,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  langPair: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  heroSection: {
    flex: 1,
    alignItems: "center",
  },
  calleeName: {
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  ringing: {
    fontSize: 16,
    fontWeight: "500",
  },
  footer: {
    alignItems: "center",
  },
  cancelButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  cancelIcon: {
    fontSize: 24,
    fontWeight: "700",
  },
  cancelLabel: {
    fontSize: 13,
  },
});
