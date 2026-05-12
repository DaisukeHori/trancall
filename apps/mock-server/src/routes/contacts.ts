import type { Router, Request, Response } from "express";
import { getState, getSessionByToken, getUserById } from "../state.js";

function extractBearerToken(req: Request): string | null {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function requireAuth(req: Request, res: Response): string | null {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Missing token", retryable: false },
    });
    return null;
  }
  const session = getSessionByToken(token);
  if (!session) {
    res.status(401).json({
      ok: false,
      error: { code: "AUTH_TOKEN_EXPIRED", message: "Token expired or invalid", retryable: false },
    });
    return null;
  }
  return session.userId;
}

export function registerContactRoutes(router: Router): void {
  router.get("/contacts", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const state = getState();
    const myContacts = state.contacts.filter(
      (c) => c.ownerUserId === userId && !c.isBlocked,
    );

    const data = myContacts.map((c) => {
      const contactUser = getUserById(c.contactUserId);
      return {
        id: c.id,
        userId: c.contactUserId,
        trancallId: contactUser?.trancallId ?? "",
        displayName: contactUser?.displayName ?? "",
        nativeLanguage: contactUser?.nativeLanguage ?? "en",
        avatarUrl: contactUser?.avatarUrl ?? null,
        isFavorite: c.isFavorite,
        createdAt: c.createdAt,
      };
    });

    res.status(200).json({ ok: true, data });
  });

  router.post("/contacts", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const { contactUserId } = req.body as { contactUserId?: string };
    if (!contactUserId) {
      res.status(400).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Missing contactUserId", retryable: false },
      });
      return;
    }

    const state = getState();
    const existing = state.contacts.find(
      (c) => c.ownerUserId === userId && c.contactUserId === contactUserId,
    );
    if (existing) {
      res.status(409).json({
        ok: false,
        error: { code: "CONTACT_ALREADY_EXISTS", message: "Already in your contacts", retryable: false },
      });
      return;
    }

    const targetUser = getUserById(contactUserId);
    if (!targetUser) {
      res.status(404).json({
        ok: false,
        error: { code: "CONTACT_NOT_FOUND", message: "User not found", retryable: false },
      });
      return;
    }

    const newContact = {
      id: `contact-${Date.now()}`,
      ownerUserId: userId,
      contactUserId,
      isFavorite: false,
      isBlocked: false,
      createdAt: new Date().toISOString(),
    };
    state.contacts.push(newContact);

    res.status(200).json({
      ok: true,
      data: {
        id: newContact.id,
        userId: contactUserId,
        trancallId: targetUser.trancallId,
        displayName: targetUser.displayName,
        nativeLanguage: targetUser.nativeLanguage,
        avatarUrl: targetUser.avatarUrl,
        isFavorite: false,
        createdAt: newContact.createdAt,
      },
    });
  });

  router.delete("/contacts/:id", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const { id } = req.params;
    const state = getState();
    const index = state.contacts.findIndex(
      (c) => c.id === id && c.ownerUserId === userId,
    );
    if (index < 0) {
      res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "Contact not found", retryable: false },
      });
      return;
    }

    state.contacts.splice(index, 1);
    res.status(200).json({ ok: true, data: true });
  });

  router.get("/contacts/search", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    const q = (req.query["q"] as string | undefined) ?? "";
    const state = getState();

    const results = state.users
      .filter(
        (u) =>
          u.userId !== userId &&
          (u.trancallId.includes(q) || u.displayName.toLowerCase().includes(q.toLowerCase())),
      )
      .map((u) => ({
        userId: u.userId,
        trancallId: u.trancallId,
        displayName: u.displayName,
        nativeLanguage: u.nativeLanguage,
        avatarUrl: u.avatarUrl,
      }));

    res.status(200).json({ ok: true, data: results });
  });

  router.post("/contacts/invite-link", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    res.status(200).json({
      ok: true,
      data: {
        url: `https://trancall.app/invite/e2e_mock_${userId}`,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      },
    });
  });

  router.post("/contacts/block", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    res.status(200).json({ ok: true, data: true });
  });

  router.post("/contacts/report", (req: Request, res: Response) => {
    const userId = requireAuth(req, res);
    if (!userId) return;

    res.status(200).json({ ok: true, data: true });
  });
}
