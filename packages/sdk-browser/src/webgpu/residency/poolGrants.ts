import { deviceGrants } from '../../gpu/core/errorScope.ts';
import { createPageBuffer } from '../../gpu/page/resize.ts';
import { tilePoolTexture } from '../tile/pool.ts';
import { POOL_LANES } from '../../texture/blockFormats.ts';
import type { GeometryPool, PoolClamp } from '../../residency/pools.ts';
import type { TexturePool, TexturePools } from './memoryBudgets.ts';

/** What a probe is named: never a pool's own label, which a reader of the device looks for. */
const PROBE_LABEL = 'Trillion3D pool probe';

type Pool = { budgetBytes: number; allocatedBytes: number; clamp: PoolClamp };
type Diagnose = (phase: string, message: string, context: Record<string, unknown>) => void;

/**
 * Out of memory, absorbed: the pool a session asks for is first probed on the device
 * (`deviceGrants`), and a refusal shrinks that pool — half the bytes it would have held, drawn
 * again by its own rule — until the device grants it or the pool reaches its floor (`floor`: the
 * root cover of the geometry, one layer per lane of the textures). The pool in place is never
 * replaced by one the device refused, so the frame goes on: what no longer fits draws coarser,
 * through the budget ladder every pool already follows. A refusal is published once per request
 * as `gpu-out-of-memory`, naming the pool, the bytes asked and the bytes granted (`null` when even
 * the floor was refused: the caller then keeps what it holds).
 */
async function grantedPool<P extends Pool>(options: {
  name: 'geometry' | 'texture';
  budgetBytes: number;
  draw: (budgetBytes: number) => P;
  grants: (pool: P) => Promise<boolean>;
  floor: PoolClamp;
  diagnose: Diagnose;
}): Promise<P | undefined> {
  const { name, draw, grants, floor, diagnose } = options;
  let pool = draw(options.budgetBytes);
  const requestedBytes = pool.allocatedBytes;
  for (;;) {
    if (await grants(pool)) break;
    const half = Math.floor(Math.min(pool.budgetBytes, pool.allocatedBytes) / 2);
    if (pool.clamp === floor || half < 1) {
      diagnose('gpu-out-of-memory', `The device refused the ${name} pool's floor`, {
        kind: 'warning',
        pool: name,
        requestedBytes,
        grantedBytes: null,
      });
      return undefined;
    }
    pool = draw(half);
  }
  if (pool.allocatedBytes !== requestedBytes)
    diagnose('gpu-out-of-memory', `The device refused the ${name} pool; drawn smaller`, {
      kind: 'warning',
      pool: name,
      requestedBytes,
      grantedBytes: pool.allocatedBytes,
      clamp: pool.clamp,
    });
  return pool;
}

/** The geometry pool the device grants for `budgetBytes`, by the session's own rule. */
export const grantedGeometryPool = (
  device: GPUDevice,
  budgetBytes: number,
  draw: (budgetBytes: number) => GeometryPool,
  diagnose: Diagnose,
) =>
  grantedPool({
    name: 'geometry',
    budgetBytes,
    draw,
    grants: (pool) =>
      deviceGrants(device, () => [createPageBuffer(device, pool.allocatedBytes, PROBE_LABEL)]),
    floor: 'root-cover',
    diagnose,
  });

/** The texture lane pools the device grants for `budgetBytes`, by the session's own rule. */
export const grantedTexturePool = (
  device: GPUDevice,
  budgetBytes: number,
  pools: Pick<TexturePools, 'encoding' | 'poolFor'>,
  diagnose: Diagnose,
) =>
  grantedPool<TexturePool>({
    name: 'texture',
    budgetBytes,
    draw: pools.poolFor,
    grants: (pool) =>
      deviceGrants(device, () =>
        (['color', 'data'] as const).flatMap((kind) =>
          POOL_LANES.filter((lane) => pool.layers[kind][lane] > 0).map((lane) =>
            device.createTexture({
              ...tilePoolTexture({
                kind,
                lane,
                format: pools.encoding.formatOf(kind, lane),
                texelBytes: pools.encoding.texelBytes(lane),
                layers: pool.layers[kind][lane],
              }),
              label: PROBE_LABEL,
            }),
          ),
        ),
      ),
    floor: 'minimum',
    diagnose,
  });

/** True when two texture pools hold the same layers in every lane: nothing to replace. */
export const sameLayers = (a: TexturePool, b: TexturePool) =>
  (['color', 'data'] as const).every((kind) =>
    POOL_LANES.every((lane) => a.layers[kind][lane] === b.layers[kind][lane]),
  );
