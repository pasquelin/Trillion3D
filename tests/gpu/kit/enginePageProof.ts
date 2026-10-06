// What the "real engine" proofs share: load a page module on Dawn (`onDawn.ts`), run it with the
// machine's WebGPU device, and return what the page answered, errors included.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { runOnDawn, loadPage } from './onDawn.ts';

/** One entry of the `events` array a page result reports diagnostics through. */
interface PageProofEvent {
  phase: string;
  context?: { reason?: string };
}

/** The page-result shape every proof of this kind asserts on (`assertSoundProof`), whatever else the
 *  page adds beside it. */
export interface PageProofResult {
  unavailable?: string | null;
  error?: string | null;
  errors?: string[];
  events?: PageProofEvent[];
}

/** Target of the call `runOnDawn` runs: the page module installed under `name`, with the method
 *  the proof asks to run. */
type PageTarget = { name: string; method: string };
type PageModule = Record<string, () => unknown>;
type PageScope = typeof globalThis & Record<string, PageModule>;

/**
 * Runs `method()` of the page module `page` on Dawn — `run` by default, the name the engine
 * pages carry — installed as `globalThis[name]`. `page` is an absolute path — a proof passes
 * `resolve(import.meta.dirname, '<page>.ts')`, its page lying beside it — or a path relative to
 * this kit folder. Returns the page result, its `errors` array completed by the errors nothing
 * caught while it ran.
 */
export async function runPageProof(
  page: string,
  name: string,
  method = 'run',
): Promise<PageProofResult> {
  await loadPage(resolve(import.meta.dirname, page), name);
  const pageErrors: string[] = [];
  const result = (await runOnDawn(
    (target: PageTarget) => (globalThis as PageScope)[target.name][target.method](),
    { name, method },
    pageErrors,
  )) as PageProofResult;
  return { ...result, errors: [...(result.errors ?? []), ...pageErrors] };
}

/** Checks every proof of this kind must pass before examining its own reading. */
export function assertSoundProof(result: PageProofResult): void {
  assert.equal(result.unavailable ?? null, null, String(result.unavailable));
  assert.equal(result.error ?? null, null, String(result.error));
  assert.deepEqual(result.errors, []);
  // An uncaptured GPU error is announced as a loss with that reason: a proof that provokes a
  // loss of its own still fails on one the engine's work caused.
  assert.ok(
    !(result.events ?? []).some(
      (event) => /failed/.test(event.phase) || event.context?.reason === 'uncaptured-error',
    ),
    JSON.stringify(result.events),
  );
}

/** Prints the adapter, the passes and the errors of a result that reports per-pass readings, then
 *  runs the checks every proof of this kind passes (`assertSoundProof`). */
export function publishAndVerify(
  result: PageProofResult & { adapter?: unknown; passes: unknown },
): void {
  console.log(
    JSON.stringify(
      {
        adapter: result.adapter ?? null,
        passes: result.passes,
        errors: result.errors,
      },
      null,
      2,
    ),
  );
  assertSoundProof(result);
}
