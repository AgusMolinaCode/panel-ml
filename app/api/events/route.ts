import { NextRequest } from "next/server";
import { addClient, removeClient } from "@/lib/sse/emitter";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const clientId = crypto.randomUUID();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send initial connection confirmation
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`));

      // Register this client
      addClient(clientId, controller, req.signal);

      // Heartbeat every 25s to keep the connection alive through Vercel's 30s timeout
      const heartbeatAbort = new AbortController();
      const heartbeat = setInterval(() => {
        if (heartbeatAbort.signal.aborted) {
          clearInterval(heartbeat);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
          heartbeatAbort.abort();
        }
      }, 25_000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        heartbeatAbort.abort();
        removeClient(clientId);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
    cancel() {
      removeClient(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
