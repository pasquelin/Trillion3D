import { viewProj } from './webgpuPagesHelpers.ts';
import { FLAG_UNLIT_VIEW } from './visibilityBuffer.ts';
import { writeBlendDiagnostic } from './webgpuBlendDiagnostic.ts';
import { directTiles } from './webgpuPagesEncodeLights.ts';
import { wantsContractLighting } from './webgpuPagesLightResources.ts';
import type { DiagnosticMode } from '../sdk-core/src/index.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Uniform stride of the fallback path, which keeps one record per primitive. */
export const UNIFORM_STRIDE = 256;
/** `viewProj`, the eye, lamp tiles, view flags, the item offset, the texture-feedback phase and
 *  three alignment words: 112 bytes. */
export const BLEND_VIEW_SIZE = 112;

/** Diagnostic bits that the WHOLE pass carries: they do not depend on the item. */
function diagnosticBits(diagnostic: DiagnosticMode) {
  if (diagnostic === 'beauty') return 0;
  const mode =
    diagnostic === 'wireframe'
      ? 0x20000000
      : diagnostic === 'clusters'
        ? 0x10000000
        : diagnostic === 'lod'
          ? 0x08000000
          : diagnostic === 'screen-error'
            ? 0x04000000
            : 0;
  return (0x40000000 | mode) >>> 0;
}

/**
 * VIEW uniform of the transparent pass: one hundred and twelve bytes, once per image.
 *
 * Everything that belonged to an item — its matrix, its colour, its six maps — now lives in the
 * record the shader reads at the rank the vertex index carries (`webgpuBlendItems.ts`). What
 * remains here is only what changes from one image to the next and holds for every item at once:
 * the projection, the eye, this image's lamp tiles and the diagnostic flags. No loop over items,
 * no allocation, a single buffer write.
 */
export function writeBlendView(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { run, blendState } = rt,
    buffer = blendState.viewBuffer;
  if (!buffer) return;
  const packed = blendState.viewPacked,
    ints = blendState.viewInts;
  const { diagnostic, lastCamera, diagnosticPixelError } = run,
    { viewport } = rt.setup;
  // The eye in world space, taken from the engine camera: the local position of a parented
  // camera is not where it looks.
  const eye = lastCamera ? run.gate.cam.eye : undefined;
  const tiles = directTiles();
  writeBlendDiagnostic(
    blendState,
    rt.layout.packedPages,
    diagnostic,
    eye && run.gate.cam,
    viewport,
    diagnosticPixelError,
  );
  packed.set(viewProj, 0);
  // The camera as one homogeneous point (`EngineCamera.viewPoint`): the shading's view vector
  // is `camPos.xyz − P·camPos.w` whatever the projection.
  const viewPoint = eye && run.gate.cam.viewPoint;
  packed[16] = viewPoint?.[0] ?? 0;
  packed[17] = viewPoint?.[1] ?? 0;
  packed[18] = viewPoint?.[2] ?? 0;
  packed[19] = viewPoint?.[3] ?? 1;
  // Lamp tiles of this image: without them the pixel loop falls back on the declared lamps.
  // Zero when no list has been encoded, never those of another image.
  packed[20] = tiles[1];
  packed[21] = tiles[2];
  // One question per image, not per mesh: is the image lit by declared lamps? If not, transparents
  // output their raw albedo, like the opaques (P6).
  ints[22] = ((wantsContractLighting(rt) ? 0 : FLAG_UNLIT_VIEW) | diagnosticBits(diagnostic)) >>> 0;
  ints[23] = blendState.vertexShift;
  // Texture-feedback phase: the same as the opaque resolve, this image.
  ints[24] = rt.vis.textures?.feedback.phaseWord(run.textureConverging) ?? 0;
  device.queue.writeBuffer(
    buffer,
    0,
    packed.buffer as ArrayBuffer,
    packed.byteOffset,
    BLEND_VIEW_SIZE,
  );
}
