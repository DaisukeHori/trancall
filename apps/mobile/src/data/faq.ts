// apps/mobile/src/data/faq.ts
// FAQ data (canonical: docs/support-flow.md §8)
// Stored as local data for offline support

export type FaqCategory =
  | "account"
  | "call"
  | "translation"
  | "billing"
  | "privacy";

export interface FaqEntry {
  id: string;
  category: FaqCategory;
  question: { ja: string; en: string; zh: string };
  answer: { ja: string; en: string; zh: string };
}

export const FAQ_ENTRIES: FaqEntry[] = [
  // ── account ────────────────────────────────────────────────
  {
    id: "account-1",
    category: "account",
    question: {
      ja: "アカウントの登録方法を教えてください",
      en: "How do I create an account?",
      zh: "如何注册账号？",
    },
    answer: {
      ja: "アプリを起動して「アカウント作成」をタップし、メールアドレスとパスワードを入力してください。登録後に確認メールが届きますので、メール内のリンクをタップして認証を完了してください。",
      en: "Launch the app and tap \"Create Account\". Enter your email address and password. After registration, you will receive a verification email. Tap the link in the email to complete verification.",
      zh: "启动应用并点击「创建账号」，输入电子邮件地址和密码。注册后您将收到一封验证邮件，请点击邮件中的链接完成验证。",
    },
  },
  {
    id: "account-2",
    category: "account",
    question: {
      ja: "パスワードを忘れた場合はどうすればよいですか？",
      en: "What should I do if I forget my password?",
      zh: "忘记密码该怎么办？",
    },
    answer: {
      ja: "ログイン画面の「パスワードを忘れた方」をタップし、登録済みのメールアドレスを入力してください。パスワードリセット用のリンクが記載されたメールをお送りします。",
      en: "Tap \"Forgot Password?\" on the login screen and enter your registered email address. We will send you an email with a link to reset your password.",
      zh: "在登录界面点击「忘记密码？」，输入您注册的电子邮件地址，我们将发送一封包含重置密码链接的邮件。",
    },
  },
  {
    id: "account-3",
    category: "account",
    question: {
      ja: "アカウントを削除するにはどうすればよいですか？",
      en: "How do I delete my account?",
      zh: "如何删除账号？",
    },
    answer: {
      ja: "設定 → アカウント → 「アカウントを削除」をタップしてください。削除の確認後、すべてのデータが完全に削除されます。この操作は取り消せません。",
      en: "Go to Settings -> Account -> tap \"Delete Account\". After confirming the deletion, all your data will be permanently removed. This action cannot be undone.",
      zh: "前往设置 -> 账号 -> 点击「删除账号」。确认删除后，您的所有数据将被永久删除，此操作无法撤销。",
    },
  },
  {
    id: "account-4",
    category: "account",
    question: {
      ja: "表示名や母国語の設定を変更できますか？",
      en: "Can I change my display name or native language?",
      zh: "可以更改显示名称或母语设置吗？",
    },
    answer: {
      ja: "設定画面のプロフィールセクションから表示名や母国語を変更できます。翻訳通話の品質を最大にするために、正確な母国語を設定することを推奨します。",
      en: "You can change your display name and native language from the Profile section in Settings. We recommend setting your correct native language to maximize translation call quality.",
      zh: "您可以在设置界面的个人资料部分更改显示名称和母语。建议设置正确的母语以获得最佳翻詬通话质量。",
    },
  },

  // ── call ───────────────────────────────────────────────────
  {
    id: "call-1",
    category: "call",
    question: {
      ja: "翻訳通話の使い方を教えてください",
      en: "How do I make a translation call?",
      zh: "如何进行翻詬通话？",
    },
    answer: {
      ja: "連絡先を追加してから、連絡先画面でお相手を選んで「通話」をタップしてください。通話前の設定画面で翻訳方向を確認し、「通話を開始」をタップすると翻訳付きの通話が始まります。",
      en: "After adding a contact, select them from the Contacts screen and tap \"Call\". On the pre-call setup screen, confirm the translation direction and tap \"Start Call\" to begin a translation call.",
      zh: "添加联系人后，在联系人界面选择对方并点击「通话」。在通话前设置界面确认翻詬方向，点击「开始通话」即可开始翻詬通话。",
    },
  },
  {
    id: "call-2",
    category: "call",
    question: {
      ja: "着信が来ない時はどうすればよいですか？",
      en: "What should I do if I am not receiving incoming calls?",
      zh: "收不到来电该怎么办？",
    },
    answer: {
      ja: "以下を確認してください。\n\n1. **通知許可** — 設定アプリ → TranCall → 通知 が「オン」になっているか確認してください。\n2. **おやすみモード / 集中モード** — これらが有効な場合、着信通知が届かないことがあります。\n3. **ネットワーク接続** — 安定したインターネット接続があるか確認してください。\n4. **アプリの再起動** — アプリを完全に終了してから再起動してみてください。",
      en: "Please check the following:\n\n1. **Notification permission** - Go to device Settings -> TranCall -> Notifications and make sure it is enabled.\n2. **Do Not Disturb / Focus mode** - These modes may block incoming call notifications.\n3. **Network connection** - Ensure you have a stable internet connection.\n4. **Restart the app** - Fully close the app and restart it.",
      zh: "请检查以下几点：\n\n1. **通知权限** - 前往系统设置 -> TranCall -> 通知，确认通知已开启。\n2. **勿扰模式 / 专注模式** - 这些模式可能会屏蔽来电通知。\n3. **网络连接** - 确认您有稳定的网络连接。\n4. **重启应用** - 完全关闭应用后重新启动。",
    },
  },
  {
    id: "call-3",
    category: "call",
    question: {
      ja: "Bluetooth ヘッドセットが動かない時はどうすればよいですか？",
      en: "What should I do when my Bluetooth headset is not working?",
      zh: "蓝牙耳机无法使用时该怎么办？",
    },
    answer: {
      ja: "以下の手順をお試しください。\n\n1. ヘッドセットと端末の Bluetooth 接続を一度切断し、再接続してください。\n2. 端末の設定 → Bluetooth から対象デバイスを削除し、ペアリングをやり直してください。\n3. TranCall アプリを再起動してください。\n4. 通話中に画面の「スピーカー」ボタンをタップして出力先を切り替えてみてください。\n\n上記で解決しない場合は、お問い合わせフォームからご連絡ください。",
      en: "Please try the following steps:\n\n1. Disconnect and reconnect the Bluetooth connection between your headset and device.\n2. Remove the device from your device's Settings -> Bluetooth and re-pair it.\n3. Restart the TranCall app.\n4. During a call, tap the \"Speaker\" button to switch the audio output.\n\nIf the issue persists, please contact us through the inquiry form.",
      zh: "请尝试以下步骤：\n\n1. 断开耳机与设备的蓝牙连接，然后重新连接。\n2. 在系统设置 -> 蓝牙中删除该设备，然后重新配对。\n3. 重启TranCall应用。\n4. 通话中点击「扬声器」按鈕切换音频输出。\n\n如果问题仍未解决，请通过问题咋询表单联系我们。",
    },
  },
  {
    id: "call-4",
    category: "call",
    question: {
      ja: "通話中に翻訳をオフにできますか？",
      en: "Can I turn off translation during a call?",
      zh: "通话中可以关闭翻詬吗？",
    },
    answer: {
      ja: "通話画面の翻訳 ON/OFF バッジをタップすることで、通話中に翻訳のオン・オフを切り替えられます。翻訳をオフにした場合、相手の声はそのまま（原音）で聴こえます。翻訳をオフにしている間は翻訳分数は消費されません。",
      en: "You can toggle translation on and off during a call by tapping the Translation ON/OFF badge on the call screen. When translation is off, you will hear the other person's voice in the original language. Translation minutes are not consumed while translation is off.",
      zh: "您可以在通话界面点击翻詬开启/关闭标识来切换翻詬状态。关闭翻詬时，您将听到对方的原声。关闭翻詬期间不会消耗翻詬分钟数。",
    },
  },

  // ── translation ────────────────────────────────────────────
  {
    id: "translation-1",
    category: "translation",
    question: {
      ja: "翻訳が途中で止まることがあります",
      en: "Translation stops in the middle of a call",
      zh: "翻詬在通话中途停止了",
    },
    answer: {
      ja: "翻訳の一時停止は、主にネットワーク接続の不安定や翻訳サービスへの一時的なアクセス集中によって発生します。\n\n- 画面上に「翻訳を再接続中...」と表示される場合は、自動的に再接続を試みています。\n- ネットワーク環境（Wi-Fi / モバイルデータ）の切り替えをお試しください。\n- 問題が継続する場合は、お問い合わせフォームよりご報告ください。",
      en: "Translation interruptions are primarily caused by unstable network connections or temporary high load on the translation service.\n\n- If \"Reconnecting translation...\" appears on screen, the app is automatically attempting to reconnect.\n- Try switching your network environment (Wi-Fi / mobile data).\n- If the issue persists, please report it through the inquiry form.",
      zh: "翻詬中断主要是由网络连接不稳定或翻詬服务临时负载过高引起的。\n\n- 如果屏幕上显示「正在重新连接翻詬...」，应用正在自动尝试重新连接。\n- 请尝试切换网络环境（Wi-Fi / 移动数据）。\n- 如果问题持续，请通过问题咋询表单进行报告。",
    },
  },
  {
    id: "translation-2",
    category: "translation",
    question: {
      ja: "翻訳精度を上げるコツはありますか？",
      en: "Are there tips to improve translation accuracy?",
      zh: "有提高翻詬精度的技巧吗？",
    },
    answer: {
      ja: "翻訳精度を高めるためのポイントをご紹介します。\n\n1. **明繊に話す** — 早口や小声を避け、はっきりと話してください。\n2. **静かな環境** — 背景ノイズが多い場所では精度が下がることがあります。\n3. **短い文節** — 長すぎる文よりも、適度に区切って話すと翻訳精度が向上します。\n4. **ヘッドセット使用** — マイク内蔵のヘッドセットを使用するとノイズを低減できます。",
      en: "Here are some tips to improve translation accuracy:\n\n1. **Speak clearly** - Avoid speaking too fast or too quietly. Speak distinctly.\n2. **Quiet environment** - High background noise can reduce accuracy.\n3. **Short phrases** - Speaking in shorter segments rather than very long sentences improves translation quality.\n4. **Use a headset** - A headset with a built-in microphone can reduce background noise.",
      zh: "以下是提高翻詬精度的技巧：\n\n1. **清晰地说话** - 避免语速过快或声音过小，说话要清晰。\n2. **安静的环境** - 背景噪音大的地方可能会降低精度。\n3. **简短的语句** - 使用较短的句子比冗长的句子翻詬质量更好。\n4. **使用耳机** - 使用内置麦克风的耳机可以减少背景噪音。",
    },
  },
  {
    id: "translation-3",
    category: "translation",
    question: {
      ja: "対応している言語は何ですか？",
      en: "What languages are supported?",
      zh: "支持哪些语言？",
    },
    answer: {
      ja: "TranCall は GPT-Realtime-Translate を利用しており、現在 13 言語の出力に対応しています。\n\n対応言語: 日本語 / 英語 / スペイン語 / ポルトガル語 / フランス語 / ロシア語 / 中国語 / ドイツ語 / 韓国語 / ヒンディー語 / インドネシア語 / ベトナム語 / イタリア語\n\n対応言語は今後のアップデートで追加される予定です。",
      en: "TranCall uses GPT-Realtime-Translate and currently supports output in 13 languages.\n\nSupported languages: Japanese / English / Spanish / Portuguese / French / Russian / Chinese / German / Korean / Hindi / Indonesian / Vietnamese / Italian\n\nAdditional languages will be added in future updates.",
      zh: "TranCall 使用 GPT-Realtime-Translate，目前支持 13 种语言的输出。\n\n支持的语言：日语 / 英语 / 西班牙语 / 葡萄牙语 / 法语 / 俄语 / 中文 / 德语 / 韩语 / 印地语 / 印尼语 / 越南诞 / 意大利语\n\n未来的更新中将添加更多语言。",
    },
  },

  // ── billing ────────────────────────────────────────────────
  {
    id: "billing-1",
    category: "billing",
    question: {
      ja: "課金プランの変更方法を教えてください",
      en: "How do I change my billing plan?",
      zh: "如何更改计费套餐？",
    },
    answer: {
      ja: "設定 → プラン → 「管理」をタップするとブラウザが開き、プランの変更ができます。プラン変更は即時反映されます。\n\nアップグレードした場合、残りの翻訳分数が追加されます。ダウングレードは次の請求サイクルから適用されます。",
      en: "Go to Settings -> Plan -> tap \"Manage\" to open your browser and change your plan. Plan changes take effect immediately.\n\nWhen you upgrade, additional translation minutes will be added. Downgrades take effect from the next billing cycle.",
      zh: "前往设置 -> 套餐 -> 点击「管理」打开浏览器更改套餐。套餐变更立即生效。\n\n升级套餐时，将添加额外的翻詬分钟数。降级将从下一个计费周期开始生效。",
    },
  },
  {
    id: "billing-2",
    category: "billing",
    question: {
      ja: "翻訳分数の残量を確認するにはどうすればよいですか？",
      en: "How do I check my remaining translation minutes?",
      zh: "如何查看剩余翻詬分钟数？",
    },
    answer: {
      ja: "残りの翻訳分数はホーム画面と設定 → プラン セクションで確認できます。また、残量が少なくなると警告が表示されます。通話前の設定画面でも残り分数が確認できます。",
      en: "You can check your remaining translation minutes on the Home screen and in Settings -> Plan section. A warning will also appear when your balance is running low. The pre-call setup screen also shows your remaining minutes.",
      zh: "您可以在首页和设置 -> 套餐部分查看剩余翻詬分钟数。余量不足时也会显示警告。通话前设置界面同样显示剩余分钟数。",
    },
  },
  {
    id: "billing-3",
    category: "billing",
    question: {
      ja: "課金に関する問題 (二重請求・返金など) はどこに連絡すればよいですか？",
      en: "Where do I contact for billing issues (double charges, refunds, etc.)?",
      zh: "计费问题（重复扣款、退款等）应联系哪里？",
    },
    answer: {
      ja: "課金に関するお問い合わせは、お問い合わせフォーム（本画面の「戻る」→「お問い合わせ」→ カテゴリ「課金・お支払い」）からご連絡ください。24 時間以内に返答いたします。\n\n**注意**: Apple App Store 経由でのご購入の場合は、Apple の返金申請ページ (https://reportaproblem.apple.com) もご利用いただけます。",
      en: "For billing inquiries, please contact us through the inquiry form (from this screen: Back -> Contact Us -> Category: Billing). We will respond within 24 hours.\n\n**Note**: For purchases made through the Apple App Store, you can also use Apple's refund request page (https://reportaproblem.apple.com).",
      zh: "有关计费问题，请通过问题咋询表单联系我们（从本界面：返回 -> 联系我们 -> 类别：计费/付款）。我们将在 24 小时内回复。\n\n**注意**：如果您通过 Apple App Store 购买，也可以使用 Apple 的退款申请页面 (https://reportaproblem.apple.com)。",
    },
  },
  {
    id: "billing-4",
    category: "billing",
    question: {
      ja: "無料プランではどのくらい使えますか？",
      en: "How much can I use with the free plan?",
      zh: "免费套餐可以使用多少？",
    },
    answer: {
      ja: "無料プランでは毎月 60 分の翻訳通話をご利用いただけます。翻訳分数は毎月リセットされます。より多くの通話が必要な場合は、有料プランへのアップグレードをご検討ください。",
      en: "The free plan includes 60 minutes of translation calls per month. Translation minutes reset every month. If you need more call time, consider upgrading to a paid plan.",
      zh: "免费套餐每月包含 60 分钟的翻詬通话。翻詬分钟数每月重置。如果您需要更多通话时间，请考虑升级为付费套餐。",
    },
  },

  // ── privacy ────────────────────────────────────────────────
  {
    id: "privacy-1",
    category: "privacy",
    question: {
      ja: "通話音声は保存されますか？",
      en: "Is my call audio stored?",
      zh: "通话音频会被存储吗？",
    },
    answer: {
      ja: "通話音声 (生の音声データ) は TranCall サーバーには保存されません。翻訳処理のために音声が OpenAI のサーバーに送信されますが、OpenAI 側でも音声は保存されません。\n\nトランスクリプト (文字起こし) は TranCall サーバーに保存されます。設定 → 翻訳設定 でトランスクリプトの保存を無効化できます。",
      en: "Raw call audio is not stored on TranCall servers. Audio is sent to OpenAI's servers for translation processing, but OpenAI does not store the audio either.\n\nTranscripts (text records) are stored on TranCall servers. You can disable transcript storage in Settings -> Translation.",
      zh: "原始通话音频不会存储在 TranCall 服务器上。音频会发送到 OpenAI 服务器进行翻詬处理，但 OpenAI 也不会存储音频。\n\n文字记录会存储在 TranCall 服务器上。您可以在设置 -> 翻詬设置中禁用文字记录存储。",
    },
  },
  {
    id: "privacy-2",
    category: "privacy",
    question: {
      ja: "OpenAI への音声送信について教えてください",
      en: "Can you tell me about audio transmission to OpenAI?",
      zh: "请介绍一下向 OpenAI 传输音频的相关信息",
    },
    answer: {
      ja: "TranCall の翻訳機能は OpenAI の GPT-Realtime-Translate API を使用しています。通話中の音声はリアルタイムで OpenAI のサーバーに送信され、翻訳処理が行われます。\n\n- OpenAI は音声を翻訳目的のみに使用します\n- 翻訳後、音声データは OpenAI 側で保存されません\n- 詳細は OpenAI のプライバシーポリシー (https://openai.com/policies/privacy-policy) をご確認ください\n\n翻訳機能を使用しない通話 (翻訳 OFF) では、音声は OpenAI に送信されません。",
      en: "TranCall's translation feature uses OpenAI's GPT-Realtime-Translate API. During a call, audio is sent in real time to OpenAI's servers for translation processing.\n\n- OpenAI uses the audio only for translation purposes\n- Audio data is not stored by OpenAI after translation\n- For details, please see OpenAI's Privacy Policy (https://openai.com/policies/privacy-policy)\n\nWhen translation is disabled during a call, audio is not sent to OpenAI.",
      zh: "TranCall 的翻詬功能使用 OpenAI 的 GPT-Realtime-Translate API。通话中的音频会实时发送到 OpenAI 服务器进行翻詬处理。\n\n- OpenAI 仅将音频用于翻詬目的\n- 翻詬后， OpenAI 不会存储音频数据\n- 详情请参阅 OpenAI 隐私政策 (https://openai.com/policies/privacy-policy)\n\n当通话中禁用翻詬时，音频不会发送到 OpenAI。",
    },
  },
  {
    id: "privacy-3",
    category: "privacy",
    question: {
      ja: "トランスクリプト (文字起こし) の保存期間はどのくらいですか？",
      en: "How long are transcripts stored?",
      zh: "文字记录会保存多长时间？",
    },
    answer: {
      ja: "トランスクリプトは通話終了後、デフォルトで 90 日間保存されます。保存期間内であれば、通話履歴から確認・エクスポートできます。\n\nトランスクリプトの保存が不要な場合は、設定 → 翻訳設定 から無効化できます。無効化後は新しい通話のトランスクリプトは保存されなくなります。",
      en: "Transcripts are stored for 90 days by default after the call ends. During the retention period, you can view and export them from your call history.\n\nIf you do not need transcripts stored, you can disable this in Settings -> Translation. After disabling, transcripts from new calls will not be saved.",
      zh: "文字记录在通话结束后默认保存 90 天。在保存期间内，您可以从通话记录中查看和导出。\n\n如果不需要保存文字记录，可以在设置 -> 翻詬设置中禁用。禁用后，新通话的文字记录将不再保存。",
    },
  },
  {
    id: "privacy-4",
    category: "privacy",
    question: {
      ja: "データの削除を依頼するにはどうすればよいですか？",
      en: "How do I request deletion of my data?",
      zh: "如何申请删除我的数据？",
    },
    answer: {
      ja: "データ削除の方法は 2 通りあります。\n\n**1. アカウント削除**: 設定 → アカウント → 「アカウントを削除」をタップすると、すべての個人データ（プロフィール・通話履歴・トランスクリプト）が削除されます。\n\n**2. 部分削除のご依頼**: 特定のデータのみ削除したい場合は、お問い合わせフォームからカテゴリ「プライバシー」でご連絡ください。\n\nGDPR / 個人情報保護法に基づく削除要求にも対応しています。",
      en: "There are two ways to delete your data:\n\n**1. Account deletion**: Go to Settings -> Account -> tap \"Delete Account\" to delete all personal data (profile, call history, transcripts).\n\n**2. Partial deletion request**: If you want to delete specific data only, please contact us through the inquiry form with the category \"Privacy\".\n\nWe also handle deletion requests based on GDPR and personal data protection laws.",
      zh: "删除数据有两种方式：\n\n**1. 删除账号**：前往设置 -> 账号 -> 点击「删除账号」，将删除所有个人数据（个人资料、通话记录、文字记录）。\n\n**2. 部分删除申请**：如果您只想删除特定数据，请通过问题咋询表单选择「隐私」类别联系我们。\n\n我们也处理基于 GDPR 和个人信息保护法的删除请求。",
    },
  },
];

export const FAQ_CATEGORIES: FaqCategory[] = [
  "account",
  "call",
  "translation",
  "billing",
  "privacy",
];
