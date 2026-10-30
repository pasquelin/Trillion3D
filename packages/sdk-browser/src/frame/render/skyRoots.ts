import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { ViewSet } from '../../../../sdk-core/src/world/camera/viewSet.ts'
import { readCutSetting } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { hasBit } from '../../../../math/src/scalar/bits.ts'
import { createViewFilter } from '../../geometry/selection/viewFilter.ts'
import { notDrawn, rootSource } from '../../placement/hidden.ts'
import { viewKey } from '../backend/state/viewKey.ts'
import type { BlendGpuItem } from '../../blend/state.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { hiddenFromViews } from './hiddenFromViews.ts'
import { appendRootsUnder } from './movedNode.ts'

/**
 * THE SKY OBJECTS OF THE SCENE: the roots whose surface is a sky material (`VisMaterial.sky`) and the scene nodes that draw them. A view has
 * a sky material (`sceneHasSkyMaterial`, the view's own relevance, `viewSky`) while it draws a sky surface: one of those roots, not hidden by its host
 * nor left out by the view (`Camera.hidden`, `Camera.showOnly`, `Camera.owner`, read as the cut reads them), or a sky surface that no node
 * stands for (`skyOpen`: an actor of an HLOD cell, the world DAG's) that the host draws and the view does not restrict to named objects. The
 * sky meshes a capture of the sky draws alone are drawn by the plan's sky view; their views are cut to the nodes (`skyNodes`, the
 * `Camera.showOnly` of the capture's views) while every sky surface has one, to no list else. The roots are listed once for as long as the
 * roots, their index by node and the surface records stand; the nodes again when the scene moves or a sky root is hidden, parked or shown
 * (the host and the streaming do it without a scene revision, so each root's state is read). What a view draws of them is kept for the
 * view (`viewKey`): the main view, the faces of the sky meshes' capture and the planar views each keep their own filter and answer.
 */

/** What a runtime holds of its sky objects. */
interface Held {
  roots: number
  index: number
  records: readonly object[] | undefined
  ranks: number[]
  /** Per listed rank, whether its root is drawn by the host (neither hidden nor parked), as of the last look. */
  shown: Uint8Array
  scene: number
  /** Made again whenever the list, a root's state or the scene moved: what a view's answer was made at. */
  version: number
  nodes: Object3D[]
  /** Whether a sky surface of the plan has no node that stands for it, for the records listed. */
  open: boolean
}
const held = new WeakMap<WebgpuPagesRuntime, Held>()

/** The nodes of the sky roots the host draws and `bits` (the ranks a view leaves out, none for no view) keeps. */
function nodesOf(
  at: Held,
  roots: WebgpuPagesRuntime['layout']['selectionRoots'],
  bits?: Uint32Array,
) {
  const nodes = new Set<Object3D>()
  for (const rank of at.ranks) {
    const root = roots[rank]
    const node = rootSource(root)
    if (node && !root.hidden && !root.parked && !(bits && hasBit(bits, rank))) nodes.add(node)
  }
  return nodes
}

/** The sky objects of `rt`, listed again when the roots, their index or the plan's sky records moved, their nodes when the scene or a
 *  root's state did. */
function skyHeld(rt: WebgpuPagesRuntime): Held {
  const { selectionRoots: roots, rootIndex } = rt.layout,
    scene = rt.run.gate.revisions.scene
  // The plan's sky list is made again whenever the surface records are written (a material swap).
  const records = rt.blendState.skyItems
  let at = held.get(rt)
  if (!at)
    held.set(
      rt,
      (at = {
        roots: -1,
        index: -1,
        records: undefined,
        ranks: [],
        shown: new Uint8Array(0),
        scene: -1,
        version: 0,
        nodes: [],
        open: false,
      }),
    )
  let moved = at.scene !== scene
  if (at.roots !== roots.length || at.index !== rootIndex.revision || at.records !== records) {
    at.ranks = []
    roots.forEach((root, rank) => {
      if (root.worn?.surface.sky === true) at!.ranks.push(rank)
    })
    at.shown = new Uint8Array(at.ranks.length)
    at.roots = roots.length
    at.index = rootIndex.revision
    at.records = records
    at.open = records.some((item) => !item.drawSource?.node)
    moved = true
  }
  at.ranks.forEach((rank, k) => {
    const root = roots[rank],
      shown = Number(!root.hidden && !root.parked)
    if (at!.shown[k] === shown) return
    at!.shown[k] = shown
    moved = true
  })
  if (moved) {
    at.nodes = [...nodesOf(at, roots)]
    at.scene = scene
    at.version++
  }
  return at
}

/** The sky objects of `rt` as of this image. */
export const skyNodes = (rt: WebgpuPagesRuntime): readonly Object3D[] => skyHeld(rt).nodes

/** Whether a sky surface of the plan has no node that stands for it: the capture's views cannot be cut to the nodes. */
export const skyOpen = (rt: WebgpuPagesRuntime) => skyHeld(rt).open

/** What a view draws of the sky objects, for as long as its filter, the sky objects and the plan's sky list stand. */
interface Seen {
  bits: Uint32Array | undefined
  listed: boolean
  version: number
  items: ReadonlySet<BlendGpuItem>
  /** Whether a root of the view draws a sky object, with or without a sky surface in the plan. */
  roots: boolean
}

/** What a view keeps of its answer: the filter of its set and the surfaces it drew last. */
interface ViewHeld {
  filter: ReturnType<typeof createViewFilter>
  seen?: Seen
}
const views = new WeakMap<object, ViewHeld>()

/**
 * The sky surfaces of the plan the view of `set` draws, the one relevance of the view: the sky pass draws these and no other
 * (`cutSkyItems`), the sky meshes' faces are cut to them, and the atmosphere leaves its pixels alone only where they were drawn. A
 * surface of a node is drawn when its root is not hidden by its host nor left out by the view (`Camera.hidden`, `Camera.showOnly`,
 * `Camera.owner`, read as the cut reads them, but for the occlusion test's); one no node stands for (an HLOD actor, the world DAG's) when
 * the host draws it and the view names no object to show only. `main`: the view is the main one, which takes the stand-ins of
 * first-person objects for its owner's.
 */
export function viewSky(rt: WebgpuPagesRuntime, set: ViewSet, main: boolean): Seen {
  const at = skyHeld(rt)
  const { selectionRoots: roots } = rt.layout,
    key = viewKey(rt.gpu)
  let own = views.get(key)
  if (!own) views.set(key, (own = { filter: createViewFilter() }))
  const filtering = readCutSetting(rt, 'cutViewFiltering')
  const bits = own.filter.update(
    filtering ? set : undefined,
    roots.length,
    (node, out, from) => appendRootsUnder(rt.layout, node, out, from),
    rt.run.gate.revisions.scene,
    hiddenFromViews(rt, main, set.owner),
  )
  const listed = filtering && set.showOnly !== null
  const seen = own.seen
  if (seen && seen.bits === bits && seen.listed === listed && seen.version === at.version)
    return seen
  const nodes = nodesOf(at, roots, bits)
  const list = rt.blendState.skyItems.filter((item) => {
    const node = item.drawSource?.node
    return node ? nodes.has(node) : !listed && !notDrawn(item)
  })
  return (own.seen = {
    bits,
    listed,
    version: at.version,
    items: new Set(list),
    roots: nodes.size > 0,
  })
}

/** Whether the view of `set` has a sky material: it draws a sky object, or a sky surface of the plan (`viewSky`). */
export const sceneHasSkyMaterial = (rt: WebgpuPagesRuntime, set: ViewSet, main: boolean) => {
  const seen = viewSky(rt, set, main)
  return seen.roots || seen.items.size > 0
}

/** Whether the sky pass drew a sky surface in the last image of each runtime (kept here: the clouds read it, the pass imports the blend). */
const drawn = new WeakMap<WebgpuPagesRuntime, boolean>()

/** Whether the sky pass drew every sky surface of the view this image. */
export const skyDrawn = (rt: WebgpuPagesRuntime) => drawn.get(rt) === true

/** The sky pass says whether it drew every sky surface of the view this image. */
export const setSkyDrawn = (rt: WebgpuPagesRuntime, value: boolean) => drawn.set(rt, value)
