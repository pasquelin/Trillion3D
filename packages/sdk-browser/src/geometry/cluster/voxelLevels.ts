import type {
  ClusterManifest,
  CullingHierarchy,
  Page,
  Primitive,
  StreamBundle,
} from '../../../../sdk-core/src/contracts/geometry.ts'
import { assertVoxelSection, decodeVoxelFile } from '../../../../sdk-core/src/contracts/voxel.ts'
import { joinVoxelLevels, type VoxelJoin } from '../../../../sdk-core/src/page/voxelJoin.ts'
import {
  GEOMETRY_VOXEL,
  VOXEL_BRICK_CORNERS,
  VOXEL_BRICK_INDICES,
} from '../../../../sdk-core/src/page/voxelPage.ts'
import { CULLING_FANOUT } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import { sphereUnion } from '../../../../math/src/geometry/sphere.ts'
import { boxEmpty, boxUnion, boxUnionBox } from '../../../../math/src/geometry/box.ts'
import {
  CULL_CEIL,
  CULL_CHILD_COUNT,
  CULL_FIRST_CHILD,
  CULL_FIRST_PAGE,
  CULL_FLOOR,
  CULL_MAX,
  CULL_MIN,
  CULL_PAGE_COUNT,
  CULL_SPHERE,
} from '../dag/types.ts'
import { sha256Hex } from '../streaming/sha256Hex.ts'
import { served } from '../streaming/served.ts'
import { readSidecar } from './sidecarFile.ts'
import type { ByteMeter } from './byteMeter.ts'

/**
 * THE VOXEL LEVELS OF A CACHE, READ INTO ITS PRIMITIVES (`voxels.bin`, `../../../../sdk-core/src/contracts/voxel.ts`).
 * The file is read once beside the manifest, its groups joined to the DAG they continue
 * (`joinVoxelLevels`), and each primitive's bricks served as one more streaming bundle of its
 * own, at an address of its own with the digest its read checks — as a cut made at run time is
 * (`../runtime/runtimePrimitive.ts`). From there a brick is a page like any other: catalogued,
 * streamed, held and evicted by the one streamer, chosen by the one cut, drawn by every raster
 * through the page geometry (`../../visibility/shader/voxelWgsl.ts`).
 *
 * Each primitive's culling tree gains a root over its old one and a tree of its bricks, a leaf a
 * group part and `CULLING_FANOUT` children a node as the compiler packs them; every node's
 * replacement ceiling, ball and least own error are read again from the pages, whose bands the
 * join rewrote.
 */

/** A node of the bricks' culling tree before it is laid out. */
type Tree = { box: Float64Array; first: number; count: number; children: Tree[] }

/** A leaf over `count` pages of `pages` from `at`, the first `first`. */
function leaf(pages: readonly Page[], at: number, count: number, first: number): Tree {
  const box = new Float64Array(6)
  boxEmpty(box, 0)
  for (let p = at; p < at + count; p++) {
    const { min, max } = pages[p]
    boxUnion(box, 0, min[0], min[1], min[2], max[0], max[1], max[2])
  }
  return { box, first: first + at, count, children: [] }
}

/** The tree of `pages`, the first of them page `first`: a leaf per group part — a run of pages of
 *  one group, the one bundle holding them all; a root a part of its own —, `CULLING_FANOUT`
 *  children a node. */
function brickTree(pages: readonly Page[], first: number) {
  let level: Tree[] = []
  for (let at = 0, end = 1; at < pages.length; at = end++) {
    const group = pages[at].group
    while (group != null && end < pages.length && pages[end].group === group) end++
    level.push(leaf(pages, at, end - at, first))
  }
  while (level.length > 1) {
    const up: Tree[] = []
    for (let at = 0; at < level.length; at += CULLING_FANOUT) {
      const children = level.slice(at, at + CULLING_FANOUT),
        box = new Float64Array(6)
      boxEmpty(box, 0)
      for (const c of children) boxUnionBox(box, 0, c.box)
      up.push({ box, first: 0, count: 0, children })
    }
    level = up
  }
  return level[0]
}

/** Lays `tree` out at node `at` of `nodes`, its children after every node there, breadth first. */
function layOut(nodes: number[], stride: number, at: number, tree: Tree) {
  const queue: [number, Tree][] = [[at, tree]]
  for (let k = 0; k < queue.length; k++) {
    const [index, node] = queue[k],
      base = index * stride
    for (let a = 0; a < 6; a++) nodes[base + CULL_MIN + a] = node.box[a]
    const firstChild = nodes.length / stride
    nodes[base + CULL_FIRST_CHILD] = node.children.length ? firstChild : 0
    nodes[base + CULL_CHILD_COUNT] = node.children.length
    nodes[base + CULL_FIRST_PAGE] = node.children.length ? 0 : node.first
    nodes[base + CULL_PAGE_COUNT] = node.children.length ? 0 : node.count
    node.children.forEach((child, i) => {
      for (let a = 0; a < stride; a++) nodes.push(0)
      queue.push([firstChild + i, child])
    })
  }
}

/** Every node's replacement ceiling, ball and least own error, read from `pages` bottom up: the
 *  greatest `parentError` under it (-1 where a page has none) through the ball of every
 *  replacement, and the least `lodError`. */
function ceilings(nodes: number[], stride: number, pages: readonly Page[]) {
  const ball = new Float64Array(4)
  for (let node = nodes.length / stride - 1; node >= 0; node--) {
    const base = node * stride
    ball.set([0, 0, 0, -1])
    let ceil = 0,
      floor = Infinity
    const take = (error: number, own: number, sphere: ArrayLike<number>, from: number) => {
      ceil = error < 0 || ceil < 0 ? -1 : Math.max(ceil, error)
      floor = Math.min(floor, own)
      sphereUnion(ball, 0, sphere, from)
    }
    const children = nodes[base + CULL_CHILD_COUNT]
    for (let c = 0; c < children; c++) {
      const child = (nodes[base + CULL_FIRST_CHILD] + c) * stride
      take(nodes[child + CULL_CEIL], nodes[child + CULL_FLOOR], nodes, child + CULL_SPHERE)
    }
    if (!children)
      for (let p = 0; p < nodes[base + CULL_PAGE_COUNT]; p++) {
        const page = pages[nodes[base + CULL_FIRST_PAGE] + p]
        take(page.parentError ?? -1, page.lodError ?? 0, page.parentSphere ?? page.sphere!, 0)
      }
    nodes[base + CULL_CEIL] = ceil
    nodes[base + CULL_FLOOR] = floor
    for (let a = 0; a < 4; a++) nodes[base + CULL_SPHERE + a] = ball[a]
  }
}

/** `culling` with a root over its old one and the tree of the `added` pages, the first page `first`. */
function grownCulling(culling: CullingHierarchy, pages: readonly Page[], first: number) {
  const { stride, nodes: old } = culling
  const nodes = new Array<number>(3 * stride).fill(0)
  for (let node = 0; node < culling.count; node++) {
    const row = old.slice(node * stride, (node + 1) * stride)
    if (row[CULL_CHILD_COUNT] > 0) row[CULL_FIRST_CHILD] += 2
    for (let a = 0; a < stride; a++) {
      if (node) nodes.push(row[a])
      else nodes[stride + a] = row[a]
    }
  }
  const bricks = brickTree(pages.slice(first), first),
    box = new Float64Array(old.slice(CULL_MIN, CULL_MAX + 3))
  boxUnionBox(box, 0, bricks.box)
  layOut(nodes, stride, 2, bricks)
  for (let a = 0; a < 6; a++) nodes[CULL_MIN + a] = box[a]
  nodes[CULL_FIRST_CHILD] = 1
  nodes[CULL_CHILD_COUNT] = 2
  ceilings(nodes, stride, pages)
  return { stride, count: nodes.length / stride, nodes }
}

/** The bundles `pages` of `primitive` lie in, and with `closed` every bundle those are installed
 *  after. */
function bundlesOf(
  primitive: Primitive,
  pages: Iterable<number>,
  closed: boolean,
  into = new Set<number>(),
) {
  const bundles = primitive.streams!.pages
  for (const index of pages) {
    const stream = primitive.pages[index]?.stream
    if (stream === undefined) continue
    into.add(stream)
    if (closed) for (const dependency of bundles[stream].dependencies) into.add(dependency)
  }
  return into
}

/** `join`'s bundle `bundle` added to its primitive's catalogue: installed after the bundles of its
 *  pages' replacements, and before those of the pages it replaces. */
function addBundle(join: VoxelJoin, bundle: StreamBundle) {
  const { primitive } = join,
    streams = primitive.streams!,
    groups = primitive.structure!.groups
  const own = primitive.pages.length,
    added = streams.pages.length
  const above = join.pages.flatMap((page) => (page.group == null ? [] : groups[page.group].outputs))
  const after = bundlesOf(primitive, above, true)
  bundle.dependencies = [...after].sort((a, b) => a - b)
  const below = new Set<number>()
  for (const group of groups)
    if (group.outputs.some((output) => output >= own))
      bundlesOf(primitive, group.children, false, below)
  for (const stream of below) {
    const listed = streams.pages[stream]
    // The pages of a bundle rank the clusters they name vertices of by the place of their bundle in
    // this list (`docs/FORMAT.md`, the references): the entries it holds keep theirs, the new ones
    // follow.
    const held = new Set(listed.dependencies)
    const more = [added, ...after].filter(
      (dependency) => dependency !== stream && !held.has(dependency),
    )
    listed.dependencies = [...listed.dependencies, ...more.sort((a, b) => a - b)]
    streams.maxDependencies = Math.max(streams.maxDependencies, listed.dependencies.length)
  }
  streams.pages.push(bundle)
}

/** `join`'s pages laid end to end in one body, each page's offset in it, and the body's digest. */
async function bodyOf(join: VoxelJoin) {
  const total = join.bytes.reduce((sum, bytes) => sum + bytes.byteLength, 0)
  const body = new Uint8Array(total)
  let end = 0
  const offsets = join.bytes.map((bytes) => {
    body.set(bytes, end)
    return (end += bytes.byteLength) - bytes.byteLength
  })
  return { body, offsets, sha256: await sha256Hex(body) }
}

/** `join`'s body served as one bundle at an address of its own (`urls` keeps it), then its pages
 *  made pages of its primitive: catalogue, culling tree and bundle list. */
function serveJoin(
  join: VoxelJoin,
  { body, offsets, sha256: digest }: Awaited<ReturnType<typeof bodyOf>>,
  urls: string[],
) {
  const { url, sha256, bytes: size } = served(body.buffer, digest, urls)
  const { primitive } = join,
    stream = primitive.streams!.pages.length,
    own = primitive.pages.length
  join.pages.forEach((page, k) => {
    const offset = offsets[k]
    Object.assign(page, { url: `${url}#${offset}`, sha256, stream, streamOffset: offset })
    page.geometry = {
      ...{ url: page.url, bundle: { url, offset }, sha256, bytes: page.bytes },
      // A page's count is its boxes' corners named, three a triangle; it holds eight a brick.
      vertexCount: (page.count / VOXEL_BRICK_INDICES) * VOXEL_BRICK_CORNERS,
      ...{ indexCount: page.count, flags: GEOMETRY_VOXEL },
      uncompressedBytes: page.bytes,
      // A voxel page is installed as it is read: what it takes in the pool is its bytes, at its
      // place in the bundle.
      residentBytes: page.bytes,
      residentOffset: offset,
    }
  })
  addBundle(join, { url, sha256, bytes: size, count: join.pages.length, dependencies: [] })
  primitive.pages.push(...join.pages)
  primitive.culling = grownCulling(primitive.culling!, primitive.pages, own)
}

/** Whether a primitive's pages can gain a bundle and a subtree. */
const servable = (primitive: Primitive) => !!primitive.culling && !!primitive.streams?.pages.length

/** What the voxel levels added to a manifest: the addresses its bundles are served at, which
 *  `URL.revokeObjectURL` releases with the scene, and how many groups were drawn as voxels. */
export type VoxelLevels = { urls: string[]; joined: number; kept: number }

/**
 * Reads the voxel levels `metadata` declares, beside it at `metadataUrl`, verified against its
 * `files`, into its primitives (above); none for a cache without them. A primitive without a
 * culling tree or streaming bundles takes none: its pages are read another way.
 */
export async function readVoxelLevels(
  metadata: ClusterManifest,
  metadataUrl: string,
  signal: AbortSignal | undefined,
  meter: ByteMeter,
): Promise<VoxelLevels | undefined> {
  const read = await readSidecar(metadata, 'voxels', assertVoxelSection, metadataUrl, signal, meter)
  if (!read) return undefined
  const file = decodeVoxelFile(read.bytes, read.section)
  const { joins, joined, kept } = joinVoxelLevels(metadata, file, servable)
  const urls: string[] = []
  const list = [...joins.values()]
  // The bodies are hashed together and the joins applied in their order, so the catalogue does not
  // depend on which digest ends first; a body that failed leaves no address behind.
  const bodies = await Promise.allSettled(list.map(bodyOf))
  try {
    list.forEach((join, k) => {
      const body = bodies[k]
      if (body.status === 'rejected') throw body.reason
      serveJoin(join, body.value, urls)
    })
  } catch (error) {
    urls.forEach((url) => URL.revokeObjectURL(url))
    throw error
  }
  return { urls, joined, kept }
}
