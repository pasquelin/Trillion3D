// A colour tile stales only the shadow pages of the masked surfaces that read its texture: a tile of
// a texture no cutout reads, or a colour change on an opaque material, leaves every map as it is.
// The CPU boxes the resident clusters of those surfaces alone, one box a root, one scan of the
// resident clusters a pump (`followChanges.ts`); and a surface whose alpha moved under a casting light
// stales the pages over its clusters (`refreshWebgpuMaterials`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { FLAG_MASK } from '../../../visibility/types.ts'
import { refreshWebgpuMaterials } from '../../../frame/io/refreshMaterials.ts'
import type { PageSurface } from '../../../geometry/pages/surface.ts'
import type { PageRec } from '../../../geometry/selection/types.ts'
import { shadowsFollowSurfaces, shadowsFollowTextures } from './followChanges.ts'
import type { FollowRuntime } from './followChanges.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/** The surfaces of a forest: bark and knots are cutouts on the atlas slots 3 and 5, leaves an opaque
 *  surface on slot 7. */
const bark = {} as PageSurface,
  leaves = {} as PageSurface,
  knots = {} as PageSurface
const ROWS = new Map<PageSurface, { map: number; bits: number }>([
  [bark, { map: 3, bits: FLAG_MASK }],
  [leaves, { map: 7, bits: 0 }],
  [knots, { map: 5, bits: FLAG_MASK }],
])

/** A cluster, the unit box about `at` along x, of `material`. */
const record = (material: PageSurface, at: number) =>
  ({ material, min: [at, 0, 0], max: [at + 1, 1, 1] }) as unknown as PageRec

/** One root holding bark, leaves and knots clusters, its second a lone knots cluster; a light that
 *  casts, and a spy of the CPU's boxes. `resident` names the packed pages that are. */
function forest(casting = true, resident = [0, 1, 2, 3]) {
  const records = [record(bark, 0), record(leaves, 10), record(knots, 20), record(knots, 100)]
  const boxes: Array<{ box: number[]; moving: boolean }> = []
  const representation: number[][] = []
  const identity = () => {
    const elements = new Float64Array(16)
    for (let k = 0; k < 4; k++) elements[k * 5] = 1
    return { world: { elements }, pages: [] as PageRec[], reach: 0 }
  }
  const roots = [identity(), identity()]
  roots[0].pages = records.slice(0, 3)
  roots[1].pages = records.slice(3)
  const moving = new Set<number>()
  const rt = {
    lights: {
      store: { count: casting ? 1 : 0 },
      mobility: { cachedDynamic: (rank: number) => moving.has(rank) },
      changes: {
        worldChanged: (min: ArrayLike<number>, max: ArrayLike<number>, movingOnly: boolean) =>
          void boxes.push({ box: [...Array.from(min), ...Array.from(max)], moving: movingOnly }),
        representationChanged: (min: ArrayLike<number>, max: ArrayLike<number>) =>
          void representation.push([...Array.from(min), ...Array.from(max)]),
      },
    },
    layout: {
      clusters: {
        residentPages: () => ({ pages: Int32Array.from(resident), count: resident.length }),
      },
      recordOf: (page: number) => records[page],
      selectionRoots: roots,
      placement: { baseOfRoot: Int32Array.of(0, 3), packedCount: 4 },
    },
    vis: {
      mapLayer: new Map(),
      dataLayer: new Map(),
      materialTable: {
        surface: (material: PageSurface) => ({ rank: 0, row: ROWS.get(material)! }),
      },
    },
  } as unknown as FollowRuntime
  return { rt, boxes, representation, moving }
}

test('a tile of a texture read by a cutout boxes that cutout, not the opaque surface beside it', () => {
  const { rt, boxes } = forest()
  shadowsFollowTextures(rt, new Set([3]))
  assert.equal(boxes.length, 1, 'one box a root')
  const [{ box }] = boxes
  assert.ok(box[0] <= 0 && box[3] >= 1, 'the bark cluster is in it')
  assert.ok(box[3] < 10, 'the leaves beside it are not')
})

test('tiles of two textures served by one pump box both cutouts of the root, in one scan', () => {
  const { rt, boxes } = forest()
  shadowsFollowTextures(rt, new Set([3, 5]))
  const first = boxes.find(({ box }) => box[0] <= 0)!.box
  assert.ok(first[0] <= 0 && first[3] >= 21, 'bark and knots in one box of their root')
  assert.equal(boxes.length, 2, 'and the other root’s knots in its own')
  assert.ok(boxes.some(({ box }) => box[0] <= 100 && box[3] >= 101 && box[0] > 50))
})

test('a tile of a texture no cutout reads boxes nothing', () => {
  const { rt, boxes } = forest()
  shadowsFollowTextures(rt, new Set([9]))
  assert.equal(boxes.length, 0)
})

test('a tile of a texture only an opaque surface reads boxes nothing', () => {
  const { rt, boxes } = forest()
  shadowsFollowTextures(rt, new Set([7]))
  assert.equal(boxes.length, 0, 'the opaque cluster on that texture is left')
})

test('a cluster that is not resident is never boxed', () => {
  const { rt, boxes } = forest(true, [2, 3])
  shadowsFollowTextures(rt, new Set([3, 5]))
  assert.equal(boxes.length, 2)
  assert.ok(
    boxes.every(({ box }) => box[0] > 15),
    'the bark cluster, not resident, is left out',
  )
})

test('the boxes of a placement already moving are for its moving casters alone', () => {
  const { rt, boxes, moving } = forest()
  moving.add(1)
  shadowsFollowTextures(rt, new Set([5]))
  assert.deepEqual(boxes.map(({ moving }) => moving).sort(), [false, true])
})

test('a resize, which names no texture, still restarts everything', () => {
  const { rt, boxes, representation } = forest()
  shadowsFollowTextures(rt, -1)
  assert.equal(representation.length, 1)
  assert.ok(representation[0][0] < -1e29 && representation[0][3] > 1e29)
  assert.equal(boxes.length, 0)
})

test('with no light declared, a tile stales nothing', () => {
  const { rt, boxes, representation } = forest(false)
  shadowsFollowTextures(rt, -1)
  shadowsFollowTextures(rt, new Set([3]))
  shadowsFollowSurfaces(rt, new Set([bark]))
  assert.equal(boxes.length + representation.length, 0)
})

// A page moved a material's alpha: its clusters' shadow pages stale whatever their flags say —
// an opaque surface turned masked has no cutout flag until its cluster record is written again.
test('an alpha change boxes the clusters of its surfaces, the opaque ones too', () => {
  const { rt, boxes } = forest()
  shadowsFollowSurfaces(rt, new Set([leaves]))
  assert.equal(boxes.length, 1)
  assert.ok(boxes[0].box[0] <= 10 && boxes[0].box[3] >= 11 && boxes[0].box[3] < 20)
  shadowsFollowSurfaces(rt, new Set())
  assert.equal(boxes.length, 1, 'no surface, no box')
})

// A cutoff moved in place under a casting light drew a few shadowed pixels off the image of a
// session opened on it: its redrawn shadow pages land in other pool slots, and a shadow read
// depended on the slot. The move is taken in place, the shadow over its clusters drawn again — the
// box of those clusters entered into the world's changes, which the next plan stales.
test('an alpha move is taken in place under a casting light, the shadow over its clusters drawn again', () => {
  const { rt, boxes } = forest()
  const runtime = Object.assign(rt, {
    layout: Object.assign(rt.layout, { clusters: { ...rt.layout.clusters, infoEpoch: 1 } }),
    run: { gate: { movedInPlace() {} } },
  }) as unknown as WebgpuPagesRuntime
  const alpha = { surfaces: [bark], from: 'mask', to: 'mask' } as const
  assert.equal(refreshWebgpuMaterials(runtime, true, alpha as never), true, 'no new session')
  assert.equal(boxes.length, 1, 'the shadow pages over the cutout drawn again')
  assert.ok(boxes[0].box[0] <= 0 && boxes[0].box[3] >= 1)
  assert.equal(runtime.layout.clusters.infoEpoch, 2, 'and its clusters’ records written again')
  assert.equal(refreshWebgpuMaterials(runtime, true), true, 'values alone stay in place')
  assert.equal(boxes.length, 1, 'and stale no shadow')
})
