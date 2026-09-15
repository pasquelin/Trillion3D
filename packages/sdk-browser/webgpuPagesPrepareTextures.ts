import { compteMateriauxEtTangentes } from './webgpuPagesCatalogue.ts';
import { prepareWebgpuGeometry } from './webgpuGeometryPrepare.ts';
import { collectWebgpuMaterialTextures } from './webgpuMaterialTextures.ts';
import { prepareWebgpuAtlas } from './webgpuAtlasCommon.ts';
import { createWebgpuAtlasSlots } from './webgpuAtlasSlots.ts';
import { ATLAS_CLASS_COUNT } from './webgpuAtlasClasses.ts';
import {
  PREVIEW_BASE,
  TEXTURE_PREVIEW_VERSION,
  previewFirstLevel,
  previewLastLevel,
  type TexturePreview,
} from '../sdk-core/index.ts';
import { generateMaterialMips, mipLevelCountFor } from './textureMips.ts';
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
  // Les niveaux progressifs du sidecar, rangés par la texture de la scène qu'ils couvrent.
  const byTexture = new Map<number, TexturePreview>();
  for (const preview of rt.context.metadata.texturePreviews ?? [])
    byTexture.set(preview.texture, preview);
  const previewFor = (index: number) => {
    const source = rt.context.textureIndices?.get(maps[index]);
    return source === undefined ? undefined : byTexture.get(source);
  };
  // Une seule classe par défaut : l'hôte demande la seconde explicitement (`atlasClasses`).
  const maxClasses = rt.context.atlasClasses ?? 1;
  const colorAtlas = prepareWebgpuAtlas(gpuDevice, maps, uvScales, textureJobs, fallbackEncoder, {
    kind: 'color',
    format: 'rgba8unorm-srgb',
    maxClasses,
    fillFor: () => WHITE,
    errorCode: 'MATERIAL_COLOR_TEXTURE_UNAVAILABLE',
    previewFor,
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
    },
  );
  gpuDevice.queue.submit([fallbackEncoder.finish()]);
  vis.dataAtlas = dataAtlas;
  vis.slots = createWebgpuAtlasSlots(gpuDevice, colorAtlas.slotWords, dataAtlas.slotWords);
  vis.slotPyramids = maps.map((_map, index) => {
    const preview = previewFor(index);
    if (!preview) return undefined;
    return {
      first: previewFirstLevel(preview.width, preview.height),
      last: previewLastLevel(preview.width, preview.height),
    };
  });
  // La chaîne de mips du remplissage se fait une fois, avant la pompe : les niveaux progressifs
  // écrasent ensuite ceux de leur couche, et la pleine résolution les fait tous régénérer.
  for (const atlas of [colorAtlas, dataAtlas])
    for (const entry of atlas.classes)
      await generateMaterialMips(
        gpuDevice,
        entry.texture,
        entry.texture.format,
        ...entry.size,
        entry.scales,
      );
  await rt.texturePump.pump();
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
      withLevels: vis.slotPyramids.filter(Boolean).length,
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
