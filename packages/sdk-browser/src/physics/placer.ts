import { NODE_TRS_DIRTY } from '../../../sdk-core/src/world/transform/nodeFlags.ts'
import { markTransformNode } from '../../../sdk-core/src/world/transform/transformTree.ts'
import { composeMatrix4At } from '../../../math/src/matrix/matrix4Compose.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { SceneLink } from '../../../sdk-core/src/world/object/sceneLink.ts'
import type { Bodied } from './bodies/bodied.ts'
import { createNestedNodes } from './nodePose.ts'

type Batch = NonNullable<ReturnType<NonNullable<SceneLink['seat']>>>['batch']
const UNASKED = -2,
  NO_ROW = -1

/** True when `node` sits at the origin, unturned and unscaled: its children's world is their local. */
function atRest({ parent, position, quaternion, scale }: Object3D) {
  if (parent) return false
  const p = position.elements,
    q = quaternion.elements,
    s = scale.elements
  for (let k = 0; k < 3; k++) if (p[k] !== 0 || q[k] !== 0 || s[k] !== 1) return false
  return q[3] === 1
}

/** A slot's position at `p` and quaternion at `q`, into the tree's stores at node `n`. */
function writeTreePose(
  sp: Float64Array,
  sq: Float64Array,
  n: number,
  position: Float64Array,
  p: number,
  quaternion: Float64Array,
  q: number,
) {
  sp[n * 3] = position[p]
  sp[n * 3 + 1] = position[p + 1]
  sp[n * 3 + 2] = position[p + 2]
  sq[n * 4] = quaternion[q]
  sq[n * 4 + 1] = quaternion[q + 1]
  sq[n * 4 + 2] = quaternion[q + 2]
  sq[n * 4 + 3] = quaternion[q + 3]
}

/** The slots: each one's pose arrays, the mesh and node bound to it, and how a mesh is bound,
 *  released or let go of. */
function createPoseBinding(maxBodies: number) {
  const position = new Float64Array(maxBodies * 3),
    quaternion = new Float64Array(maxBodies * 4),
    scale = new Float64Array(maxBodies * 3)
  /** Each slot's mesh, the generation it was bound at (-1: none) and its node in the tree (-1:
   *  a nested node's, `nested`). */
  const owner: (Bodied | null)[] = [],
    bound = new Int16Array(maxBodies).fill(-1),
    node = new Int32Array(maxBodies)
  const slotOf = new Map<Bodied, number>()
  const nested = createNestedNodes(position, quaternion, scale)
  /** Each slot's row (`UNASKED` until asked, `NO_ROW` when it has none or must not use it). */
  const rowOf = new Int32Array(maxBodies).fill(UNASKED)
  /** The mesh keeps its own numbers again, as they stand. */
  const release = (mesh: Bodied) => {
    slotOf.delete(mesh)
    mesh.position._share(new Float64Array(3))
    mesh.quaternion._share(new Float64Array(4))
    mesh.scale._share(new Float64Array(3))
  }
  return {
    ...{ position, quaternion, scale, owner, bound, node, rowOf, nested },
    /** Slot `index` holds `mesh` at `generation`: the mesh's pose numbers move here. */
    bind(index: number, generation: number, mesh: Bodied) {
      const before = owner[index]
      if (before && before !== mesh && slotOf.get(before) === index) release(before)
      const was = slotOf.get(mesh)
      if (was !== undefined && was !== index) owner[was] = null
      slotOf.set(mesh, index)
      owner[index] = mesh
      nested.drop(index)
      mesh.position._share(position.subarray(index * 3, index * 3 + 3))
      mesh.quaternion._share(quaternion.subarray(index * 4, index * 4 + 4))
      mesh.scale._share(scale.subarray(index * 3, index * 3 + 3))
      bound[index] = generation
      node[index] = mesh.index
      rowOf[index] = UNASKED
    },
    /** Slot `index` holds `target`, a node under others (a compiled model's) at `generation`, of
     *  world scale `size`: its poses are written as its local pose, from where it stands. */
    bindNode(index: number, generation: number, target: Object3D, size: readonly number[]) {
      const before = owner[index]
      if (before && slotOf.get(before) === index) release(before)
      owner[index] = null
      nested.bind(index, target, size)
      bound[index] = generation
      node[index] = -1
    },
    /** Every mesh keeps its own numbers again (the physics stops). */
    clear() {
      for (const mesh of [...slotOf.keys()]) release(mesh)
      owner.length = 0
      nested.clear()
      bound.fill(-1)
    },
  }
}

/** The instance buffers written in a batch of writes: each as a rank, its matrices and the span
 *  of rows written, which the world hears once per batch. */
function createRowBatches() {
  const batches: Batch[] = [],
    matrices: Float64Array[] = [],
    from: number[] = [],
    to: number[] = []
  return {
    matrices,
    from,
    to,
    /** The rank of `batch`, taken on its first write. */
    rankOf(batch: Batch) {
      let rank = batches.indexOf(batch)
      if (rank < 0) {
        rank = batches.push(batch) - 1
        matrices[rank] = batch.rows!.matrices
        from[rank] = Infinity
        to[rank] = -1
      }
      return rank
    },
    /** The rows asked before are dropped. */
    forget() {
      batches.length = matrices.length = 0
    },
    open() {
      from.fill(Infinity)
      to.fill(-1)
    },
    /** The world hears the written span of each batch. */
    hear(link: SceneLink | null) {
      for (let b = 0; b < batches.length; b++)
        if (to[b] >= 0) link?.placed?.(batches[b], from[b], to[b])
    },
  }
}

/** What a batch of writes keeps: the tree's stores, read once per batch (they are replaced when
 *  the tree grows), whether the rows are used directly, the nodes the world recomposes itself and
 *  the nested slots written, posed at its end, each after its ancestors'. */
type BatchState = {
  tp: Float64Array
  tq: Float64Array
  direct: boolean
  placed: Object3D[]
  due: number[]
}

/** How a slot's pose lands in the tree and in its row, for the batch `st`. */
function createPoseCommit(
  binding: ReturnType<typeof createPoseBinding>,
  rows: ReturnType<typeof createRowBatches>,
  tree: ReturnType<typeof Object3D._treeOf>,
  st: BatchState,
) {
  const { position, quaternion, scale, owner, node, rowOf } = binding
  const { matrices, from, to } = rows
  const batchOf = new Int32Array(rowOf.length)
  /** Slot `index`'s pose, as its arrays hold it, into the tree's stores — its node listed for the
   *  tree's frame pass — and its row. */
  const commit = (index: number, sp: Float64Array, sq: Float64Array) => {
    const p = index * 3,
      q = index * 4,
      n = node[index]
    if (n < 0) return void st.due.push(index)
    writeTreePose(sp, sq, n, position, p, quaternion, q)
    markTransformNode(tree, n, NODE_TRS_DIRTY)
    if (rowOf[index] === UNASKED) seatOf(index, owner[index]!)
    const b = batchOf[index],
      row = rowOf[index]
    if (row === NO_ROW) return void st.placed.push(owner[index]!)
    composeMatrix4At(matrices[b], row * 16, position, p, quaternion, q, scale, p)
    if (row < from[b]) from[b] = row
    if (row > to[b]) to[b] = row
  }
  const seatOf = (index: number, mesh: Bodied) => {
    const seat = st.direct && !mesh.children.length ? (mesh._link?.seat?.(mesh) ?? null) : null
    rowOf[index] = NO_ROW
    if (!seat) return
    batchOf[index] = rows.rankOf(seat.batch)
    rowOf[index] = seat.row
  }
  return {
    /** Writes slot `index` at `pose` (7 numbers from `at`): node, tree, and row. */
    place(index: number, pose: ArrayLike<number>, at: number) {
      const p = index * 3,
        q = index * 4
      position[p] = pose[at]
      position[p + 1] = pose[at + 1]
      position[p + 2] = pose[at + 2]
      quaternion[q] = pose[at + 3]
      quaternion[q + 1] = pose[at + 4]
      quaternion[q + 2] = pose[at + 5]
      quaternion[q + 3] = pose[at + 6]
      commit(index, st.tp, st.tq)
    },
    /** The listed slots into the tree and rows; its stores as locals, not reloaded at each use. */
    commit(list: Int32Array, count: number) {
      const p = st.tp,
        q = st.tq
      for (let i = 0; i < count; i++) commit(list[i], p, q)
    },
  }
}

/** The rows the slots are drawn from and the tree they land in: a batch of writes opens, places
 *  and commits poses, and closes. */
function createPoseRows(binding: ReturnType<typeof createPoseBinding>, root: Object3D) {
  const { rowOf, nested } = binding
  const rows = createRowBatches()
  /** The one transform tree every node lives in. */
  const tree = Object3D._treeOf(root)
  const st: BatchState = {
    ...{ tp: tree.position, tq: tree.quaternion, direct: false },
    ...{ placed: [], due: [] },
  }
  let epoch = NaN
  const { place, commit } = createPoseCommit(binding, rows, tree, st)
  return {
    /** Opens a batch of writes: the rows asked before are dropped when the world moved them. */
    begin() {
      const link = root._link
      const now = link?.seatEpoch?.() ?? NaN,
        rest = !!link?.seat && atRest(root)
      if (now !== epoch || rest !== st.direct) {
        rowOf.fill(UNASKED)
        rows.forget()
      }
      epoch = now
      st.direct = rest
      rows.open()
      st.tp = tree.position
      st.tq = tree.quaternion
    },
    place,
    commit,
    /** The nested slots written are forgotten (the physics stops). */
    clear() {
      st.due.length = 0
    },
    /** Closes the batch: the world hears the written rows and the nodes it recomposes itself. */
    end() {
      const link = root._link,
        { due } = st
      // A nested node's local pose is read against its parent's world: ancestors first.
      if (due.length > 1) nested.order(due)
      for (const index of due) st.placed.push(nested.place(index))
      nested.forgetParents()
      due.length = 0
      rows.hear(link)
      // The list went to the link; the next frame gets a fresh one when anything was placed.
      if (st.placed.length) {
        link?.posed(st.placed)
        st.placed = []
      }
    },
  }
}

/**
 * Writes the physics' drawn poses where they are read, in flat arrays only. A bound mesh keeps its
 * position, quaternion and scale in this placer's arrays (`ObservedComponents._share`), so a write
 * here is the node's own and a page reading it sees the drawn pose; the pose also lands in the
 * transform tree every node shares, and its world matrix is composed straight into the row the
 * renderer draws it from (`SceneLink.seat`). The world hears the written span of each instance
 * buffer once per batch of writes. A body the world holds no row for, one with children, or any
 * body while the scene itself is moved, is handed to `SceneLink.posed`, which recomposes it. A
 * node nested under others (`bindNode`) keeps its world pose here, posed locally to its parent
 * (`createNestedNodes`) and handed to `SceneLink.posed` too.
 */
export function createPosePlacer(maxBodies: number, root: Object3D) {
  const binding = createPoseBinding(maxBodies)
  const rows = createPoseRows(binding, root)
  return {
    position: binding.position,
    quaternion: binding.quaternion,
    bound: binding.bound,
    bind: binding.bind,
    bindNode: binding.bindNode,
    follow: binding.nested.follow,
    clear() {
      binding.clear()
      rows.clear()
    },
    begin: rows.begin,
    place: rows.place,
    commit: rows.commit,
    end: rows.end,
  }
}
