import { viewProj } from '../pages/helpers.ts';
import { pixelFootprintOf } from '../../streaming/priority.ts';
import { renderMipBias, renderPixelRatio } from '../pages/state/renderScale.ts';
import { FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts';
import { writeBlendDiagnostic } from './diagnostic.ts';
import { directTiles } from '../pages/render/encodeLights.ts';
import { wantsContractLighting } from '../pages/prepare/lightResources.ts';
import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Uniform stride of the fallback path, which keeps one record per primitive. */
export const UNIFORM_STRIDE = 256;
/** Word offsets in the fallback shader's 48-word record (the stride includes alignment). */
export const FALLBACK_UNIFORM = {
  projection: 0,
  world: 16,
  color: 32,
  opacity: 35,
  pageOffset: 36,
  indexCount: 37,
  mode: 38,
  identity: 39,
  lineWidth: 40,
  pixelRatio: 41,
  width: 42,
  height: 43,
  dash: 44,
  gap: 45,
  sprite: 46,
  spriteMode: 47,
} as const;

type FallbackFields = {
  projection: ArrayLike<number>;
  world: ArrayLike<number>;
  color: ArrayLike<number>;
  opacity: number;
  pageOffset: number;
  indexCount: number;
  mode: number;
  /** Opaque cluster hash or transparent flags: diagnostics retain their existing identity. */
  identity: number;
  lineWidth?: number;
  pixelRatio?: number;
  width?: number;
  height?: number;
  dash?: number;
  gap?: number;
  spriteRotation?: number;
  spriteMode?: number;
};

/** Packs both fallback paths. Disabled line/sprite words are reset when records are reused. */
export function writeFallbackUniform(
  packed: Float32Array,
  ints: Uint32Array,
  base: number,
  fields: FallbackFields,
) {
  const word = FALLBACK_UNIFORM;
  packed.set(fields.projection, base + word.projection);
  packed.set(fields.world, base + word.world);
  for (let i = 0; i < 3; i++) packed[base + word.color + i] = fields.color[i];
  packed[base + word.opacity] = fields.opacity;
  ints[base + word.pageOffset] = fields.pageOffset;
  ints[base + word.indexCount] = fields.indexCount;
  ints[base + word.mode] = fields.mode;
  ints[base + word.identity] = fields.identity;
  packed[base + word.lineWidth] = fields.lineWidth ?? 0;
  packed[base + word.pixelRatio] = fields.pixelRatio ?? 0;
  packed[base + word.width] = fields.width ?? 0;
  packed[base + word.height] = fields.height ?? 0;
  packed[base + word.dash] = fields.dash ?? 0;
  packed[base + word.gap] = fields.gap ?? 0;
  packed[base + word.sprite] = fields.spriteRotation ?? 0;
  packed[base + word.spriteMode] = fields.spriteMode ?? 0;
}

/** `viewProj`, the view point, lamp tiles, view flags, the item offset, the texture-feedback
 *  phase, the pixel scale, the target size, the eye, the render pixel ratio and the texture level
 *  offset: 136 bytes, 144 with the struct's alignment. */
export const BLEND_VIEW_SIZE = 144;

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
 * VIEW uniform of the transparent pass: one hundred and forty-four bytes, once per image.
 *
 * Everything that belonged to an item — its matrix, its colour, its six maps — now lives in the
 * record the shader reads at the rank the vertex index carries (`items.ts`). What
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
  // A pixel's world size per unit of distance — or its size, under an orthographic camera —:
  // the footprint the transparent surface reads its shadow level at.
  // A display pixel's, whatever size the frame is drawn at: shadow detail is the display's.
  packed[25] = eye ? pixelFootprintOf(run.gate.cam.projection, rt.gpu.displaySize[1]) : 0;
  // The size in pixels of the target both surface passes draw into: the vertex stage's facing test
  // measures a triangle's area against the rasteriser's snapping there (`facing.ts`).
  packed[26] = rt.gpu.targetSize[0];
  packed[27] = rt.gpu.targetSize[1];
  // The eye the fog is measured from, the opaque resolve's (`encodeLights.ts`), written by value:
  // no `subarray` view allocated per frame.
  packed[28] = tiles[5];
  packed[29] = tiles[6];
  packed[30] = tiles[7];
  // Render pixels per CSS pixel: a line's width counts CSS pixels (`lineClip`).
  packed[32] = renderPixelRatio(rt);
  // Texture level offset of a frame drawn below the display (`tilePoolWgsl`).
  packed[33] = renderMipBias(rt);
  device.queue.writeBuffer(
    buffer,
    0,
    packed.buffer as ArrayBuffer,
    packed.byteOffset,
    BLEND_VIEW_SIZE,
  );
}
