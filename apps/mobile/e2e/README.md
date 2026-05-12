# TranCall E2E Tests (Maestro)

## Prerequisites

- [Maestro CLI](https://maestro.mobile.dev) installed (`~/.maestro/bin` on PATH)
- iOS Simulator or Android Emulator running with TranCall app installed
- mock-server running on port 4010

## Quick Start

### 1. Start mock-server

```bash
pnpm --filter @trancall/mock-server dev
```

### 2. Build and install the app (E2E variant)

```bash
cd apps/mobile
EXPO_PUBLIC_API_BASE_URL=http://localhost:4010 expo start --ios
```

### 3. Run P0 flows

```bash
maestro test apps/mobile/e2e/maestro/flows/ \
  --include-tags P0 \
  --config apps/mobile/e2e/maestro/config.yaml
```

### 4. Run a single flow

```bash
maestro test apps/mobile/e2e/maestro/flows/02-login.yaml \
  --config apps/mobile/e2e/maestro/config.yaml
```

### 5. Reset mock-server state

```bash
curl -X POST http://localhost:4010/api/__e2e__/reset
```

## Flow inventory

| File | Tag | Description |
|---|---|---|
| `01-signup.yaml` | P0, auth | Sign up → consent → Home |
| `02-login.yaml` | P0, auth | Login → Home |
| `03-create-room.yaml` | P0, contacts | Contacts browse + Add contact |
| `04-incoming-call.yaml` | P0, call | Incoming call → Accept → InCall |
| `05-in-call.yaml` | P0, call | InCall controls (mute / translation toggle) |
| `06-end-call.yaml` | P0, call | Pre-call → Start → End call |
| `07-recent-history.yaml` | P0, home | Home recent calls list |
| `08-transcript-view.yaml` | P0, transcript | Call summary → Full transcript |
| `09-transcript-export.yaml` | P0, transcript | Transcript export (PDF) |
| `10-settings.yaml` | P0, settings | Settings: language change + sign out |
| `g1-consent-screen.yaml` | P0, gate | Translation consent (caller) |
| `g2-permission-mic.yaml` | P0, gate | Microphone permission gate |
| `g3-billing-upgrade.yaml` | P0, gate | Billing insufficient balance → upgrade |
| `g4-account-deletion.yaml` | P0, gate | Account deletion 4-step flow |

## E2E test users

| Email | Plan | Balance |
|---|---|---|
| `e2e_user_a@trancall.dev` | Free | 100 min |
| `e2e_user_b@trancall.dev` | Standard | 300 min |
| `e2e_user_c@trancall.dev` | Free | 0 min (billing error tests) |

## Directory structure

```
apps/mobile/e2e/
├── maestro/
│   ├── config.yaml           # Maestro project config + env vars
│   ├── flows/
│   │   ├── 01-signup.yaml ... 10-settings.yaml   # P0 basic flows
│   │   ├── g1-consent-screen.yaml ... g4-account-deletion.yaml  # P0 gates
│   │   └── shared/
│   │       ├── login_as_e2e_user.yaml
│   │       ├── reset_mock_server.yaml
│   │       └── grant_permissions_ios.yaml
│   └── fixtures/
│       ├── contacts.json
│       ├── transcript-sample.json
│       └── billing-state.json
└── README.md

apps/mock-server/
├── src/
│   ├── index.ts              # Express server entry point (port 4010)
│   ├── fixtures.ts           # Static fixture data
│   ├── state.ts              # In-memory mutable state
│   └── routes/
│       ├── auth.ts           # POST /api/auth/{signup,signin,consent}, GET/PATCH profile
│       ├── contacts.ts       # GET/POST/DELETE /api/contacts, search, block, report
│       ├── rooms.ts          # POST/GET /api/rooms, join, leave, token, history
│       ├── transcripts.ts    # GET/DELETE /api/transcripts/:roomId
│       ├── billing.ts        # GET /api/billing/subscription, POST checkout, webhooks
│       ├── notifications.ts  # POST /api/notifications/register
│       └── e2e-hooks.ts      # POST /api/__e2e__/{reset,trigger-incoming-call,...}
└── package.json
```

## CI integration

P0 flows run automatically on PRs touching `apps/mobile/**`, `apps/mock-server/**`, `packages/ui-kit/**`.

See `.github/workflows/e2e.yml` for full details.
