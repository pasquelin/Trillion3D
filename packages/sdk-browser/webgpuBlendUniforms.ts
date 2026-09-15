import { viewProj } from './webgpuPagesHelpers.ts';
import { FLAG_UNLIT_VIEW, visMaterial } from './visibilityBuffer.ts';
import { writeBlendDiagnostic } from './webgpuBlendDiagnostic.ts';
import { wantsContractLighting } from './webgpuPagesLightResources.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

export const UNIFORM_STRIDE = 256;

/** Populates and uploads the transparent draw uniforms for one image. */
export function writeBlendUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  uniformBase: number,
  textured: boolean,
) {
  const { run, vis, blendState } = rt,
    items = blendState.visibleBlend,
    table = blendState.table,
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
  // Une seule question par image, pas par maillage : l'image est-elle éclairée par des lampes
  // déclarées ? Sinon les transparents sortent leur albédo brut, comme les opaques (P6).
  const unlit = wantsContractLighting(rt) ? 0 : FLAG_UNLIT_VIEW;
  writeBlendDiagnostic(
    blendState,
    rt.layout.packedPages,
    diagnostic,
    lastCamera,
    viewport,
    diagnosticPixelError,
  );
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      base = (uniformBase + i) * (UNIFORM_STRIDE / 4),
      mat = visMaterial(item.material);
    const layer = item.map && mapLayer.has(item.map) ? mapLayer.get(item.map)! : 0,
      scale = uvScales[layer] ?? [1, 1];
    uniformPacked.set(viewProj.elements, base);
    uniformPacked.set(item.matrix.elements, base + 16);
    uniformPacked[base + 32] = item.rgba[0];
    uniformPacked[base + 33] = item.rgba[1];
    uniformPacked[base + 34] = item.rgba[2];
    uniformPacked[base + 35] = item.rgba[3];
    // A paged item reads its cluster list from `instanceBuffer` at its own base; an unpaged one
    // reads its own index buffer from the start.
    packedInts[base + 36] =
      item.paged && table && item.pagedIndex !== undefined
        ? table.itemRanges[item.pagedIndex * 2]
        : 0;
    packedInts[base + 37] = item.count;
    packedInts[base + 38] = textured ? layer : diagnostic === 'wireframe' ? 1 : 0;
    packedInts[base + 39] =
      item.flags |
      unlit |
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
    uniformPacked[base + 44] = cam?.x ?? 0;
    uniformPacked[base + 45] = cam?.y ?? 0;
    uniformPacked[base + 46] = cam?.z ?? 0;
    uniformPacked[base + 47] = 1;
    uniformPacked[base + 48] = mat.roughness;
    uniformPacked[base + 49] = mat.metalness;
    uniformPacked[base + 50] = mat.normalScale;
    uniformPacked[base + 51] = mat.normalScaleY;
    packedInts[base + 52] = mat.roughnessMap ? (dataLayer.get(mat.roughnessMap) ?? 0) : 0;
    packedInts[base + 53] = mat.metalnessMap ? (dataLayer.get(mat.metalnessMap) ?? 0) : 0;
    packedInts[base + 54] = mat.normalMap ? (dataLayer.get(mat.normalMap) ?? 0) : 0;
    packedInts[base + 55] = mat.aoMap ? (dataLayer.get(mat.aoMap) ?? 0) : 0;
    uniformPacked[base + 56] = mat.aoIntensity;
    uniformPacked.set(mat.emissive, base + 57);
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
