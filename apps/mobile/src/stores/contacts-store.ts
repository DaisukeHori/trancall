import { create } from "zustand";
import type { ContactEntry } from "../api/contacts-api";
import {
  getContacts,
  addContact as apiAddContact,
  removeContact as apiRemoveContact,
  blockUser as apiBlockUser,
} from "../api/contacts-api";

export interface ContactsState {
  contacts: ContactEntry[];
  isLoading: boolean;
  error: string | null;

  load: () => Promise<void>;
  add: (contactUserId: string) => Promise<ContactEntry | null>;
  remove: (id: string) => Promise<boolean>;
  toggleFavorite: (contactUserId: string) => void;
  block: (userId: string) => Promise<boolean>;
  search: (query: string) => ContactEntry[];
  getFavoriteIds: () => Set<string>;
  getBlockedIds: () => Set<string>;
}

export const useContactsStore = create<ContactsState>()((set, get) => ({
  contacts: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    const result = await getContacts();
    if (result.ok) {
      set({ contacts: result.data, isLoading: false });
    } else {
      set({ error: result.error.message, isLoading: false });
    }
  },

  add: async (contactUserId: string) => {
    const result = await apiAddContact(contactUserId);
    if (result.ok) {
      set((state) => ({
        contacts: [...state.contacts, result.data],
      }));
      return result.data;
    }
    return null;
  },

  remove: async (id: string) => {
    const result = await apiRemoveContact(id);
    if (result.ok && result.data.success) {
      set((state) => ({
        contacts: state.contacts.filter((c) => c.id !== id),
      }));
      return true;
    }
    return false;
  },

  toggleFavorite: (contactUserId: string) => {
    set((state) => ({
      contacts: state.contacts.map((c) =>
        c.contactUserId === contactUserId
          ? { ...c, isFavorite: !c.isFavorite }
          : c,
      ),
    }));
  },

  block: async (userId: string) => {
    const result = await apiBlockUser(userId);
    if (result.ok && result.data.success) {
      set((state) => ({
        contacts: state.contacts.map((c) =>
          c.contactUserId === userId ? { ...c, isBlocked: true } : c,
        ),
      }));
      return true;
    }
    return false;
  },

  search: (query: string) => {
    const { contacts } = get();
    const q = query.toLowerCase().trim();
    if (q.length === 0) return contacts.filter((c) => !c.isBlocked);
    return contacts.filter(
      (c) =>
        !c.isBlocked &&
        (c.displayName.toLowerCase().includes(q) ||
          c.trancallId.toLowerCase().includes(q)),
    );
  },

  getFavoriteIds: () => {
    const { contacts } = get();
    return new Set(contacts.filter((c) => c.isFavorite).map((c) => c.contactUserId));
  },

  getBlockedIds: () => {
    const { contacts } = get();
    return new Set(contacts.filter((c) => c.isBlocked).map((c) => c.contactUserId));
  },
}));
