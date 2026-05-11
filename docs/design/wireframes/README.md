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
  └→ [初回起動時] permission-consent.html
       ├→ マイク権限要求 (拒否時: マイク拒否状態画面 → 設定アプリへ誘導)
       └→ 通知権限要求
            └→ SCR-002 Home (Recent)
                 ├→ SCR-005 Contacts
                 │    ├→ SCR-007 Add contact
                 │    └→ SCR-008 Contact profile
                 │         └→ SCR-009 Pre-call setup
                 │              └→ [発信前・初回のみ] 翻訳同意(発信者) フルスクリーン
                 │                   └→ SCR-010 Calling (ringing)
                 │                        └→ SCR-003 In-call
                 │                             ├→ [通話中] 残高不足警告 (ボトムシート)
                 │                             └→ SCR-011 Call summary
                 │                                  ├→ SCR-012 Full transcript
                 │                                  └→ SCR-002 Home
                 ├→ SCR-004 Incoming call
                 │    └→ [応答後・初回のみ] 翻訳同意(着信者) ボトムシート
                 │         └→ SCR-003 In-call
                 └→ SCR-006 Settings
```

### 権限・同意系の出現タイミング（permission-consent.html の各画面）

| 画面 | 出現タイミング | 形式 |
|------|--------------|------|
| マイク権限要求 | アプリ初回起動時、Onboarding 直後 | フルスクリーン |
| 通知権限要求 | マイク権限要求の直後 | フルスクリーン |
| 翻訳同意（発信者） | 初回発信時の Pre-call setup 内 | フルスクリーン |
| 翻訳同意（着信者） | 初回着信応答後、Room 参加前 | ボトムシート（軽量同意） |
| マイク拒否状態 | マイク権限が拒否されている状態で通話を試みた時 | 案内画面（設定アプリへ誘導） |
| 残高不足警告 | 通話中に残量が0になった時 | ボトムシート（通話継続オプション提示） |
