import { compteMateriauxEtTangentes } from './webgpuPagesCatalogue.ts';
import { prepareWebgpuGeometry } from './webgpuGeometryPrepare.ts';
import { collectWebgpuMaterialTextures } from './webgpuMaterialTextures.ts';
import { tileCatalogue } from './webgpuTileCatalogue.ts';
import { createWebgpuTileStreamer } from './webgpuTileStreamer.ts';
import { poolEncoding } from './textureBlockFormats.ts';
import { shadowsFollowTextures } from './webgpuPagesLightResources.ts';
import {
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
  PREVIEW_BASE,
  TEXTURE_PREVIEW_VERSION,
  type TexturePreview,
} from '../sdk-core/index.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';
import type { TileTexture } from './webgpuTileAtlas.ts';

/** What a diagnostic says of a catalogue: how many textures per source, and their tiles. */
const catalogueReport = (textures: TileTexture[]) => ({
  count: textures.length - 1,
  baked: textures.filter((texture) => texture.source.kind === 'baked').length,
  tailOnly: textures.filter((texture) => texture.source.kind === 'bytes').length - 1,
  host: textures.filter((texture) => texture.source.kind === 'host').length,
  streamedTiles: textures.reduce((total, texture) => total + texture.layout.entries, 0),
});

/**
 * Concatenates page geometry, inventories material textures and builds virtual textures: two tile
 * pools at the size the host budget sets, in the block format the session chose when every
 * texture the render needs has its baked chain — a host image cannot fill a block pool, so one
 * without brings both pools back to RGBA8, by name —, their page tables, each texture's queue
 * pinned from the start, and the sampler the passes read.
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
  const byTexture = new Map<string, TexturePreview>();
  for (const preview of rt.context.metadata.texturePreviews ?? [])
    byTexture.set(`${preview.texture}/${preview.atlas}`, preview);
  const previewOf = (atlas: number, list: typeof maps) => (index: number) => {
    const source = rt.context.textureIndices?.get(list[index]);
    return source === undefined ? undefined : byTexture.get(`${source}/${atlas}`);
  };
  const readLevel = rt.context.readTextureLevel;
  const color = tileCatalogue(maps, previewOf(PREVIEW_ATLAS_COLOR, maps), readLevel);
  const data = tileCatalogue(dataMaps, previewOf(PREVIEW_ATLAS_DATA, dataMaps), readLevel);
  // The block choice settles here, where the textures are known: a host image cannot fill a
  // block pool, so one texture without a whole baked chain keeps both pools RGBA8, by name.
  const hosted = [...color, ...data].filter((texture) => texture.source.kind === 'host').length;
  if (hosted && rt.setup.blockChoice.block)
    rt.setup.blockChoice = {
      block: undefined,
      reason: `${hosted} texture(s) without a whole baked chain`,
    };
  const encoding = poolEncoding(rt.setup.blockChoice.block);
  rt.setup.texturePool = rt.setup.texturePoolFor(rt.setup.texturePool.budgetBytes, encoding.block);
  const textures = createWebgpuTileStreamer({
    device: gpuDevice,
    color,
    data,
    layersPerAtlas: rt.setup.texturePool.layers,
    encoding,
    budgetBytes: rt.setup.textureBudget,
    readLevel,
    onFailure: diag.diagnosticFailure,
    onColorChanged: () => {
      // Origin of the resource change: a colour tile has just reached the pool or left it, and the
      // shadow of cutout foliage follows it.
      run.gate.resourcesChanged();
      shadowsFollowTextures(rt.lights);
    },
  });
  textures.prepare();
  vis.textures = textures;
  diag.engineDiagnostic('material-textures-ready', 'Textures and filtering ready', {
    color: catalogueReport(color),
    data: catalogueReport(data),
    pool: {
      layersPerAtlas: rt.setup.texturePool.layers,
      bytes: textures.color.pool.bytes + textures.data.pool.bytes,
      format: encoding.color,
      compression: rt.setup.blockChoice,
      layerBytes: textures.color.pool.layerBytes,
      tileBytes: textures.color.pool.tileBytes,
      tilesPerAtlas: textures.color.pool.tiles,
      pinnedTails: textures.color.pool.resident + textures.data.pool.resident,
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
