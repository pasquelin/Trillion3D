// The occlusion's whole chain on the synthetic view: every pass of the plan run twice — the shipped WGSL through
// `shaderRun`, and the search written apart (`reference.fixture.ts`) —, each pass reading the texture the one before wrote.
// The qualities of 3 and 4 take no blur among a quad, which needs the fragment stage's derivatives.
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import type { AmbientOcclusionOptions } from '../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { aoOcclusionShader, aoShapeOf } from './occlusionWgsl.ts'
import { AO_SETUP_WGSL } from './setupWgsl.ts'
import { AO_SMOOTH_WGSL } from './smoothWgsl.ts'
import { aoPasses, aoTargetExtent, aoTargetRect, type AoPass, type AoTarget } from './plan.ts'
import { searchOf, setupTexel, smoothOf, type RunSpec } from './reference.fixture.ts'
import {
  createScene,
  HEIGHT,
  imageOf,
  sceneScope,
  settingsOf,
  uniformOf,
  WIDTH,
  type Geometry,
} from './scene.fixture.ts'

type Texels = number[][]
type Search = (p: [number, number]) => { value: number }

/** The values of a texture of `[w, h]` pixels, by row, filled by `texel`. */
const filled = ([w, h]: readonly [number, number], texel: (x: number, y: number) => number) =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => texel(x, y)))

/** The textures the chain holds so far, by target: the WGSL's and the search apart's. */
interface Held {
  setupWgsl: Partial<Record<AoTarget, Float32Array>>
  setupApart: Partial<Record<AoTarget, number[][]>>
  wgsl: Partial<Record<AoTarget, Texels>>
  apart: Partial<Record<AoTarget, Texels>>
}

/** What a pass is run over: the scene, the settings, its uniform's words and the size of its target and rectangle. */
interface Spec {
  scene: ReturnType<typeof createScene>
  settings: ReturnType<typeof settingsOf>
  extent: [number, number]
  ao: ReturnType<typeof uniformOf>
}

/** A setup pass, run twice: the texture the WGSL wrote, and the one apart; the two compared. */
function setupPass(
  spec: Spec,
  target: AoTarget,
  held: Held,
  compare: (a: number, b: number) => void,
) {
  const { scene, settings, extent, ao } = spec
  const [w, h] = aoTargetExtent(target, extent)
  const scale = extent[0] / w
  const { aoSetup } = shaderRun<{ aoSetup: (at: number[]) => number[] }>(
    AO_SETUP_WGSL,
    ['aoSetup'],
    sceneScope(scene, ao),
  )
  const texels = new Float32Array(w * h * 4)
  const want: number[][] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const got = aoSetup([x + 0.5, y + 0.5, 0, 1])
      texels.set(got, 4 * (y * w + x))
      want[y * w + x] = setupTexel(scene, scale, settings.mipThreshold / scale, [x, y])
      want[y * w + x].forEach((v, i) => compare(v, got[i]))
    }
  held.setupWgsl[target] = texels
  held.setupApart[target] = want
}

/** A search pass, run twice, the two compared. */
function searchPass(spec: Spec, pass: AoPass, held: Held, compare: (a: number, b: number) => void) {
  const { scene, settings, extent, ao } = spec
  const [w, h] = aoTargetExtent(pass.target, extent)
  const [rw, rh] = aoTargetRect(pass.target, extent)
  const { setup, lower } = pass
  const shape = aoShapeOf(
    pass.kind === 'final' ? 'final' : 'step',
    settings.shaderQuality,
    !!lower,
    settings.compute,
  )
  const scope = sceneScope(scene, ao, {
    setup: setup && { texels: held.setupWgsl[setup]!, width: aoTargetExtent(setup, extent)[0] },
    lower: lower ? (x, y) => held.wgsl[lower]![y][x] : undefined,
  })
  const { aoSearch } = shaderRun<{ aoSearch: Search }>(
    aoOcclusionShader(shape),
    ['aoSearch'],
    scope,
  )
  const setupExtent = setup && (aoTargetExtent(setup, extent) as [number, number])
  const run: RunSpec = {
    scale: extent[0] / w,
    rect: [rw, rh],
    extent: [w, h],
    fromSetup: pass.kind === 'step',
    last: pass.kind === 'final',
    quality: settings.shaderQuality,
    noiseStep: 0,
    depthNormals: settings.compute,
    setup:
      setup &&
      ((x, y) =>
        held.setupApart[setup]![
          Math.min(y, setupExtent![1] - 1) * setupExtent![0] + Math.min(x, setupExtent![0] - 1)
        ]),
    setupExtent,
    lower: lower && {
      value: (x, y) => held.apart[lower]![y][x],
      extent: aoTargetExtent(lower, extent) as [number, number],
      rect: aoTargetRect(lower, extent) as [number, number],
    },
  }
  const target = pass.target
  held.wgsl[target] = filled([w, h], (x, y) => aoSearch([x, y]).value)
  held.apart[target] = filled([w, h], (x, y) => searchOf(scene, settings, run, [x, y]).value)
  held.wgsl[target]!.forEach((row, y) =>
    row.forEach((v, x) => compare(v, held.apart[target]![y][x])),
  )
}

/** The smoothing pass, run twice over the result the last pass left, the two compared. */
function smoothPass(spec: Spec, pass: AoPass, held: Held, compare: (a: number, b: number) => void) {
  const { scene, extent, ao } = spec
  const source = held.wgsl[pass.lower!]!
  const [w, h] = aoTargetExtent(pass.target, extent)
  const { aoSmooth } = shaderRun<{ aoSmooth: (at: number[]) => number[] }>(
    AO_SMOOTH_WGSL,
    ['aoSmooth'],
    sceneScope(scene, ao, { lower: (x, y) => source[y][x] }),
  )
  const apartSource = held.apart[pass.lower!]!
  const wgsl = filled([w, h], (x, y) => aoSmooth([x + 0.5, y + 0.5, 0, 1])[0])
  const apart = filled([w, h], (x, y) => smoothOf((tx, ty) => apartSource[ty][tx], [w, h], [x, y]))
  held.wgsl[pass.target] = wgsl
  held.apart[pass.target] = apart
  wgsl.forEach((row, y) => row.forEach((v, x) => compare(v, apart[y][x])))
}

/**
 * Runs the plan of the options' resolutions over `geometry`: the WGSL and the apart search, the occlusion each leaves at every
 * pixel of the last texture, and the largest difference between them over every pass.
 */
export function runChain(geometry: Geometry, options: AmbientOcclusionOptions) {
  const scene = createScene(geometry)
  const settings = settingsOf(options)
  const smooth = settings.compute && settings.computeSmooth
  const passes = aoPasses(settings.levels, smooth)
  const extent: [number, number] = [WIDTH, HEIGHT]
  const held: Held = { setupWgsl: {}, setupApart: {}, wgsl: {}, apart: {} }
  let worst = 0
  const compare = (a: number, b: number) => (worst = Math.max(worst, Math.abs(a - b)))
  for (const [at, pass] of passes.entries()) {
    const ao = uniformOf(settings.levels, at, settings, imageOf(), smooth)
    const spec = { scene, settings, extent, ao }
    if (pass.kind === 'setup') setupPass(spec, pass.target, held, compare)
    else if (pass.kind === 'smooth') smoothPass(spec, pass, held, compare)
    else searchPass(spec, pass, held, compare)
  }
  return { wgsl: held.wgsl.ao!, apart: held.apart.ao!, worst, passes, settings }
}
