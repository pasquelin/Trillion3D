import { prepareWebgpuGeometry } from './webgpuGeometryPrepare.ts';
import { collectWebgpuMaterialTextures } from './webgpuMaterialTextures.ts';
import { prepareWebgpuAtlas } from './webgpuAtlasCommon.ts';
import { prepareWebgpuPreviewAtlas } from './webgpuPreviewAtlas.ts';
import { PREVIEW_LEVEL_SIZES, TEXTURE_PREVIEW_VERSION } from '../sdk-core/index.ts';
import { generateMaterialMips, mipLevelCountFor } from './textureMips.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const FLAT_NORMAL = { r: 128 / 255, g: 128 / 255, b: 1, a: 1 };

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
  diag.engineDiagnostic('material-textures', 'Textures nécessaires au rendu', {
    colorTextures: maps.length,
    dataTextures: dataMaps.length,
    materials: new Set(allPages.map((page) => page.material)).size,
    opaquePages: allPages.length,
    forwardMeshes: blendCopies.length,
    geometryWithTangents: [...geometryBlocks.values()].filter((block) => block.hasTangent).length,
    geometryWithoutTangents: [...geometryBlocks.values()].filter((block) => !block.hasTangent)
      .length,
  });
  const textureStarted = performance.now();
  const fallbackEncoder = gpuDevice.createCommandEncoder();
  const colorAtlas = prepareWebgpuAtlas(gpuDevice, maps, uvScales, textureJobs, fallbackEncoder, {
    kind: 'color',
    format: 'rgba8unorm-srgb',
    fillFor: () => WHITE,
    errorCode: 'MATERIAL_COLOR_TEXTURE_UNAVAILABLE',
  });
  vis.mapsTexture = colorAtlas.texture;
  vis.textureColorSize = [colorAtlas.width, colorAtlas.height];
  // L'aperçu se tient prêt avant le premier transfert : sans lui la première image serait blanche.
  vis.preview = prepareWebgpuPreviewAtlas(
    gpuDevice,
    maps,
    rt.context.textureIndices,
    rt.context.metadata.texturePreviews,
  );
  const { width: maxW, height: maxH } = colorAtlas;
  const dataAtlas = prepareWebgpuAtlas(
    gpuDevice,
    dataMaps,
    dataUvScales,
    textureJobs,
    fallbackEncoder,
    {
      kind: 'data',
      format: 'rgba8unorm',
      fillFor: (layer) => (normalMaps.has(dataMaps[layer - 1]) ? FLAT_NORMAL : WHITE),
      errorCode: 'MATERIAL_DATA_TEXTURE_UNAVAILABLE',
    },
  );
  gpuDevice.queue.submit([fallbackEncoder.finish()]);
  vis.dataMapsTexture = dataAtlas.texture;
  vis.textureDataSize = [dataAtlas.width, dataAtlas.height];
  const { width: dataW, height: dataH } = dataAtlas;
  await generateMaterialMips(gpuDevice, vis.mapsTexture, 'rgba8unorm-srgb', maxW, maxH, uvScales);
  await generateMaterialMips(
    gpuDevice,
    vis.dataMapsTexture,
    'rgba8unorm',
    dataW,
    dataH,
    dataUvScales,
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
    color: {
      count: maps.length,
      size: [maxW, maxH],
      mipLevels: mipLevelCountFor(maxW, maxH),
      format: 'rgba8unorm-srgb',
    },
    data: {
      count: dataMaps.length,
      size: [dataW, dataH],
      mipLevels: mipLevelCountFor(dataW, dataH),
      format: 'rgba8unorm',
    },
    previews: {
      version: TEXTURE_PREVIEW_VERSION,
      layers: maps.length + 1,
      withPreview: vis.preview.withPreview,
      size: [PREVIEW_LEVEL_SIZES[0], PREVIEW_LEVEL_SIZES[0]],
      levels: PREVIEW_LEVEL_SIZES.length,
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
