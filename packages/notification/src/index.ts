/**
 * @trancall/notification — Public API
 *
 * 外部モジュールはこのファイルが export するシンボルのみ利用できる。
 * services/ / repositories/ / adapters/ への直接 import は禁止。
 */

export { createNotificationFacade } from "./facade.ts";
export type { NotificationFacade, NotificationFacadeDeps } from "./facade.ts";

export type {
  NotificationTarget,
  IncomingCallNotification,
  MissedCallPayload,
} from "./schemas.ts";

export { createDeviceTokenService } from "./services/device-token-service.ts";
export type { DeviceTokenService } from "./services/device-token-service.ts";

export { createPushDispatcher } from "./services/push-dispatcher.ts";
export type { PushDispatcher, PushDispatcherDeps } from "./services/push-dispatcher.ts";

export type { DeviceTokenRepository } from "./repositories/device-token-repository.ts";
export type { PushLogRepository } from "./repositories/push-log-repository.ts";

export { createApnsAdapter } from "./adapters/apns-adapter.ts";
export type { ApnsAdapter, ApnsAdapterConfig } from "./adapters/apns-adapter.ts";

export { createFcmAdapter } from "./adapters/fcm-adapter.ts";
export type { FcmAdapter, FcmAdapterConfig } from "./adapters/fcm-adapter.ts";

export { loadConfig, parseConfig } from "./config.ts";
export type { NotificationConfig } from "./config.ts";

export {
  signCallPayload,
  buildCallTimestamps,
  buildCanonicalString,
} from "./signing/hmac.ts";
export type { CallPayloadSignable } from "./signing/hmac.ts";
