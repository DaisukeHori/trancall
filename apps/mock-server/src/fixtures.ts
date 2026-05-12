export type UserFixture = {
  userId: string;
  email: string;
  password: string;
  trancallId: string;
  displayName: string;
  nativeLanguage: string;
  avatarUrl: string | null;
  consentVersion: string | null;
  emailVerified: boolean;
  createdAt: string;
  tier: "free" | "light" | "standard" | "business";
  remainingMinutes: number;
};

export const USERS: UserFixture[] = [
  {
    userId: "user-a-uuid-0000-0000-000000000001",
    email: "e2e_user_a@trancall.dev",
    password: "E2ePassword!1",
    trancallId: "@e2e_user_a",
    displayName: "E2E User A",
    nativeLanguage: "ja",
    avatarUrl: null,
    consentVersion: "v1.0",
    emailVerified: true,
    createdAt: "2026-05-01T00:00:00.000Z",
    tier: "free",
    remainingMinutes: 100,
  },
  {
    userId: "user-b-uuid-0000-0000-000000000002",
    email: "e2e_user_b@trancall.dev",
    password: "E2ePassword!2",
    trancallId: "@e2e_user_b",
    displayName: "E2E User B",
    nativeLanguage: "en",
    avatarUrl: null,
    consentVersion: "v1.0",
    emailVerified: true,
    createdAt: "2026-05-02T00:00:00.000Z",
    tier: "standard",
    remainingMinutes: 300,
  },
  {
    userId: "user-c-uuid-0000-0000-000000000003",
    email: "e2e_user_c@trancall.dev",
    password: "E2ePassword!1",
    trancallId: "@e2e_user_c",
    displayName: "E2E User C",
    nativeLanguage: "zh",
    avatarUrl: null,
    consentVersion: "v1.0",
    emailVerified: true,
    createdAt: "2026-05-03T00:00:00.000Z",
    tier: "free",
    remainingMinutes: 0,
  },
];

export type ContactFixture = {
  id: string;
  ownerUserId: string;
  contactUserId: string;
  isFavorite: boolean;
  isBlocked: boolean;
  createdAt: string;
};

export const CONTACTS: ContactFixture[] = [
  {
    id: "contact-001",
    ownerUserId: "user-a-uuid-0000-0000-000000000001",
    contactUserId: "user-b-uuid-0000-0000-000000000002",
    isFavorite: true,
    isBlocked: false,
    createdAt: "2026-05-01T00:00:00.000Z",
  },
];

export type RoomFixture = {
  roomId: string;
  status: "pending" | "active" | "ended";
  roomType: "audio" | "video";
  translationEnabled: boolean;
  hostUserId: string;
  participantIds: string[];
  startedAt: string | null;
  endedAt: string | null;
};

export const E2E_ROOM_ID = "room-e2e-fixture-00000000000001";

export const ROOMS: RoomFixture[] = [
  {
    roomId: E2E_ROOM_ID,
    status: "ended",
    roomType: "audio",
    translationEnabled: true,
    hostUserId: "user-a-uuid-0000-0000-000000000001",
    participantIds: [
      "user-a-uuid-0000-0000-000000000001",
      "user-b-uuid-0000-0000-000000000002",
    ],
    startedAt: "2026-05-11T10:00:00.000Z",
    endedAt: "2026-05-11T10:15:32.000Z",
  },
];

export const MOCK_LIVEKIT_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e2UyZV9tb2NrX3Rva2VufQ.mock_signature";
export const MOCK_LIVEKIT_URL = "wss://mock-livekit.trancall.dev";
