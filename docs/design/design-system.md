# TranCall Design System

> 「すべての通話を、自分の言語で。」 — Every call, in your language.

TranCall is a real-time translated VoIP calling app (iOS / Android, React Native + Expo + New Architecture). It uses GPT-Realtime-Translate to translate voice both directions during a live phone call. This design system is the visual + interaction substrate that ships in **`packages/ui-kit`** and is consumed by every screen of the app.

## Sources

All visuals and tokens here were extracted from the canonical codebase. Nothing was invented:

- **Repo:** `DaisukeHori/trancall` @ `main`
- **Token source of truth:** `packages/ui-kit/src/tokens.ts`
- **Component library:** `packages/ui-kit/src/components/*.tsx`
- **Theme hook:** `packages/ui-kit/src/theme/{light,dark,index}.ts`
- **i18n (copy fundamentals):** `packages/ui-kit/src/i18n/locales/{ja,en}.json`
- **Module brief:** `packages/ui-kit/CLAUDE.md`, `packages/ui-kit/docs/design.md`

The imported subset of the repo is preserved under `packages/ui-kit/` in this project so you can re-read it without GitHub access.

## Product context

TranCall renders an unusual UI for a voice-call app: the **subtitle** is the hero, the call controls are intentionally tiny. Every screen has to communicate three pieces of live state that a normal phone app doesn't have:

1. **Translation on/off** — never ambiguous. Always a badge.
2. **Language pair** — `JA → EN`, shown in the status strip.
3. **Cost & balance** — `¥X / 残り N 分`, visible during and after every call.

Behind the UI an **ambient passthrough** plays the original voice at 30% under the translated voice (`ambientVolumeNormal: 0.3`). This is not surfaced in the UI but explains why the call screen never feels silent during translation latency.

### Platforms covered

| Phase | Targets |
|---|---|
| **Phase 1 (MVP)** | iOS + Android phones, portrait only, 375×812 → 412×915 |
| Phase 3 | Electron — macOS + Windows desktop (not designed yet) |

### Screen inventory (Phase 1)

12 primary screens plus 4 permission / consent gates:

`SCR-001` Onboarding · `SCR-002` Home / Recent calls · `SCR-003` In-call · `SCR-004` Incoming call · `SCR-005` Contacts · `SCR-006` Settings · `SCR-007` Add contact · `SCR-008` Contact profile · `SCR-009` Pre-call setup · `SCR-010` Calling / Ringing · `SCR-011` Call summary · `SCR-012` Full transcript · Mic permission · Notification permission · Caller consent · Callee consent.

---

## Content fundamentals

The product ships in **13 languages** (ja / en / zh / es / pt / fr / ja / ru / zh / de / ko / hi / id / vi / it). Japanese (`ja`) is the primary; English (`en`) is the secondary. All copy below is quoted verbatim from `i18n/locales/ja.json` and `en.json`.

### Voice & tone

- **Quietly functional, never marketing-y.** No exclamation marks, no emoji in product copy (flag emoji appear *only* as language labels in the picker). Copy reports state; it does not cheer.
- **Polite, neutral Japanese.** Verbs are mostly noun-form (`通話を開始` / `連絡先を追加`) or です/ます (`再ログインしてください`). No キラキラ, no slang. Honorifics avoided unless instructing the user (`ください` for required actions only).
- **English is direct and lowercase-titled.** `Recent calls`, not `Recent Calls`. Buttons are imperative: `Allow`, `Accept`, `Decline`, `Save`.
- **Brand line:** `TranCall — すべての通話を、自分の言語で。` (`Every call, in your language.`)
- **Status copy is binary and explicit.** `翻訳ON` / `翻訳OFF`, `Translating` / `Reconnecting` / `Stopped`. Never `Almost ready` or `Just a moment`.
- **Money + minutes are concrete.** `約{{cost}}円/分`, `残り{{minutes}}分（{{plan}}プラン）`. Always with units, always with the plan name when balance is involved.
- **Errors name the cause and the fix.** Not `Something went wrong` — `接続できません。ネットワークを確認してください。` (`Can't connect. Check your network.`)
- **First-person voice:** the product addresses the user as `あなた` only in setup screens (`あなたの声 → 相手`). Otherwise impersonal.

### Casing & punctuation

- Japanese: full-width punctuation, no trailing periods on UI labels (`通話を終了`).
- English: sentence case for labels (`Recent calls`), Title Case only for proper-noun product features (`TranCall`).
- Sentence-ending punctuation only in body text and consent screens.
- The em-dash and arrow `→` are used for direction (`Your voice → Them`, `JA → EN`).

### Vocabulary cheatsheet

| Concept | JA | EN |
|---|---|---|
| Translation on / off | 翻訳ON / 翻訳OFF | Translation on / off |
| Subtitles | 字幕 | Subtitles |
| Live subtitles toggle | リアルタイム字幕 | Live subtitles |
| Plan & balance | プラン / 残り分数 | Plan / Remaining minutes |
| Insufficient balance | 翻訳分数が不足しています | Insufficient minutes |
| Recovered notification | 翻訳が復旧しました | Translation recovered |
| Caller consent | 通話音声がOpenAI社のサーバーに送信されます | Call audio will be sent to OpenAI's servers |

### Don'ts (from the brief)

- **No Claude / Anthropic / OpenAI branding** in the product UI (consent screens may mention OpenAI by name as a fact, but never as a logo).
- **No ads** in the call surface.
- **No flashy animation.** Only the `translate.degraded` and `translate.recovered` fade is allowed.
- **Don't be ambiguous about translation state** — every call surface must carry a badge for it.

---

## Visual foundations

### Color system

Two complete schemes — **light** (default) and **dark** — both required, both at WCAG AA contrast. Tokens live in `packages/ui-kit/src/tokens.ts` and are mirrored as CSS custom properties in `colors_and_type.css`.

**Primary** — `#0A7AFF` (light) / `#64B5F6` (dark). iOS system blue in light mode, softened blue in dark mode so a glowing translation badge doesn't burn into a black call screen.

**Semantic pairs (foreground + tinted background, used everywhere):**

| Role | Foreground | Tinted bg (light) | Tinted bg (dark) | Used for |
|---|---|---|---|---|
| Primary | `#0A7AFF` / `#64B5F6` | `#E6F1FB` | `#0C447C` | Translation ON, primary actions |
| Success | `#34C759` | `#EAF3DE` | `#1A3A1A` | `Translating` status, confirmations |
| Warning | `#FF9500` | `#FAEEDA` | `#3A2A0A` | `Reconnecting`, low balance, favorite star |
| Danger | `#FF3B30` | `#FCEBEB` | `#3A1A1A` | `Stopped`, missed calls, decline / hang-up |

Backgrounds layer through three steps (`bgPrimary` → `bgSecondary` → `bgTertiary`) to differentiate cards, sheets, and pressed-state surfaces. Text steps through three (`textPrimary` → `textSecondary` → `textTertiary`) for hierarchy.

Subtitles use a fixed-formula overlay: `rgba(0,0,0,0.7)` (light) / `rgba(0,0,0,0.85)` (dark), white translated text on a `#AAAAAA` original sub-line.

### Typography

System fonts only — `fontFamily` is intentionally left `undefined` in `tokens.ts` so the OS supplies San Francisco on iOS and Roboto on Android. The web mirror uses an SF Pro → Hiragino Sans → Noto Sans JP → Roboto fallback stack.

| Role | Size | Weight | Usage |
|---|---|---|---|
| `heading1` | 28 | 700 | Onboarding hero, call-ended summary number |
| `heading2` | 18 | 600 | Screen titles, plan names |
| `heading3` | 16 | 600 | Card / list section headers |
| `body` | 16 | 400 | Default text, contact names |
| `bodySmall` | 14 | 400 | Helper text, secondary lines in list rows |
| `caption` | 12 | 500 | Badges, timestamps, balance counters |
| `captionSmall` | 10 | 500 | Tab labels, micro-meta |
| `mono` | 14 | 500 | Durations, cost figures, TranCall IDs |

Durations and costs are always **tabular-nums** so they don't shift width while a call counts up.

### Spacing — 8-step scale

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. The 4-step is reserved for icon-to-label gaps and badge padding; the 8 / 12 / 16 trio runs the layout; 24 / 32 are section breathing room; 48 / 64 are reserved for full-screen hero whitespace (onboarding, call-ended, calling).

### Radii

`4 · 8 · 12 · 16 · full(9999)`. Buttons and inputs use `8`. Cards use `12`. Bottom sheets use `16` on the top corners only. `full` is reserved for avatars, badges, and circular call-action buttons.

### Elevation & cards

A single soft elevation runs through the system. From `Card.tsx`:

```
shadowOffset { width: 0, height: 2 }
shadowOpacity 0.08
shadowRadius  4
elevation     2   (Android)
```

Cards always carry a 1px `--tc-border` outline *in addition* to the shadow — iOS-style, so the card edge stays defined even when the shadow is suppressed by a parent surface. There are no decorative left-border accents or coloured stripes; the system is flat plus border plus subtle shadow.

The only "louder" shadow is the FAB / call-action shadow (`0 6px 16px` tinted by `--tc-primary`), used for the green answer button and the floating call button.

### Backgrounds & imagery

There is no decorative photography. Onboarding uses a clean white surface; the call screen uses a deep `#1C1C1E` Material-style dark surface regardless of system theme; everything else is flat with the tinted semantic backgrounds above. No gradients except the optional bottom-of-screen black protection gradient on the in-call view (so subtitles stay legible over a moving avatar).

### Transparency & blur

Reserved for two places:

1. **Subtitle overlay** — `rgba(0,0,0,0.7–0.85)` solid, no blur (faster on Android).
2. **Modal backdrops** — `rgba(0,0,0,0.4)` from `LanguagePicker.tsx`.

iOS-style backdrop-filter blur is **not** used; this is intentional — Android RN's blur is patchy, so the system commits to solid translucency only.

### Animation

Minimal by policy. The only sanctioned motion is the `translate.degraded` → `translate.recovered` cross-fade (200–250ms ease-out) on the status badge, and the bottom-sheet slide for `LanguagePicker` / low-balance warnings. No springs, no bounce, no parallax. The `Reconnecting` badge gets a slow 1.4s opacity pulse.

### Interaction states

- **Press (touch-down):** `opacity: 0.6` (RN `TouchableOpacity` default — the system relies on it; no shrink, no colour change).
- **Disabled:** `opacity: 0.5` plus `pointerEvents: none`. Button text colour does not change.
- **Focused (input):** border colour swaps from `--tc-border` to `--tc-primary`.
- **Error (input):** border colour swaps to `--tc-danger`, helper text renders in `--tc-danger` with `accessibilityRole="alert"`.
- **Hover** is not designed — this is a touch-first product.

### Borders

`1px` of `--tc-border` is the standard divider. The only exception is the **selected** state on `PlanCard` (`borderWidth: 2`, `borderColor: --tc-primary`), which is the system's one approved "louder" border.

### Layout rules

- Mobile portrait, fixed widths 375 → 412 px.
- Safe area at top + bottom is mandatory; keyboard avoidance on every screen with an input.
- Tap targets are **never** below 44×44 (iOS HIG); the call action button is 56×56 (`callTokens.actionSize`), normal controls 48×48 (`callTokens.controlSize`).
- Lists separate rows with a `StyleSheet.hairlineWidth` bottom border in `--tc-border`, no card per row.
- Section spacing is `--tc-space-24`; intra-section spacing `--tc-space-12` or `--tc-space-16`.

### Accessibility (non-negotiable)

- WCAG 2.1 **AA** in both schemes (4.5:1 minimum contrast).
- Every `TouchableOpacity` carries `accessibilityLabel` + `accessibilityRole`. The `Button` and `ContactRow` components enforce this via TypeScript.
- Translation status is announced via the badge `accessibilityRole="text"` — screen readers always hear translation state.
- Subtitle overlay is `pointerEvents="none"` so it never blocks the call surface gestures.

---

## Iconography

The codebase intentionally uses **almost no SVG iconography**. Where icons appear, they fall into two buckets:

1. **Unicode glyphs**, used directly in `Text`:
   - `★` / `☆` — favorite on `ContactRow` (warning-orange when filled, border-grey when empty).
   - `›` — disclosure chevron at the end of every navigable row.
   - `▾` — picker disclosure caret.
   - `✓` — confirmation tick inside `PlanCard`'s selected badge and after consent.

2. **Flag emoji**, used **only** in `LanguagePicker` as 24px native glyphs (`LANGUAGE_LIST` in `LanguagePicker.tsx`). They are language tags, not decorative emoji. The product copy itself never uses emoji.

This design system therefore links **Phosphor Icons** (line variant) from CDN as the recommended icon family for any new icon needed — it is the closest match to the iOS-HIG + Material-3 dual-baseline the brief calls for, and its 16/20/24 sizes line up with the spacing scale. This is a **substitution**, flagged in the caveats. The repo currently has no icon font of its own.

```html
<!-- preferred for new icons -->
<script src="https://unpkg.com/@phosphor-icons/web"></script>
<i class="ph ph-phone"></i>           <!-- call -->
<i class="ph ph-phone-slash"></i>     <!-- decline / hang up -->
<i class="ph ph-microphone-slash"></i> <!-- mute -->
<i class="ph ph-speaker-high"></i>    <!-- speaker -->
<i class="ph ph-translate"></i>       <!-- translation toggle -->
```

When a brand mark is needed, use `assets/trancall-mark.svg` (the wordmark in this system). The brief explicitly forbids displaying Claude / Anthropic / OpenAI logos in product UI; OpenAI may be named in plaintext on the consent screen only.

---

## Index of this design system

| Path | What's in it |
|---|---|
| `README.md` | This document. |
| `colors_and_type.css` | All tokens as CSS custom properties + semantic classes. |
| `SKILL.md` | Cross-compatible skill manifest. |
| `assets/` | Brand wordmark, app icon, logo lockups. |
| `preview/` | Per-card HTML specimens registered for the Design System tab. |
| `ui_kits/mobile/` | React-Babel recreation of the mobile product, with click-thru screens and component JSX files. |
| `packages/ui-kit/` | The imported, read-only slice of the canonical repo (tokens + components + i18n). |

---

## Caveats

- **Fonts:** TranCall ships with `fontFamily: undefined` (system fonts). On the web mirror, San Francisco isn't available outside Safari — the fallback stack drops down to Inter-like system fonts. If you need a pixel-perfect web preview, drop the SF Pro / Hiragino files into `fonts/` and update the `--tc-font-sans` stack.
- **Icons:** The repo has no icon library of its own. Phosphor (line) is the recommended substitute. Swap if the brand later adopts SF Symbols / Material Symbols.
- **Desktop:** Phase 3 (Electron macOS / Windows) is out of scope here; everything is sized for portrait mobile.
