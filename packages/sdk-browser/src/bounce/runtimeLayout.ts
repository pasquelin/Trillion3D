// The layout of the run-time proxy's buffer, kept apart from the passes that read it (`runtimeTraceWgsl.ts`)
// and the object that writes it (`runtimeProxy.ts`): both read it from here.
/** No instance, no node: a word every table spells the absence of a link with. */
export const RUNTIME_NONE = 0xffffffff

/**
 * THE RUN-TIME PROXY'S BUFFER: one storage binding holding, in this order, the header, an instance
 * per placement, a surface per drawn material, then the arena of the cuts' own proxies — the columns
 * of a `proxy.bin` (`page-codec-wasm/src/proxy.rs`), one cut's after another, in the cut's own space.
 * The placement tree and the worlds it places are the culling's (`gpu/dag`), read where they lie.
 *
 * Header words: the placements the instances hold (the blended copies' follow them), then the word rank
 * of each region — the copies' worlds a region of their own —, the tree's
 * root node (`RUNTIME_NONE` for a packing without a tree: the placements are then its few members), the
 * rank of the tree's member order in the cold table, the live members, the words of a world row, the
 * rows the world table's first range holds and the greatest world error of a cut's proxy, in metres, as
 * an `f32`'s bits: the distance a ray leaves a surface off its normal.
 */
export const RUNTIME_HEADER = {
  instances: 0,
  instancesWord: 1,
  surfacesWord: 2,
  trianglesWord: 3,
  copyWorldsWord: 4,
  boundsWord: 5,
  childrenWord: 6,
  treeRoot: 7,
  membersWord: 8,
  members: 9,
  worldStride: 10,
  worldRows: 11,
  error: 12,
  nodeFirst: 13,
  coldFirst: 14,
  copies: 15,
} as const
export const RUNTIME_HEADER_WORDS = 16

/** Words of one placement's instance: its cut's first node and first triangle in the arena
 *  (`RUNTIME_NONE` where it draws no proxy), the surface it wears, and its frame word — the mark
 *  with the deformation's reach above it (`markReach`). */
export const INSTANCE_WORDS = 4
export const INSTANCE = { node: 0, triangle: 1, surface: 2, mark: 3 } as const

/** Words of one surface: the diffuse tint (linear), the opacity, the emission (linear radiance) and
 *  a flags word; floats but the last. */
export const SURFACE_WORDS = 8
export const SURFACE_BLENDED = 1

/**
 * THE BUDGETS OF A RAY AND OF A FRAME. One counter of `work` units per ray, shared by the placement
 * tree and the cuts' own nodes: a child a tree node examines costs one, a cut's node four, a triangle
 * two; a ray stops at `RAY_WORK` units or `RAY_TRIANGLES` triangle tests, and answers that
 * it is exhausted (zero confidence, the next stage of the chain), never a miss. A frame spends at
 * most about `FRAME_WORK` units (`runtimeTraceWgsl.ts`): the rays the budget leaves out go on in the
 * next frames, from the answer they last got (`reflections/proxyHistory.ts`).
 */
export const RAY_WORK = 512
export const RAY_TRIANGLES = 128
/** 2²⁵ units at ~30 flops: ~1 Gflop a frame, 0.3 ms at the peak of a 3.6 Tflop/s device, ~1.1 ms at a
 *  quarter of it, and up to twice that with the rays in flight when the counter fills. */
export const FRAME_WORK = 2 ** 25
/** Surfaces met in a ray before it ends: a blended one is looked through, up to this many — a closed
 *  blended solid is two, its front face and its back. */
export const RAY_LAYERS = 3
