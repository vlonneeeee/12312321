import type { FastifyInstance } from "fastify";
import { prisma } from "@core/db/prisma";
import { verifyTranscriptSig } from "@modules/tickets/ticket.service";

/**
 * Serve a previously archived ticket transcript via signed URL.
 *
 *   GET /transcripts/<ticketId>.html?sig=<hex>
 *
 * The `sig` is HMAC-SHA256(SESSION_SECRET, `transcript:<ticketId>`). It's
 * generated when the ticket is closed and embedded into the admin log, so
 * staff can share the link without exposing raw ticket bodies through a
 * predictable URL.
 *
 * Errors are returned as plain text — the consumer is a browser, not an API.
 */
export function registerTranscriptsRoutes(app: FastifyInstance): void {
  app.get<{
    Params: { fname: string };
    Querystring: { sig?: string };
  }>("/transcripts/:fname", async (req, reply) => {
    const fname = req.params.fname;
    const m = /^([A-Za-z0-9_-]{1,64})\.html$/.exec(fname);
    if (!m) {
      reply.code(400).type("text/plain").send("bad ticket id");
      return;
    }
    const ticketId = m[1]!;
    const sig = req.query.sig;
    if (!sig || !/^[a-f0-9]{64}$/i.test(sig)) {
      reply.code(401).type("text/plain").send("missing signature");
      return;
    }
    if (!verifyTranscriptSig(ticketId, sig)) {
      reply.code(403).type("text/plain").send("invalid signature");
      return;
    }
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { transcriptHtml: true },
    });
    if (!ticket || !ticket.transcriptHtml) {
      reply.code(404).type("text/plain").send("transcript not found");
      return;
    }
    reply
      .code(200)
      .type("text/html; charset=utf-8")
      .header("Cache-Control", "private, max-age=300")
      .send(ticket.transcriptHtml);
  });
}
