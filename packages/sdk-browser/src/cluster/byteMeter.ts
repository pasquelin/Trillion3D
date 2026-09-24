/** Counts the bytes a load reads, against the lengths its manifest declares. */
export interface ByteMeter {
  /** The files the load may read, address to declared length: their sum is the total at once. */
  plan(files: ReadonlyMap<string, number>): void;
  /** Hands back `response` (read from `url`) with its body counted as it arrives. */
  read(response: Response, url: string): Response;
  /** Drops the planned files never read, so the last event has `loaded === total`. */
  settle(): void;
}

/** The meter of a read nobody watches: the response itself. */
export const unmetered: ByteMeter = { plan() {}, read: (response) => response, settle() {} };

/**
 * One count over every response a load reads, `report(loaded, total)` at each chunk once the plan
 * is known — never before, so the share never starts full. A planned file counts against the
 * length the manifest declares, whatever its `Content-Length` or `Content-Encoding` says: the
 * stream hands over decoded bytes, which is what the manifest measured. A byte outside the plan
 * (a file read before it, an image the manifest does not list, a planned file read twice or past
 * its length) joins `loaded` and `total` together, so the share `loaded / total` never goes down.
 * The body is streamed, never read twice: the caller reads the returned response as it read the
 * original.
 */
export function byteMeter(report: (loaded: number, total: number) => void): ByteMeter {
  let loaded = 0,
    total = 0,
    planned: Map<string, number> | null = null;
  const tell = () => {
    if (planned) report(loaded, total);
  };
  return {
    plan(files) {
      planned = new Map(files);
      for (const bytes of planned.values()) total += bytes;
      tell();
    },
    read(response, url) {
      if (!response.body) return response;
      const expected = planned?.get(url) ?? 0;
      let seen = 0;
      planned?.delete(url);
      const counted = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const within = Math.max(0, Math.min(chunk.byteLength, expected - seen));
            seen += chunk.byteLength;
            loaded += chunk.byteLength;
            total += chunk.byteLength - within;
            tell();
            controller.enqueue(chunk);
          },
          flush() {
            // A body shorter than declared gives its shortfall back: the share only rises.
            if (seen >= expected) return;
            total -= expected - seen;
            tell();
          },
        }),
      );
      const { status, statusText, headers } = response;
      return new Response(counted, { status, statusText, headers });
    },
    settle() {
      for (const bytes of planned?.values() ?? []) total -= bytes;
      planned = new Map();
      tell();
    },
  };
}
