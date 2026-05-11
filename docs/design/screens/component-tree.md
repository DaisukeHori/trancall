# TranCall 画面コンポーネント分解

## SCR-001 Onboarding

```
OnboardingScreen
├── AppLogo
├── Heading ("TranCall")
├── SubHeading ("すべての通話を、自分の言語で。")
├── LanguageGrid
│   └── LanguageChip × 13 (selected state)
└── PrimaryButton ("Next →")
```

## SCR-002 Home (Recent)

```
HomeScreen
├── ScreenHeader ("Recent calls")
├── SearchInput (placeholder: "Search contacts...")
├── CallHistoryList
│   └── CallHistoryRow × N
│       ├── Avatar (initials, color)
│       ├── ContactName
│       ├── CallDirection (↗ outgoing / ↙ incoming / ✕ missed)
│       ├── CallTime ("Today 14:32")
│       ├── LanguageBadge ("EN→JA")
│       └── CallButton (再発信)
└── TabBar [Recent*, Contacts, Call, Settings]
```

## SCR-003 In-call

```
InCallScreen
├── StatusBar (● Translating / ● Reconnecting)
├── CallerInfo
│   ├── Avatar
│   ├── ContactName
│   └── CallTimer ("03:42")
├── TranslationBadge ("EN→JA Live")
├── SubtitleOverlay
│   └── SubtitleBox × 3 (最新3発話)
│       ├── OriginalText (gray, small)
│       ├── TranslatedText (white)
│       └── LoadingDots (partial時に点滅)
├── CallControls
│   ├── MuteButton (toggle)
│   ├── SpeakerButton (toggle)
│   ├── TranslationToggle (ON/OFF)
│   └── EndCallButton (red)
└── DegradationBanner (翻訳一時停止時のみ表示)
```

## SCR-004 Incoming Call

```
IncomingCallScreen (フルスクリーンモーダル)
├── Label ("Incoming call")
├── Avatar (large)
├── CallerName
├── LanguageBadge ("FR→JA")
├── TranslationReadyLabel
├── CallActions
│   ├── DeclineButton (red circle)
│   └── AcceptButton (green circle)
└── [初回のみ] ConsentBottomSheet
    ├── ConsentTitle
    ├── ConsentDescription
    ├── AgreeButton
    └── DeclineButton (翻訳OFFで応答)
```

## SCR-005 Contacts

```
ContactsScreen
├── ScreenHeader ("Contacts")
├── SearchInput
├── AddContactButton
├── FavoritesSection
│   └── ContactRow × N (★ icon)
├── AllContactsSection
│   └── ContactRow × N
│       ├── Avatar
│       ├── ContactName
│       ├── LanguageLabel
│       └── ActionButtons [Call, Message]
└── TabBar
```

## SCR-006 Settings

```
SettingsScreen
├── ProfileCard
│   ├── Avatar
│   ├── DisplayName
│   └── Email
├── TranslationSection
│   ├── NativeLanguageSetting
│   ├── ShowSubtitlesSetting (toggle)
│   └── DynamicVoiceInfo (説明テキスト)
├── PlanSection
│   ├── CurrentPlanCard (active border)
│   │   ├── PlanName
│   │   ├── Price
│   │   └── RemainingMinutes
│   └── ManageButton
├── NotificationSection
├── AboutSection (version, privacy, terms)
└── DeleteAccountButton (danger)
```

## SCR-007 Add Contact

```
AddContactScreen
├── BackButton + Header ("Add contact")
├── SearchInput ("Search by TranCall ID or name...")
├── QRScanner (camera preview)
├── SearchResults
│   └── UserRow × N
│       ├── Avatar
│       ├── UserName
│       ├── TranCallId
│       ├── LanguageBadge
│       └── AddButton
├── Divider
├── ShareInviteLinkButton
└── ImportFromDeviceButton
```

## SCR-008 Contact Profile

```
ContactProfileScreen
├── BackButton
├── ProfileHeader
│   ├── Avatar (large)
│   ├── ContactName
│   ├── TranCallId
│   └── LanguageBadge
├── ActionButtons [Audio, Video(Phase2), Message(Phase2), Favorite]
├── CallHistorySection
│   └── CallHistoryRow × N
│       ├── Direction + Date
│       ├── Duration + LanguageBadge
│       └── Cost
└── [メニュー] Block / Report / Remove
```

## SCR-009 Pre-call Setup (初回のみ表示)

```
PreCallSetupScreen
├── BackButton + Header ("Call setup")
├── ContactInfo (Avatar, Name, Language)
├── TranslationToggle (ON/OFF)
├── LanguagePairDisplay
│   ├── "Your voice → their ears: JA→EN"
│   └── "Their voice → your ears: EN→JA"
├── SubtitleToggle
├── CostEstimate
│   ├── PerMinuteRate
│   └── RemainingMinutes
└── StartCallButton (green)
```

## SCR-010 Calling (Ringing)

```
CallingScreen
├── Label ("Calling...")
├── Avatar (large)
├── ContactName
├── LanguageBadge
├── RingingIndicator (dots animation)
├── RingingLabel
└── CancelButton (red circle)
```

## SCR-011 Call Summary

```
CallSummaryScreen
├── Header ("Call ended")
├── ContactInfo
├── StatsGrid (2×2)
│   ├── DurationStat
│   ├── CostStat
│   ├── TranslationPairStat
│   └── RemainingStat
├── TranscriptPreview (最初の2-3セグメント)
│   └── "... View full transcript" link
├── CallAgainButton
└── BackToHomeButton
```

## SCR-012 Full Transcript

```
TranscriptScreen
├── BackButton + Header ("Transcript")
├── TranscriptMeta (contact, duration, languageBadge)
├── ViewModeTabs [Both, Original, Translation]
├── SearchInput
├── SegmentList
│   └── TranscriptSegment × N
│       ├── SpeakerLabel (color-coded)
│       ├── Timestamp
│       ├── OriginalText
│       └── TranslatedText
├── Divider
└── ExportButtons [PDF, TXT, Share]
```

## 追加画面: 権限リクエスト + 同意

### PermissionScreen (マイク/通知)

```
PermissionScreen (初回起動フロー内)
├── IllustrationIcon (マイク or 通知)
├── PermissionTitle
├── PermissionDescription
├── AllowButton (primary)
└── LaterButton (text-only)
```

### ConsentScreen (OpenAI音声送信同意)

```
ConsentScreen (初回翻訳通話前)
├── ShieldIcon
├── ConsentTitle ("翻訳通話について")
├── ConsentDescription
│   ├── Point1: "通話音声がOpenAIに送信されます"
│   ├── Point2: "翻訳処理のみに使用されます"
│   └── Point3: "トランスクリプトはTranCallに保存されます"
├── LearnMoreLink → Privacy Policy
├── AgreeButton (primary)
└── DeclineButton ("翻訳なしで通話する")
```
