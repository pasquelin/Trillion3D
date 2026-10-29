import { readHairStrandsSetting } from '../../../sdk-core/src/contracts/hairStrandsOptions.ts'
import type { DiagnosticMode } from '../../../sdk-core/src/runtime/diagnostics.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { drawHairCull } from './debugCull.ts'
import { DEBUG_COLORS, createDebugLines, type DebugLines } from './debugLines.ts'
import { createDebugLinesGpu, type DebugGpuBoxes, type DebugLinesGpu } from './debugLinesPass.ts'
import { createDebugPanelsGpu, type DebugPanelsGpu } from './debugPanelsPass.ts'
import { HAIR_COMPONENT } from './hairBsdfWgsl.ts'
import { lastMacroGroups } from './macroGroups.ts'
import type { HairViewGpu } from './viewGpu.ts'

/** The hair debug views by diagnostic mode, each with the name it is written under on the image. */
const VIEWS = {
  'hair-light-bounds': 'LightBounds',
  'hair-deep-opacity-maps': 'DeepOpacityMaps',
  'hair-macro-group-screen-rect': 'MacroGroupScreenRect',
  'hair-voxels-density': 'VoxelsDensity',
} as const satisfies Partial<Record<DiagnosticMode, string>>
type HairDebugView = keyof typeof VIEWS

const viewOf = (rt: Pick<WebgpuPagesRuntime, 'run'>): HairDebugView | undefined =>
  rt.run.diagnostic in VIEWS ? (rt.run.diagnostic as HairDebugView) : undefined

/** The pixels from the display's edge a line of text starts at, and the pixels between two lines of the statistics (cells of 2 pixels). */
const LEFT = 50
const LINE = 14

/** What the debug views keep of a runtime: the lines of the image and the passes that draw them, made when a view is first shown. */
interface DebugState {
  readonly lines: DebugLines
  linesGpu?: DebugLinesGpu
  panels?: DebugPanelsGpu
}
const states = new WeakMap<object, DebugState>()

/** Whether this image draws a hair debug view: one is chosen (`hair-…`) or the culling of the grooms is asked (`hairCastShadowWhenOutOfViewDebug`), and the image has strands. */
export const hairDebugShown = (rt: WebgpuPagesRuntime) =>
  !!rt.gpu.hair?.visible &&
  readHairStrandsSetting(rt, 'hairStrands') &&
  (!!viewOf(rt) || readHairStrandsSetting(rt, 'hairCastShadowWhenOutOfViewDebug'))

/** Gives the passes of a runtime's debug views back. */
export function disposeHairDebug(owner: object) {
  const state = states.get(owner)
  state?.linesGpu?.dispose()
  state?.panels?.dispose()
  states.delete(owner)
}

/** Writes `rows` of text from the pixel (`x`, `y`), a row after the other, in `color`. */
function rows(lines: DebugLines, x: number, y: number, color: number, ...text: string[]) {
  text.forEach((row, at) => lines.text(row, x, y + at * LINE, color))
  return y + text.length * LINE
}

/** A row `name` and its boolean `value`, green or red. */
function flagRow(lines: DebugLines, x: number, y: number, name: string, value: boolean) {
  lines.text(name.padEnd(22), x, y, DEBUG_COLORS.silver)
  lines.text(value ? 'TRUE' : 'FALSE', x + 23 * 8, y, value ? DEBUG_COLORS.green : DEBUG_COLORS.red)
  return y + LINE
}

/** The statistics of the deep shadows (the hair components, the voxelization, the atlas) and the choices of the bounds, from the pixel (`LEFT`, 40). */
function deepShadowInfo(rt: WebgpuPagesRuntime, view: HairViewGpu, lines: DebugLines) {
  const components = view.inputs.components ?? 0
  const atlas = view.deepShadows
  let y = rows(lines, LEFT, 40, DEBUG_COLORS.yellow, 'Hair Components')
  for (const [name, bit] of [
    ['R', HAIR_COMPONENT.r],
    ['TT', HAIR_COMPONENT.tt],
    ['TRT', HAIR_COMPONENT.trt],
    ['Global Scatt.', HAIR_COMPONENT.globalScattering],
    ['Local Scatt.', HAIR_COMPONENT.localScattering],
  ] as const)
    y = flagRow(lines, LEFT, y, name, (components & bit) !== 0)
  y = rows(lines, LEFT, y + LINE, DEBUG_COLORS.yellow, 'Misc')
  y = flagRow(lines, LEFT, y, 'Voxelization', !!view.inputs.voxel)
  y = flagRow(lines, LEFT, y, 'View rect optim.', true)
  y = rows(lines, LEFT, y + LINE, DEBUG_COLORS.yellow, 'DOM')
  const side = atlas ? atlas.set.resolution : 0
  y = rows(
    lines,
    LEFT,
    y,
    DEBUG_COLORS.silver,
    `Atlas resolution      : ${side} x ${side}`,
    `Atlas slots           : ${atlas?.slotCount ?? 0}`,
  )
  y = flagRow(lines, LEFT, y, 'GPU driven', true)
  y = rows(lines, LEFT, y + LINE, DEBUG_COLORS.yellow, 'Bounds')
  const macro = readHairStrandsSetting(rt, 'hairDeepShadowDebugMacroBounds')
  const shadow = readHairStrandsSetting(rt, 'hairDeepShadowDebugShadowBounds')
  y = flagRow(lines, LEFT, y, 'Macro  AABB', macro)
  flagRow(lines, LEFT, y, 'Shadow AABB', shadow)
}

/** The volume's sizes and the choices of the voxel view, from the pixel (`LEFT`, 100). */
function voxelInfo(rt: WebgpuPagesRuntime, view: HairViewGpu, lines: DebugLines) {
  const { set } = view.voxel
  const settings = view.inputs.voxel
  if (!set || !settings) return
  const side = settings.pageCountPerDim
  let y = flagRow(lines, LEFT, 100, 'Alloc. Feedback', settings.adaptive)
  rows(
    lines,
    LEFT,
    y,
    DEBUG_COLORS.silver,
    `CPU Min. Voxel Size   : ${settings.worldSize * 100} CM`,
    `Page Res              : ${set.pageResolution}`,
    `Page Count Res        : ${side} ${side} ${side}`,
    `Total Page Index      : ${set.indexCapacity}`,
    `Total Page            : ${set.pageCount}`,
  )
  y = flagRow(
    lines,
    500,
    100,
    'Draw Voxels',
    readHairStrandsSetting(rt, 'hairVoxelDebugDrawVoxels'),
  )
  y = flagRow(lines, 500, y, 'Draw Pages', readHairStrandsSetting(rt, 'hairVoxelDebugDrawPages'))
  const forced = readHairStrandsSetting(rt, 'hairVoxelDebugForcedMip')
  flagRow(lines, 500, y, 'Force MIP', forced >= 0)
}

/** The macro groups' screen rectangles, and the one that holds them all, as green frames in the display's pixels. */
function screenRects(view: HairViewGpu, lines: DebugLines, display: readonly [number, number]) {
  const [width, height] = view.inputs.size
  const total = [Infinity, Infinity, -Infinity, -Infinity]
  for (const group of lastMacroGroups()) {
    const [x0, y0, x1, y1] = group.screenRect
    lines.rect(
      (x0 * display[0]) / width,
      (y0 * display[1]) / height,
      (x1 * display[0]) / width,
      (y1 * display[1]) / height,
      DEBUG_COLORS.green,
    )
    total[0] = Math.min(total[0]!, x0)
    total[1] = Math.min(total[1]!, y0)
    total[2] = Math.max(total[2]!, x1)
    total[3] = Math.max(total[3]!, y1)
  }
  if (total[0]! <= total[2]!)
    lines.rect(
      (total[0]! * display[0]) / width,
      (total[1]! * display[1]) / height,
      (total[2]! * display[0]) / width,
      (total[3]! * display[1]) / height,
      DEBUG_COLORS.green,
    )
}

/** The state of the debug views of `rt`, made on first use. */
function stateOf(rt: WebgpuPagesRuntime): DebugState {
  let state = states.get(rt)
  if (!state) states.set(rt, (state = { lines: createDebugLines() }))
  return state
}

/** What a view draws into: the image's lines and boxes, the passes, the encoder and the display. */
interface DebugFrame {
  readonly rt: WebgpuPagesRuntime
  readonly encoder: GPUCommandEncoder
  readonly view: HairViewGpu
  readonly lines: DebugLines
  readonly panels: DebugPanelsGpu
  readonly boxes: { -readonly [K in keyof DebugGpuBoxes]: DebugGpuBoxes[K] }
  readonly target: GPUTextureView
  readonly size: readonly [number, number]
}

/** The views of the deep shadows: the statistics, the bounds the settings ask for and, for the deep opacity maps, the atlases. */
function drawDeepShadowView(frame: DebugFrame, mode: HairDebugView) {
  const { rt, view, lines, boxes } = frame
  const { deepShadows } = view
  if (!deepShadows) return
  deepShadowInfo(rt, view, lines)
  if (readHairStrandsSetting(rt, 'hairDeepShadowDebugMacroBounds'))
    boxes.macro = { count: lastMacroGroups().length, aabb: view.bounds.macroAabb }
  if (readHairStrandsSetting(rt, 'hairDeepShadowDebugShadowBounds'))
    boxes.frusta = { count: deepShadows.slotCount, viewInfos: deepShadows.set.viewInfos }
  if (
    mode === 'hair-deep-opacity-maps' &&
    readHairStrandsSetting(rt, 'hairDeepShadowDebugIndex') < deepShadows.slotCount
  )
    frame.panels.encodeAtlas(
      frame.encoder,
      frame.target,
      deepShadows.set,
      readHairStrandsSetting(rt, 'hairDeepShadowDebugScale'),
    )
}

/** The view of the voxels: the sizes of the volume, the boxes of its nodes and the strands' count along each pixel's ray. */
function drawVoxelView(frame: DebugFrame, depth: GPUTextureView) {
  const { rt, view, boxes } = frame
  const { set } = view.voxel
  const settings = view.inputs.voxel
  if (!set || !settings) return
  voxelInfo(rt, view, frame.lines)
  boxes.nodes = { count: lastMacroGroups().length, nodes: set.nodes }
  frame.panels.encodeVoxels(frame.encoder, frame.target, frame.size, {
    set,
    viewBuffer: view.viewBlock.buffer,
    depth,
    mipmap: readHairStrandsSetting(rt, 'hairVoxelDebugTraversal') === 'mip',
    densityScale: readHairStrandsSetting(rt, 'hairVoxelDensityScale'),
    stepping: settings.steppingScaleShadow,
    forcedMip: readHairStrandsSetting(rt, 'hairVoxelDebugForcedMip'),
    drawPages: readHairStrandsSetting(rt, 'hairVoxelDebugDrawPages'),
    drawVoxels: readHairStrandsSetting(rt, 'hairVoxelDebugDrawVoxels'),
    frame: rt.run.frame,
    jitterMode: settings.jitterMode,
  })
}

/**
 * THE HAIR DEBUG VIEWS over the display image, drawn after the image is composed: the lines of the culling of the grooms out of view
 * (`hairCastShadowWhenOutOfViewDebug`) in every view, and those of the chosen view (`hair-light-bounds`, `hair-deep-opacity-maps`,
 * `hair-macro-group-screen-rect`, `hair-voxels-density`) with the name of the mode written at the bottom. Nothing, and the passes given
 * back, while neither is asked or the image holds no strands.
 */
export function encodeHairDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const view = gpu.hair
  const mode = viewOf(rt)
  if (!hairDebugShown(rt) || !view?.visible || !gpu.displayView) return disposeHairDebug(rt)
  const state = stateOf(rt)
  const frame: DebugFrame = {
    rt,
    encoder,
    view,
    lines: state.lines,
    panels: (state.panels ??= createDebugPanelsGpu(device)),
    boxes: {},
    target: gpu.displayView,
    size: gpu.displaySize,
  }
  frame.lines.begin(cam.eye)
  if (readHairStrandsSetting(rt, 'hairCastShadowWhenOutOfViewDebug'))
    drawHairCull(frame.lines, view.lists.plan.trace, cam.viewProjection)
  if (mode) {
    frame.lines.text(
      `Hair Debug mode - ${VIEWS[mode]}`,
      40,
      frame.size[1] - 2 * LINE,
      DEBUG_COLORS.yellow,
    )
    if (mode === 'hair-macro-group-screen-rect') screenRects(view, frame.lines, frame.size)
    else if (mode === 'hair-voxels-density') {
      if (gpu.depthView) drawVoxelView(frame, gpu.depthView)
    } else drawDeepShadowView(frame, mode)
  }
  const linesGpu = (state.linesGpu ??= createDebugLinesGpu(device))
  linesGpu.encode(
    encoder,
    frame.target,
    frame.size,
    cam.viewProjectionRelative,
    frame.lines,
    frame.boxes,
  )
}
