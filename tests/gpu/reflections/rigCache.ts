// The surface cache of the reflection rig: the cards its faces' hits read (`rigField.ts` marches their rays, this lights what they
// meet). Each face (`RigFace`: its triangles, in metres, and the radiance it gives) is a mesh with its six cards, made by the
// engine's own cache — the placements, the cards, the pages' table and the tables a hit reads (`createSurfaceTables`) —; the atlas
// holds, for each card's page, the depth of the face along the card's axis (65535 where the face is not) and the face's radiance as
// the final light, written as the passes of the cache would leave them. The object grid of the field names, for each of its
// cells, the faces near it, nearest first, as the grid's pass does, and the table of instances takes a face of the grid to its
// placement. A ray that meets a face finds its cards and its light; one that meets none finds a black hit, as the reference's.
import { resolveSettings } from '../../../packages/sdk-core/src/contracts/settingRules.ts'
import { SURFACE_CACHE_RULES } from '../../../packages/sdk-core/src/contracts/surfaceCacheOptions.ts'
import { createSurfaceCache } from '../../../packages/sdk-core/src/lighting/surfaceCache/state.ts'
import {
  addMeshCards,
  setPlacement,
  updateAtlasSize,
} from '../../../packages/sdk-core/src/lighting/surfaceCache/placements.ts'
import {
  confirmPages,
  mapPage,
  reallocVirtualSurface,
} from '../../../packages/sdk-core/src/lighting/surfaceCache/virtualSurface.ts'
import {
  mipOf,
  type MeshCards,
} from '../../../packages/sdk-core/src/lighting/surfaceCache/cardTypes.ts'
import { PAGE_SIZE } from '../../../packages/sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import { createSurfaceTables } from '../../../packages/sdk-browser/src/lighting/surfaceCache/tables.ts'
import { createHitCards } from '../../../packages/sdk-browser/src/lighting/reflections/hitCards.ts'
import { WORD_LIGHT_FORMAT } from '../../../packages/sdk-browser/src/gpu/core/lightAtlasFormat.ts'
import type { SurfaceHitResources } from '../../../packages/sdk-browser/src/lighting/surfaceCache/hitWgsl.ts'
import type { WebgpuPagesRuntime } from '../../../packages/sdk-browser/src/frame/backend/runtime.ts'
import { CENTIMETRES, rayCrossing, type RigClipmap } from './rigField.ts'
import { objectGrid } from './rigGrid.ts'
import type { RigFace } from './rigRuntime.ts'
import type { Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'

/** The resolution level of every card: one page of 128 texels along an axis, fewer along the shorter one. */
const LEVEL = 7
/** The half thickness, metres, a face's cards keep at least along any axis. */
const THIN = 0.01
/** The depth word of a texel with no surface. */
const NO_SURFACE = 0xffff
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** A card's three axes in the mesh's space, by the axis it looks along (0 to 2) and the third axis facing out of the mesh. */
const DIRECTIONS: Vec3[] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
]

/** The six cards of the mesh of `triangles` (metres): the box of its triangles, thickened by `THIN`, seen along each axis. */
function meshCardsOf(mesh: number, triangles: Float32Array): MeshCards {
  const low: Vec3 = [Infinity, Infinity, Infinity],
    high: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < triangles.length; k++) {
    low[k % 3] = Math.min(low[k % 3], triangles[k] - THIN)
    high[k % 3] = Math.max(high[k % 3], triangles[k] + THIN)
  }
  const centre = low.map((l, a) => (l + high[a]) / 2) as Vec3
  const half = low.map((l, a) => (high[a] - l) / 2)
  const cards = DIRECTIONS.map((axisZ, direction) => {
    const axis = direction >> 1
    const [u, v] = [0, 1, 2].filter((a) => a !== axis)
    const unit = (a: number): Vec3 => [0, 1, 2].map((k) => (k === a ? 1 : 0)) as Vec3
    return {
      origin: centre,
      extent: [half[u], half[v], half[axis]] as Vec3,
      axisX: unit(u),
      axisY: unit(v),
      axisZ,
      direction,
    }
  })
  return { mesh, hlodCell: false, mostlyTwoSided: false, min: low, max: high, cards }
}

/** The distance along the ray `o + t·d` to the nearest of `triangles` (nine numbers each, centimetres), Infinity when none: both sides count. */
function nearest(triangles: Float64Array, o: Vec3, d: Vec3) {
  let best = Infinity
  for (let k = 0; k < triangles.length; k += 9)
    best = Math.min(best, rayCrossing(o, d, triangles, k, 1e-6))
  return best
}

/** The light word of the cache's atlas for `rgb`: three channels of 6, 6 and 5 bits of mantissa (`packLight`). */
function lightWord([r, g, b]: readonly number[]) {
  const float = new Float32Array(1),
    bits = new Uint32Array(float.buffer)
  const small = (x: number, mantissa: number) => {
    const top = (30 << mantissa) | ((1 << mantissa) - 1)
    const v = Math.min(Math.max(x, 0), 131008)
    if (v < 6.103515625e-5) return Math.min(Math.round(v * 2 ** (14 + mantissa)), top)
    float[0] = v
    const shift = 23 - mantissa
    return Math.min(
      ((bits[0] >>> 23) - 112) * (1 << mantissa) +
        (((bits[0] & 0x7fffff) + (1 << (shift - 1))) >> shift),
      top,
    )
  }
  return (small(r, 6) | (small(g, 6) << 11) | (small(b, 5) << 22)) >>> 0
}

/** The depth and final light of every page of `cache`, written in the atlas textures: the texel `(i, j)` of a page is the card's point at the middle of it, its depth the distance along the card's axis from its outer face to the face's triangles over twice the card's half thickness. */
function fillAtlas(
  device: GPUDevice,
  cache: ReturnType<typeof createSurfaceCache>,
  faces: readonly RigFace[],
  instances: readonly number[],
  depth: GPUTexture,
  final: GPUTexture,
) {
  const side = cache.atlasPages * PAGE_SIZE
  const depths = new Uint32Array(side * side).fill(NO_SURFACE)
  const lights = new Uint32Array(side * side)
  const centimetres = faces.map(({ triangles }) =>
    Float64Array.from(triangles, (m) => m * CENTIMETRES),
  )
  const start: Vec3 = [0, 0, 0],
    along: Vec3 = [0, 0, 0]
  for (let index = 0; index < cache.pages.length; index++) {
    if (!cache.pages.has(index)) continue
    const page = cache.pages.at(index)
    if (page.physX < 0) continue
    const card = cache.cards.at(page.card)
    const face = faces[instances[card.meshCards]]
    const word = lightWord(face.radiance)
    const width = page.maxX - page.minX,
      height = page.maxY - page.minY
    const [ex, ey, ez] = card.extent
    for (let j = 0; j < height; j++)
      for (let i = 0; i < width; i++) {
        const lx = ex * (2 * ((i + 0.5) / width) - 1),
          ly = ey * (1 - 2 * ((j + 0.5) / height))
        for (let k = 0; k < 3; k++) {
          start[k] = card.origin[k] + card.axisX[k] * lx + card.axisY[k] * ly + card.axisZ[k] * ez
          along[k] = -card.axisZ[k]
        }
        const t = nearest(centimetres[instances[card.meshCards]], start, along)
        if (!(t < 2 * ez)) continue
        const at = (page.minY + j) * side + page.minX + i
        depths[at] = Math.min(Math.round((t / (2 * ez)) * 65535), 65534)
        lights[at] = word
      }
  }
  for (const [texture, data] of [
    [depth, depths],
    [final, lights],
  ] as const)
    device.queue.writeTexture({ texture }, data, { bytesPerRow: side * 4 }, [side, side])
}

/** The cache of `faces`: a placement and six cards for each, every card one page at `LEVEL`, mapped and confirmed; `instances` gives the face of each mesh cards. */
function cacheOf(faces: readonly RigFace[]) {
  const side = PAGE_SIZE * Math.max(2, Math.ceil(Math.sqrt(faces.length * 6)) + 1)
  const cache = createSurfaceCache(
    resolveSettings(SURFACE_CACHE_RULES, {
      surfaceCacheAtlasSize: side,
      surfaceCacheMeshCardsCullFaces: false,
      surfaceCacheMeshCardsMinSize: 0,
    }),
  )
  updateAtlasSize(cache, false, 1, WORD_LIGHT_FORMAT)
  const instances: number[] = []
  faces.forEach(({ triangles }, k) => {
    setPlacement(cache, k, { world: IDENTITY, cards: meshCardsOf(k, triangles), emissive: true })
    const placement = cache.placements.get(k)
    if (!placement) throw new Error(`the rig's face ${k} has no cards`)
    addMeshCards(cache, placement)
    instances[placement.meshCards] = k
    const mesh = cache.meshCards.at(placement.meshCards)
    for (let at = mesh.firstCard; at < mesh.firstCard + mesh.numCards; at++) {
      const card = cache.cards.at(at)
      card.visible = true
      reallocVirtualSurface(cache, card, at, LEVEL, true)
      const mip = mipOf(card, LEVEL)
      const held = Array.from({ length: mip.spanSize }, (_, local) => mip.spanOffset + local)
      for (const page of held) mapPage(cache, mip, page)
      confirmPages(cache, held)
    }
  })
  return { cache, instances }
}

/**
 * The surface cache of `faces` for the hits of a rig whose field is `clipmap`: the resources a hit binds
 * (`SurfaceHitResources`, over the stand-ins `stand` for what a hit reads and the cache has none of) and what disposes them.
 * The faces are the field's, in the same order: the face `k` of the field is the object `k` of the grid, the placement `k`
 * of the cache. What was made when it throws is destroyed.
 */
export function rigCache(
  device: GPUDevice,
  faces: readonly RigFace[],
  clipmap: RigClipmap,
  stand: ReturnType<typeof createHitCards>,
) {
  const made: { destroy(): void }[] = []
  const keep = <T extends { destroy(): void }>(resource: T) => (made.push(resource), resource)
  const dispose = () => made.forEach((resource) => resource.destroy())
  try {
    const { cache, instances } = cacheOf(faces)
    const side = cache.atlasPages * PAGE_SIZE
    const layer = () =>
      keep(
        device.createTexture({
          size: [side, side],
          format: 'r32uint',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        }),
      )
    const depth = layer(),
      final = layer()
    fillAtlas(device, cache, faces, instances, depth, final)
    const tables = createSurfaceTables(device)
    made.push({ destroy: tables.dispose })
    const encoder = device.createCommandEncoder()
    tables.update(cache, 1, 1, encoder)
    device.queue.submit([encoder.finish()])
    if (!tables.buffer) throw new Error("the rig's surface cache wrote no tables")
    const buffer = (words: Uint32Array<ArrayBuffer>) => {
      const buffer = keep(
        device.createBuffer({
          size: Math.max(16, words.byteLength),
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }),
      )
      device.queue.writeBuffer(buffer, 0, words)
      return buffer
    }
    const hit: SurfaceHitResources = {
      ...stand.resources({} as WebgpuPagesRuntime, WORD_LIGHT_FORMAT),
      tables: tables.buffer,
      depth: depth.createView(),
      final: final.createView(),
      grid: buffer(objectGrid(clipmap, faces)),
      instances: buffer(Uint32Array.from([faces.length, ...faces.keys()])),
    }
    return { hit, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
