import { deviceMade } from '../../gpu/core/errorScope.ts';

/** Bytes of a kept pair: its region, its row. */
export const PAIR_BYTES = 8;

/**
 * THE LIST THE GPU PAGES' PAIRS LAND IN (#1363), sized to what the frames ask. It is the region
 * cull's (`cull.kept`), free once the host's batches are encoded, while that holds the pairs the
 * latest frame read back counted (`need`, the pool's `pairs` count); past it, a list of its own,
 * the next power of two of that need, made under an out-of-memory scope and put in place once the
 * device granted it. A size the device refused is not asked again: the list then overflows only at
 * the device's ceiling, as Unreal's page pool does, and the pair cull admits whole regions alone
 * (`admitShadowPairs`), so none is drawn short for nothing. Never shrinks.
 */
export function createFreshPairs(device: GPUDevice) {
  let own: GPUBuffer | undefined,
    asking = false,
    refused = Infinity,
    disposed = false;
  const grow = async (size: number) => {
    asking = true;
    const next = await deviceMade(device, () =>
      device.createBuffer({
        label: 'Trillion3D shadow GPU page pairs v1',
        size,
        usage: GPUBufferUsage.STORAGE,
      }),
    ).finally(() => (asking = false));
    if (!next) refused = size;
    else if (disposed) next.destroy();
    else {
      own?.destroy();
      own = next;
    }
  };
  const pairs = {
    /** Pairs the latest frame read back counted, whether the list held them or not. */
    need: 0,
    /** The list this frame's cull fills: the larger of `kept` and its own; a growth asked when the
     *  need is past it, which a later frame takes. */
    list(kept: GPUBuffer) {
      const held = own && own.size > kept.size ? own : kept,
        bytes = pairs.need * PAIR_BYTES,
        headroom = 2 ** Math.ceil(Math.log2(bytes));
      // Below a refused size, the need itself: the device's ceiling is reached, never passed.
      if (bytes > held.size && !asking && bytes < refused)
        void grow(headroom < refused ? headroom : bytes).catch(() => {});
      return held;
    },
    dispose() {
      disposed = true;
      own?.destroy();
      own = undefined;
    },
  };
  return pairs;
}
