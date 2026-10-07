import { collectWebgpuMaterialTextures } from '../../core/materialTextures.ts'
import { prepareHostReductions } from '../../../texture/mips.ts'
import { prepareTexelTurn } from '../../tile/texelTurn.ts'
import { texturePoolFor } from '../../residency/memoryBudgets.ts'
import { grantedTexturePool, sameLayers } from '../../residency/poolGrants.ts'
import { grantedLatest } from './grantLatest.ts'
import { laneDemand, laneTails } from './textureCensus.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import {
  reportTextureNeeds,
  reportTexturesReady,
  textureCatalogues,
  tileStreamerFor,
} from './textureSteps.ts'
import type { TileTexture } from '../../tile/tileTexture.ts'

/** The atlases among `catalogues` holding a host texture: those whose mips the device reduces. */
const hostKinds = (catalogues: Record<'color' | 'data', readonly TileTexture[]>) =>
  (['color', 'data'] as const).filter((kind) =>
    catalogues[kind].some(({ source }) => source.kind === 'host'),
  )

/** The census of the scene's material textures, their slots written in the atlases' layers: taken
 *  before the frame targets, which make a feedback target only for a scene that wears one
 *  (`./feedbackVariant.ts`). */
export function takeMaterialTextures(rt: WebgpuPagesRuntime) {
  const { mapLayer, dataLayer } = rt.vis
  mapLayer.clear()
  dataLayer.clear()
  // The physical records name data slots: counted again, each is written again (`physicalTable.ts`).
  rt.vis.physicalTable.forget()
  return collectWebgpuMaterialTextures(rt.setup.allPages, rt.setup.blendCopies, mapLayer, dataLayer)
}

/**
 * Builds the virtual textures of the census over the geometry prepare concatenated
 * (`prepareWebgpuGeometry`, `takeMaterialTextures`): for each atlas one tile pool per lane its
 * textures take — the block family the session chose for the chains the gate kept in it, RGBA8 for
 * the others and for a host image —, sized together by the host budget, their page tables, each
 * texture's queue pinned from the start, and the sampler the passes read.
 */
export async function prepareWebgpuTextures(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  census = takeMaterialTextures(rt),
) {
  const { vis, diag, run } = rt
  reportTextureNeeds(rt, census)
  const textureStarted = performance.now()
  const catalogues = textureCatalogues(rt, gpuDevice, census)
  const { choice, encoding, color, data } = catalogues
  // What the atlases holding a host texture reduce its mips with, and turn its raw texels with,
  // compiled off the thread beside the pools' grant, before the tails below are reduced
  // (`../../../texture/mips.ts`, `../../tile/texelTurn.ts`); a scene of cooked chains alone
  // reduces nothing on the device, and compiles none.
  const reductions = Promise.all([
    prepareHostReductions(gpuDevice, encoding, hostKinds({ color, data })),
    prepareTexelTurn(gpuDevice, [...color, ...data]),
  ])
  // The lanes settle here, where the textures are known: each pool is sized by what its lane holds,
  // never below the tails it keeps resident whole, one tile each.
  const demand = { color: laneDemand(color), data: laneDemand(data) }
  const tails = { color: laneTails(color), data: laneTails(data) }
  const poolFor = (budgetBytes: number) =>
    texturePoolFor(budgetBytes, gpuDevice, demand, encoding.texelBytes, tails)
  const streamer = tileStreamerFor(rt, gpuDevice, catalogues)
  // Out of memory absorbed: the lane pools are those the device grants, allocated once, under the
  // out-of-memory scope (`poolGrants.ts`). One refused even at its floor is refused by name, never
  // allocated at the full request outside any scope: the material pipeline then drops. A budget
  // `setMemoryBudgets` records while the device answers is the later word (`grantedLatest`).
  const granted = await grantedLatest({
    budget: () => rt.setup.texturePoolBudget,
    draw: (asked) => ({ asked, pool: poolFor(asked) }),
    same: sameLayers,
    grant: ({ asked }) =>
      grantedTexturePool(gpuDevice, asked, { poolFor }, diag.engineDiagnostic, (pool) =>
        streamer(pool.layers),
      ),
    stopped: () => rt.signal.aborted || run.lost,
  })
  if (!granted) throw new Error('WEBGPU_TEXTURE_POOL_REFUSED')
  const { coverage } = census
  rt.setup.texturePools = { choice, encoding, pool: granted.pool, poolFor, demand, tails, coverage }
  // The budget recorded is the one granted, not the one asked.
  rt.setup.texturePoolBudget = granted.pool.budgetBytes
  const textures = granted.made
  await reductions
  textures.prepare()
  vis.textures = textures
  reportTexturesReady(rt, catalogues, granted.pool, textureStarted)
  vis.mapsSampler = gpuDevice.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  })
}
