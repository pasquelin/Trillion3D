import { msSince } from '../../../diagnostic/stopwatch.ts'
import { materialsAndTangentsCount } from '../io/catalogue.ts'
import type { takeMaterialTextures } from './textures.ts'
import { previewsByAtlas, tileCatalogue } from '../../tile/catalogue.ts'
import { appendCardMaps, cardsStream } from '../../tile/cardMaps.ts'
import { createWebgpuTileStreamer } from '../../tile/streamer.ts'
import { chooseBlockFormat, poolEncoding } from '../../../texture/blockFormats.ts'
import type { TexturePool } from '../../residency/memoryBudgets.ts'
import { shadowsFollowTextures } from './lightResources.ts'
import { catalogueReport, pageTablesReport } from './textureCensus.ts'
import {
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
} from '../../../../../sdk-core/src/texture/previewFormat.ts'
import {
  PREVIEW_BASE,
  TEXTURE_PREVIEW_VERSION,
} from '../../../../../sdk-core/src/contracts/writtenFormats.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

type Census = ReturnType<typeof takeMaterialTextures>

/** The textures the render needs, said once. */
export function reportTextureNeeds(rt: WebgpuPagesRuntime, { maps, dataMaps }: Census) {
  const { allPages, blendCopies } = rt.setup
  const compte = materialsAndTangentsCount(allPages, rt.vis.geometryBlocks)
  rt.diag.engineDiagnostic('material-textures', 'Textures needed for the render', {
    colorTextures: maps.length,
    dataTextures: dataMaps.length,
    materials: compte.materials,
    opaquePages: allPages.length,
    forwardMeshes: blendCopies.length,
    geometryWithTangents: compte.geometryWithTangents,
    geometryWithoutTangents: compte.geometryWithoutTangents,
  })
}

/** The block family, the pools' encoding and each atlas's tile catalogue, the impostor maps
 *  appended after the scene's textures (`appendCardMaps`) with each mesh's slots. */
export function textureCatalogues(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  { maps, dataMaps, coverage }: Census,
) {
  const previews = rt.context.metadata.texturePreviews ?? []
  const previewAt = previewsByAtlas(previews)
  // The family is settled here, the chains in hand: the one the device samples AND the cache
  // holds kept chains in — a device with both features takes the family the cook wrote.
  const choice = chooseBlockFormat(gpuDevice.features, previews, rt.context.textureCompression)
  const encoding = poolEncoding(choice.block)
  // The glTF rank of each record: what its baked preview is found by.
  const ranks = rt.context.textureIndices
  const previewOf = (atlas: number, list: typeof maps) => (index: number) => {
    const source = ranks?.get(list[index])
    return source === undefined ? undefined : previewAt(source, atlas)
  }
  const readLevel = rt.context.readTextureLevel
  const color = tileCatalogue(
    maps,
    previewOf(PREVIEW_ATLAS_COLOR, maps),
    readLevel,
    encoding,
    coverage,
  )
  const data = tileCatalogue(dataMaps, previewOf(PREVIEW_ATLAS_DATA, dataMaps), readLevel, encoding)
  const section = cardsStream(rt) ? rt.context.metadata.impostors : undefined
  const cards = appendCardMaps(section, color, data, rt.diag.diagnosticFailure)
  return { choice, encoding, color, data, readLevel, cards }
}

/** The tile streamer over the lane pools' `layers`. */
export function tileStreamerFor(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  catalogues: ReturnType<typeof textureCatalogues>,
) {
  const { color, data, encoding, readLevel, cards } = catalogues
  return (layers: TexturePool['layers']) =>
    createWebgpuTileStreamer({
      device: gpuDevice,
      color,
      data,
      layers,
      encoding,
      budgetBytes: rt.setup.textureBudget,
      budgetMs: rt.setup.textureUploadMs,
      clock: rt.clock,
      readLevel,
      onFailure: rt.diag.diagnosticFailure,
      cards,
      onCardsLanded: () => rt.run.gate.resourcesChanged(),
      onColorChanged: (slots) => {
        // Origin of the resource change: colour tiles have just reached the pool or left it, or a
        // texture's sampling moved, and the shadow of the cutout foliage that reads them follows —
        // once per pump.
        rt.run.gate.resourcesChanged()
        shadowsFollowTextures(rt, rt.layout.rows, slots, rt.vis.mapLayer)
      },
    })
}

/** The textures and their filtering ready, said once. */
export function reportTexturesReady(
  rt: WebgpuPagesRuntime,
  catalogues: ReturnType<typeof textureCatalogues>,
  pool: TexturePool,
  textureStarted: number,
) {
  const textures = rt.vis.textures!
  rt.diag.engineDiagnostic('material-textures-ready', 'Textures and filtering ready', {
    color: catalogueReport(catalogues.color),
    data: catalogueReport(catalogues.data),
    pool: {
      layers: pool.layers,
      bytes: pool.allocatedBytes,
      clamp: pool.clamp,
      compression: catalogues.choice,
      pools: [...textures.color.pools, ...textures.data.pools].map((pool) => ({
        label: pool.label,
        format: pool.texture.format,
        layers: pool.layers,
        tiles: pool.tiles,
        tileBytes: pool.tileBytes,
        pinnedTails: pool.resident,
      })),
    },
    pageTables: pageTablesReport(textures),
    progressiveLevels: { version: TEXTURE_PREVIEW_VERSION, base: PREVIEW_BASE },
    preparationMs: msSince(textureStarted),
    lighting: 'GGX direct + diffuse hemisphere; no environment map',
    display: 'ACES once, sRGB once',
  })
}
