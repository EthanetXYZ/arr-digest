import type { FastifyInstance } from "fastify";
import {
  createDestination,
  deleteDestination,
  listDestinations,
  updateDestination,
  validateDestination,
  type DestinationInput,
} from "../digest/destinations.js";

export async function destinationsRoutes(app: FastifyInstance) {
  app.get("/api/destinations", async () => listDestinations());

  app.post<{ Body: DestinationInput }>("/api/destinations", async (req, reply) => {
    const error = validateDestination(req.body ?? {});
    if (error) return reply.code(400).send({ error });
    return createDestination(req.body);
  });

  app.put<{ Params: { id: string }; Body: DestinationInput }>(
    "/api/destinations/:id",
    async (req, reply) => {
      const error = validateDestination(req.body ?? {});
      if (error) return reply.code(400).send({ error });
      const updated = updateDestination(Number(req.params.id), req.body);
      if (!updated) return reply.code(404).send({ error: "Destination not found" });
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>("/api/destinations/:id", async (req, reply) => {
    if (!deleteDestination(Number(req.params.id))) {
      return reply.code(404).send({ error: "Destination not found" });
    }
    return { ok: true };
  });
}
