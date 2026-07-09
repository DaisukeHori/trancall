/**
 * SCR-003 In-call (最複雑)
 *
 * 通話中画面:
 *   - 上部 status strip: 翻訳バッジ + 語ペア + 通話時間 + 残量
 *   - 中央: 相手 Avatar (大、円形)、相手名
 *   - 字幕オーバーレイ (下部 30%)
 *   - コントロール (下部): ミュート/スピーカー/翻訳/終話
 *
 * 翻訳 degraded → cross-fade で warning Badge (200-250ms cross-fade、設計書準拠)
 * 翻訳 stopped → danger Badge + 原音 fallback
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Avatar, Badge, useTheme, callTokens } from "@trancall/ui-kit";
import { useTranslation } from "../i18n/index.js";
import { useCallStore } from "../stores/call-store.js";
import { useSubtitleStore } from "../stores/subtitle-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { useTranslationStatusStore } from "../stores/translation-status-store.js";
import { SubtitleOverlayLive } from "../components/subtitle-overlay-live.js";
import { endCall as apiEndCall } from "../api/room-api.js";
import { getCallKeep } from "../lib/callkit/index.js";
import { connectToRoom, MicrophonePermissionDeniedError, type RoomHandle } from "../lib/livekit/connect.js";
import { subscribeTranslationDataChannel } from "../lib/livekit/data-channel-subscription.js";
import { usePermissionStore } from "../stores/permission-store.js";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { CallStackParamList } from "../navigation/call-overlay.js";

type Props = NativeStackScreenProps<CallStackParamList, "InCall">;

// Format duration for display
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function InCallScreen({ route, navigation }: Props) {
  const {
    roomId,
    callerName,
    callerLanguage,
    callerAvatarUri,
    livekitToken,
    livekitUrl,
    translationEnabled: initialTranslationEnabled,
    callUuid,
  } = route.params;

  const { t } = useTranslation();
  const theme = useTheme();
  const c = theme.colors;
  const s = theme.spacing;

  const session = useAuthStore((state) => state.session);
  const profile = useAuthStore((state) => state.profile);

  const degradedReason = useTranslationStatusStore((state) => state.degradedReason);
  const justRecovered = useTranslationStatusStore((state) => state.justRecovered);
  const clearJustRecovered = useTranslationStatusStore((state) => state.clearJustRecovered);
  const setDegraded = useTranslationStatusStore((state) => state.setDegraded);
  const setRecovered = useTranslationStatusStore((state) => state.setRecovered);

  const callState = useCallStore((state) => state.state);
  const isMuted = useCallStore((state) => state.isMuted);
  const isSpeakerOn = useCallStore((state) => state.isSpeakerOn);
  const translationEnabled = useCallStore((state) => state.translationEnabled);
  const translationStatus = useCallStore((state) => state.translationStatus);
  const callDurationMs = useCallStore((state) => state.callDurationMs);

  const setActive = useCallStore((state) => state.setActive);
  const toggleMuteAction = useCallStore((state) => state.toggleMute);
  const toggleSpeakerAction = useCallStore((state) => state.toggleSpeaker);
  const toggleTranslationAction = useCallStore((state) => state.toggleTranslation);
  const endCallAction = useCallStore((state) => state.endCall);
  const tickDuration = useCallStore((state) => state.tickDuration);
  const setCallError = useCallStore((state) => state.setError);
  const resetSubtitles = useSubtitleStore((state) => state.reset);
  const receivePartialDelta = useSubtitleStore((state) => state.receivePartialDelta);
  const setDeniedPermission = usePermissionStore((state) => state.setDeniedPermission);

  // LiveKit RoomHandle — @livekit/react-native が未インストールの環境
  // (Expo Go / このリポジトリの現状) では connectToRoom が reject し、
  // roomHandleRef は null のままになる (device-verification-required)。
  const roomHandleRef = useRef<RoomHandle | null>(null);
  // translation.status Data Channel の購読解除関数 (cleanup でリーク防止)
  const dataChannelUnsubscribeRef = useRef<(() => void) | null>(null);

  const myLanguage = profile?.native_language ?? "ja";
  const langPair = `${callerLanguage.toUpperCase()} → ${myLanguage.toUpperCase()}`;

  // Animation for status badge cross-fade (degraded→recovered, 200ms)
  const statusOpacity = useRef(new Animated.Value(1)).current;
  const [prevStatus, setPrevStatus] = useState(translationStatus);

  // Reconnecting pulse animation (1.4s, design-system 準拠)
  const reconnectPulse = useRef(new Animated.Value(1)).current;
  const reconnectLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Cost estimate (placeholder — 実際の billing store 結線は Phase 2 で対応予定)
  const remainingMin = 60;
  const plan = t("billing.plans.free.label");

  // Set active on mount — intentional empty deps (run once on mount only)
  useEffect(() => {
    if (callState !== "active") {
      setActive();
    }
    // initialTranslationEnabled is read once on mount, no sync needed
    void initialTranslationEnabled;
    return () => {
      resetSubtitles();
    };
  }, []);

  // LiveKit Room 接続 — connect.ts (native-call-bridge.md §3.2.2 step 8: JS 側で room.connect)
  //
  // ⚠️ device-verification-required: `@livekit/react-native` は本リポジトリに未インストール
  // (依存追加の是非は native-call-bridge-impl-status.md §H-2 参照)。未インストール環境では
  // connectToRoom が reject し、以下は catch されて lastError に日本語メッセージが設定されるのみで
  // 画面はクラッシュしない。依存追加後は実機ビルドで音声疎通を検証する必要がある。
  useEffect(() => {
    if (livekitUrl == null || livekitUrl.length === 0) {
      console.warn("[InCallScreen] livekitUrl is missing — skipping LiveKit connect");
      return;
    }

    let cancelled = false;

    void connectToRoom({ serverUrl: livekitUrl, token: livekitToken })
      .then((room) => {
        if (cancelled) {
          void room.disconnect();
          return;
        }
        roomHandleRef.current = room;

        // translation.status Data Channel (module-contracts.md §3.4 canonical topic) を購読。
        // degraded/recovered → 翻訳ステータスバッジ、subtitle.delta → ライブ字幕オーバーレイ。
        // 通話ライフサイクル (この useEffect の join/leave) に紐付けて subscribe/cleanup する。
        dataChannelUnsubscribeRef.current = subscribeTranslationDataChannel(
          room,
          { setDegraded, setRecovered },
          receivePartialDelta,
          myLanguage,
        );
      })
      .catch((error: unknown) => {
        console.warn("[InCallScreen] connectToRoom failed", error);
        if (error instanceof MicrophonePermissionDeniedError) {
          setDeniedPermission("microphone");
          return;
        }
        setCallError(t("call.connectionFailed"));
      });

    return () => {
      cancelled = true;
      dataChannelUnsubscribeRef.current?.();
      dataChannelUnsubscribeRef.current = null;
      const room = roomHandleRef.current;
      roomHandleRef.current = null;
      if (room != null) {
        void room.disconnect();
      }
    };
    // livekitToken/livekitUrl/myLanguage は route.params/profile から接続時点の値を一度だけ読む
    // (再接続は行わない)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Duration ticker
  useEffect(() => {
    const interval = setInterval(() => {
      tickDuration(Date.now());
    }, 1000);
    return () => { clearInterval(interval); };
  }, [tickDuration]);

  // Translation status cross-fade + reconnect pulse
  useEffect(() => {
    if (translationStatus !== prevStatus) {
      // Cross-fade badge transition (200ms)
      Animated.sequence([
        Animated.timing(statusOpacity, { toValue: 0, duration: 100, useNativeDriver: true }),
        Animated.timing(statusOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
      ]).start();
      setPrevStatus(translationStatus);

      // Screen reader announcement
      const announcement =
        translationStatus === "reconnecting"
          ? t("translation.reconnecting")
          : translationStatus === "stopped"
          ? t("translation.stopped")
          : translationStatus === "translating"
          ? t("translation.enabled")
          : "";
      if (announcement.length > 0) {
        AccessibilityInfo.announceForAccessibility(announcement);
      }
    }

    // Reconnecting pulse
    if (translationStatus === "reconnecting") {
      reconnectLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(reconnectPulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
          Animated.timing(reconnectPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
      );
      reconnectLoopRef.current.start();
    } else {
      reconnectLoopRef.current?.stop();
      reconnectPulse.setValue(1);
    }

    return () => {
      reconnectLoopRef.current?.stop();
    };
  }, [translationStatus, prevStatus, statusOpacity, reconnectPulse, t]);

  // recovered バッジを 3 秒後に消去するタイマー
  useEffect(() => {
    if (!justRecovered) return;
    const timer = setTimeout(() => {
      clearJustRecovered();
    }, 3000);
    return () => { clearTimeout(timer); };
  }, [justRecovered, clearJustRecovered]);

  // degraded / recovered 変化時のアクセシビリティアナウンス
  useEffect(() => {
    if (degradedReason != null) {
      AccessibilityInfo.announceForAccessibility(t("translation.degraded"));
    } else if (justRecovered) {
      AccessibilityInfo.announceForAccessibility(t("translation.recoveredShort"));
    }
  }, [degradedReason, justRecovered, t]);

  const getStatusBadgeVariant = (): "default" | "success" | "warning" | "danger" => {
    if (!translationEnabled) return "danger";
    // degraded / recovered は call-store の translationStatus より優先
    if (degradedReason != null) return "warning";
    if (justRecovered) return "success";
    switch (translationStatus) {
      case "translating": return "success";
      case "reconnecting": return "warning";
      case "stopped": return "danger";
      default: return "default";
    }
  };

  const getStatusBadgeLabel = (): string => {
    if (!translationEnabled) return t("translation.disabled");
    if (degradedReason != null) return t("translation.degraded");
    if (justRecovered) return t("translation.recoveredShort");
    switch (translationStatus) {
      case "translating": return t("translation.enabled");
      case "reconnecting": return t("translation.reconnecting");
      case "stopped": return t("translation.stopped");
      default: return t("translation.enabled");
    }
  };

  const handleToggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    toggleMuteAction();
    roomHandleRef.current?.setMicrophoneMuted(nextMuted).catch((error: unknown) => {
      console.warn("[InCallScreen] setMicrophoneMuted failed", error);
    });
  }, [isMuted, toggleMuteAction]);

  const handleEndCall = useCallback(async () => {
    if (callUuid != null) {
      getCallKeep().endCall(callUuid);
    }

    const room = roomHandleRef.current;
    roomHandleRef.current = null;
    if (room != null) {
      await room.disconnect().catch((error: unknown) => {
        console.warn("[InCallScreen] room.disconnect failed", error);
      });
    }

    endCallAction();

    if (session != null && roomId != null) {
      await apiEndCall(roomId, session.accessToken);
    }

    // Navigate to CallSummary (SCR-011, Layer 4-D では replace で遷移予定)
    // Layer 4-C では popToTop でルートに戻る
    navigation.popToTop();
  }, [callUuid, endCallAction, session, roomId, navigation]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: c.callBg }]}
      accessibilityLabel={t("call.inCall")}
    >
      {/* Status strip */}
      <View
        style={[styles.statusStrip, { paddingTop: s[16], paddingHorizontal: s[16] }]}
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${getStatusBadgeLabel()} ${langPair}`}
      >
        <Animated.View style={[styles.badgeRow, { opacity: statusOpacity }]}>
          <Animated.View
            style={
              translationStatus === "reconnecting"
                ? { opacity: reconnectPulse }
                : undefined
            }
          >
            <Badge variant={getStatusBadgeVariant()}>
              {getStatusBadgeLabel()}
            </Badge>
          </Animated.View>
          <Text style={[styles.langPairText, { color: c.textSecondary }]}>
            {langPair}
          </Text>
        </Animated.View>

        <View style={styles.statusRight}>
          <Text
            style={[styles.duration, { color: c.textSecondary }]}
            accessibilityLabel={formatDuration(callDurationMs)}
          >
            {formatDuration(callDurationMs)}
          </Text>
          <Text style={[styles.remaining, { color: c.textTertiary }]}>
            {t("precall.remainingMinutes", {
              minutes: String(remainingMin),
              plan,
            })}
          </Text>
        </View>
      </View>

      {/* Hero: Peer avatar + name */}
      <View style={[styles.heroSection, { marginTop: s[24] }]}>
        <Avatar
          size="xl"
          fallbackInitials={callerName.slice(0, 2)}
          {...(callerAvatarUri != null ? { uri: callerAvatarUri } : {})}
          accessibilityLabel={callerName}
        />
        <Text
          style={[styles.peerName, { color: c.subtitleText, marginTop: s[12] }]}
          accessibilityRole="header"
        >
          {callerName}
        </Text>
      </View>

      {/* Subtitle overlay */}
      <View style={[styles.subtitleSection, { paddingHorizontal: s[16] }]}>
        <SubtitleOverlayLive isDark mode="Both" />
      </View>

      {/* Call controls */}
      <View style={[styles.controlsSection, { paddingBottom: s[32], paddingHorizontal: s[24] }]}>
        {/* Mute */}
        <View style={styles.controlItem}>
          <Pressable
            onPress={handleToggleMute}
            accessibilityLabel={isMuted ? t("call.unmute") : t("call.mute")}
            accessibilityRole="button"
            accessibilityState={{ selected: isMuted }}
            style={[
              styles.controlButton,
              {
                width: callTokens.controlSize,
                height: callTokens.controlSize,
                borderRadius: theme.radii.full,
                backgroundColor: isMuted ? c.controlSurfaceActive : c.controlSurface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: isMuted ? "transparent" : c.controlSurfaceBorder,
              },
            ]}
          >
            <Text style={[styles.controlIcon, { color: isMuted ? c.textPrimary : c.controlText }]}>
              M
            </Text>
          </Pressable>
          <Text style={[styles.controlLabel, { color: c.textSecondary }]}>
            {isMuted ? t("call.unmute") : t("call.mute")}
          </Text>
        </View>

        {/* End call — center, 56×56 */}
        <View style={styles.controlItem}>
          <Pressable
            onPress={() => { void handleEndCall(); }}
            accessibilityLabel={t("call.endCall")}
            accessibilityRole="button"
            style={[
              styles.endCallButton,
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
          <Text style={[styles.controlLabel, { color: c.textSecondary }]}>
            {t("call.endCall")}
          </Text>
        </View>

        {/* Speaker */}
        <View style={styles.controlItem}>
          <Pressable
            onPress={toggleSpeakerAction}
            accessibilityLabel={t("call.speaker")}
            accessibilityRole="button"
            accessibilityState={{ selected: isSpeakerOn }}
            style={[
              styles.controlButton,
              {
                width: callTokens.controlSize,
                height: callTokens.controlSize,
                borderRadius: theme.radii.full,
                backgroundColor: isSpeakerOn ? c.controlSurfaceActive : c.controlSurface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: isSpeakerOn ? "transparent" : c.controlSurfaceBorder,
              },
            ]}
          >
            <Text style={[styles.controlIcon, { color: isSpeakerOn ? c.textPrimary : c.controlText }]}>
              S
            </Text>
          </Pressable>
          <Text style={[styles.controlLabel, { color: c.textSecondary }]}>
            {t("call.speaker")}
          </Text>
        </View>

        {/* Translation toggle */}
        <View style={styles.controlItem}>
          <Pressable
            onPress={toggleTranslationAction}
            accessibilityLabel={
              translationEnabled ? t("translation.disabled") : t("translation.enabled")
            }
            accessibilityRole="button"
            accessibilityState={{ selected: translationEnabled }}
            style={[
              styles.controlButton,
              {
                width: callTokens.controlSize,
                height: callTokens.controlSize,
                borderRadius: theme.radii.full,
                backgroundColor: translationEnabled
                  ? c.controlSurfaceActive
                  : c.controlSurface,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: translationEnabled ? "transparent" : c.controlSurfaceBorder,
              },
            ]}
          >
            <Text
              style={[
                styles.controlIcon,
                { color: translationEnabled ? c.textPrimary : c.controlText },
              ]}
            >
              T
            </Text>
          </Pressable>
          <Text style={[styles.controlLabel, { color: c.textSecondary }]}>
            {translationEnabled ? t("translation.enabled") : t("translation.disabled")}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  statusStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  langPairText: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  statusRight: {
    alignItems: "flex-end",
  },
  duration: {
    fontSize: 14,
    fontFamily: "monospace",
    fontVariant: ["tabular-nums"],
    fontWeight: "500",
  },
  remaining: {
    fontSize: 11,
    marginTop: 2,
  },
  heroSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  peerName: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  subtitleSection: {
    marginBottom: 8,
  },
  controlsSection: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-start",
    gap: 8,
  },
  controlItem: {
    alignItems: "center",
    gap: 6,
  },
  controlButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  controlIcon: {
    fontSize: 20,
    fontWeight: "700",
  },
  controlLabel: {
    fontSize: 11,
    textAlign: "center",
  },
  endCallButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  endCallIcon: {
    fontSize: 24,
    fontWeight: "700",
  },
});
