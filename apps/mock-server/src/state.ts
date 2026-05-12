import { USERS, CONTACTS, ROOMS } from "./fixtures.js";
import type { UserFixture, ContactFixture, RoomFixture } from "./fixtures.js";

export type AuthSession = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type ServerState = {
  users: UserFixture[];
  contacts: ContactFixture[];
  rooms: RoomFixture[];
  sessions: Map<string, AuthSession>;
  pendingIncomingCallTarget: string | null;
};

let _state: ServerState = createInitialState();

function createInitialState(): ServerState {
  return {
    users: USERS.map((u) => ({ ...u })),
    contacts: CONTACTS.map((c) => ({ ...c })),
    rooms: ROOMS.map((r) => ({ ...r })),
    sessions: new Map(),
    pendingIncomingCallTarget: null,
  };
}

export function resetState(): void {
  _state = createInitialState();
}

export function getState(): ServerState {
  return _state;
}

export function generateToken(userId: string): string {
  return `mock_token_${userId}_${Date.now()}`;
}

export function createSession(userId: string): AuthSession {
  const accessToken = generateToken(userId);
  const refreshToken = generateToken(userId + "_refresh");
  const session: AuthSession = {
    userId,
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  _state.sessions.set(accessToken, session);
  return session;
}

export function getSessionByToken(token: string): AuthSession | undefined {
  return _state.sessions.get(token);
}

export function getUserById(userId: string): UserFixture | undefined {
  return _state.users.find((u) => u.userId === userId);
}

export function getUserByEmail(email: string): UserFixture | undefined {
  return _state.users.find((u) => u.email === email);
}
