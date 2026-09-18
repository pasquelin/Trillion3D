import { compteMateriauxEtTangentes } from './webgpuPagesCatalogue.ts';
import { prepareWebgpuGeometry } from './webgpuGeometryPrepare.ts';
import { collectWebgpuMaterialTextures } from './webgpuMaterialTextures.ts';
import { tileCatalogue } from './webgpuTileCatalogue.ts';
import { createWebgpuTileStreamer } from './webgpuTileStreamer.ts';
import { POOL_LAYER_BYTES, TILE_BYTES } from './textureTiles.ts';
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

/** Ce qu'un diagnostic dit d'un catalogue : combien de textures par source, et leurs tuiles. */
const catalogueReport = (textures: TileTexture[]) => ({
  count: textures.length - 1,
  baked: textures.filter((texture) => texture.source.kind === 'baked').length,
  tailOnly: textures.filter((texture) => texture.source.kind === 'bytes').length - 1,
  host: textures.filter((texture) => texture.source.kind === 'host').length,
  streamedTiles: textures.reduce((total, texture) => total + texture.layout.entries, 0),
});

/**
 * Concatène la géométrie des pages, recense les textures des matériaux et bâtit les textures
 * virtuelles : deux pools de tuiles à la taille que le budget de l'hôte fixe, leurs tables de pages,
 * la queue de chaque texture épinglée d'emblée, et l'échantillonneur que les passes lisent.
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
  diag.engineDiagnostic('material-textures', 'Textures nécessaires au rendu', {
    colorTextures: maps.length,
    dataTextures: dataMaps.length,
    materials: compte.materials,
    opaquePages: allPages.length,
    forwardMeshes: blendCopies.length,
    geometryWithTangents: compte.geometryWithTangents,
    geometryWithoutTangents: compte.geometryWithoutTangents,
  });
  const textureStarted = performance.now();
  // Les niveaux du sidecar, rangés par la texture de la scène qu'ils couvrent et par atlas : la
  // même texture peut en avoir une entrée pour chacun, réduite par la courbe de cet atlas.
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
  const textures = createWebgpuTileStreamer({
    device: gpuDevice,
    color,
    data,
    layersPerAtlas: rt.setup.texturePoolLayers,
    budgetBytes: rt.setup.textureBudget,
    readLevel,
    onFailure: diag.diagnosticFailure,
    onColorChanged: () => {
      // Origine du changement de ressources : une tuile de couleur vient d'atteindre le pool ou de
      // le quitter, et l'ombre d'un feuillage découpé la suit.
      run.gate.resourcesChanged();
      shadowsFollowTextures(rt.lights);
    },
  });
  textures.prepare();
  vis.textures = textures;
  diag.engineDiagnostic('material-textures-ready', 'Textures et filtrage prêts', {
    color: catalogueReport(color),
    data: catalogueReport(data),
    pool: {
      layersPerAtlas: rt.setup.texturePoolLayers,
      bytes: textures.color.pool.bytes + textures.data.pool.bytes,
      layerBytes: POOL_LAYER_BYTES,
      tileBytes: TILE_BYTES,
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
