import { EngineError, type Texture } from '../../../../../sdk-core/src/index.ts';
import { poolLayerBytes } from '../../../texture/tiles.ts';
import { poolTaking } from '../../residency/memoryBudgets.ts';
import { deviceMade } from '../../../gpu/core/errorScope.ts';
import { tileCatalogue } from '../../tile/catalogue.ts';
import { textureProbe } from '../../residency/poolGrants.ts';
import { catalogueReport, pageTablesReport } from '../prepare/textures.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The append each session runs last: the next one draws its lane from the pool that one left. */
const appending = new WeakMap<WebgpuPagesRuntime, Promise<unknown>>();

/**
 * A texture taken by a live session's atlas after open (#847), by the path the open ran: its
 * catalogue entry drawn as `prepareWebgpuTextures` draws a host image's, its lane grown under the
 * texture budget, the live textures beside it, only when its tail finds no free place
 * (`poolTaking`), granted under the out-of-memory scope, then its slot appended (`growth.ts`). A
 * refusal (`TEXTURE_BUDGET`) comes before anything moves. The catalogue, the page tables and the
 * pool bytes are published (`material-texture-appended`). Returns the texture's slot, the one it
 * already holds when it has one. Appends run one after the other. Internal: a created material's
 * map goes through here.
 */
export function appendWebgpuTexture(
  rt: WebgpuPagesRuntime,
  texture: Texture,
  kind: 'color' | 'data',
): Promise<number> {
  const previous = appending.get(rt)?.catch(() => undefined) ?? Promise.resolve();
  const next = previous.then(() => appendNow(rt, texture, kind));
  appending.set(rt, next);
  return next;
}

async function appendNow(rt: WebgpuPagesRuntime, texture: Texture, kind: 'color' | 'data') {
  const { vis, setup, gpu, run, diag } = rt;
  const slots = kind === 'color' ? vis.mapLayer : vis.dataLayer;
  const held = slots.get(texture);
  if (held !== undefined) return held;
  const pools = setup.texturePools,
    streamer = vis.textures,
    device = gpu.device;
  if (!pools || !streamer || !device || run.lost)
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'no texture atlas is open to take it', {});
  const { encoding } = pools,
    coverage = kind === 'color' ? pools.coverage : undefined;
  const [, entry] = tileCatalogue([texture], () => undefined, undefined, encoding, coverage);
  const { lane } = entry,
    atlas = streamer[kind],
    peer = atlas.textures.findIndex((each) => each.lane === lane);
  const tails = pools.tails[kind][lane] + 1,
    demand = pools.demand[kind][lane] + 1 + entry.layout.entries;
  const resident = peer < 0 ? 0 : atlas.poolOf(peer).resident;
  const pool = poolTaking(
    pools.pool,
    { kind, lane, resident, tails, streams: demand > tails },
    poolLayerBytes(encoding.texelBytes(lane)),
    {
      budgetBytes: setup.texturePoolBudget,
      heldBytes: streamer.sources.liveBytes,
      maxLayers: device.limits.maxTextureArrayLayers,
    },
  );
  if (pool !== pools.pool) {
    // Out of memory, absorbed: the grown pool is probed under its scope before any pool moves.
    const probe = await deviceMade(device, () => textureProbe(device, encoding)(pool));
    const refused = { kind, lane, askedBytes: pool.allocatedBytes };
    if (!probe) throw new EngineError('TEXTURE_BUDGET', 'the device refused the pool', refused);
    probe.destroy();
    if (run.lost) throw new Error('WEBGPU_LOST');
    streamer.resize(pool.layers);
    pools.pool = pool;
  }
  pools.tails[kind][lane] = tails;
  pools.demand[kind][lane] = demand;
  const slot = streamer.append(kind, entry);
  slots.set(texture, slot);
  run.gate.resourcesChanged();
  diag.engineDiagnostic('material-texture-appended', 'A texture joined the atlas', {
    kind,
    slot,
    catalogue: catalogueReport(atlas.textures),
    pageTables: pageTablesReport(streamer),
    pool: { layers: pools.pool.layers, bytes: pools.pool.allocatedBytes },
  });
  return slot;
}
