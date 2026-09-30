import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { HTTP_ATTEMPTS, pause, retriableError } from '../cluster/checked.ts';
import { RETRY_AFTER_CAP_MS } from '../cluster/retryCap.ts';

/** The public code of a family that could not load (`docs/messages/T3D-E090.md`). */
export const FAMILY_LOAD_FAILED_ID = 'T3D-E090';

/**
 * The engine's one on-demand loader (#1353, #1404): a module imported on its first use, which the
 * CDN bundle makes a chunk of its own (`scripts/bundle-fold.ts`) that a page without that family
 * never downloads. An import that fails is tried again as the HTTP loader asks a file again
 * (`checked`: `HTTP_ATTEMPTS` in all, no second try of what cannot pass); what still fails is a
 * `FAMILY_LOAD_FAILED` naming the family, told to `refused` once per round and kept in `failed`.
 * A refusal is not kept for the session: the next ask starts a new round, once the longest wait
 * of the HTTP loader (`RETRY_AFTER_CAP_MS`) has passed since it. `get` starts the import and
 * answers the module once it has arrived, `undefined` until then; `arrived` says it has;
 * `settled` waits for the round in flight and `load` for the module itself, refused as the round
 * was. A frame never reads a module that has not arrived: what uses it waits for it first
 * (`families.ts`).
 * @param family - The family's name, which its refusal names.
 * @param load - The module's dynamic import, a relative specifier as the bundle folds it.
 * @param refused - Told each final refusal, the page's error channel.
 */
export function onDemand<M>(
  family: string,
  load: () => Promise<M>,
  refused: (error: EngineError) => void = () => {},
) {
  let module: M | undefined,
    refusal: EngineError | undefined,
    loading: Promise<void> | undefined,
    refusedAt = -Infinity;
  const round = async () => {
    const wait = refusedAt + RETRY_AFTER_CAP_MS - Date.now();
    if (wait > 0) await pause(wait);
    let cause: unknown,
      tried = 0;
    while (tried < HTTP_ATTEMPTS) {
      tried++;
      try {
        module = await load();
        refusal = undefined;
        return;
      } catch (error) {
        cause = error;
        if (!retriableError(error)) break;
      }
    }
    refusedAt = Date.now();
    const times = tried === 1 ? 'one attempt' : `${tried} attempts`;
    refusal = new EngineError(
      'FAMILY_LOAD_FAILED',
      `${FAMILY_LOAD_FAILED_ID} FAMILY_LOAD_FAILED: the ${family} family did not load after ${times}: ${String(cause)}`,
      { id: FAMILY_LOAD_FAILED_ID, family, attempts: tried, cause },
    );
    loading = undefined; // the next ask tries again
    refused(refusal);
  };
  const start = () => (module ? Promise.resolve() : (loading ??= round()));
  return {
    get(): M | undefined {
      void start();
      return module;
    },
    get arrived() {
      return module !== undefined;
    },
    /** The last refusal, until the module arrives. */
    get failed() {
      return refusal;
    },
    settled: () => loading ?? Promise.resolve(),
    /** The module; `signal`, once aborted, refuses it with its reason, the round going on. */
    async load(signal?: AbortSignal): Promise<M> {
      signal?.throwIfAborted();
      await start();
      signal?.throwIfAborted();
      if (module === undefined) throw refusal;
      return module;
    },
  };
}
