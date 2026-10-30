import {
  RAY_TRACING_FLAG_MASKED,
  RAY_TRACING_FLAG_SKY,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_TWO_SIDED,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import type { RayTracing } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import {
  withRuntimeTrees,
  type RuntimeTree,
} from '../../../../../sdk-core/src/lighting/rayTracingRuntime.ts'
import type { RayTracingTree } from '../../../../../sdk-core/src/lighting/rayTracingTree.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/**
 * THE SCENE THE RAYS ARE CAST THROUGH, with the meshes a world cut at run time in it: the structure the compiler wrote
 * (`WebgpuPagesRuntime.context.rayTracing`, none for a scene made in place) and, after it, the tree of each run-time primitive the cut
 * places (`ClusterRoot.rayTracing`, built where the mesh is cut), each flagged as the material of the first root that places it
 * (`RAY_TRACING_FLAG_*`: double-sided, masked, translucent). The same object while the primitives are the same, so that a scene trace made
 * for it is kept (`ensureSceneTrace`).
 */

/** The roots of the cut, as `layout.selectionRoots` lists them, that place a run-time primitive with a tree. */
interface TracedRoot {
  readonly mesh?: number
  readonly primitive?: number
  readonly rayTracing?: RayTracingTree
  readonly worn?: {
    readonly surface: {
      readonly side: string
      readonly alphaTest: number
      readonly transparent: boolean
      readonly sky?: boolean
    }
  }
}

/** The flags a run-time primitive's record takes from the materials of the roots that place it: double-sided or masked where one is, translucent where all are, a sky material where all wear one. */
function flagsOf(wearing: readonly TracedRoot[]) {
  const surfaces = wearing.map((root) => root.worn?.surface)
  const any = (has: (surface: NonNullable<(typeof surfaces)[number]>) => boolean) =>
    surfaces.some((surface) => !!surface && has(surface))
  const translucent = surfaces.length > 0 && surfaces.every((surface) => surface?.transparent)
  const sky = surfaces.length > 0 && surfaces.every((surface) => surface?.sky === true)
  return (
    (sky ? RAY_TRACING_FLAG_SKY : 0) |
    (any((surface) => surface.side === 'double') ? RAY_TRACING_FLAG_TWO_SIDED : 0) |
    (any((surface) => surface.alphaTest > 0) ? RAY_TRACING_FLAG_MASKED : 0) |
    (translucent ? RAY_TRACING_FLAG_TRANSLUCENT : 0)
  )
}

/** What the scene held when it was last asked: the file it was joined to, the trees, and the structure made of them. */
interface Held {
  readonly file: RayTracing | undefined
  /** The trees held and the flags each was written with. */
  readonly trees: readonly Pick<RuntimeTree, 'tree' | 'flags'>[]
  readonly made: RayTracing | undefined
}
const held = new WeakMap<object, Held>()

/** The trees of the run-time primitives the roots `roots` place, each once, with the numbers a root names its primitive by. */
function treesOf(roots: readonly TracedRoot[]) {
  const placed = new Map<RayTracingTree, TracedRoot[]>()
  for (const root of roots) {
    if (!root.rayTracing || root.mesh === undefined || root.primitive === undefined) continue
    const wearing = placed.get(root.rayTracing)
    if (wearing) wearing.push(root)
    else placed.set(root.rayTracing, [root])
  }
  return [...placed].map(([tree, wearing]): RuntimeTree => ({
    mesh: wearing[0].mesh!,
    primitive: wearing[0].primitive!,
    flags: flagsOf(wearing),
    tree,
  }))
}

/** The structure the rays of `rt` are cast through (see above), none for a scene with neither. */
export function rayTracingOf(
  rt: Pick<WebgpuPagesRuntime, 'context' | 'layout'>,
): RayTracing | undefined {
  const file = rt.context.rayTracing
  const before = held.get(rt.layout)
  const trees = treesOf(rt.layout.selectionRoots as readonly TracedRoot[])
  const same =
    before &&
    before.file === file &&
    before.trees.length === trees.length &&
    before.trees.every(({ tree, flags }, k) => tree === trees[k].tree && flags === trees[k].flags)
  if (same) return before.made
  const made = withRuntimeTrees(file, trees)
  held.set(rt.layout, { file, trees: trees.map(({ tree, flags }) => ({ tree, flags })), made })
  return made
}
