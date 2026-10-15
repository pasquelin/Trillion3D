/**
 * THE PROJECTION'S VIEW UNIFORM, WRITTEN (`projectionPass.ts`): its header from the camera — the
 * shifted view, its clip and their inverses, the depth and screen words — and each light's record.
 */
import { LIGHT_KIND } from '../../../sdk-core/src/scene/light/contracts.ts'
import { NO_CONE } from '../../../sdk-core/src/scene/light/fields.ts'
import { screenSlab } from '../gpu/hiz/screenSlab.ts'
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import {
  copyMatrix4,
  multiplyMatrix4,
  negateColumnMatrix4,
  negateRowMatrix4,
} from '../../../math/src/matrix/matrix4.ts'
import { matrixAtRenderOrigin } from '../../../math/src/projection/renderOrigin.ts'
import { vsmWriteDepthFromDeviceZ } from './constants.ts'
import {
  VSM_PROJECTION_HEADER_WORDS,
  VSM_PROJECTION_LIGHT_WORD,
  VSM_PROJECTION_LIGHT_WORDS,
  VSM_PROJECTION_MAX_PASS_LIGHTS,
  VSM_PROJECTION_VIEW_WORD,
} from './projectionView.ts'
import type { VsmProjectionInputs, VsmProjectionLight } from './projectionPass.ts'

type VsmProjectionLightType = VsmProjectionLight['type']

const KIND: Record<VsmProjectionLightType, number> = {
  directional: LIGHT_KIND.directional,
  point: LIGHT_KIND.point,
  spot: LIGHT_KIND.spot,
  rect: LIGHT_KIND.rect,
}

const scratch = {
  view: new Float64Array(16),
  shiftedToView: new Float64Array(16),
  viewToClip: new Float64Array(16),
  shiftedToClip: new Float64Array(16),
  clipToShifted: new Float64Array(16),
  viewInverse: new Float64Array(16),
  shift: new Float64Array(3),
  /** The shift negated: the point `T(originShift)` takes to the world origin. */
  origin: new Float64Array(3),
}

/** The words of a view uniform's staging image, as floats, unsigned and signed integers. */
export interface ViewWords {
  f: Float32Array
  u: Uint32Array
  i: Int32Array
}

/** A light's position where it has none (a sun). */
const ORIGIN = [0, 0, 0] as const

/** What the view's header is written from (`VsmProjectionInputs`). */
type ViewInputs = Pick<VsmProjectionInputs, 'width' | 'height' | 'camera' | 'frameIndex'>

/** The view's matrices into `scratch`: its inverse — the eye its translation (words 12-14) —, the
 *  origin shift, and the shifted-to-view, view-to-clip, shifted-to-clip matrices and its inverse. */
function viewMatrices(camera: ViewInputs['camera']) {
  const s = scratch
  copyMatrix4(s.view, camera.view)
  invertMatrix4(s.viewInverse, s.view)
  // The eye: the inverse view's translation (words 12-14).
  const eye = s.viewInverse,
    shift = s.shift
  for (let k = 0; k < 3; k++) {
    shift[k] = camera.originShift ? camera.originShift[k] : -eye[12 + k]
    s.origin[k] = -shift[k]
  }
  // shiftedToView = flipZ · view · T(originShift): the view at the render origin −shift, its z row
  // negated.
  matrixAtRenderOrigin(s.shiftedToView, s.view, s.origin)
  negateRowMatrix4(s.shiftedToView, s.shiftedToView, 2)
  // viewToClip = projection · flipZ: its z column negated.
  negateColumnMatrix4(s.viewToClip, camera.projection, 2)
  multiplyMatrix4(s.shiftedToClip, s.viewToClip, s.shiftedToView)
  invertMatrix4(s.clipToShifted, s.shiftedToClip)
}

/** The view's header from the matrices of `scratch` (`viewMatrices`), its light `count` included,
 *  the screen's words after it (`writeScreenWords`). */
function writeViewHeader(view: ViewWords, inputs: ViewInputs, count: number) {
  const { f, u } = view,
    s = scratch,
    eye = s.viewInverse,
    shift = s.shift
  f.set(s.shiftedToClip, VSM_PROJECTION_VIEW_WORD.shiftedToClip)
  f.set(s.shiftedToView, VSM_PROJECTION_VIEW_WORD.shiftedToView)
  f.set(s.viewToClip, VSM_PROJECTION_VIEW_WORD.viewToClip)
  f.set(s.clipToShifted, VSM_PROJECTION_VIEW_WORD.clipToShifted)
  for (let k = 0; k < 3; k++)
    writeSplitDouble(
      f,
      VSM_PROJECTION_VIEW_WORD.originShiftHigh + k,
      VSM_PROJECTION_VIEW_WORD.originShiftLow + k,
      shift[k],
    )
  u[VSM_PROJECTION_VIEW_WORD.frameIndex] = inputs.frameIndex >>> 0
  // The camera's kind as the engine knows it, never a matrix test M[3][3] < 1: the projection's
  // jitter (`taaRenderProjection`) leaves rows 2 and 3 as they are, but the same projection
  // scaled as a homogeneous matrix (×0.25: M[3][3] = 0.25 for an orthographic one) would fail it.
  const perspective = inputs.camera.perspective
  u[VSM_PROJECTION_VIEW_WORD.isOrtho] = perspective ? 0 : 1
  for (let k = 0; k < 3; k++) f[VSM_PROJECTION_VIEW_WORD.shiftedEye + k] = eye[12 + k] + shift[k]
  u[VSM_PROJECTION_VIEW_WORD.lightCount] = count
  // The view's forward axis: its +Z (row 2 of shiftedToView).
  f[VSM_PROJECTION_VIEW_WORD.viewForward] = s.shiftedToView[2]
  f[VSM_PROJECTION_VIEW_WORD.viewForward + 1] = s.shiftedToView[6]
  f[VSM_PROJECTION_VIEW_WORD.viewForward + 2] = s.shiftedToView[10]
  vsmWriteDepthFromDeviceZ(f, VSM_PROJECTION_VIEW_WORD.depthFromDeviceZ, s.viewToClip, perspective)
  writeScreenWords(view, inputs, s.viewToClip, perspective)
}

/** The header's screen words (`screenRayScale` on) from view-to-clip `v2c`. */
function writeScreenWords(
  { f, i }: ViewWords,
  { width, height }: ViewInputs,
  v2c: Float64Array,
  perspective: boolean,
) {
  // The screen ray length multiplier (zero but where set) and the tangent and inverse tangent of
  // the half field of view (clip-to-view [0][0], [1][1], view-to-clip [0][0], [1][1]); an
  // orthographic view's are 1.
  const ray = VSM_PROJECTION_VIEW_WORD.screenRayScale,
    tangents = VSM_PROJECTION_VIEW_WORD.halfFovTangents
  if (perspective) {
    f[ray] = f[tangents] = 1 / v2c[0]
    f[ray + 1] = f[tangents + 1] = 1 / v2c[5]
    f[tangents + 2] = v2c[0]
    f[tangents + 3] = v2c[5]
  } else
    f[ray + 2] = f[ray + 3] = f[tangents] = f[tangents + 1] = f[tangents + 2] = f[tangents + 3] = 1
  const pixels = VSM_PROJECTION_VIEW_WORD.viewPixels
  f[pixels] = width
  f[pixels + 1] = height
  f[pixels + 2] = 1 / width
  f[pixels + 3] = 1 / height
  // The geometry of the thickness the screen march gives a surface (`screenSlab`), from the view's
  // own matrix: a translation changes neither gradient it reads.
  f.set(screenSlab(scratch.shiftedToClip, height), VSM_PROJECTION_VIEW_WORD.screenSlab)
  // The projection rect: from (0, 0) (zero), its size.
  i[VSM_PROJECTION_VIEW_WORD.projectionRect + 2] = width
  i[VSM_PROJECTION_VIEW_WORD.projectionRect + 3] = height
}

/** One light's record at word `o`, its position shifted by `shift`. */
function writeLightRecord(
  { f, u, i }: ViewWords,
  o: number,
  light: VsmProjectionLight,
  shift: Float64Array,
) {
  const d = light.direction
  const p = light.type === 'directional' ? ORIGIN : light.position
  const L = VSM_PROJECTION_LIGHT_WORD
  for (let k = 0; k < 3; k++) {
    f[o + L.shiftedPosition + k] = p[k] + shift[k]
    // The record's direction points towards the light.
    f[o + L.direction + k] = -d[k]
  }
  f[o + L.radius] = light.type === 'directional' ? 0 : light.radius
  f[o + L.sourceRadius] = light.sourceRadius ?? 0
  // The cone's cosine as the lighting packs it: −2, which no direction's cosine reaches, off a spot.
  f[o + L.cosCone] = light.type === 'spot' ? Math.cos(light.coneAngle) : NO_CONE
  i[o + L.mapId] = light.mapId | 0
  u[o + L.kind] = KIND[light.type]
}

/** Writes `VsmProjectionView` for these inputs and ≤ 64 lights into its staging words: its header
 *  and the lights' records, the shader reading no record past its light count; returns the bytes
 *  written. */
export function writeVsmProjectionView(
  view: ViewWords,
  inputs: ViewInputs,
  lights: readonly VsmProjectionLight[],
) {
  const count = Math.min(lights.length, VSM_PROJECTION_MAX_PASS_LIGHTS),
    words = VSM_PROJECTION_HEADER_WORDS + VSM_PROJECTION_LIGHT_WORDS * count
  view.f.fill(0, 0, words)
  viewMatrices(inputs.camera)
  writeViewHeader(view, inputs, count)
  for (let k = 0; k < count; k++)
    writeLightRecord(
      view,
      VSM_PROJECTION_HEADER_WORDS + k * VSM_PROJECTION_LIGHT_WORDS,
      lights[k],
      scratch.shift,
    )
  return 4 * words
}
