// The labels of the GPU passes the profile names by their own word (`passTable.ts`): each pass
// reads its label here, so the table and the passes share one word, and the table — which the
// public profile reads, in the CDN core — holds none of the passes nor their shaders (#1353).

/** The rest compaction: the per-step profile files it under "Geometry". */
export const REST_COMPACT_PASS = 'Trillion3D rest compaction';
/** The two material resolve passes, as the profile and the pass blocks read them. */
export const MATERIAL_DEPTH_PASS = 'Trillion3D material depth';
export const MATERIAL_SURFACES_PASS = 'Trillion3D material surfaces v1';
/** The material classification pass (`../visibility/shader/materialTilesWgsl.ts`). */
export const MATERIAL_TILES_PASS = 'Trillion3D material tiles';
/** The particle step and draw, as the GPU timings name them (`passesGpu`). */
export const PARTICLES_PASS = 'Trillion3D particles';
export const PARTICLE_DRAW_PASS = 'Trillion3D particle draw';
/** The shadow atlas pass; `gpuShadowsMs` is read under this name. */
export const SHADOW_PASS = 'Trillion3D shadow atlas v1';
/** The pass that fills the static layer: timed with the Shadows stage. */
export const SHADOW_LAYER_PASS = 'Trillion3D shadow static layer v1';
/** The transmittance layer's pass, and the one that clears it: both timed with the Shadows stage. */
export const SHADOW_TRANSMITTANCE_PASS = 'Trillion3D shadow transmittance pass v1';
export const SHADOW_TRANSMITTANCE_CLEAR_PASS = 'Trillion3D shadow transmittance clear v1';
/** A light cut's passes: shadow work, profiled as a stage of its own and never in the visibility
 *  block the camera's cut belongs to (`mapping.ts`). */
export const LIGHT_CUT_PASS = 'Trillion3D light cut';
/** The shadow pages' demand pass, as a frame's passes are timed. */
export const SHADOW_DEMAND_PASS = 'Trillion3D shadow demand v1';
/** The transparents' marks of the pages they read (`../webgpu/blend/marks.ts`). */
export const BLEND_SHADOW_MARKS_PASS = 'Trillion3D shadow blend marks v1';
/** The allocation and the host's table words, as a frame's passes are timed. */
export const SHADOW_ALLOC_PASS = 'Trillion3D shadow allocation v1';
export const SHADOW_FLOORS_PASS = 'Trillion3D shadow floors v1';
export const SHADOW_WORDS_PASS = 'Trillion3D shadow table words v1';
export const SHADOW_FRESH_PASS = 'Trillion3D shadow GPU pages v1';
export const SHADOW_FRESH_COUNT_PASS = 'Trillion3D shadow GPU page count v1';
export const SHADOW_FRESH_ADMIT_PASS = 'Trillion3D shadow GPU page admission v1';
export const SHADOW_FRESH_CULL_PASS = 'Trillion3D shadow GPU page cull v1';
export const SHADOW_FRESH_SEAL_PASS = 'Trillion3D shadow GPU page seal v1';
/** The GPU's page passes, the floors first: timed under the Shadows stage. */
export const SHADOW_PAGE_PASSES = [
  SHADOW_FLOORS_PASS,
  SHADOW_DEMAND_PASS,
  BLEND_SHADOW_MARKS_PASS,
  SHADOW_ALLOC_PASS,
  SHADOW_WORDS_PASS,
  SHADOW_FRESH_PASS,
  SHADOW_FRESH_COUNT_PASS,
  SHADOW_FRESH_ADMIT_PASS,
  SHADOW_FRESH_CULL_PASS,
  SHADOW_FRESH_SEAL_PASS,
] as const;
/** The light lists' pass; `gpuLightListsMs` is read under this name, not by its rank. */
export const LIGHT_TILES_PASS = 'Trillion3D light tiles v1';
/** The bounce probe pass; the "Bounce" step is read under this name, not by its rank. */
export const BOUNCE_PROBE_PASS = 'Trillion3D bounce probes v1';
/** The bounce surface cache pass; it joins the "Bounce" step like the probe pass. */
export const BOUNCE_SURFACE_PASS = 'Trillion3D bounce surface cache v1';
/** The deferred lighting pass; `gpuLightingMs` is read under this name. */
export const DEFERRED_LIGHTING_PASS = 'Trillion3D deferred lighting';
/** The temporal resolve; its timestamp duration absorbs that of the passes that precede it on
 *  some devices (apple metal-3), and is only read safely by envelope difference. */
export const TAA_PASS = 'Trillion3D temporal antialiasing';
