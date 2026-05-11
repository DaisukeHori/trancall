/**
 * LiveKit Adapter ファクトリ
 *
 * 環境変数から LiveKitAdapter を構築する。
 */

import type { AuthFacade } from "@trancall/auth";
import { createLiveKitAdapter } from "@trancall/media";
import type { LiveKitAdapter } from "@trancall/media";
import type { Config } from "../config.js";

export function buildLiveKitAdapter(config: Config, auth: AuthFacade): LiveKitAdapter {
  return createLiveKitAdapter({
    livekitUrl: config.LIVEKIT_URL,
    livekitHttpUrl: config.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://"),
    apiKey: config.LIVEKIT_API_KEY,
    apiSecret: config.LIVEKIT_API_SECRET,
    authFacade: auth,
  });
}
