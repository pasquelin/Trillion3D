// The horizon search's whole chain on the synthetic view (`../scene.fixture.ts`): every pass run twice — the shipped WGSL through
// `shaderRun`, and the same pass written apart, in plain scalars and arrays, from the steps themselves — over the textures the
// pass before left. Distances are centimetres, as the shaders'.
import type { AmbientOcclusionOptions } from '../../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { createScene, HEIGHT, imageOf, sceneScope, settingsOf, WIDTH } from '../scene.fixture.ts'
import { HORIZON_SPATIAL_WGSL, HORIZON_TEMPORAL_WGSL, HORIZON_UPSAMPLE_WGSL } from './filterWgsl.ts'
import { HORIZON_BORDER, HORIZON_GROUP, HORIZON_TILE_TEXELS } from './tables.ts'
import { HORIZON_PARAMS } from './layout.ts'
import { createDepthTerms } from '../params.ts'
import { writeHorizonParams, type HorizonFrame } from './params.ts'
import {
  horizonPasses,
  horizonTargetExtent,
  horizonTargetRect,
  type HorizonPass,
  type HorizonTarget,
} from './plan.ts'
import { combineOf, type Scene, type Settings } from './reference.fixture.ts'
import { horizonCombineShader, horizonShapeOf } from './searchWgsl.ts'
import { readOr0, spatialOf, temporalOf, upsampleOf, type Texels } from './filters.fixture.ts'

/** The uniform of a pass as the shader reads it: each `vec4f` an array by name, the matrix a `Mat`. */
function uniformOf(pass: HorizonPass, s: Settings, rank: number, frame: HorizonFrame) {
  const words = new Float32Array(HORIZON_PARAMS.words)
  writeHorizonParams(words, pass, s, { ...imageOf(rank), frame: rank }, frame, createDepthTerms())
  return Object.fromEntries(
    Object.entries(HORIZON_PARAMS.at).map(([name, word]) => [
      name,
      name === 'clip'
        ? new Mat(Array.from(words.slice(word, word + 16)))
        : Array.from(words.slice(word, word + 4)),
    ]),
  )
}

/** What a run of the chain is given: the image's rank, the history (a texture of this pass's size, or none) and the camera's motion. */
interface HorizonRun {
  rank?: number
  history?: (x: number, y: number) => number
  /** A shift of the clip positions the last image holds, in clip units along x. */
  shift?: number
  /** The word of motion the velocity stage measured at a pixel (`encodeMotion`), where it measured the image. */
  vectors?: (x: number, y: number) => number
}

/** A texture `texel` fills, `[w, h]` big. */
const filled = ([w, h]: readonly number[], texel: (x: number, y: number) => number): Texels =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => texel(x, y)))

/** What one pass is run over: the settings, the scene, the textures the pass before left, the uniform and the history. */
interface PassContext {
  scene: Scene
  s: Settings
  /** The reduction of the pass's target and of the texture it reads. */
  scale: number
  inputScale: number
  rank: number
  frame: HorizonFrame
  history: (x: number, y: number) => number
  vectors?: (x: number, y: number) => number
}

/** The pass `pass` run by the shipped WGSL over the texels `input` and by the same pass written apart over `inputApart`. */
function runPass(pass: HorizonPass, c: PassContext, input?: Texels, inputApart?: Texels) {
  const { scene, s, scale, inputScale, rank, frame, history, vectors } = c
  const [w, h] = horizonTargetExtent(pass.target, [WIDTH, HEIGHT], s.horizon.downscale)
  const [iw, ih] = pass.input
    ? horizonTargetExtent(pass.input, [WIDTH, HEIGHT], s.horizon.downscale)
    : [1, 1]
  const scope = sceneScope(scene, uniformOf(pass, s, rank, frame), {
    input: input && ((x, y) => input[y][x]),
    history,
    vectors,
  })
  const texts = {
    combine: horizonCombineShader(horizonShapeOf(s.shaderQuality, s.horizon.normals)),
    spatial: HORIZON_SPATIAL_WGSL,
    temporal: HORIZON_TEMPORAL_WGSL,
    upsample: HORIZON_UPSAMPLE_WGSL,
  }
  const entry = `hz${pass.kind[0].toUpperCase()}${pass.kind.slice(1)}Main`
  const run =
    pass.kind === 'spatial'
      ? undefined
      : shaderRun<Record<string, (at: number[]) => number[]>>(texts[pass.kind], [entry], scope)[
          entry
        ]
  const read = inputApart && readOr0(inputApart, iw, ih)
  const clip = Array.from(frame.clipToPrevious)
  const rect = [frame.historyRect[0], frame.historyRect[1]]
  const apart = (at: number[]) => {
    if (pass.kind === 'combine') return combineOf(scene, s, scale, rank, at)
    if (pass.kind === 'spatial') return spatialOf(scene, s, scale, read!, at)
    if (pass.kind === 'temporal')
      return temporalOf(
        scene,
        s,
        scale,
        (tx, ty) => inputApart![ty][tx],
        { history, historyRect: rect, clip, vectors },
        at,
      )
    return upsampleOf(s, inputScale, (tx, ty) => inputApart![ty][tx], at)
  }
  return {
    wgsl: run
      ? filled([w, h], (x, y) => run([x + 0.5, y + 0.5, 0, 1])[0])
      : spatialTiles([w, h], scope),
    apart: filled([w, h], (x, y) => apart([x, y])),
  }
}

/** The spatial filter's texture run as its compute pass is: a workgroup at a time, its tile loaded (`hzLoadTile`, every texel of
 *  the tile, as the group's threads load them between them) into the arrays the shader names, then each of its pixels' filter read
 *  from them (`hzSpatialAt`). */
function spatialTiles([w, h]: readonly number[], scope: object): Texels {
  const [gx, gy] = HORIZON_GROUP
  const tileAo = new Array<number>(HORIZON_TILE_TEXELS).fill(0)
  const tileZ = new Array<number>(HORIZON_TILE_TEXELS).fill(0)
  const { hzLoadTile, hzSpatialAt } = shaderRun<{
    hzLoadTile: (index: number, origin: number[]) => void
    hzSpatialAt: (local: number[]) => number
  }>(HORIZON_SPATIAL_WGSL, ['hzLoadTile', 'hzSpatialAt'], { ...scope, tileAo, tileZ })
  const out = filled([w, h], () => 0)
  for (let y0 = 0; y0 < h; y0 += gy)
    for (let x0 = 0; x0 < w; x0 += gx) {
      const origin = [x0 - HORIZON_BORDER, y0 - HORIZON_BORDER]
      for (let index = 0; index < HORIZON_TILE_TEXELS; index++) hzLoadTile(index, origin)
      for (let ly = 0; ly < gy && y0 + ly < h; ly++)
        for (let lx = 0; lx < gx && x0 + lx < w; lx++) out[y0 + ly][x0 + lx] = hzSpatialAt([lx, ly])
    }
  return out
}

/**
 * Runs the plan of the options over `geometry`: every pass twice, over the texture the pass before left (the WGSL's own for the
 * WGSL, the apart one's for the apart), and the largest difference between them over every pass. Returns each pass's texels.
 */
export function runHorizon(
  geometry: object,
  options: AmbientOcclusionOptions,
  run: HorizonRun = {},
) {
  const s = settingsOf({ ambientOcclusionMethod: 'horizon', ...options })
  const { downscale } = s.horizon
  const clip = new Float32Array(16)
  clip[0] = clip[5] = clip[10] = clip[15] = 1
  clip[12] = run.shift ?? 0
  // The history of an image with none is the white texel its pass is bound to.
  const history = run.history ?? (() => 1)
  const frame: HorizonFrame = {
    historyRect: run.history
      ? horizonTargetRect('history0', [WIDTH, HEIGHT], downscale, [0, 0])
      : [1, 1],
    vectors: !!run.vectors,
    clipToPrevious: clip,
  }
  const wgsl: Record<string, Texels> = {}
  const apart: Record<string, Texels> = {}
  let worst = 0
  for (const pass of horizonPasses(s.horizon)[0]) {
    const scaleOf = (target: HorizonTarget) =>
      WIDTH / horizonTargetExtent(target, [WIDTH, HEIGHT], downscale)[0]
    const scale = scaleOf(pass.target)
    const inputScale = pass.input ? scaleOf(pass.input) : 1
    const context = {
      scene: createScene(geometry),
      s,
      scale,
      inputScale,
      rank: run.rank ?? 0,
      frame,
      history,
      vectors: run.vectors,
    }
    const made = runPass(
      pass,
      context,
      pass.input && wgsl[pass.input],
      pass.input && apart[pass.input],
    )
    wgsl[pass.target] = made.wgsl
    apart[pass.target] = made.apart
    made.wgsl.forEach((row, y) =>
      row.forEach((v, x) => (worst = Math.max(worst, Math.abs(v - made.apart[y][x])))),
    )
  }
  return { wgsl, apart, worst, settings: s }
}
