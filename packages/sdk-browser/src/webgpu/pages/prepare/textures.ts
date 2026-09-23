import { importTextureIndices } from '../../../host/surfaceImport.ts';
import { compteMateriauxEtTangentes } from '../io/catalogue.ts';
import { prepareWebgpuGeometry } from '../../core/geometryPrepare.ts';
import { collectWebgpuMaterialTextures } from '../../core/materialTextures.ts';
import { tileCatalogue } from '../../tile/catalogue.ts';
import { createWebgpuTileStreamer } from '../../tile/streamer.ts';
import {
  chooseBlockFormat,
  laneCounts,
  POOL_LANES,
  poolEncoding,
} from '../../../texture/blockFormats.ts';
import { texturePoolFor } from '../../residency/memoryBudgets.ts';
import { shadowsFollowTextures } from './lightResources.ts';
import {
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
  PREVIEW_BASE,
  TEXTURE_PREVIEW_VERSION,
  type TexturePreview,
} from '../../../../../sdk-core/src/index.ts';
import { refreshSurface, type PageSurface } from '../../../page/surface.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { TileTexture } from '../../tile/atlas.ts';

/** Tiles each lane's textures would hold at full residency: their tails and streamed entries. */
const laneDemand = (textures: TileTexture[]) => {
  const demand = laneCounts();
  for (const texture of textures) demand[texture.lane] += 1 + texture.layout.entries;
  return demand;
};

/** What a diagnostic says of a catalogue: how many textures per source and per lane, their tiles. */
const catalogueReport = (textures: TileTexture[]) => ({
  count: textures.length - 1,
  baked: textures.filter((texture) => texture.source.kind === 'baked').length,
  tailOnly: textures.filter((texture) => texture.source.kind === 'bytes').length - 1,
  host: textures.filter((texture) => texture.source.kind === 'host').length,
  lanes: Object.fromEntries(
    POOL_LANES.map((lane) => [lane, textures.filter((texture) => texture.lane === lane).length]),
  ),
  streamedTiles: textures.reduce((total, texture) => total + texture.layout.entries, 0),
});

/**
 * Concatenates page geometry, inventories material textures and builds virtual textures: for
 * each atlas one tile pool per lane its textures take — the block family the session chose for
 * the chains the gate kept in it, RGBA8 for the others and for a host image —, sized together by
 * the host budget, their page tables, each texture's queue pinned from the start, and the
 * sampler the passes read.
 */
export async function prepareWebgpuTextures(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis, diag, run } = rt,
    { allPages, blendCopies } = rt.setup,
    { geometryBlocks, mapLayer, dataLayer } = vis;
  geometryBlocks.clear();
  mapLayer.clear();
  dataLayer.clear();
  ({
    concatPos: vis.concatPos,
    concatUv: vis.concatUv,
    concatNrm: vis.concatNrm,
  } = prepareWebgpuGeometry(gpuDevice, allPages, geometryBlocks));
  const { maps, dataMaps } = collectWebgpuMaterialTextures(
    allPages,
    blendCopies,
    mapLayer,
    dataLayer,
  );
  const compte = compteMateriauxEtTangentes(allPages, geometryBlocks);
  diag.engineDiagnostic('material-textures', 'Textures needed for the render', {
    colorTextures: maps.length,
    dataTextures: dataMaps.length,
    materials: compte.materials,
    opaquePages: allPages.length,
    forwardMeshes: blendCopies.length,
    geometryWithTangents: compte.geometryWithTangents,
    geometryWithoutTangents: compte.geometryWithoutTangents,
  });
  const textureStarted = performance.now();
  // Sidecar levels, filed by the scene texture they cover and by atlas: the same texture can have
  // an entry for each, reduced by that atlas's curve.
  const previews = rt.context.metadata.texturePreviews ?? [];
  const byTexture = new Map<string, TexturePreview>();
  for (const preview of previews) byTexture.set(`${preview.texture}/${preview.atlas}`, preview);
  // The family is settled here, the chains in hand: the one the device samples AND the cache
  // holds kept chains in — a device with both features takes the family the cook wrote.
  const choice = chooseBlockFormat(gpuDevice.features, previews, rt.context.textureCompression);
  const encoding = poolEncoding(choice.block);
  // The host names its textures by glTF rank on its own objects; the atlas addresses the engine's
  // records, so the table is rekeyed once, here, before a preview is looked up.
  const ranks = importTextureIndices(rt.context.textureIndices);
  const previewOf = (atlas: number, list: typeof maps) => (index: number) => {
    const source = ranks?.get(list[index]);
    return source === undefined ? undefined : byTexture.get(`${source}/${atlas}`);
  };
  const readLevel = rt.context.readTextureLevel;
  const color = tileCatalogue(maps, previewOf(PREVIEW_ATLAS_COLOR, maps), readLevel, encoding);
  const data = tileCatalogue(
    dataMaps,
    previewOf(PREVIEW_ATLAS_DATA, dataMaps),
    readLevel,
    encoding,
  );
  // The lanes settle here, where the textures are known: each pool is sized by what its lane holds.
  const demand = { color: laneDemand(color), data: laneDemand(data) };
  const poolFor = (budgetBytes: number) =>
    texturePoolFor(budgetBytes, gpuDevice, demand, encoding.texelBytes);
  const pools = { choice, encoding, pool: poolFor(rt.setup.texturePoolBudget), poolFor };
  rt.setup.texturePools = pools;
  const textures = createWebgpuTileStreamer({
    device: gpuDevice,
    color,
    data,
    layers: pools.pool.layers,
    encoding,
    budgetBytes: rt.setup.textureBudget,
    budgetMs: rt.setup.textureUploadMs,
    readLevel,
    onFailure: diag.diagnosticFailure,
    onColorChanged: (slots) => {
      // Origin of the resource change: colour tiles have just reached the pool or left it, and
      // the shadow of the cutout foliage that reads them follows — once per pump.
      run.gate.resourcesChanged();
      shadowsFollowTextures(rt.lights, rt.layout.rows, slots);
    },
  });
  textures.prepare();
  vis.textures = textures;
  diag.engineDiagnostic('material-textures-ready', 'Textures and filtering ready', {
    color: catalogueReport(color),
    data: catalogueReport(data),
    pool: {
      layers: pools.pool.layers,
      bytes: pools.pool.allocatedBytes,
      clamp: pools.pool.clamp,
      compression: choice,
      pools: [...textures.color.pools, ...textures.data.pools].map((pool) => ({
        label: pool.texture.label,
        format: pool.texture.format,
        layers: pool.layers,
        tiles: pool.tiles,
        tileBytes: pool.tileBytes,
        pinnedTails: pool.resident,
      })),
      requestReduce: textures.requestReduce,
    },
    progressiveLevels: { version: TEXTURE_PREVIEW_VERSION, base: PREVIEW_BASE },
    preparationMs: performance.now() - textureStarted,
    lighting: 'GGX direct + diffuse hemisphere; no environment map',
    display: 'ACES once, sRGB once',
  });
  vis.mapsSampler = gpuDevice.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
}

/**
 * A repaint wrote a texture's filter or UV transform after the session opened (#335): each
 * surface is reread once — the record of a texture is refilled with it (`../../../host/surfaceImport.ts`)
 * — and every header whose sampling moved is sent. Nothing is rebuilt: no pool, no sampler, no
 * bind group.
 */
export function resampleWebgpuTextures(rt: WebgpuPagesRuntime) {
  const { allPages, blendCopies } = rt.setup,
    surfaces = new Set<PageSurface>();
  for (const rec of allPages) surfaces.add(rec.material);
  for (const copy of blendCopies) surfaces.add(copy.surface);
  for (const surface of surfaces) refreshSurface(surface);
  rt.vis.textures?.resample();
}
