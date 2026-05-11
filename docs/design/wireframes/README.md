# TranCall ワイヤーフレーム

Phase 1 MVP の全12画面のワイヤーフレームを格納する。

## ファイル一覧

| ファイル | 画面 |
|---------|------|
| core-screens.html | SCR-001〜006（Onboarding, Home, In-call, Incoming, Contacts, Settings） |
| contact-call-flow.html | SCR-007〜012（Add contact, Contact profile, Pre-call, Calling, Summary, Transcript） |
| permission-consent.html | 追加画面（マイク権限, 通知権限, 翻訳同意(発信者), 翻訳同意(着信者), マイク拒否状態, 残高不足） |

## 閲覧方法

HTMLファイルをブラウザで直接開くと、モバイルフレーム付きのワイヤーフレームが表示される。
各画面を個別表示するボタンと全画面一覧表示を切り替え可能。

## 画面遷移マップ

```
SCR-001 Onboarding
  └→ SCR-002 Home (Recent)
       ├→ SCR-005 Contacts
       │    ├→ SCR-007 Add contact
       │    └→ SCR-008 Contact profile
       │         └→ SCR-009 Pre-call setup
       │              └→ SCR-010 Calling (ringing)
       │                   └→ SCR-003 In-call
       │                        └→ SCR-011 Call summary
       │                             ├→ SCR-012 Full transcript
       │                             └→ SCR-002 Home
       ├→ SCR-004 Incoming call → SCR-003 In-call
       └→ SCR-006 Settings
```
