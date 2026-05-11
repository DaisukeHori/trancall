import { z } from "zod";

export const DomainEventBase = z.object({
  eventId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  aggregateId: z.string().uuid(),
});
export type DomainEventBase = z.infer<typeof DomainEventBase>;
