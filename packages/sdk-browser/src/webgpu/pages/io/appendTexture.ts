import { EngineError, type Texture } from '../../../../../sdk-core/src/index.ts'
import { poolLayerBytes, poolLayerLimit } from '../../../texture/tiles.ts'
import { poolTaking } from '../../residency/memoryBudgets.ts'
import { tileCatalogue } from '../../tile/catalogue.ts'
import * as grants from '../../residency/poolGrants.ts'
import {
  catalogueReport,
  laneDemand,
  laneTails,
  pageTablesReport,
} from '../prepare/textureCensus.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { textureBytesBeside } from './memory.ts'
import { prepareHostReductions } from '../../../texture/mips.ts'
import { prepareTexelTurn } from '../../tile/texelTurn.ts'

/** The append each session runs last: the next one draws its lane from the pool that one left. */
const appending = new WeakMap<WebgpuPagesRuntime, Promise<unknown>>()

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
  const previous = appending.get(rt)?.catch(() => undefined) ?? Promise.resolve()
  const next = previous.then(() => appendNow(rt, texture, kind))
  appending.set(rt, next)
  return next
}

async function appendNow(
  rt: WebgpuPagesRuntime,
  texture: Texture,
  kind: 'color' | 'data',
): Promise<number> {
  const { vis, setup, gpu, run } = rt
  const slots = kind === 'color' ? vis.mapLayer : vis.dataLayer
  const held = slots.get(texture)
  if (held !== undefined) return held
  rt.signal.throwIfAborted()
  const pools = setup.texturePools,
    streamer = vis.textures,
    device = gpu.device
  if (!pools || !streamer || !device || run.lost)
    throw new EngineError('UNSUPPORTED_SCENE_UPDATE', 'no texture atlas is open to take it', {})
  const { encoding } = pools,
    coverage = kind === 'color' ? pools.coverage : undefined
  const [, entry] = tileCatalogue([texture], () => undefined, undefined, encoding, coverage)
  const atlas = streamer[kind],
    taken = [...atlas.textures, entry]
  // What each lane takes, by the open's own rule, the new texture counted.
  const a: Append = {
    ...{ kind, slots, pools, streamer, device, entry, atlas, taken },
    ...{ tails: laneTails(taken), demand: laneDemand(taken) },
  }
  if ((await growLane(rt, a)) === 'moved') return appendNow(rt, texture, kind)
  // A host texture's mips reduce on the device, its raw texels turn there: what they take
  // compiled before its tail does.
  if (entry.source.kind === 'host')
    await Promise.all([
      prepareHostReductions(device, encoding, [kind]),
      prepareTexelTurn(device, [entry]),
    ])
  rt.signal.throwIfAborted()
  return appendEntry(rt, texture, a)
}

type Pools = NonNullable<WebgpuPagesRuntime['setup']['texturePools']>
type Streamer = NonNullable<WebgpuPagesRuntime['vis']['textures']>
/** One append as its steps read it: the texture's catalogue entry, its atlas, and the lanes'
 *  tails and demand with it counted. */
type Append = {
  kind: 'color' | 'data'
  slots: Map<Texture, number>
  pools: Pools
  streamer: Streamer
  device: GPUDevice
  entry: ReturnType<typeof tileCatalogue>[1]
  atlas: Streamer['color' | 'data']
  /** The atlas's textures as the census counted them, the new one last. */
  taken: readonly unknown[]
  tails: ReturnType<typeof laneTails>
  demand: ReturnType<typeof laneDemand>
}

/** The pool grown for the entry's lane when its tail finds no free place, granted under the
 *  out-of-memory scope; 'moved' when the pools or the atlas moved while the device granted it. */
async function growLane(rt: WebgpuPagesRuntime, a: Append) {
  const { setup, run, diag } = rt
  const { kind, pools, device, entry, atlas, taken, tails, demand } = a
  const { lane } = entry,
    { encoding } = pools,
    resident = atlas.residentIn(lane)
  const previousPool = pools.pool,
    previousBudget = setup.texturePoolBudget
  const pool = poolTaking(
    previousPool,
    { kind, lane, resident, tails: tails[lane], streams: demand[lane] > tails[lane] },
    poolLayerBytes(encoding.texelBytes(lane)),
    {
      budgetBytes: grants.budgetBeside(setup.texturePoolBudget, textureBytesBeside(rt)).bytes,
      maxLayers: poolLayerLimit(device.limits),
    },
  )
  if (pool === pools.pool) return undefined
  // Out of memory, absorbed: the grown pool is probed before any pool moves, a refusal named.
  const drawn = { poolFor: () => pool },
    probe = grants.textureProbe(device, encoding)
  const asked = grants.grantedTexturePool(device, 0, drawn, diag.engineDiagnostic, probe)
  const granted = await grants.probed(asked)
  if (!granted)
    throw new EngineError('TEXTURE_BUDGET', 'the device refused the pool', { kind, lane })
  rt.signal.throwIfAborted()
  if (run.lost) throw new Error('WEBGPU_LOST')
  // A release or budget update can run while the device grants the probe. Recompute its
  // census and admission instead of overwriting those changes with the pre-await snapshot.
  if (
    pools.pool !== previousPool ||
    setup.texturePoolBudget !== previousBudget ||
    atlas.textures.some((texture, index) => texture !== taken[index])
  )
    return 'moved'
  a.streamer.resize(pool.layers)
  pools.pool = pool
  return undefined
}

/** The entry's slot appended, the lanes' census kept, the append published. */
function appendEntry(rt: WebgpuPagesRuntime, texture: Texture, a: Append) {
  const { vis, run, diag } = rt
  const { kind, slots, pools, streamer, entry, atlas } = a
  const started = performance.now(),
    before = { ...streamer.counters }
  let slot: number
  try {
    slot = streamer.append(kind, entry)
  } finally {
    // Rollback also replaces page-table buffers: readers must stop binding the old ones.
    run.gate.resourcesChanged()
  }
  pools.tails[kind] = a.tails
  pools.demand[kind] = a.demand
  slots.set(texture, slot)
  // The physical records name data slots (`../../visibility/physicalTable.ts`): read again.
  if (kind === 'data') vis.physicalTable.forget()
  diag.engineDiagnostic('material-texture-appended', 'A texture joined the atlas', {
    kind,
    slot,
    uploadedBytes: streamer.counters.uploadedBytes - before.uploadedBytes,
    uploadMs: performance.now() - started,
    scratchBuilds: streamer.counters.scratches - before.scratches,
    catalogue: catalogueReport(atlas.textures),
    pageTables: pageTablesReport(streamer),
    pool: { layers: pools.pool.layers, bytes: pools.pool.allocatedBytes },
  })
  return slot
}

/** The texture is no longer worn: release its places and source, retaining reusable pool capacity. */
export function releaseWebgpuTexture(
  rt: WebgpuPagesRuntime,
  texture: Texture,
  kind: 'color' | 'data',
) {
  const slots = kind === 'color' ? rt.vis.mapLayer : rt.vis.dataLayer
  const slot = slots.get(texture),
    streamer = rt.vis.textures,
    pools = rt.setup.texturePools
  if (slot === undefined || !streamer || !pools) return
  streamer.release(kind, slot)
  slots.delete(texture)
  if (kind === 'data') rt.vis.physicalTable.forget()
  pools.tails[kind] = laneTails(streamer[kind].textures)
  pools.demand[kind] = laneDemand(streamer[kind].textures)
  rt.run.gate.resourcesChanged()
}
