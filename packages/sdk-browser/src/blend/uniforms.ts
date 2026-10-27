import { viewProj } from '../frame/backend/helpers.ts'
import { writeDividedVector3 } from '../../../math/src/vector/vector.ts'
import { renderMipBias, renderPixelRatio } from '../frame/backend/state/renderScale.ts'
import {
  DIAGNOSTIC_CODE_SHIFT,
  FLAG_DIAGNOSTIC_VIEW,
  FLAG_UNLIT_VIEW,
} from '../visibility/types.ts'
import { diagnosticCode, drawsLit } from '../visibility/shader/shadeMode.ts'
import { writeBlendDiagnostic } from './diagnostic.ts'
import { directTiles } from '../frame/render/encodeLights.ts'
import { DIRECT_AT } from '../lighting/deferred/view.ts'
import { wantsContractLighting } from '../frame/prepare/lit.ts'
import type { DiagnosticMode } from '../../../sdk-core/src/runtime/diagnostics.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { BLEND_VIEW_SIZE, VIEW } from './viewLayout.ts'
import { writeViewClipPlane } from '../frame/render/viewClip.ts'
import {
  SHADING,
  markShadingDrawn,
  switchOn,
  writeNormalCurvature,
} from '../materials/surface/pixelModel.ts'
import { writeTranslucencyVolumeView } from '../lighting/translucency/frame.ts'
import { writeTranslucencyGiView } from '../lighting/translucencyGi/frame.ts'
import { holdoutOn } from '../frame/prepare/alphaHoldout.ts'

/** Diagnostic bits that the WHOLE pass carries: they do not depend on the item. None for beauty
 *  and a view of the lit image, which the transparents light as beauty (`drawsLit`). */
const diagnosticBits = (diagnostic: DiagnosticMode) =>
  drawsLit(diagnostic)
    ? 0
    : (FLAG_DIAGNOSTIC_VIEW | (diagnosticCode(diagnostic) << DIAGNOSTIC_CODE_SHIFT)) >>> 0

/**
 * VIEW uniform of the transparent pass (`viewLayout.ts`): one hundred and ninety-two bytes, once
 * per image.
 *
 * Everything that belonged to an item — its matrix, its colour, its six maps — now lives in the
 * record the shader reads at the rank the vertex index carries (`items.ts`). What
 * remains here is only what changes from one image to the next and holds for every item at once:
 * the projection, the eye, this image's lamp tiles and the diagnostic view. No loop over items,
 * no allocation, a single buffer write.
 */
export function writeBlendView(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { run, blendState } = rt,
    buffer = blendState.viewBuffer
  if (!buffer) return
  const packed = blendState.viewPacked
  const { diagnostic, lastCamera } = run
  // The eye in world space, taken from the engine camera: the local position of a parented
  // camera is not where it looks.
  const eye = lastCamera ? run.gate.cam.eye : undefined
  const tiles = directTiles()
  writeBlendDiagnostic(blendState, rt.layout.packedPages, diagnostic)
  packed.set(viewProj, VIEW.viewProj)
  // The camera as one homogeneous point (`EngineCamera.viewPoint`): the shading's view vector
  // is `camPos.xyz − P·camPos.w` whatever the projection.
  const viewPoint = eye && run.gate.cam.viewPoint
  packed[VIEW.camPos] = viewPoint?.[0] ?? 0
  packed[VIEW.camPos + 1] = viewPoint?.[1] ?? 0
  packed[VIEW.camPos + 2] = viewPoint?.[2] ?? 0
  packed[VIEW.camPos + 3] = viewPoint?.[3] ?? 1
  writeDistortionView(rt)
  // Lamp tiles of this image: without them the pixel loop falls back on the declared lamps.
  // Zero when no list has been encoded, never those of another image.
  packed[VIEW.lightTiles] = tiles[1]
  packed[VIEW.lightTiles + 1] = tiles[2]
  writeViewFrame(rt, tiles)
  device.queue.writeBuffer(
    buffer,
    0,
    packed.buffer as ArrayBuffer,
    packed.byteOffset,
    BLEND_VIEW_SIZE,
  )
}

/** The unit axis of column `column` of the camera's world matrix `world`, at word `at`. */
function writeAxis(packed: Float32Array, at: number, world: Float64Array, column: number) {
  writeDividedVector3(packed, at, world[column], world[column + 1], world[column + 2])
}

/** The camera's axes, the distortion parameters and the render matrix's clip-w row
 *  (`viewLayout.ts`), once an image on the CPU: what every refracting fragment reads alike. */
function writeDistortionView(rt: WebgpuPagesRuntime) {
  const packed = rt.blendState.viewPacked,
    cam = rt.run.gate.cam,
    world = cam.world,
    [width, height] = rt.gpu.targetSize,
    [displayWidth, displayHeight] = rt.gpu.displaySize
  writeAxis(packed, VIEW.viewRight, world, 0)
  writeAxis(packed, VIEW.viewUp, world, 4)
  // The distortion parameters, the offsets' scale from view normal to screen fraction: M[0][0]
  // by the UNSCALED view's width, M[0][0] by the aspect by its height — a lower render scale bends
  // the scene as far as the display's.
  const m00 = cam.projection[0]
  packed[VIEW.viewRight + 3] = m00 * displayWidth
  packed[VIEW.viewUp + 3] = (height > 0 ? width / height : 1) * m00 * displayHeight
  for (let i = 0; i < 4; i++) packed[VIEW.clipW + i] = viewProj[i * 4 + 3]
}

/** The view's words this image sets past its camera and its lamp tiles: the flags, the
 *  texture-feedback phase, the target, the fog's eye, the pixel ratio, the
 *  texture level offset, the display curve and the colours the tone table gives. */
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
  // Render pixels per CSS pixel: a line's width counts CSS pixels (`lineClip`).
  packed[VIEW.pixelRatio] = renderPixelRatio(rt)
  // Texture level offset of a frame drawn below the display (`tilePoolWgsl`).
  packed[VIEW.mipBias] = renderMipBias(rt)
  // The composition's scale and display curve: the display filter's colour (`display/displayFilter.ts`);
  // and the pre-exposure every light is written multiplied by.
  packed[VIEW.exposure] = tiles[DIRECT_AT.shown]
  packed[VIEW.preExposure] = tiles[DIRECT_AT.preExposure]
  ints[VIEW.toneCurve] = tiles[4]
  // The colours the tone table gives, for the layers drawn on display values (`displayRoute`): the
  // baking's words, baked before the image's transparents are bound (`encodeSurfaceLighting`).
  const bake = rt.gpu.deferred?.toneLut.words
  if (bake) packed.set(bake, VIEW.bake)
  // The cut's threshold the screen-error view measures against (`diagnosticScreenError`).
  packed[VIEW.pixelError] = run.diagnosticPixelError
  // What a material graph reads of the clocks, the opaque resolve's (`../visibility/passes/uniforms.ts`).
  packed[VIEW.time] = run.graphClocks.time
  packed[VIEW.realTime] = run.graphClocks.realTime
  // Whether a clear coat keeps a bottom normal, the opaque resolve's (`../visibility/passes/uniforms.ts`).
  ints[VIEW.clearCoatNormal] = switchOn(run.shading[SHADING.switches], 'clearCoatNormal')
  // Whether the surfaces' diffuse light is the rough diffuse (`shadingRoughDiffuse`).
  ints[VIEW.roughDiffuse] = switchOn(run.shading[SHADING.switches], 'roughDiffuse')
  // Whether the specular lobes' visibility is the exact one (`shadingAccurate`).
  ints[VIEW.shadingAccurate] = switchOn(run.shading[SHADING.switches], 'accurate')
  // The view's clip plane: every vertex stage cuts its primitives by it (`../gpu/core/clipDistances.ts`).
  writeViewClipPlane(rt, run.gate.cam, packed, VIEW.clipPlane)
  // The translucency lighting volume this image built, where the surfaces lit from it read it.
  writeTranslucencyVolumeView(rt, packed, VIEW.volumeCorner, VIEW.volumeScale, VIEW.volumeRead)
  // The translucency global illumination volume this image built, where the surfaces read their indirect light.
  writeTranslucencyGiView(rt, packed, VIEW.giGrid, VIEW.giZ)
  // The alpha holdout, which the layers of a held-out primitive read.
  ints[VIEW.holdout] = holdoutOn(rt) ? 1 : 0
  // The curve a material's normal curvature takes its roughness by, the opaque resolve's.
  writeNormalCurvature(run.shading, packed, VIEW.normalCurvature)
  markShadingDrawn(run)
}
