import { viewProj } from '../pages/helpers.ts'
import { pixelFootprintOf } from '../../streaming/priority.ts'
import { renderMipBias, renderPixelRatio } from '../pages/state/renderScale.ts'
import {
  FLAG_DIAGNOSTIC_CLUSTERS,
  FLAG_DIAGNOSTIC_LOD,
  FLAG_DIAGNOSTIC_SCREEN_ERROR,
  FLAG_DIAGNOSTIC_VIEW,
  FLAG_DIAGNOSTIC_WIREFRAME,
  FLAG_UNLIT_VIEW,
} from '../../visibility/buffer.ts'
import { writeBlendDiagnostic } from './diagnostic.ts'
import { stillTurn } from '../../taa/frameState.ts'
import { directTiles } from '../pages/render/encodeLights.ts'
import { wantsContractLighting } from '../pages/prepare/lightResources.ts'
import type { DiagnosticMode } from '../../../../sdk-core/src/index.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { BLEND_VIEW_SIZE, VIEW } from './viewLayout.ts'

/** Diagnostic bits that the WHOLE pass carries: they do not depend on the item. */
function diagnosticBits(diagnostic: DiagnosticMode) {
  if (diagnostic === 'beauty') return 0
  const mode =
    diagnostic === 'wireframe'
      ? FLAG_DIAGNOSTIC_WIREFRAME
      : diagnostic === 'clusters'
        ? FLAG_DIAGNOSTIC_CLUSTERS
        : diagnostic === 'lod'
          ? FLAG_DIAGNOSTIC_LOD
          : diagnostic === 'screen-error'
            ? FLAG_DIAGNOSTIC_SCREEN_ERROR
            : 0
  return (FLAG_DIAGNOSTIC_VIEW | mode) >>> 0
}

/**
 * VIEW uniform of the transparent pass (`viewLayout.ts`): one hundred and forty-four bytes, once
 * per image.
 *
 * Everything that belonged to an item — its matrix, its colour, its six maps — now lives in the
 * record the shader reads at the rank the vertex index carries (`items.ts`). What
 * remains here is only what changes from one image to the next and holds for every item at once:
 * the projection, the eye, this image's lamp tiles and the diagnostic flags. No loop over items,
 * no allocation, a single buffer write.
 */
export function writeBlendView(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { run, blendState } = rt,
    buffer = blendState.viewBuffer
  if (!buffer) return
  const packed = blendState.viewPacked
  const { diagnostic, lastCamera, diagnosticPixelError } = run
  // The eye in world space, taken from the engine camera: the local position of a parented
  // camera is not where it looks.
  const eye = lastCamera ? run.gate.cam.eye : undefined
  const tiles = directTiles()
  writeBlendDiagnostic(
    blendState,
    rt.layout.packedPages,
    rt.layout.selectionRoots,
    rt.layout.placement.rootOfPacked,
    diagnostic,
    eye && run.gate.cam,
    rt.setup.viewport,
    diagnosticPixelError,
  )
  packed.set(viewProj, VIEW.viewProj)
  // The camera as one homogeneous point (`EngineCamera.viewPoint`): the shading's view vector
  // is `camPos.xyz − P·camPos.w` whatever the projection.
  const viewPoint = eye && run.gate.cam.viewPoint
  packed[VIEW.camPos] = viewPoint?.[0] ?? 0
  packed[VIEW.camPos + 1] = viewPoint?.[1] ?? 0
  packed[VIEW.camPos + 2] = viewPoint?.[2] ?? 0
  packed[VIEW.camPos + 3] = viewPoint?.[3] ?? 1
  // Lamp tiles of this image: without them the pixel loop falls back on the declared lamps.
  // Zero when no list has been encoded, never those of another image.
  packed[VIEW.lightTiles] = tiles[1]
  packed[VIEW.lightTiles + 1] = tiles[2]
  // A pixel's world size per unit of distance — or its size, under an orthographic camera —:
  // the footprint the transparent surface reads its shadow level at.
  // A display pixel's, whatever size the frame is drawn at: shadow detail is the display's.
  packed[VIEW.pixelScale] = eye
    ? pixelFootprintOf(run.gate.cam.projection, rt.gpu.displaySize[1])
    : 0
  writeViewFrame(rt, tiles)
  device.queue.writeBuffer(
    buffer,
    0,
    packed.buffer as ArrayBuffer,
    packed.byteOffset,
    BLEND_VIEW_SIZE,
  )
}

/** The view's words this image sets past its camera and its lamp tiles: the flags, the
 *  texture-feedback phase, the target, the fog's eye, the noise turn, the pixel ratio, the
 *  texture level offset and the display curve. */
function writeViewFrame(rt: WebgpuPagesRuntime, tiles: ReturnType<typeof directTiles>) {
  const { run, blendState } = rt,
    packed = blendState.viewPacked,
    ints = blendState.viewInts
  // One question per image, not per mesh: is the image lit by declared lamps? If not, transparents
  // output their raw albedo, like the opaques (P6).
  ints[VIEW.viewFlags] =
    ((wantsContractLighting(rt) ? 0 : FLAG_UNLIT_VIEW) | diagnosticBits(run.diagnostic)) >>> 0
  ints[VIEW.vertexShift] = blendState.vertexShift
  // Texture-feedback phase: the same as the opaque resolve, this image.
  ints[VIEW.feedback] = rt.vis.textures?.feedback.phaseWord(run.textureConverging) ?? 0
  // The size in pixels of the target both surface passes draw into: the vertex stage's facing test
  // measures a triangle's area against the rasteriser's snapping there (`facing.ts`).
  packed[VIEW.viewport] = rt.gpu.targetSize[0]
  packed[VIEW.viewport + 1] = rt.gpu.targetSize[1]
  // The eye the fog is measured from, the opaque resolve's (`encodeLights.ts`), written by value:
  // no `subarray` view allocated per frame.
  packed[VIEW.eye] = tiles[5]
  packed[VIEW.eye + 1] = tiles[6]
  packed[VIEW.eye + 2] = tiles[7]
  // The turn the blended surfaces' noise takes this image (`translucentReflectionOffset`).
  packed[VIEW.frameNoise] = stillTurn(rt.gpu.temporal?.frame)
  // Render pixels per CSS pixel: a line's width counts CSS pixels (`lineClip`).
  packed[VIEW.pixelRatio] = renderPixelRatio(rt)
  // Texture level offset of a frame drawn below the display (`tilePoolWgsl`).
  packed[VIEW.mipBias] = renderMipBias(rt)
  // The composition's exposure and display curve: the display filter's colour (`displayFilter.ts`).
  packed[VIEW.exposure] = tiles[3]
  ints[VIEW.toneCurve] = tiles[4]
}
