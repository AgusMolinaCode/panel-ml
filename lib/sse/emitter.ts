/**
 * Global SSE broadcaster — singleton that tracks all connected clients.
 *
 * In Vercel's serverless model, module-level state persists across
 * invocations in the same warm container, so this Map is safe to use.
 * Each entry: controller (for sending) → AbortSignal (for cleanup)
 */

type SSEResponder = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  signal: AbortSignal;
};

const clients = new Map<string, SSEResponder>();

export function addClient(
  id: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  signal: AbortSignal
): void {
  clients.set(id, { controller, signal });
  signal.addEventListener("abort", () => clients.delete(id));
}

export function removeClient(id: string): void {
  clients.delete(id);
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoded = new TextEncoder().encode(payload);

  for (const { controller, signal } of clients.values()) {
    if (signal.aborted) {
      clients.delete([...clients.entries()].find(([, v]) => v.controller === controller)?.[0] ?? "");
      continue;
    }
    try {
      controller.enqueue(encoded);
    } catch {
      // Client already disconnected — will be cleaned up via abort signal
    }
  }
}

export function clientCount(): number {
  return clients.size;
}
