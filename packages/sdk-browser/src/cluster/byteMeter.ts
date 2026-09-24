/** Hands back a response whose body is counted as it arrives: what a load reports in bytes. */
export type ByteMeter = (response: Response) => Response;

/** The meter of a read nobody watches: the response itself. */
export const unmetered: ByteMeter = (response) => response;

/** The length a response declares for its body: none when absent, or when the body is encoded —
 *  the stream then decodes to more bytes than the header counts. */
function declaredLength(response: Response) {
  const header = response.headers.get('content-length');
  if (header === null || response.headers.get('content-encoding')) return 0;
  const length = Number(header);
  return Number.isFinite(length) && length > 0 ? length : 0;
}

/**
 * One count over every response a load reads, `report(loaded, total)` at each chunk that lands.
 * `total` adds each response's declared length as it opens, and is corrected to what its body
 * actually held, so the last chunk of the last response reports `loaded === total`. The body is
 * streamed, never read twice: the caller reads the returned response as it read the original.
 */
export function byteMeter(report: (loaded: number, total: number) => void): ByteMeter {
  let loaded = 0,
    total = 0;
  return (response) => {
    if (!response.body) return response;
    let expected = declaredLength(response),
      seen = 0;
    total += expected;
    report(loaded, total);
    const counted = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          seen += chunk.byteLength;
          loaded += chunk.byteLength;
          if (seen > expected) [total, expected] = [total + seen - expected, seen];
          report(loaded, total);
          controller.enqueue(chunk);
        },
        flush() {
          if (seen === expected) return;
          total -= expected - seen;
          report(loaded, total);
        },
      }),
    );
    const { status, statusText, headers } = response;
    return new Response(counted, { status, statusText, headers });
  };
}
