/**
 * The two blocks of a frame that can be set against a published profile, and nothing else.
 * `visibility` is building the visibility buffer: selection, partition, Hi-Z and raster.
 * `materials` is writing surfaces from that buffer. Everything else is `other`: shadows, light
 * lists, bounce, transparents, deferred lighting, present, and the fallback path that does not go
 * through the buffer — putting any of those in a block would inflate a comparison instead of
 * serving it, so they stay outside AND named, each pass keeping its duration.
 */
export type GpuPassBlock = 'visibility' | 'materials' | 'other';

/** A shadow page's GPU cost: choosing its casters, then drawing them. Sampling is in `lighting`. */
type ShadowPart = 'cull' | 'raster';

/** A pass's row: its stage and block, plus its shadow part when it serves shadow pages. */
export type PassRow = readonly [stage: string, block: GpuPassBlock, part?: ShadowPart];

/**
 * Profile stage, comparison block and shadow part of each GPU pass, read from the label the pass
 * already carries. This is the only read of deposit labels: direct-light durations, the per-stage
 * profile and the blocks share it. An unknown label joins `geometry`, the only stage that draws
 * without a name of its own, and `other`, so a new pass does not silently swell a compared block.
 * The labels are written here, not imported from their passes: the public profile reads this
 * table (`mapping.ts`), and an import would put every pass and its shader in the CDN core, on a
 * WebGL2 page too (#1353). `passTable.test.ts` holds each pass's own constant to its row.
 */
const SHADOW_PAGE_ROW: PassRow = ['shadows', 'other', 'cull'];

export const PASSES: Readonly<Record<string, PassRow>> = Object.freeze({
  'Trillion3D DAG selection': ['selection', 'visibility'],
  'Trillion3D partition': ['partition', 'visibility'],
  'Trillion3D draw compaction': ['selection', 'visibility'],
  'Trillion3D rest compaction': ['geometry', 'other'],
  'Trillion3D HiZ pyramid': ['hiZ', 'visibility'],
  'Trillion3D HiZ test': ['hiZ', 'visibility'],
  'Trillion3D clear': ['geometry', 'visibility'],
  'Trillion3D visibility primary': ['geometry', 'visibility'],
  'Trillion3D visibility secondary': ['geometry', 'visibility'],
  'Trillion3D small triangle binning': ['geometry', 'visibility'],
  'Trillion3D small triangle raster': ['geometry', 'visibility'],
  'Trillion3D hybrid visibility resolve': ['geometry', 'visibility'],
  // Compute raster (`../gpu/raster/raster.ts`, `../gpu/raster/resolve.ts`): it builds the same buffer.
  'Trillion3D raster target and lists': ['geometry', 'visibility'],
  'Trillion3D raster dispatch': ['geometry', 'visibility'],
  'Trillion3D raster binning': ['geometry', 'visibility'],
  'Trillion3D raster occluder depth': ['geometry', 'visibility'],
  'Trillion3D raster tested depth': ['geometry', 'visibility'],
  'Trillion3D raster identifiers': ['geometry', 'visibility'],
  'Trillion3D raster occluder hiz': ['hiZ', 'visibility'],
  'Trillion3D raster resolve': ['geometry', 'visibility'],
  'Trillion3D empty surfaces': ['geometry', 'materials'],
  'Trillion3D material depth': ['geometry', 'materials'],
  'Trillion3D material tiles': ['geometry', 'materials'],
  'Trillion3D material surfaces v1': ['geometry', 'materials'],
  'Trillion3D opaque fallback': ['geometry', 'other'],
  'Trillion3D transparents': ['transparents', 'other'],
  'Trillion3D transmission': ['transparents', 'other'],
  'Trillion3D water surfaces': ['transparents', 'other'],
  'Trillion3D water composite': ['transparents', 'other'],
  'Trillion3D transparent compaction': ['transparents', 'other'],
  'Trillion3D particle draw': ['transparents', 'other'],
  'Trillion3D shadow atlas v1': ['shadows', 'other', 'raster'],
  'Trillion3D shadow static layer v1': ['shadows', 'other', 'raster'],
  'Trillion3D shadow transmittance pass v1': ['shadows', 'other', 'raster'],
  'Trillion3D shadow transmittance clear v1': ['shadows', 'other', 'raster'],
  'Trillion3D light cut': ['shadowCasters', 'other', 'cull'],
  'Trillion3D shadow cull': ['shadows', 'other', 'cull'],
  'Trillion3D shadow page pyramids': ['shadows', 'other', 'cull'],
  'Trillion3D shadow occlusion': ['shadows', 'other', 'cull'],
  'Trillion3D shadow floors v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow demand v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow blend marks v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow allocation v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow table words v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow GPU pages v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow GPU page count v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow GPU page admission v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow GPU page cull v1': SHADOW_PAGE_ROW,
  'Trillion3D shadow GPU page seal v1': SHADOW_PAGE_ROW,
  'Trillion3D light tiles v1': ['lightLists', 'other'],
  'Trillion3D bounce surface cache v1': ['bounce', 'other'],
  'Trillion3D bounce probes v1': ['bounce', 'other'],
  'Trillion3D particles': ['physics', 'other'],
  'Trillion3D deferred lighting': ['lighting', 'other'],
  'Trillion3D temporal antialiasing': ['antialiasing', 'other'],
  'Trillion3D HDR composition': ['present', 'other'],
  'Trillion3D HDR composition + present': ['present', 'other'],
  'Trillion3D direct present': ['present', 'other'],
  'Trillion3D explicit capture': ['present', 'other'],
});

/** Shadow part of a pass, by its label. A pass that serves no shadow page is `other`. */
export const gpuShadowPartOf = (name: string) => PASSES[name]?.[2] ?? 'other';
