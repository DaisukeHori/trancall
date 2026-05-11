---
name: trancall-design
description: Use this skill to generate well-branded interfaces and assets for TranCall, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

# TranCall Design Skill

TranCall is a React Native + Expo VoIP app with real-time GPT-Realtime-Translate translation. Tagline: 「すべての通話を、自分の言語で。」 — "Every call, in your language."

## Read first

- `README.md` — full design system: product context, visual foundations, content tone, iconography.
- `colors_and_type.css` — all design tokens as CSS custom properties (light + dark) and semantic type classes.
- `packages/ui-kit/src/tokens.ts` — canonical source of truth for tokens (imported, read-only).
- `ui_kits/mobile/` — runnable React-Babel recreation of the product. Open `index.html` to see live components; reuse JSX components when prototyping.

## Working rules (non-negotiable)

1. **Always support both light & dark schemes.** Use the `--tc-*` custom properties or the `TC.light` / `TC.dark` objects — never hard-coded hex.
2. **Tap targets ≥ 44×44.** Use `callTokens.actionSize` (56) for accept/decline and `controlSize` (48) for mute/speaker.
3. **Translation state is never ambiguous.** Every call surface must show the translation badge — `Translating` / `Reconnecting` / `Stopped`.
4. **No marketing flourish.** No exclamation marks, no decorative emoji (flag emoji in `LanguagePicker` only). State is reported, not celebrated.
5. **No Claude / Anthropic / OpenAI logos in the product UI.** OpenAI may be named in plain text on the consent screen.
6. **No springs, no parallax, no decorative animation.** Only the translate.degraded → recovered fade and bottom-sheet slides are sanctioned.
7. **System fonts only.** `fontFamily` is intentionally undefined; the OS picks SF Pro on iOS, Roboto on Android.

## When invoked

If the user gives no further direction, ask:

1. What surface (existing screen, new screen, marketing asset, slide)?
2. iOS, Android, or both? Light, dark, or both?
3. Production code (React Native + TypeScript) or throwaway HTML mock?

Then act as an expert designer. For HTML artifacts, copy the assets and tokens out of this skill. For production code, mirror the existing `packages/ui-kit` component APIs.

## Assets

- `assets/trancall-mark.svg` — wordmark
- `assets/trancall-icon.svg` — app icon (squircle)
- Phosphor Icons (web) is the recommended icon family; load from `https://unpkg.com/@phosphor-icons/web`.
