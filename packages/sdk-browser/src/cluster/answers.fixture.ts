import type { TestContext } from 'node:test';

/** An answer `answering` gives: a status, or `'hang'` — no answer until the request aborts. */
export type Answer = number | 'hang';

/** One request `answering` heard: its address and its options. */
export type Asked = { url: string; init: RequestInit };

/**
 * Stubs `fetch` for the test `t`: a request whose address ends in `name` gets the next of
 * `answers` (the last one again once they run out), its body `body` when the status is 200; a
 * `'hang'` rejects with the signal's reason once it aborts. Any other address answers `other`.
 * The requests to `name` are returned as they are asked.
 */
export function answering(
  t: TestContext,
  name: string,
  answers: Answer[],
  body: () => BodyInit = () => '{}',
  other: (url: string) => Response = () => new Response('missing', { status: 404 }),
) {
  const asked: Asked[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.endsWith(name)) return other(url);
    asked.push({ url, init });
    const answer = answers[Math.min(asked.length, answers.length) - 1];
    if (answer === 'hang')
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
      );
    return new Response(answer === 200 ? body() : 'refused', { status: answer });
  });
  return asked;
}

/** Whether `error` is the `RESOURCE_HTTP_ERROR` of `status`, naming an address ending in `name`. */
export const refusedWith = (status: number | null, name: string) => (error: unknown) => {
  const { code, details } = error as {
    code?: string;
    details?: { url?: string; status?: unknown };
  };
  return (
    code === 'RESOURCE_HTTP_ERROR' && details?.status === status && !!details.url?.endsWith(name)
  );
};
