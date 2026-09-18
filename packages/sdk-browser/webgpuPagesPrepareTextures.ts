import { compteMateriauxEtTangentes } from './webgpuPagesCatalogue.ts';
import { prepareWebgpuGeometry } from './webgpuGeometryPrepare.ts';
import { collectWebgpuMaterialTextures } from './webgpuMaterialTextures.ts';
import { prepareWebgpuAtlas, regenerateClassMips } from './webgpuAtlasCommon.ts';
import { createWebgpuAtlasSlots } from './webgpuAtlasSlots.ts';
import { ATLAS_CLASS_COUNT } from './webgpuAtlasClasses.ts';
import {
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
  PREVIEW_BASE,
  previewIsWhole,
  TEXTURE_PREVIEW_VERSION,
  type TexturePreview,
} from '../sdk-core/index.ts';
import { mipLevelCountFor } from './textureMips.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const FLAT_NORMAL = { r: 128 / 255, g: 128 / 255, b: 1, a: 1 };

/** Ce qu'un diagnostic dit d'un atlas : ses classes, leurs dimensions et leurs octets calculés. */
const atlasReport = (
  atlas: ReturnType<typeof prepareWebgpuAtlas>,
  format: string,
  count: number,
) => ({
  count,
  format,
  classesUsed: atlas.used,
  classSlots: ATLAS_CLASS_COUNT,
  classes: atlas.classes.map((entry) => ({
    size: entry.size,
    layers: entry.layers,
    mipLevels: mipLevelCountFor(...entry.size),
    allocatedBytes: entry.bytes,
  })),
  allocatedBytes: atlas.bytes,
});

/** Concatenates the page geometry and builds the colour and data atlases with their mip chains,
 *  the material scale table and the sampler the shade pass reads them through. */
export async function prepareWebgpuTextures(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis, diag } = rt,
    { allPages, blendCopies } = rt.setup,
    { geometryBlocks, mapLayer, dataLayer, uvScales, dataUvScales, textureJobs } = vis;
  geometryBlocks.clear();
  mapLayer.clear();
  dataLayer.clear();
  uvScales.length = 0;
  uvScales.push([1, 1]);
  dataUvScales.length = 0;
  dataUvScales.push([1, 1]);
  ({
    concatPos: vis.concatPos,
    concatUv: vis.concatUv,
    concatNrm: vis.concatNrm,
  } = prepareWebgpuGeometry(gpuDevice, allPages, geometryBlocks));
  const { maps, dataMaps, normalMaps, materialLayers } = collectWebgpuMaterialTextures(
    allPages,
    blendCopies,
    mapLayer,
    dataLayer,
  );
  vis.materialLayers = materialLayers;
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
  const fallbackEncoder = gpuDevice.createCommandEncoder();
  // Les niveaux du sidecar, rangés par la texture de la scène qu'ils couvrent et par atlas : la
  // même texture peut en avoir une entrée pour chacun, réduite par la courbe de cet atlas.
  const byTexture = new Map<string, TexturePreview>();
  for (const preview of rt.context.metadata.texturePreviews ?? [])
    byTexture.set(`${preview.texture}/${preview.atlas}`, preview);
  const previewOf = (kind: 'color' | 'data', list: typeof maps) => (index: number) => {
    const source = rt.context.textureIndices?.get(list[index]);
    const atlas = kind === 'color' ? PREVIEW_ATLAS_COLOR : PREVIEW_ATLAS_DATA;
    return source === undefined ? undefined : byTexture.get(`${source}/${atlas}`);
  };
  const previewFor = previewOf('color', maps);
  const dataPreviewFor = previewOf('data', dataMaps);
  const readLevel = rt.context.readTextureLevel;
  // Deux classes par défaut : une texture 16×16 rangée dans l'atlas dimensionné sur la plus
  // grande occupe une couche entière — 872 359 272 octets sur Emerald, rendus pour 0,012 % de
  // pixels changés (`docs/SDK.md`). L'hôte redescend à une classe explicitement (`atlasClasses`).
  const maxClasses = rt.context.atlasClasses ?? 2;
  const colorAtlas = prepareWebgpuAtlas(gpuDevice, maps, uvScales, textureJobs, fallbackEncoder, {
    kind: 'color',
    format: 'rgba8unorm-srgb',
    maxClasses,
    fillFor: () => WHITE,
    errorCode: 'MATERIAL_COLOR_TEXTURE_UNAVAILABLE',
    previewFor,
    readLevel,
  });
  vis.colorAtlas = colorAtlas;
  const dataAtlas = prepareWebgpuAtlas(
    gpuDevice,
    dataMaps,
    dataUvScales,
    textureJobs,
    fallbackEncoder,
    {
      kind: 'data',
      format: 'rgba8unorm',
      maxClasses,
      fillFor: (source) =>
        source !== undefined && normalMaps.has(dataMaps[source]) ? FLAT_NORMAL : WHITE,
      errorCode: 'MATERIAL_DATA_TEXTURE_UNAVAILABLE',
      previewFor: dataPreviewFor,
      readLevel,
    },
  );
  gpuDevice.queue.submit([fallbackEncoder.finish()]);
  vis.dataAtlas = dataAtlas;
  vis.slots = createWebgpuAtlasSlots(gpuDevice, colorAtlas.slotWords, dataAtlas.slotWords);
  // La chaîne de mips du remplissage se fait une fois, avant la pompe : les niveaux progressifs
  // écrasent ensuite ceux de leur couche, et la pleine résolution les fait tous régénérer. Les
  // passes sont soumises, pas attendues : la file de l'appareil les exécute avant ce qui suit.
  for (const atlas of [colorAtlas, dataAtlas])
    for (const entry of atlas.classes) regenerateClassMips(gpuDevice, entry);
  rt.texturePump.pump();
  const scales = new Float32Array(Math.max(uvScales.length, dataUvScales.length) * 4);
  for (let i = 0; i < scales.length / 4; i++) {
    scales.set(dataUvScales[i] ?? [1, 1], i * 4);
    scales.set(uvScales[i] ?? [1, 1], i * 4 + 2);
  }
  vis.materialScales = gpuDevice.createBuffer({
    size: scales.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  gpuDevice.queue.writeBuffer(vis.materialScales, 0, scales);
  diag.engineDiagnostic('material-textures-ready', 'Textures et filtrage prêts', {
    color: atlasReport(colorAtlas, 'rgba8unorm-srgb', maps.length),
    data: atlasReport(dataAtlas, 'rgba8unorm', dataMaps.length),
    progressiveLevels: {
      version: TEXTURE_PREVIEW_VERSION,
      base: PREVIEW_BASE,
      withLevels: maps.filter((_map, index) => previewFor(index)).length,
      dataWithLevels: dataMaps.filter((_map, index) => dataPreviewFor(index)).length,
      // Les chaînes cuites en entier, que le moteur lit dans le cache sans jamais décoder la source.
      baked: [
        ...maps.map((_m, i) => previewFor(i)),
        ...dataMaps.map((_m, i) => dataPreviewFor(i)),
      ].filter((preview) => preview && previewIsWhole(preview) && readLevel).length,
      format: 'rgba8unorm-srgb',
    },
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
