import { z } from "zod";

export const DomainEventBase = z.object({
  eventId: z.uuid(),
  occurredAt: z.iso.datetime(),
  aggregateId: z.uuid(),
});
export type DomainEventBase = z.infer<typeof DomainEventBase>;
