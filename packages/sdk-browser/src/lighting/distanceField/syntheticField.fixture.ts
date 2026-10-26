// A synthetic global distance field for the tests of what reads it (`globalTraceWgsl.test.ts`, the reflection rig's
// room): built the way the passes build one — pages of 7 voxels whose bytes are an exact distance field's, a page
// table, a coverage atlas, a coarse mip that never overestimates —, the shipped march (`globalTraceWgsl.ts`) run in JavaScript over it
// (`shaderRun`), or its arrays and view block (`fieldArrays`, `gdfViewWords`) handed to a device.
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { GDF_VIEW } from './globalReadWgsl.ts'
import { globalObjectGridReadWgsl } from './objectGridWgsl.ts'
import { globalDistanceFieldTraceWgsl } from './globalTraceWgsl.ts'

export type Vec3 = [number, number, number]
const COVERAGE_BIT = 0x80000000
const MIP_FACTOR = 4
/** The pages along a clipmap of a field that names none, and its voxels along it. */
const PAGES = 4
export const SIDE = 7 * PAGES

/** What a field is built from: the half-extent of each clipmap about `centre` (the origin by default), centimetres,
 *  the pages along a clipmap, the exact distance to the surface at a point of the world, the pages flagged as reached by
 *  two-sided meshes alone, the coverage at a point of the world (a flagged page's atlas holds it at its lattice;
 *  0 where only two-sided meshes reach, else 1, by default 0 for a flagged page whole), the steps a clipmap,
 *  the simple coverage (the atlas unread). */
type Field = {
  extents: number[]
  centre?: Vec3
  pages?: number
  sdf: (p: Vec3) => number
  flagged?: (page: Vec3, clipmap: number) => boolean
  coverage?: (p: Vec3) => number
  simple?: boolean
  steps?: number
  /** The thresholds of the dithered transparency: a step's and a trace's. */
  dither?: [number, number]
}

const byte = (unit: number) => Math.round(Math.min(Math.max(unit, 0), 1) * 255)

/** The arrays of the field `field` as the passes would leave them — its page table (a word a page, a clipmap above
 *  the other), page atlas (a byte a voxel, four to a word) with the coverage atlas past it (a byte a lattice voxel,
 *  4 × 4 × 4 a page, four to a word), coarse mip (a float a voxel) — and its view block's values. */
export function fieldArrays({
  extents,
  centre = [0, 0, 0],
  pages = PAGES,
  sdf,
  flagged = () => false,
  coverage = () => 0,
  simple = false,
  steps = 256,
  dither = [0.5, 0.9],
}: Field) {
  const count = extents.length
  const side = 7 * pages
  const mipSide = Math.ceil(side / MIP_FACTOR)
  const table = new Uint32Array(pages ** 3 * count)
  // The page atlas's words, then the coverage atlas's, in one buffer as the field keeps them.
  const pageWords = (pages ** 3 * count * 512) / 4
  const atlas = new Uint32Array(pageWords + pages ** 3 * count * 16)
  const mip = new Float32Array(mipSide ** 3 * count)
  const put = (page: number, x: number, y: number, z: number, value: number) => {
    const at = page * 512 + (z * 8 + y) * 8 + x
    atlas[at >> 2] |= value << (8 * (at & 3))
  }
  extents.forEach((extent, k) => {
    const voxel = (2 * extent) / side
    const range = 4 * voxel
    const place = (g: Vec3): Vec3 => g.map((c, a) => c * voxel - extent + centre[a]) as Vec3
    for (let pz = 0; pz < pages; pz++)
      for (let py = 0; py < pages; py++)
        for (let px = 0; px < pages; px++) {
          const page = ((k * pages + pz) * pages + py) * pages + px
          table[page] = (page | (flagged([px, py, pz], k) ? COVERAGE_BIT : 0)) >>> 0
          for (let z = 0; z < 4; z++)
            for (let y = 0; y < 4; y++)
              for (let x = 0; x < 4; x++) {
                const p = place([px * 7 + 2 * x, py * 7 + 2 * y, pz * 7 + 2 * z])
                atlas[pageWords + (page * 4 + z) * 4 + y] |= byte(coverage(p)) << (8 * x)
              }
          for (let z = 0; z < 8; z++)
            for (let y = 0; y < 8; y++)
              for (let x = 0; x < 8; x++) {
                const d = sdf(place([px * 7 + x, py * 7 + y, pz * 7 + z]))
                put(page, x, y, z, byte(d / (2 * range) + 0.5))
              }
        }
    // The coarse mip, under the true distance by the half diagonal of its voxel.
    const cell = (2 * extent) / mipSide
    for (let z = 0; z < mipSide; z++)
      for (let y = 0; y < mipSide; y++)
        for (let x = 0; x < mipSide; x++) {
          const at: Vec3 = [x + 0.5, y + 0.5, z + 0.5].map(
            (c, a) => c * cell - extent + centre[a],
          ) as Vec3
          const d = sdf(at) - (cell * Math.sqrt(3)) / 2
          mip[(k * mipSide + z) * mipSide * mipSide + y * mipSide + x] =
            byte(d / (2 * MIP_FACTOR * range) + 0.5) / 255
        }
  })
  const view = {
    centerExtent: extents.map((e) => [...centre, e]),
    uvAddMul: extents.map((e) => [...centre.map((c) => 0.5 - c / (2 * e)), 1 / (2 * e)]),
    mipScale: extents.map((e, k) => [
      1 / (2 * e),
      1 / (2 * e),
      1 / (2 * e) / count,
      (k * mipSide + 0.5) / (mipSide * count),
    ]),
    mipBias: extents.map((e, k) => [
      0.5 - centre[0] / (2 * e),
      0.5 - centre[1] / (2 * e),
      (0.5 - centre[2] / (2 * e) + k) / count,
      (k * mipSide + mipSide - 0.5) / (mipSide * count),
    ]),
    clipmaps: count,
    pagesAlong: pages,
    texel: 1 / side,
    mipFactor: MIP_FACTOR,
    mipTransition: (4 + MIP_FACTOR / 4) / 8,
    traceSteps: steps,
    flags: simple ? 2 : 0,
    coverageBase: pageWords,
    expandCovered: 1,
    expandNotCovered: 0.6,
    minStepNotCovered: 4,
    ditherStep: dither[0],
    ditherTrace: dither[1],
    translation: [0, 0, 0],
  }
  return { view, table, atlas, mip, mipSide, pages, count }
}

/** The view block of a field's `view` (`fieldArrays`) in the words the shader reads (`GDF_VIEW`). */
export function gdfViewWords(view: ReturnType<typeof fieldArrays>['view']) {
  const words = new Float32Array(GDF_VIEW.words),
    ints = new Uint32Array(words.buffer),
    at = GDF_VIEW.at
  for (const name of ['centerExtent', 'uvAddMul', 'mipScale', 'mipBias'] as const)
    view[name].forEach((lane, k) => words.set(lane, at[name] + 4 * k))
  ints[at.clipmaps] = view.clipmaps
  ints[at.pagesAlong] = view.pagesAlong
  ints[at.traceSteps] = view.traceSteps
  words[at.texel] = view.texel
  words[at.mipFactor] = view.mipFactor
  words[at.mipTransition] = view.mipTransition
  ints[at.flags] = view.flags
  ints[at.coverageBase] = view.coverageBase
  words[at.expandCovered] = view.expandCovered
  words[at.expandNotCovered] = view.expandNotCovered
  words[at.minStepNotCovered] = view.minStepNotCovered
  words[at.ditherStep] = view.ditherStep
  words[at.ditherTrace] = view.ditherTrace
  words.set(view.translation, at.translation)
  return words
}

/** The bindings of the field `field` as the shader reads them: its view block, page table, page atlas with the
 *  coverage atlas, and coarse mip, and `cells` for the object grid. */
function scopeOf(field: Field, cells: Uint32Array = new Uint32Array(4)) {
  const { view, table, atlas, mip, mipSide, pages, count } = fieldArrays(field)
  const tableToken = {}
  return {
    gdfView: view,
    gdfPageTable: tableToken,
    gdfPageAtlas: atlas,
    gdfObjectGrid: Array.from({ length: cells.length / 4 }, (_, k) => [
      ...cells.subarray(4 * k, 4 * k + 4),
    ]),
    gdfMip: {},
    textureLoad: (t: object, c: number[]) =>
      t === tableToken
        ? [table[(c[2] * pages + c[1]) * pages + c[0]], 0, 0, 0]
        : [mip[(c[2] * mipSide + c[1]) * mipSide + c[0]], 0, 0, 0],
    textureDimensions: () => [mipSide, mipSide, mipSide * count],
  }
}

/** The march of the field `field` and the reads around it. */
export function build(field: Field) {
  return shaderRun<{
    gdfTraceInput: (...a: unknown[]) => Input
    gdfTrace: (input: Input) => { hitTime: number; clipmap: number; steps: number; expand: number }
    gdfNormal: (p: Vec3, clipmap: number, fallback: Vec3) => Vec3
    gdfClipmapAt: (p: Vec3) => number
    gdfClipRayOutside: (
      origin: Vec3,
      dir: Vec3,
      span: number,
      steps: number,
    ) => { start: number; length: number }
    gdfCoverageSample: (page: number, local: Vec3) => number
  }>(
    wgslModule(globalDistanceFieldTraceWgsl(0, 0)),
    [
      'gdfTraceInput',
      'gdfTrace',
      'gdfNormal',
      'gdfClipmapAt',
      'gdfClipRayOutside',
      'gdfCoverageSample',
    ],
    scopeOf(field),
  )
}

/** The object grid's reads over the field `field`, its cells `cells` (four words each, a page's 64 after the other). */
export function buildGrid(field: Field, cells: Uint32Array) {
  return shaderRun<{
    gdfGridPack: (instance: number, distance: number, extent: number, reach: number) => number
    gdfGridAdd: (
      cell: number[],
      instance: number,
      distance: number,
      extent: number,
      reach: number,
    ) => number[]
    gdfGridSort: (cell: number[]) => number[]
    gdfGridCellOffset: (cell: Vec3) => number
    gdfGridValid: (packed: number) => boolean
    gdfGridInstance: (packed: number) => number
    gdfObjectGridCellAt: (p: Vec3, clipmap: number, cells: number) => number[]
  }>(
    wgslModule(globalObjectGridReadWgsl(0, 0, 9)),
    [
      'gdfGridPack',
      'gdfGridAdd',
      'gdfGridSort',
      'gdfGridCellOffset',
      'gdfGridValid',
      'gdfGridInstance',
      'gdfObjectGridCellAt',
    ],
    scopeOf(field, cells),
  )
}
export type Input = Record<string, unknown>
