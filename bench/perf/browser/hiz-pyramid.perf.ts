// the Hi-Z pyramid of the per-frame path.
import {
  hizBuildPyramid,
  hizFootprintFar,
  hizOccluded,
} from '../../../packages/sdk-core/src/hiz/oracles.fixture.ts'
import { buildHizPyramid } from '../../../packages/sdk-browser/src/hiz/depth.ts'
import { hizTestRect, HIZ_TEST_VALUES } from '../../../packages/sdk-browser/src/hiz/occlusion.ts'
import type { HizPyramid } from '../../../packages/sdk-browser/src/hiz/types.ts'
import type { ScenePage } from './support/scenes.ts'
import { xorshiftRandom, measure, stress, rapport } from '../../core/index.ts'
import { camera, coupe, located, rectangles } from './support/scenes.ts'
import { engineCamera } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts'
import { rasterVisibility } from '../../oracles/browser/cpu-image/raster.ts'
import { hizRejects, type HizBounds } from '../../oracles/browser/hizRejects.ts'

function referenceRowsOf(depth: Float32Array, width: number, height: number): number[][] {
  const rows: number[][] = []
  for (let y = 0; y < height; y++) {
    const row = new Array<number>(width)
    for (let x = 0; x < width; x++) row[x] = depth[y * width + x]
    rows.push(row)
  }
  return rows
}
function referenceBuild(depth: Float32Array, width: number, height: number) {
  if (width < 1 || height < 1 || depth.length < width * height) throw new Error('HIZ_DEPTH_SIZE')
  return { levels: hizBuildPyramid(referenceRowsOf(depth, width, height)), width, height }
}
type ReferencePyramid = ReturnType<typeof referenceBuild>

const rejectionScratch = new Int32Array(HIZ_TEST_VALUES)
function referenceRejects(pyramid: ReferencePyramid, bounds: HizBounds, bias = 0) {
  if (
    !hizTestRect(
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
      bounds.clipsNear,
      pyramid.width,
      pyramid.height,
      pyramid.levels.length,
      rejectionScratch,
    )
  )
    return false
  const far = hizFootprintFar(
    pyramid.levels,
    rejectionScratch[1],
    rejectionScratch[2],
    rejectionScratch[3] + 1,
    rejectionScratch[4] + 1,
    rejectionScratch[0],
  )
  return hizOccluded(bounds.nearestDepth, far, bias)
}

interface Entree {
  depth: Float32Array
  width: number
  height: number
  bounds: HizBounds[]
  complet: boolean
}

function cas(width: number, height: number, pages: ScenePage[], seed: number): Entree {
  const cam = camera(6, 0.1, width / height),
    viewport: [number, number] = [width, height]
  const depth = rasterVisibility(pages, located(pages.length), engineCamera(cam), viewport).depth
  const alea = xorshiftRandom(seed),
    bounds: HizBounds[] = []
  const count = width >= 1280 ? 4000 : width >= 33 ? 200 : 2
  const rects = rectangles({ count, seed, width, height })
  for (let i = 0; i < rects.length; i++) {
    const [minX, minY, maxX, maxY, clipsNear] = rects[i]
    bounds.push({ minX, minY, maxX, maxY, clipsNear, nearestDepth: alea() * 0.9 + 0.05 })
  }
  return { depth, width, height, bounds, complet: false }
}

function passeReference(input: Entree) {
  const pyramid = referenceBuild(input.depth, input.width, input.height)
  let levels: Float64Array | null = null
  if (input.complet) {
    let total = 0
    for (const level of pyramid.levels) total += level.length * level[0].length
    levels = new Float64Array(total)
    let at = 0
    for (const level of pyramid.levels)
      for (let y = 0; y < level.length; y++)
        for (let x = 0; x < level[y].length; x++) levels[at++] = level[y][x]
  }
  const verdicts = new Uint8Array(input.bounds.length)
  for (let i = 0; i < input.bounds.length; i++)
    verdicts[i] = referenceRejects(pyramid, input.bounds[i]) ? 1 : 0
  return { levels, verdicts }
}

const reprise = new Map<string, HizPyramid>()
function optimisedPass(input: Entree) {
  const key = `${input.width}x${input.height}`
  const existante = reprise.get(key)
  const pyramid = buildHizPyramid(input.depth, input.width, input.height, existante)
  reprise.set(key, pyramid)
  let levels: Float64Array | null = null
  if (input.complet) {
    let total = 0
    for (let l = 0; l < pyramid.count; l++) total += pyramid.widths[l] * pyramid.heights[l]
    levels = new Float64Array(total)
    for (let i = 0; i < total; i++) levels[i] = pyramid.data[i]
  }
  const verdicts = new Uint8Array(input.bounds.length)
  for (let i = 0; i < input.bounds.length; i++)
    verdicts[i] = hizRejects(pyramid, input.bounds[i]) ? 1 : 0
  return { levels, verdicts }
}

const scene = coupe({ pages: 300, triangles: 24, hostile: true, seed: 7 })
const petite = coupe({ pages: 12, triangles: 16, hostile: true, seed: 53, size: 0.4 })
const image = cas(1280, 720, scene, 101)
const impaire = cas(33, 19, petite, 103)
const unique = cas(1, 1, petite, 107)
const plein = (input: Entree): Entree => ({ ...input, complet: true })

const resHiz = await measure({
  name: 'Hi-Z pyramid',
  fichier: 'packages/sdk-browser/src/hiz/depth.ts',
  cas: [
    { name: '1280×720, every level', input: plein(image), size: 921600, measure: false },
    { name: '33×19, every level', input: plein(impaire), size: 627, measure: false },
    { name: '1×1, every level', input: plein(unique), size: 1, measure: false },
    { name: '1280×720, 4 000 rectangles', input: image, size: 921600 },
    { name: '33×19, odd sizes', input: impaire, size: 627 },
    { name: '1×1', input: unique, size: 1 },
  ],
  calculation: optimisedPass,
  expected: passeReference,
  options: { warmup: 3, tours: 20, budgetMs: 1500 },
})

await stress({
  name: 'buildHizPyramid extremes',
  calculation: (e: { depth: Float32Array; width: number; height: number }) =>
    buildHizPyramid(e.depth, e.width, e.height),
  extremes: [{ name: '1x1', input: { depth: new Float32Array(1), width: 1, height: 1 } }],
})

rapport('hiz-pyramide', [resHiz], 'C2 was measured and its delta is described')
