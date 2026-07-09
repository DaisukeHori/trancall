/**
 * Expo アプリのエントリポイント
 *
 * Expo 標準の `node_modules/expo/AppEntry.js` を使わずカスタムエントリを採用する。
 * `registerRootComponent` を明示的に呼ばないとネイティブ側にルートコンポーネントが
 * 登録されず、起動直後にクラッシュする (Expo/RN の必須初期化手順)。
 *
 * registerRootComponent は AppRegistry.registerComponent("main", () => App) と同義だが、
 * Expo Go / bare workflow 双方で動作するよう環境差異を吸収してくれるため
 * こちらを使用する (Expo 公式のカスタムエントリ手順に準拠)。
 */
import { registerRootComponent } from "expo";

import App from "./App.js";

registerRootComponent(App);
