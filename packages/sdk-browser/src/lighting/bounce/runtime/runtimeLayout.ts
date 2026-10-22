// The layout of the run-time proxy's buffer, kept apart from the passes that read it (`runtimeSceneWgsl.ts`)
// and the object that writes it (`geometry/dag/proxy/proxyInstances.ts`): both read it from here.
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * THE PROXY'S BUFFER: one storage binding holding, in this order, the header, a surface per drawn
 * material, then the arena of the meshes' own proxies — the columns of a `proxy.bin`
 * (`page-codec-wasm/src/proxy.rs`), one mesh's after another, in the mesh's own space —:
 * what grows with the meshes, never with the placements. What grows with them lies in record tables a
 * program binds beside this buffer, sampled textures, no storage binding — the culling's own, never a
 * copy —: the culling's, read where they
 * lie — the placements' records, each world and each instance (`geometry/dag/worlds/worldTable.ts`), and the tree
 * above them (`geometry/dag/tree/treeTable.ts`).
 *
 * Header words, one table the writer's words and the shader's struct (`RUNTIME_PROXY_WGSL`) are
 * both drawn from (`fieldLayout`): the placements the instances hold, then the word rank of each
 * region, the tree's root node, within the tree (`NO_INDEX` for a packing without a tree: the
 * placements are then its few members), the live members, and the greatest world error of a proxy,
 * in metres, as an `f32`'s bits: the distance a ray leaves a surface off its normal.
 */
const HEADER = fieldLayout(
  'RuntimeProxy',
  [
    ['instances', 'u32'],
    ['surfacesWord', 'u32'],
    ['trianglesWord', 'u32'],
    ['boundsWord', 'u32'],
    ['childrenWord', 'u32'],
    ['treeRoot', 'u32'],
    ['members', 'u32'],
    ['error', 'f32'],
  ] as const,
  'words:array<u32>,',
)
export const RUNTIME_HEADER = HEADER.at
export const RUNTIME_HEADER_WORDS = HEADER.words
/** The proxy's buffer as the shaders read it: the header's fields, then every word past them. */
export const RUNTIME_PROXY_WGSL = wgslBlock('RUNTIME_PROXY_WGSL', [], HEADER.wgsl)

/** One placement's instance, the `Instance` texel of its record (`geometry/dag/worlds/worldTable.ts`): its
 *  cut's first node and first triangle in the arena (`NO_INDEX` where it draws no proxy), the
 *  surface it wears, and its frame word — the mark with the deformation's reach above it
 *  (`rootMark`). */
export const INSTANCE = { node: 0, triangle: 1, surface: 2, mark: 3 } as const
export const INSTANCE_WORDS = Object.keys(INSTANCE).length

/** One surface, its words laid as WGSL lays the fields (`fieldLayout`): the diffuse tint
 *  (linear), the opacity, the emission (linear radiance) and a flags word. */
const SURFACE_LAYOUT = fieldLayout('RuntimeSurface', [
  ['tint', 'vec3f'],
  ['opacity', 'f32'],
  ['emission', 'vec3f'],
  ['flags', 'u32'],
] as const)
export const SURFACE = SURFACE_LAYOUT.at
export const SURFACE_WORDS = SURFACE_LAYOUT.words
export const SURFACE_BLENDED = 1

/**
 * THE BUDGET OF A RAY. One counter of `work` units per ray, shared by the placement
 * tree and the cuts' own nodes: a child a tree node examines costs one, a cut's node four, a triangle
 * two; a ray stops at `RAY_WORK` units or `RAY_TRIANGLES` triangle tests. The shadow rays its hits'
 * lighting casts (`rtBlocked`) spend none of it: each has a budget of its own (`SHADOW_RAY_WORK`), the
 * counters of the ray it is cast for set aside and given back, so a ray's own walk is never shortened by
 * its lighting, whatever the lights its hits see.
 *
 * AN EXHAUSTED RAY IS A HIT, never a ray that is dropped: a trace that runs out of budget has not found
 * the light, nor the shade, so it answers as one that met a surface where it stopped. A probe's ray whose
 * own walk spends its budget ends as an opaque hit at the surface the walk had found, else at the distance
 * it had reached (`rtReached`) in the placement of its furthest entry (`rtReachedPlacement`), carrying the
 * light the cascades hold there (`rtLayers`, `rtProbeRay`): the estimate of a probe counts every ray it
 * fired, none renormalised away. A shadow ray that spends its own is lit, as a point no object was tested
 * against is: it has found nothing that stands in the light, and only a cut of one placement that ran out
 * of stack (`RT_CAUSE_MESH`) shades the point, as that placement's own walk could not tell.
 * A reflection's ray keeps answering zero confidence, its share left to the next stage of the chain
 * (`rtRadiance`): its budget (`REFLECTION_PROXY_WORK`) is about one node's scan of the placement tree (a full
 * node of `TREE_SPAN` children costs as many units), so the walk that ends it has entered few placements, if
 * any, and would end as a hit on a surface it hardly knows.
 */
export const RAY_WORK = 512
export const RAY_TRIANGLES = 128
/** The budget of a probe's ray (`BOUNCE_SETTINGS.probeRayWork`): the reflections keep `RAY_WORK`, a probe's
 *  ray starts inside the street's boxes. */
export const PROBE_RAY_WORK = BOUNCE_SETTINGS.probeRayWork
export const PROBE_RAY_TRIANGLES = BOUNCE_SETTINGS.probeRayTriangles
/** The budget of one shadow ray, its own (`BOUNCE_SETTINGS.shadowRayWork`): one that meets nothing walks its
 *  whole segment, where the probe's ray stops at its first surface. */
export const SHADOW_RAY_WORK = BOUNCE_SETTINGS.shadowRayWork
export const SHADOW_RAY_TRIANGLES = BOUNCE_SETTINGS.shadowRayTriangles
/** Surfaces met in a ray before it ends: a blended one is looked through, up to this many — a closed
 *  blended solid is two, its front face and its back. */
export const RAY_LAYERS = 3
/** The width a ray's footprint has at its origin, in metres: the spread a deformed placement's reach
 *  is weighed against at a hit (`rtRadiance`), never zero at a contact. */
export const RAY_SPREAD_FLOOR = 0.01
/** The light a ray lets through under which the surfaces behind are not looked for: under one step
 *  of an 8-bit channel of five times the light. */
export const RAY_THROUGH_FLOOR = 0.02
/** The least distance a ray leaves a hit by to look behind it, in metres, where the proxy's own
 *  error is smaller. */
export const RAY_ERROR_FLOOR = 1e-3
