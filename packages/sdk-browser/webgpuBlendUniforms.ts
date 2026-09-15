import { viewProj } from './webgpuPagesHelpers.ts';
import { visMaterial } from './visibilityBuffer.ts';
import { writeBlendDiagnostic } from './webgpuBlendDiagnostic.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

export const UNIFORM_STRIDE = 256;
/** Longueur de la direction de lampe par défaut : une constante, pas une racine par image. */
const LONGUEUR_LAMPE = Math.hypot(1, 3, 2);

/** Populates and uploads the transparent draw uniforms for one image. */
export function writeBlendUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  uniformBase: number,
  textured: boolean,
) {
  const { run, vis } = rt,
    items = rt.blendState.visibleBlend,
    { uniformPacked } = rt.gpu,
    uniformBuffer = rt.gpu.uniformBuffer!,
    { diagnostic, lastCamera, diagnosticPixelError } = run,
    { viewport } = rt.setup,
    { mapLayer, dataLayer, uvScales } = vis;
  const packedInts = new Uint32Array(
    uniformPacked.buffer,
    uniformPacked.byteOffset,
    uniformPacked.length,
  );
  const cam = lastCamera?.position;
  const lLen = LONGUEUR_LAMPE;
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      base = (uniformBase + i) * (UNIFORM_STRIDE / 4),
      mat = visMaterial(item.material);
    writeBlendDiagnostic(device, item, diagnostic, lastCamera, viewport, diagnosticPixelError);
    const layer = item.map && mapLayer.has(item.map) ? mapLayer.get(item.map)! : 0,
      scale = uvScales[layer] ?? [1, 1];
    uniformPacked.set(viewProj.elements, base);
    uniformPacked.set(item.matrix.elements, base + 16);
    uniformPacked[base + 32] = item.rgba[0];
    uniformPacked[base + 33] = item.rgba[1];
    uniformPacked[base + 34] = item.rgba[2];
    uniformPacked[base + 35] = item.rgba[3];
    packedInts[base + 36] = 0;
    packedInts[base + 37] = item.count;
    packedInts[base + 38] = textured ? layer : diagnostic === 'wireframe' ? 1 : 0;
    packedInts[base + 39] =
      item.flags |
      (diagnostic !== 'beauty' ? 0x40000000 : 0) |
      (diagnostic === 'wireframe'
        ? 0x20000000
        : diagnostic === 'clusters'
          ? 0x10000000
          : diagnostic === 'lod'
            ? 0x08000000
            : diagnostic === 'screen-error'
              ? 0x04000000
              : 0);
    uniformPacked[base + 40] = scale[0];
    uniformPacked[base + 41] = scale[1];
    packedInts[base + 42] = mat.emissiveMap ? (mapLayer.get(mat.emissiveMap) ?? 0) : 0;
    uniformPacked[base + 43] = mat.alphaTest;
    uniformPacked[base + 52] = mat.roughness;
    uniformPacked[base + 53] = mat.metalness;
    uniformPacked[base + 54] = mat.normalScale;
    uniformPacked[base + 55] = mat.normalScaleY;
    packedInts[base + 56] = mat.roughnessMap ? (dataLayer.get(mat.roughnessMap) ?? 0) : 0;
    packedInts[base + 57] = mat.metalnessMap ? (dataLayer.get(mat.metalnessMap) ?? 0) : 0;
    packedInts[base + 58] = mat.normalMap ? (dataLayer.get(mat.normalMap) ?? 0) : 0;
    packedInts[base + 59] = mat.aoMap ? (dataLayer.get(mat.aoMap) ?? 0) : 0;
    uniformPacked[base + 60] = mat.aoIntensity;
    uniformPacked.set(mat.emissive, base + 61);
    uniformPacked[base + 44] = cam?.x ?? 0;
    uniformPacked[base + 45] = cam?.y ?? 0;
    uniformPacked[base + 46] = cam?.z ?? 0;
    uniformPacked[base + 47] = 1;
    uniformPacked[base + 48] = 1 / lLen;
    uniformPacked[base + 49] = 3 / lLen;
    uniformPacked[base + 50] = 2 / lLen;
    uniformPacked[base + 51] = 2.5;
  }
  device.queue.writeBuffer(
    uniformBuffer,
    uniformBase * UNIFORM_STRIDE,
    uniformPacked.subarray(
      uniformBase * (UNIFORM_STRIDE / 4),
      (uniformBase + items.length) * (UNIFORM_STRIDE / 4),
    ),
  );
}
