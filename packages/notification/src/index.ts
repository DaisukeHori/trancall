/**
 * @trancall/notification — Public API
 *
 * 外部モジュールはこのファイルが export するシンボルのみ利用できる。
 * services/ / repositories/ / adapters/ への直接 import は禁止。
 */

export { createNotificationFacade } from "./facade.js";
export type { NotificationFacade, NotificationFacadeDeps } from "./facade.js";

export type {
  NotificationTarget,
  IncomingCallNotification,
  MissedCallPayload,
} from "./schemas.js";

export { createDeviceTokenService } from "./services/device-token-service.js";
export type { DeviceTokenService } from "./services/device-token-service.js";

export { createPushDispatcher } from "./services/push-dispatcher.js";
export type { PushDispatcher, PushDispatcherDeps } from "./services/push-dispatcher.js";

export type { DeviceTokenRepository } from "./repositories/device-token-repository.js";
export type { PushLogRepository } from "./repositories/push-log-repository.js";

export { createApnsAdapter } from "./adapters/apns-adapter.js";
export type { ApnsAdapter, ApnsAdapterConfig } from "./adapters/apns-adapter.js";

export { createFcmAdapter } from "./adapters/fcm-adapter.js";
export type { FcmAdapter, FcmAdapterConfig } from "./adapters/fcm-adapter.js";

export { loadConfig, parseConfig } from "./config.js";
export type { NotificationConfig } from "./config.js";
