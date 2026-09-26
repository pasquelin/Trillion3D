import type { TestContext } from 'node:test';
import { EngineError } from '../../../sdk-core/src/index.ts';
import { refusedStatus } from './pages.ts';

/** An answer `answering` gives: a status, `'network'` — a failed request —, or `'hang'` — no
 *  answer until the request aborts. */
export type Answer = number | 'network' | 'hang';

/** One request `answering` heard: its address and its options. */
type Asked = { url: string; init: RequestInit };

/** A request held until `signal` aborts, already aborted or later: it then rejects with the
 *  signal's reason, as `fetch` does. */
export const untilAborted = (signal: AbortSignal | null | undefined) =>
  new Promise<never>((_, reject) => {
    const fail = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });

/**
 * Stubs `fetch` for the test `t`: a request whose address ends in `name` gets the next of
 * `answers` (the last one again once they run out) — on a 200, `body` of its address, a body or
 * the whole answer. Any other address answers `other`. The requests to `name` are returned as
 * they are asked.
 */
export function answering(
  t: TestContext,
  name: string,
  answers: Answer[],
  body: (url: string) => BodyInit | Response = () => '{}',
  other: (url: string) => Response = () => new Response('missing', { status: 404 }),
) {
  const asked: Asked[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    if (!url.endsWith(name)) return other(url);
    asked.push({ url, init });
    const answer = answers[Math.min(asked.length, answers.length) - 1];
    if (answer === 'hang') return untilAborted(init.signal);
    if (answer === 'network') throw new TypeError('Failed to fetch');
    if (answer !== 200) return new Response('refused', { status: answer });
    const sent = body(url);
    return sent instanceof Response ? sent : new Response(sent);
  });
  return asked;
}

/** Whether `error` is the `RESOURCE_HTTP_ERROR` of `status`, naming an address ending in `name`. */
export const refusedWith = (status: number | null, name: string) => (error: unknown) =>
  error instanceof EngineError &&
  error.code === 'RESOURCE_HTTP_ERROR' &&
  refusedStatus(error) === status &&
  String(error.details.url).endsWith(name);
