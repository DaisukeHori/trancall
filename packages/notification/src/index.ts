/**
 * @trancall/notification — Public API
 *
 * 外部モジュールはこのファイルが export するシンボルのみ利用できる。
 * services/ / repositories/ / adapters/ への直接 import は禁止。
 */

export { createNotificationFacade } from "./facade";
export type { NotificationFacade, NotificationFacadeDeps } from "./facade";

export type {
  NotificationTarget,
  IncomingCallNotification,
  MissedCallPayload,
} from "./schemas";

export { createDeviceTokenService } from "./services/device-token-service";
export type { DeviceTokenService } from "./services/device-token-service";

export { createPushDispatcher } from "./services/push-dispatcher";
export type { PushDispatcher, PushDispatcherDeps } from "./services/push-dispatcher";

export type { DeviceTokenRepository } from "./repositories/device-token-repository";
export type { PushLogRepository } from "./repositories/push-log-repository";

export { createApnsAdapter } from "./adapters/apns-adapter";
export type { ApnsAdapter, ApnsAdapterConfig } from "./adapters/apns-adapter";

export { createFcmAdapter } from "./adapters/fcm-adapter";
export type { FcmAdapter, FcmAdapterConfig } from "./adapters/fcm-adapter";

export { loadConfig, parseConfig } from "./config";
export type { NotificationConfig } from "./config";

export {
  signCallPayload,
  buildCallTimestamps,
  buildCanonicalString,
} from "./signing/hmac";
export type { CallPayloadSignable } from "./signing/hmac";
