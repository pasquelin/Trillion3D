// The labels of the GPU passes the profile names by their own word (`passTable.ts`): each pass
// reads its label here, so the table and the passes share one word, and the table — which the
// public profile reads, in the CDN core — holds none of the passes nor their shaders (#1353).

/** What every pass of the virtual shadow maps' label opens with (`../vsm/`): all of them are timed
 *  with the Shadows stage, whatever their chunk or light. */
export const VSM_PASS_PREFIX = 'vsm.';
/** The visibility's opening compute pass: the GPU partition, then the draw compaction that reads
 *  the rest bits and slot counts it wrote. */
export const PARTITION_PASS = 'Trillion3D partition';
/** The occlusion step between the two visibility passes, one compute pass: the Hi-Z pyramid's
 *  build, the test of the tested half against it and the compaction of what survives. */
export const HIZ_PASS = 'Trillion3D HiZ';
/** The material resolve pass, as the profile and the pass blocks read it. */
export const MATERIAL_SURFACES_PASS = 'Trillion3D material surfaces v1';
/** The resolve's compute pass: what the frame composes once for it
 *  (`../visibility/shader/shadeCacheWgsl.ts`), then the material classification
 *  (`../visibility/shader/materialTilesWgsl.ts`). */
export const MATERIAL_COMPUTE_PASS = 'Trillion3D material cache and tiles';
/** The particle step and draw, as the GPU timings name them (`passesGpu`). */
export const PARTICLES_PASS = 'Trillion3D particles';
export const PARTICLE_DRAW_PASS = 'Trillion3D particle draw';
/** The light lists' pass; `gpuLightListsMs` is read under this name, not by its rank. */
export const LIGHT_TILES_PASS = 'Trillion3D light tiles v1';
/** The bounce pass — the surface cache's sweep, then the probes' update and the snapshot's
 *  follow-up —; the "Bounce" step is read under this name, not by its rank. */
export const BOUNCE_PASS = 'Trillion3D bounce v1';
/** The deferred lighting pass; `gpuLightingMs` is read under this name. */
export const DEFERRED_LIGHTING_PASS = 'Trillion3D deferred lighting';
/** The temporal resolve; its timestamp duration absorbs that of the passes that precede it on
 *  some devices (apple metal-3), and is only read safely by envelope difference. */
export const TAA_PASS = 'Trillion3D temporal antialiasing';
