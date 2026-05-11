# TranCall — Mobile UI Kit

A pixel-faithful, click-through recreation of the TranCall mobile app, built from the canonical `packages/ui-kit` components and tokens. Open `index.html` for the interactive prototype.

## What's here

- **`index.html`** — runnable prototype, iOS frame, click-through screens
- **`Tokens.jsx`** — JS mirror of `tokens.ts` (single source for the demo's theming)
- **`Primitives.jsx`** — Button / Badge / Avatar / Card / Input
- **`CallRow.jsx`** — CallCard + ContactRow recreations
- **`SubtitleOverlay.jsx`** — translation overlay
- **`screens/*.jsx`** — Home, InCall, Incoming, Contacts, Settings, Onboarding

## Coverage vs. omissions

Implemented as static-but-interactive (state lives in the page; no networking):

- Onboarding (13-language grid)
- Home / Recent calls (search field, scrollable list, FAB)
- Incoming call (full-screen, accept / decline)
- In-call (subtitle overlay, status badge, mute / speaker / hang up)
- Contacts (search, favorites, add)
- Settings (plan card, toggles, language)

Deliberately omitted (not in scope for the kit; see the brief):
- Pre-call setup, Call summary, Full transcript, Add contact, Contact profile, the four permission / consent screens. These re-use the same primitives; build them by composing the components here.
