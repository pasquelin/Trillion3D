import { deviceMade } from '../../gpu/core/errorScope.ts';
import { createPageBuffer } from '../../gpu/page/resize.ts';
import { tilePoolTexture } from '../tile/pool.ts';
import { POOL_LANES, type PoolEncoding } from '../../texture/blockFormats.ts';
import type { GeometryPool, PoolClamp } from '../../residency/pools.ts';
import type { TexturePool, TexturePools } from './memoryBudgets.ts';

/** What a probe is named: never a pool's own label, which a reader of the device looks for. */
const PROBE_LABEL = 'Trillion3D pool probe';

type Pool = { budgetBytes: number; allocatedBytes: number; clamp: PoolClamp };
type Diagnose = (phase: string, message: string, context: Record<string, unknown>) => void;
type Made = { destroy(): void };
/** A pool the device granted, and what was allocated for it: the pool itself at prepare, a probe
 *  at a resize (`probed`). */
type Granted<P, R> = { pool: P; made: R };

/**
 * Out of memory, absorbed: what a pool needs is allocated under an out-of-memory scope
 * (`deviceMade`), and a refusal shrinks that pool — half the bytes it would have held, drawn
 * again by its own rule — until the device grants it or the pool reaches its floor (`floor`: the
 * root cover of the geometry, one layer per lane of the textures, the smallest screen's side of
 * the shadows). The pool in place is never replaced by one the device refused, so the frame goes
 * on: what no longer fits draws coarser. A refusal is published once per request as
 * `gpu-out-of-memory`, naming the pool, the bytes asked and the bytes granted (`null` when even
 * the floor was refused: the caller then keeps what it holds).
 */
async function grantedPool<P extends Pool, R extends Made>(options: {
  device: GPUDevice;
  name: 'geometry' | 'texture' | 'shadow';
  budgetBytes: number;
  draw: (budgetBytes: number) => P;
  make: (pool: P) => R;
  floor: PoolClamp;
  diagnose: Diagnose;
  /** Bytes the budget pays before the pool (the geometry's vertex buffers): a refusal halves
   *  what is left of the budget after them, never those bytes themselves. */
  heldBytes?: number;
}): Promise<Granted<P, R> | undefined> {
  const { device, name, draw, make, floor, diagnose, heldBytes = 0 } = options;
  let pool = draw(options.budgetBytes);
  const requestedBytes = pool.allocatedBytes;
  let made: R | undefined;
  while (!(made = await deviceMade(device, () => make(pool)))) {
    const half = Math.floor(Math.min(pool.budgetBytes - heldBytes, pool.allocatedBytes) / 2);
    if (pool.clamp === floor || half < 1) {
      diagnose('gpu-out-of-memory', `The device refused the ${name} pool's floor`, {
        kind: 'warning',
        pool: name,
        requestedBytes,
        grantedBytes: null,
      });
      return undefined;
    }
    pool = draw(half + heldBytes);
  }
  if (pool.allocatedBytes !== requestedBytes)
    diagnose('gpu-out-of-memory', `The device refused the ${name} pool; drawn smaller`, {
      kind: 'warning',
      pool: name,
      requestedBytes,
      grantedBytes: pool.allocatedBytes,
      clamp: pool.clamp,
    });
  return { pool, made };
}

/** The geometry pool the device grants for `budgetBytes`, by the session's own rule; `make`
 *  allocates the pool itself, or its probe (`geometryProbe`). `heldBytes` is what `draw` takes
 *  from the budget before the slots: a refusal halves the slots, not the budget. */
export const grantedGeometryPool = <R extends Made>(
  device: GPUDevice,
  budgetBytes: number,
  draw: (budgetBytes: number) => GeometryPool,
  diagnose: Diagnose,
  make: (pool: GeometryPool) => R,
  heldBytes = 0,
) =>
  grantedPool({
    device,
    name: 'geometry',
    budgetBytes,
    draw,
    make,
    floor: 'root-cover',
    diagnose,
    heldBytes,
  });

/** The texture lane pools the device grants for `budgetBytes`, by the session's own rule; `make`
 *  allocates the pools themselves, or their probe (`textureProbe`). */
export const grantedTexturePool = <R extends Made>(
  device: GPUDevice,
  budgetBytes: number,
  pools: Pick<TexturePools, 'poolFor'>,
  diagnose: Diagnose,
  make: (pool: TexturePool) => R,
) =>
  grantedPool({
    device,
    name: 'texture',
    budgetBytes,
    draw: pools.poolFor,
    make,
    floor: 'minimum',
    diagnose,
  });

/** The shadow pool the device grants for `budgetBytes`, by its own rule (`shadowPoolFor`); `make`
 *  allocates its texture. */
export const grantedShadowPool = <P extends Pool, R extends Made>(
  device: GPUDevice,
  budgetBytes: number,
  draw: (budgetBytes: number) => P,
  diagnose: Diagnose,
  make: (pool: P) => R,
) => grantedPool({ device, name: 'shadow', budgetBytes, draw, make, floor: 'minimum', diagnose });

/** A geometry pool's probe: its buffer, under the probe's label. */
export const geometryProbe = (device: GPUDevice) => (pool: GeometryPool) =>
  createPageBuffer(device, pool.allocatedBytes, PROBE_LABEL);

/** A texture pool's probe: one texture per lane it takes, as the pool makes it, under the probe's
 *  label. */
export const textureProbe =
  (device: GPUDevice, encoding: PoolEncoding) =>
  (pool: TexturePool): Made => {
    const textures = (['color', 'data'] as const).flatMap((kind) =>
      POOL_LANES.filter((lane) => pool.layers[kind][lane] > 0).map((lane) =>
        device.createTexture({
          ...tilePoolTexture({
            kind,
            lane,
            format: encoding.formatOf(kind, lane),
            texelBytes: encoding.texelBytes(lane),
            layers: pool.layers[kind][lane],
          }),
          label: PROBE_LABEL,
        }),
      ),
    );
    return { destroy: () => textures.forEach((texture) => texture.destroy()) };
  };

/** The pool a probe was granted, the probe released: a resize allocates the pool itself when it
 *  copies into it, and the probe is gone before. */
export async function probed<P>(granted: Promise<Granted<P, Made> | undefined>) {
  const result = await granted;
  result?.made.destroy();
  return result?.pool;
}

/** True when two texture pools hold the same layers in every lane: nothing to replace. */
export const sameLayers = (a: TexturePool, b: TexturePool) =>
  (['color', 'data'] as const).every((kind) =>
    POOL_LANES.every((lane) => a.layers[kind][lane] === b.layers[kind][lane]),
  );
