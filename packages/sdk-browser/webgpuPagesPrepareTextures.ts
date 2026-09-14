import { prepareWebgpuGeometry } from './webgpuGeometryPrepare.ts';
import { collectWebgpuMaterialTextures } from './webgpuMaterialTextures.ts';
import { prepareWebgpuColorAtlas } from './webgpuColorAtlas.ts';
import { prepareWebgpuDataAtlas } from './webgpuDataAtlas.ts';
import { generateMaterialMips } from './textureMips.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

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
  const { maps, dataMaps, normalMaps } = collectWebgpuMaterialTextures(
    allPages,
    blendCopies,
    mapLayer,
    dataLayer,
  );
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
  const colorAtlas = prepareWebgpuColorAtlas(gpuDevice, maps, uvScales, textureJobs);
  vis.mapsTexture = colorAtlas.mapsTexture;
  vis.textureColorSize = [colorAtlas.maxW, colorAtlas.maxH];
  const { maxW, maxH, fallbackEncoder } = colorAtlas;
  const dataAtlas = prepareWebgpuDataAtlas(
    gpuDevice,
    dataMaps,
    normalMaps,
    dataUvScales,
    textureJobs,
    fallbackEncoder,
  );
  vis.dataMapsTexture = dataAtlas.dataMapsTexture;
  vis.textureDataSize = [dataAtlas.dataW, dataAtlas.dataH];
  const { dataW, dataH } = dataAtlas;
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
      mipLevels: 1 + Math.floor(Math.log2(Math.max(maxW, maxH))),
      format: 'rgba8unorm-srgb',
    },
    data: {
      count: dataMaps.length,
      size: [dataW, dataH],
      mipLevels: 1 + Math.floor(Math.log2(Math.max(dataW, dataH))),
      format: 'rgba8unorm',
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
