/**
 * audio-routing — LiveKit ambient passthrough 音量制御
 *
 * docs/call-lifecycle.md Section 6 参照:
 *   raw-callerA    30%  → ambient passthrough
 *   trans-A-to-ja  90%  → 翻訳済み音声
 *   ducking 時 raw 10%
 *   fallback 時 raw 100%
 */
import { callTokens } from "@trancall/ui-kit";

export type AudioRoutingMode = "normal" | "ducking" | "fallback";

/**
 * Track の音量を制御するためのヘルパー。
 * 実際の音量設定は @livekit/react-native の RemoteTrackPublication を通じて行う。
 * 本実装では型安全な volume 値を計算して返す。
 */
export interface VolumeSettings {
  rawTrackVolume: number;
  translatedTrackVolume: number;
}

export function calcVolumeSettings(mode: AudioRoutingMode): VolumeSettings {
  switch (mode) {
    case "normal":
      return {
        rawTrackVolume: callTokens.ambientVolumeNormal,      // 0.3
        translatedTrackVolume: 0.9,
      };
    case "ducking":
      return {
        rawTrackVolume: callTokens.ambientVolumeDucking,     // 0.1
        translatedTrackVolume: 0.9,
      };
    case "fallback":
      return {
        rawTrackVolume: callTokens.ambientVolumeFallback,    // 1.0
        translatedTrackVolume: 0,
      };
  }
}

/**
 * AudioRouting は track 参照を保持し、モード変更時に音量を適用する。
 */
export class AudioRouting {
  private mode: AudioRoutingMode = "normal";

  /**
   * モードを変更して音量設定を返す。
   * 呼び出し側は返却値を使って実際の track 音量を設定する。
   */
  setMode(mode: AudioRoutingMode): VolumeSettings {
    this.mode = mode;
    return calcVolumeSettings(mode);
  }

  getMode(): AudioRoutingMode {
    return this.mode;
  }

  getCurrentVolumes(): VolumeSettings {
    return calcVolumeSettings(this.mode);
  }
}
