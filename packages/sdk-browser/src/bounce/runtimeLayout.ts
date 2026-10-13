// The layout of the run-time proxy's buffer, kept apart from the passes that read it (`runtimeTraceWgsl.ts`)
// and the object that writes it (`runtimeProxy.ts`): both read it from here.
/** No instance, no node: a word every table spells the absence of a link with. */
export const RUNTIME_NONE = 0xffffffff

/**
 * THE PROXY'S BUFFER: one storage binding holding, in this order, the header, an instance per placement, a
 * surface per drawn material, then the arena of the meshes' own proxies — the columns of a `proxy.bin`
 * (`page-codec-wasm/src/proxy.rs`), one mesh's after another, in the mesh's own space —, the mirror of the
 * placement tree's nodes and the mirror of its member order, and the world matrices the instances are placed
 * by. The tree above the placements and their worlds are the culling's, copied here (`mirror`: the tree each
 * frame, the world rows written since the last copy and no other), so
 * that a program reads the whole proxy through one storage binding: the forward programs, whose fragment stage
 * binds the eight WebGPU guarantees, have no room for a second.
 *
 * Header words: the placements the instances hold (the blended copies' follow them), then the word rank
 * of each region — the copies' worlds a region of their own —, the tree's root node (`RUNTIME_NONE` for a
 * packing without a tree: the placements are then its few members), the id of the first node the mirror holds,
 * the words of its nodes and of its members, the live members, the word rank of the placements' worlds, the rows the world
 * table's first range holds, the greatest world error of a proxy, in metres, as an `f32`'s bits: the distance a
 * ray leaves a surface off its normal, and the blended copies.
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
  treeFirst: 8,
  treeWord: 9,
  membersWord: 10,
  members: 11,
  worldsWord: 12,
  worldRows: 13,
  error: 14,
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
 * next frames, from the answer they last got (`reflections/proxyStore.ts`).
 */
export const RAY_WORK = 512
export const RAY_TRIANGLES = 128
/** 2²² units. Measured on the generated scene (Metal, `tests/gpu/reflections/runtime-proxy.gpu.ts`): 1.7 million
 *  units cost 0.5 ms of the trace, 3.4 G units a second, so 2²² units are ~1.2 ms, and up to twice that with
 *  the rays in flight when the counter fills: inside the 2 ms the proxy may take of an 8.33 ms frame. */
export const FRAME_WORK = 2 ** 22
/** Surfaces met in a ray before it ends: a blended one is looked through, up to this many — a closed
 *  blended solid is two, its front face and its back. */
export const RAY_LAYERS = 3
/**
 * THE RUN-TIME PROXY'S ANSWERS, KEPT FROM IMAGE TO IMAGE, in the reflection's own store: a texture of two
 * layers of `r32uint` the image's size (`reflections/proxyStore.ts`), eight bytes a pixel, which the trace
 * reads and writes where it traces. Layer 0 is the pixel's mean radiance, premultiplied by its confidence, as
 * a shared-exponent `rgb9e5`; layer 1 holds the confidence on sixteen bits and, above them, the epoch's
 * stamp on eight (`rtStamp`): the low bits of an epoch (`follow`), never zero, so that a pixel never answered
 * holds none.
 *
 * The frame's counters live in the trace's list (`TRACE_LIST`): the tiles the classification listed, the pixels
 * whose answer is older than the epoch (`left`: what the settle waits for, `settle.ts`), the work the frame has
 * spent, the tile the next frame starts at (`offset`) and the tiles the last one served from it (`cursor`), then
 * the list itself from `TRACE_LIST_FIRST`. The trace binds that one buffer, writable, and the store: no buffer of
 * its own for the answers, which keeps a stage of it under eight storage buffers.
 */
export const TRACE_LIST = { count: 0, left: 1, spent: 2, offset: 3, cursor: 4 } as const
export const TRACE_LIST_FIRST = 8
/** Layers of the store, and its bytes a pixel. */
export const STORE_LAYERS = 2
export const STORE_BYTES_PER_PIXEL = 8
/** Bytes of the store of an image of `width × height`, which a view that wants it holds. */
export const storeBytes = (width: number, height: number) => width * height * STORE_BYTES_PER_PIXEL
/** Bits of a pixel's second word: the confidence from the low bit, the stamp from `stamp`. */
export const STORE_BITS = { confidence: 16, stamp: 24 } as const
