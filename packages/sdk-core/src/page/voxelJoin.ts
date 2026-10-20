import { EngineError } from '../contracts/cache.ts'
import type { ClusterManifest, Page, Primitive } from '../contracts/geometry.ts'
import type { VoxelFile, VoxelGroup } from '../contracts/voxel.ts'
import { sphereUnion } from '../../../math/src/geometry/sphere.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import {
  encodeVoxelPage,
  VOXEL_BRICK_INDICES,
  VOXEL_PAGE_BRICKS,
  VOXEL_PAGE_HEAD_WORDS,
  VOXEL_PAGE_MAGIC,
  type VoxelPage,
} from './voxelPage.ts'

/**
 * THE VOXEL LEVELS JOINED TO THE DAG THEY CONTINUE (`../contracts/voxel.ts`): a group's bricks
 * pages of its primitive, as many to a page as `VOXEL_PAGE_BRICKS`, in the group links the
 * one cut reads, so the DAG's own pixel-error rule picks
 * a voxel level as it picks a triangle level — no second rule, no distance.
 *
 * - A group of a primitive's DAG drawn as voxels takes its bricks as its outputs: its children are
 *   replaced by them, and they by the group that replaced its triangle outputs. Those triangles
 *   leave the links: nothing produces nor replaces them, and their band is empty
 *   (`parentError` = `lodError`), so the rule never draws them. Joined only where the swap is
 *   exact — its outputs all roots, or all replaced by one group —; a group whose outputs have
 *   several parents keeps its triangles (`VoxelJoined.kept`): one parent cannot hide its bricks
 *   for two.
 * - A mesh's far group stands above the roots of every primitive of it: one new group per
 *   primitive whose children are its roots. The first primitive outputs the bricks; each other
 *   outputs one empty page, so its roots are replaced in the same band, and the bricks alone draw
 *   the mesh past it. A blended primitive is left as it is.
 *
 * Every band is then settled level by level (`settle`): a group's error is at least its children's,
 * so the band of every page stays ordered whatever error the file gives.
 */

/** A primitive's voxel pages, in the order they follow its own pages: their records and bytes. */
export type VoxelJoin = { primitive: Primitive; pages: Page[]; bytes: Uint8Array<ArrayBuffer>[] }

/** What a join did: the joins by primitive, the groups it drew as voxels, those it left. */
export type VoxelJoined = { joins: Map<Primitive, VoxelJoin>; joined: number; kept: number }

/** The fields a new page takes from its group. */
type Producer = Pick<Page, 'level' | 'lodError' | 'sphere' | 'source'>

/** A voxel page culls nothing by its facing: its voxels face every way. */
const ANY_FACING = { axis: [0, 0, 1] as [number, number, number], angle: Math.PI }

/** Page `index` of a primitive, its own or one `join` adds. */
const pageAt = (join: VoxelJoin, index: number) => {
  const own = join.primitive.pages
  return index < own.length ? own[index] : join.pages[index - own.length]
}

/** Adds `voxels` as a page of `join`: its index. */
function addPage(join: VoxelJoin, voxels: VoxelPage, producer: Producer) {
  const id = join.primitive.pages.length + join.pages.length
  join.pages.push({
    ...{ id, url: '', sha256: '', bytes: voxels.bytes.byteLength },
    ...{ count: voxels.bricks * VOXEL_BRICK_INDICES, min: voxels.min, max: voxels.max },
    role: 'coarse',
    ...{ ...producer, parentError: null, parentSphere: null, group: null, cone: ANY_FACING },
  })
  join.bytes.push(voxels.bytes)
  return id
}

/** The bricks of `group` as pages of `join`, in the file's order — near bricks together —,
 *  `VOXEL_PAGE_BRICKS` a page: their indices. */
function brickPages(file: VoxelFile, group: VoxelGroup, join: VoxelJoin, producer: Producer) {
  const ids: number[] = []
  let voxel = group.firstVoxel
  for (let b = 0; b < group.bricks; b += VOXEL_PAGE_BRICKS) {
    const count = Math.min(VOXEL_PAGE_BRICKS, group.bricks - b)
    const page = encodeVoxelPage(file, group, [b, count], voxel)
    voxel += page.voxels
    ids.push(addPage(join, page, producer))
  }
  if (voxel !== group.firstVoxel + group.voxels)
    throw new EngineError('INVALID_CACHE', 'a voxel group holds other voxels than its bricks', {})
  return ids
}

/** A page of no voxel, at `at`: what stands for a primitive's roots in its mesh's far group. */
function emptyPage(at: number[]): VoxelPage {
  const words = new Uint32Array(VOXEL_PAGE_HEAD_WORDS)
  words[0] = VOXEL_PAGE_MAGIC
  return {
    bytes: new Uint8Array(words.buffer),
    bricks: 0,
    voxels: 0,
    min: at.slice(0, 3),
    max: at.slice(0, 3),
  }
}

/** The one group that replaces every output of group `g`, null when they are roots, undefined
 *  when they have several parents or mix both. */
function soleParent(join: VoxelJoin, outputs: readonly number[]) {
  const parents = new Set(outputs.map((output) => pageAt(join, output).group ?? null))
  return parents.size === 1 ? [...parents][0] : undefined
}

/** Draws DAG group `voxels.group` of `join`'s primitive as its bricks, where the swap is exact. */
function joinGroup(file: VoxelFile, voxels: VoxelGroup, join: VoxelJoin) {
  const s = join.primitive.structure!,
    group = s.groups[voxels.group]
  if (!group) throw new EngineError('INVALID_CACHE', 'a voxel group names no DAG group', {})
  const parent = soleParent(join, group.outputs)
  if (parent === undefined) return false
  const ids = brickPages(file, voxels, join, {
    ...{ level: group.level, lodError: voxels.error, sphere: group.sphere, source: voxels.group },
  })
  const gone = new Set(group.outputs)
  for (const output of group.outputs) {
    const page = pageAt(join, output)
    page.parentError = page.lodError
    page.parentSphere = page.sphere
    page.group = null
  }
  if (parent === null) s.roots = [...s.roots.filter((root) => !gone.has(root)), ...ids]
  else {
    const above = s.groups[parent]
    above.children = [...above.children.filter((child) => !gone.has(child)), ...ids]
  }
  group.outputs = ids
  group.error = voxels.error
  return true
}

/** The ball around every root of `joins` and the far bricks, grown by a hair so it holds each
 *  exactly: the band of a mesh's far group. */
function farSphere(joins: readonly VoxelJoin[], bricks: readonly Page[]) {
  const ball = new Float64Array([0, 0, 0, -1])
  for (const join of joins)
    for (const root of join.primitive.structure!.roots)
      sphereUnion(ball, 0, pageAt(join, root).sphere!, 0)
  for (const { min, max } of bricks) {
    const half = [0, 1, 2].map((a) => (max[a] - min[a]) / 2)
    const box = [...half.map((h, a) => min[a] + h), length3(half[0], half[1], half[2])]
    sphereUnion(ball, 0, box, 0)
  }
  ball[3] *= 1 + 1e-6
  return [...ball]
}

/** Stands mesh group `voxels` above the roots of `joins`' primitives (the mesh's own). */
function joinFar(file: VoxelFile, voxels: VoxelGroup, joins: readonly VoxelJoin[]) {
  let error = voxels.error,
    level = 0
  for (const join of joins)
    for (const root of join.primitive.structure!.roots) {
      error = Math.max(error, pageAt(join, root).lodError!)
      level = Math.max(level, pageAt(join, root).level ?? 0)
    }
  level++
  const host = joins[0],
    first = host.pages.length
  brickPages(file, voxels, host, { level, lodError: error, sphere: [], source: null })
  const sphere = farSphere(joins, host.pages.slice(first))
  joins.forEach((join, k) => {
    const s = join.primitive.structure!,
      g = s.groups.length
    const producer = { level, lodError: error, sphere, source: g }
    const own = join.primitive.pages.length
    const ids = k
      ? [addPage(join, emptyPage(sphere), producer)]
      : host.pages.slice(first).map((page, i) => (Object.assign(page, producer), own + first + i))
    s.groups.push({ level, error, sphere, children: s.roots, outputs: ids })
    s.roots = ids
  })
}

/** Orders every band of `join`'s primitive: a group's error is at least its children's, each child
 *  is replaced at that error through the group's ball, each output produced at it. */
function settle(join: VoxelJoin) {
  const s = join.primitive.structure!
  const order = s.groups.map((_, g) => g).sort((a, b) => s.groups[a].level - s.groups[b].level)
  for (const g of order) {
    const group = s.groups[g]
    for (const child of group.children)
      group.error = Math.max(group.error, pageAt(join, child).lodError ?? 0)
    for (const child of group.children)
      Object.assign(pageAt(join, child), {
        ...{ parentError: group.error, parentSphere: group.sphere, group: g },
      })
    for (const output of group.outputs) pageAt(join, output).lodError = group.error
  }
}

/** Whether `primitive` takes voxel levels: drawn opaque, with group links — its roots at least —, and one its host
 *  can serve new pages for (`servable`). */
const joinable = (primitive: Primitive | undefined, servable: (primitive: Primitive) => boolean) =>
  !!primitive?.structure && primitive.pass !== 'clustered-blend' && servable(primitive)

/** Joins `file`'s groups to the primitives of `metadata` (above): the pages each primitive gains,
 *  its links and bands rewritten in place. */
export function joinVoxelLevels(
  metadata: ClusterManifest,
  file: VoxelFile,
  servable: (primitive: Primitive) => boolean = () => true,
): VoxelJoined {
  const joins = new Map<Primitive, VoxelJoin>()
  const joinOf = (primitive: Primitive) => {
    let join = joins.get(primitive)
    if (!join) joins.set(primitive, (join = { primitive, pages: [], bytes: [] }))
    return join
  }
  let joined = 0,
    kept = 0
  const groups = file.groups.filter((group) => group.bricks > 0)
  const owned = groups.filter((group) =>
    joinable(metadata.primitives[group.primitive ?? -1], servable),
  )
  owned.sort((a, b) => a.primitive! - b.primitive! || a.group - b.group)
  for (const group of owned)
    if (joinGroup(file, group, joinOf(metadata.primitives[group.primitive!]))) joined++
    else kept++
  joins.forEach(settle)
  for (const group of groups.filter((g) => g.primitive === null)) {
    const mesh = metadata.primitives.filter((p) => p.mesh === group.group && joinable(p, servable))
    if (!mesh.length) continue
    const meshJoins = mesh.map(joinOf)
    joinFar(file, group, meshJoins)
    meshJoins.forEach(settle)
    joined++
  }
  return { joins, joined, kept }
}
