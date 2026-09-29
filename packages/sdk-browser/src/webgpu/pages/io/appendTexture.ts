import { EngineError, type Texture } from '../../../../../sdk-core/src/index.ts';
import { poolLayerBytes } from '../../../texture/tiles.ts';
import { poolTaking } from '../../residency/memoryBudgets.ts';
import { tileCatalogue } from '../../tile/catalogue.ts';
import * as grants from '../../residency/poolGrants.ts';
import { catalogueReport, laneDemand, laneTails, pageTablesReport } from '../prepare/textures.ts';
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
  rt.signal.throwIfAborted();
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
    taken = [...atlas.textures, entry];
  // What each lane takes, by the open's own rule, the new texture counted.
  const tails = laneTails(taken),
    demand = laneDemand(taken),
    peer = atlas.textures.findIndex((each) => each.lane === lane);
  const resident = peer < 0 ? 0 : atlas.poolOf(peer).resident;
  const pool = poolTaking(
    pools.pool,
    { kind, lane, resident, tails: tails[lane], streams: demand[lane] > tails[lane] },
    poolLayerBytes(encoding.texelBytes(lane)),
    {
      budgetBytes: grants.budgetBeside(setup.texturePoolBudget, streamer.sources.liveBytes).bytes,
      maxLayers: device.limits.maxTextureArrayLayers,
    },
  );
  if (pool !== pools.pool) {
    // Out of memory, absorbed: the grown pool is probed before any pool moves, a refusal named.
    const drawn = { poolFor: () => pool },
      probe = grants.textureProbe(device, encoding);
    const asked = grants.grantedTexturePool(device, 0, drawn, diag.engineDiagnostic, probe);
    const granted = await grants.probed(asked);
    if (!granted)
      throw new EngineError('TEXTURE_BUDGET', 'the device refused the pool', { kind, lane });
    rt.signal.throwIfAborted();
    if (run.lost) throw new Error('WEBGPU_LOST');
    streamer.resize(pool.layers);
    pools.pool = pool;
  }
  const started = performance.now(),
    before = { ...streamer.counters };
  const slot = streamer.append(kind, entry);
  pools.tails[kind] = tails;
  pools.demand[kind] = demand;
  slots.set(texture, slot);
  run.gate.resourcesChanged();
  diag.engineDiagnostic('material-texture-appended', 'A texture joined the atlas', {
    kind,
    slot,
    uploadedBytes: streamer.counters.uploadedBytes - before.uploadedBytes,
    uploadMs: performance.now() - started,
    scratchBuilds: streamer.counters.scratches - before.scratches,
    catalogue: catalogueReport(atlas.textures),
    pageTables: pageTablesReport(streamer),
    pool: { layers: pools.pool.layers, bytes: pools.pool.allocatedBytes },
  });
  return slot;
}

/** The texture is no longer worn: release its places and source, retaining reusable pool capacity. */
export function releaseWebgpuTexture(
  rt: WebgpuPagesRuntime,
  texture: Texture,
  kind: 'color' | 'data',
) {
  const slots = kind === 'color' ? rt.vis.mapLayer : rt.vis.dataLayer;
  const slot = slots.get(texture),
    streamer = rt.vis.textures,
    pools = rt.setup.texturePools;
  if (slot === undefined || !streamer || !pools) return;
  streamer.release(kind, slot);
  slots.delete(texture);
  pools.tails[kind] = laneTails(streamer[kind].textures);
  pools.demand[kind] = laneDemand(streamer[kind].textures);
  rt.run.gate.resourcesChanged();
}
