import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOX_CORNER_VALUES } from '../../hiz/corners.ts'
import { VERDICT_KEPT, VERDICT_REJECTED } from '../../gpu/partition/contract.ts'
import { VsmCacheManager } from '../../vsm/cacheManager.ts'
import { frame } from '../../vsm/clipmap.fixture.ts'
import { VSM_ENTRY_DRAWABLE_BIT, VSM_ENTRY_MAPPED_BIT } from '../../vsm/constants.ts'
import { inspectedCamera } from './camera.ts'
import { cameraAt } from './inspection.fixture.ts'
import { inspectedClusters, slotsRead, type ClusterSnapshot } from './clusters.ts'
import { decodeShadowMap, shadowTableRows, snapshotShadowMaps } from './shadows.ts'
import { CLUSTER_STATE } from './types.ts'

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`)

test('the inspected frustum: its near corners at the near distance, its edges leave them outward', () => {
  const camera = inspectedCamera(cameraAt([1, 2, 3]))
  assert.deepEqual(camera.eye, [1, 2, 3])
  camera.forward.forEach((v, k) => close(v, [0, 0, -1][k]))
  assert.equal(camera.perspective, true)
  for (let corner = 0; corner < 4; corner++) {
    const at = 3 * corner,
      sx = corner === 0 || corner === 3 ? -1 : 1,
      sy = corner < 2 ? -1 : 1
    // A 90° field: the near plane reaches as far sideways as it lies ahead.
    close(camera.nearCorners[at], 1 + sx * 0.5)
    close(camera.nearCorners[at + 1], 2 + sy * 0.5)
    close(camera.nearCorners[at + 2], 3 - 0.5)
    const edge = Array.from(camera.edges.subarray(at, at + 3))
    edge.forEach((v, k) => close(v, [sx, sy, -1][k] / Math.sqrt(3)))
  }
})

/** A snapshot of boxes `[x, y, z, side]`, the first `kept` drawn, judged at slots `slots`. */
function snapshot(boxes: number[][], slots: number[], firstMissing: number): ClusterSnapshot {
  const corners = new Float64Array(boxes.length * BOX_CORNER_VALUES)
  boxes.forEach(([x, y, z, side], i) => {
    for (let corner = 0; corner < 8; corner++) {
      const at = i * BOX_CORNER_VALUES + corner * 3
      corners[at] = x + (corner & 1 ? side : 0)
      corners[at + 1] = y + (corner & 2 ? side : 0)
      corners[at + 2] = z + (corner & 4 ? side : 0)
    }
  })
  return {
    count: boxes.length,
    corners,
    level: Uint8Array.from(boxes.map((_, i) => i)),
    triangles: Uint32Array.from(boxes.map(() => 128)),
    slots: Int32Array.from(slots),
    firstMissing,
    frustumRejected: 7,
    truncated: false,
  }
}

test('the inspected clusters: world boxes, levels, and kept, occluded or missing', () => {
  const snap = snapshot(
    [
      [0, 0, 0, 1],
      [10, -2, 5, 2],
      [3, 3, 3, 0.5],
      [-4, 0, 1, 4],
    ],
    [2, 0, -1, -1],
    3,
  )
  assert.equal(slotsRead(snap), 3)
  const verdicts = Uint32Array.from([VERDICT_REJECTED, VERDICT_KEPT, VERDICT_KEPT])
  const clusters = inspectedClusters(snap, verdicts)
  assert.equal(clusters.count, 4)
  assert.deepEqual(Array.from(clusters.bounds.subarray(6, 12)), [10, -2, 5, 12, 0, 7])
  assert.deepEqual(Array.from(clusters.level), [0, 1, 2, 3])
  const { kept, occluded, missing } = CLUSTER_STATE
  // Slot 2 kept, slot 0 rejected, no slot kept, then the missing one.
  assert.deepEqual(Array.from(clusters.state), [kept, occluded, kept, missing])
  assert.equal(clusters.frustumRejected, 7)
  // Without the verdicts read back, nothing is called occluded.
  assert.deepEqual(Array.from(inspectedClusters(snap).state), [kept, kept, kept, missing])
})

/** The sun's clipmap of the fixture, its entry given ids, as a plan leaves it. */
function sunMaps(eye: number[]) {
  const cache = new VsmCacheManager({ poolPages: 1024 })
  const clipmap = frame(cache, eye)
  clipmap.cacheEntry.mapId = 0
  const maps = snapshotShadowMaps([clipmap.cacheEntry], () => 'directional')
  return { clipmap, maps }
}

test("a sun's shadow pages placed in the world, drawn or cached, its fallbacks left out", () => {
  const eye = [12.5, 3, -40]
  const { clipmap, maps } = sunMaps(eye)
  assert.equal(maps.length, clipmap.levels.length)
  const map = maps[0],
    width = 256
  assert.equal(map.seen, true)
  assert.ok(shadowTableRows(maps) >= 129)
  const words = new Uint32Array(width * 192)
  words[64 * width + 64] = (VSM_ENTRY_MAPPED_BIT | VSM_ENTRY_DRAWABLE_BIT) >>> 0
  words[0] = VSM_ENTRY_MAPPED_BIT >>> 0
  // Mapped through a coarser level: not a page of this one.
  words[5 * width + 9] = (VSM_ENTRY_MAPPED_BIT | (2 << 20)) >>> 0
  const shadow = decodeShadowMap(map, words, width)
  assert.equal(shadow.mappedCount, 2)
  assert.equal(shadow.renderedCount, 1)
  // Row by row: page (0, 0), cached, then page (64, 64), drawn.
  assert.deepEqual(Array.from(shadow.rendered), [0, 1])
  assert.equal(shadow.level, clipmap.firstLevel)
  // Page (64, 64)'s first corner is the map's centre: the level's own, in the world.
  const centre = clipmap.levels[0].worldCentre
  for (let k = 0; k < 3; k++) close(shadow.pages[12 + k], centre[k], 1e-5)
  // Page (0, 0)'s first corner is the level's corner: half its span off along both light axes.
  const half = (2 * 2 ** (clipmap.firstLevel + 1)) / 100
  const d = [0, 1, 2].map((k) => shadow.pages[k] - centre[k])
  close(Math.hypot(...d), Math.SQRT2 * half, 1e-4)
  // Every corner lies on the plane through the centre facing the light.
  const along = d[0] * shadow.direction[0] + d[1] * shadow.direction[1] + d[2] * shadow.direction[2]
  close(along, 0, 1e-4)
})

test("a local light's maps count their pages and place none; another view's suns are left out", () => {
  const cache = new VsmCacheManager({ poolPages: 1024 })
  const local = cache.lightEntryFor('lamp', 1)
  local.mapId = 3
  local.mapCaches[0].projectionData.finestMip = 4
  const other = frame(cache, [0, 0, 0]).cacheEntry
  other.mapId = 0
  const aside = cache.lightEntryFor('sun', 1, 'aside')
  aside.mapId = 9
  const maps = snapshotShadowMaps(cache.entries.values(), (id) =>
    id === 'lamp' ? 'spot' : 'directional',
  )
  const spot = maps.find((map) => map.light === 'lamp')!
  assert.equal(maps.filter((map) => map.light === 'sun').length, other.mapCaches.length)
  assert.equal(spot.side, 8)
  const words = new Uint32Array(64 * 16)
  words[11 * 64 + 2] = VSM_ENTRY_MAPPED_BIT >>> 0
  const shadow = decodeShadowMap(spot, words, 64)
  assert.equal(shadow.mappedCount, 1)
  assert.equal(shadow.pages.length, 0)
})
