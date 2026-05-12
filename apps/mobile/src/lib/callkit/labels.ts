/**
 * CallKit i18n ラベルヘルパー
 *
 * Android CallKit (react-native-callkeep) の setup 時に表示される UI 文言を
 * i18n 解決済み文字列として生成する。
 *
 * 使い方:
 *   import { useTranslation } from "react-i18next";
 *   import { getCallKitLabels } from "../lib/callkit/labels";
 *   import { getCallKeep } from "../lib/callkit/index";
 *
 *   const { t } = useTranslation();
 *   getCallKeep().configure({
 *     appName: "TranCall",
 *     labels: getCallKitLabels(t),
 *   });
 *
 * TODO: CallKit.configure() を呼ぶ初期化コード (App.tsx または root-navigator.tsx 等) で
 *       useTranslation() から取得した t を渡してください。
 */

import type { TFunction } from "i18next";
import type { CallKitLabels } from "./index.js";

export function getCallKitLabels(t: TFunction): CallKitLabels {
  return {
    alertDescription: t("callkit.alertDescription"),
    cancelButton: t("callkit.cancelButton"),
    okButton: t("callkit.okButton"),
  };
}
