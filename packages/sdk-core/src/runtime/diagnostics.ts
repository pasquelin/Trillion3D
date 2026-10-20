/** Availability describes real pipeline outputs, never synthetic overlays. */
export type DiagnosticMode =
  | 'beauty'
  | 'wireframe'
  | 'xray'
  | 'triangles'
  | 'clusters'
  | 'lod'
  | 'hlod'
  | 'voxels'
  | 'screen-error'
  | 'materials'
  | 'visibility'
  | 'pages'
  | 'texture-mip'
  | 'overdraw'
  | 'frame-difference'
  | 'reflections'
  | 'shadows'
  | 'lighting'
  | 'no-temporal-aa'
  | 'taa-input'
  | 'taa-rejection'
  | 'taa-validity'
  | 'taa-flicker'
  | 'taa-shading'
  | 'taa-reprojection'
  | 'taa-motion'
  | 'taa-thin'
  | 'taa-material-history'
/** Whether a view mode is available here, and why not. */
export interface DiagnosticCapability {
  /** Whether it can be shown. */
  available: boolean
  /** Why not. */
  reason: string
}
/** Every view mode, each with whether it is available.
 *  @property beauty - The normal image. @property wireframe - The triangles' edges, lines only.
 *  @property xray - The edges of every triangle submitted, hidden ones too.
 *  @property triangles - One colour per triangle. @property clusters - One colour per cluster. @property lod - The detail level drawn.
 *  @property hlod - The HLOD coloration: no proxy, or the proxy level drawn.
 *  @property voxels - What is drawn as voxels, by level, the triangles in grey.
 *  @property screen-error - The error on screen. @property materials - One colour per material.
 *  @property visibility - The pages seen. @property pages - The pages held.
 *  @property texture-mip - The texture size read. @property overdraw - Pixels drawn again.
 *  @property frame-difference - What changed since the last image. @property reflections - The
 *  reflected light alone. @property shadows - The shadows' light. @property lighting - The light
 *  on white. @property no-temporal-aa - The image with no accumulation.
 *  @property taa-input - The image the accumulation receives. @property taa-rejection - The history
 *  rejected. @property taa-validity - The history held. @property taa-flicker - The flicker
 *  measure. @property taa-shading - The shading rejection, stage by stage.
 *  @property taa-reprojection - The reprojection's restarts. @property taa-motion - The motion the
 *  temporal analysis sees. @property taa-thin - The thin geometry detection.
 *  @property taa-material-history - The most of its history each pixel's material keeps. */
export type DiagnosticCapabilities = Record<DiagnosticMode, DiagnosticCapability>
/**
 * The view modes a world can show instead of the normal image, each with whether it is available.
 * @property beauty - The normal image.
 * @property wireframe - The edges of every triangle submitted, lines only, seen through the surfaces.
 * @property xray - The edges of every triangle the GPU cut submitted, seen through the surfaces: what the frustum, the detail levels, the HLOD and the occlusion test dropped is absent, what they kept shows even hidden.
 * @property triangles - One colour per triangle.
 * @property clusters - One colour per cluster.
 * @property lod - Which detail level each cluster was drawn at.
 * @property hlod - Where each HLOD level starts: white an object near, blue HLOD 0 (the object itself past the main loading range), yellow onwards the world DAG's levels.
 * @property voxels - Where the image is drawn as voxels — an object's far levels, a voxel HLOD
 *   cell's —, each voxel in its level's colour, as the LOD view paints levels; the triangles grey.
 * @property screen-error - How far each cluster is from the full detail, on screen.
 * @property materials - One colour per kind of material.
 * @property visibility - The pages seen this frame.
 * @property pages - The pages held in memory.
 * @property texture-mip - Which texture size each pixel read.
 * @property overdraw - How many times each pixel was drawn.
 * @property frame-difference - How much each displayed pixel changed since the image before, as
 *   grey: still pixels black, any change from one image to the next lit, amplified eight times.
 * @property reflections - The reflected light alone — the reflection trace and the probes behind
 *   it — on each lit surface, black elsewhere.
 * @property shadows - How much of the shadowed lights reaches each surface, as grey: white in full
 *   light, black in full shadow, no material colour.
 * @property lighting - Every light a surface receives — direct, reflected, bounced, the
 *   environment's — on a white surface: no material colour.
 * @property no-temporal-aa - The normal image without its temporal accumulation: the raw image of
 *   this frame.
 * @property taa-input - The image the temporal accumulation receives, shifted by this frame's
 *   jitter, nothing accumulated: each displayed pixel shows the rendered pixel it falls in.
 * @property taa-rejection - How much of its history each pixel keeps from the shading's change,
 *   as grey: white the history kept, black rejected.
 * @property taa-validity - How much history each pixel holds once updated, as grey: white a full
 *   history, black one that starts again.
 * @property taa-flicker - The flicker measure of each pixel: red its error (eight times), green
 *   how many flickers it counted, blue the transparents' coverage that discounts it.
 * @property taa-shading - The shading rejection of each pixel, white the history kept: red without
 *   the flicker measure's widening, green with it, blue spread over its neighbours — what the
 *   update applies.
 * @property taa-reprojection - Why each pixel's history restarts: red disoccluded, green
 *   disoccluded and filled with the occluder's motion, blue off the last screen.
 * @property taa-motion - The motion the temporal analysis sees at each pixel: red how far it moves
 *   to the flicker measure, green a pixel animation, blue the reprojection edge (white where the
 *   motion is flat).
 * @property taa-thin - The thin geometry detection at each pixel: red how far its history clamp
 *   relaxes, green a cluster hole region, blue the coverage history.
 * @property taa-material-history - The most of its history the temporal anti-aliasing keeps at
 *   each pixel, by its material — the opaque surface's or, at their coverage, the transparents'
 *   over it, the least —, as grey: white the whole history (1, the default), 0.75 a responsive
 *   material, black none (0, the current image alone).
 */
export const DIAGNOSTICS: DiagnosticCapabilities = {
  beauty: { available: true, reason: 'glTF materials' },
  wireframe: {
    available: true,
    reason: 'The edges of every submitted triangle, lines only, seen through the surfaces',
  },
  xray: {
    available: true,
    reason:
      'The edges of every triangle the cut submitted, opaque and transparent, drawn with no depth test and added: what the culling dropped is absent, what it kept shows even behind a wall',
  },
  triangles: { available: true, reason: 'A filled unique colour per submitted triangle' },
  clusters: { available: true, reason: 'Stable primitive/page ID' },
  lod: {
    available: true,
    reason:
      'The DAG level each drawn cluster was selected at this frame, level 0 the full detail, voxels by their level',
  },
  hlod: {
    available: true,
    reason:
      "HLOD coloration: white for an object within the main loading range, blue for HLOD level 0 (the object's own instanced meshes, out to HLOD 0's range), yellow onwards for the world DAG's merged levels",
  },
  voxels: {
    available: true,
    reason:
      "The pixels drawn as voxels in their level's colour — an object's far levels, a voxel HLOD cell's —, the triangles in grey by their brightness",
  },
  'screen-error': {
    available: true,
    reason: "Per-cluster screen error projected at each pixel's depth, against the cut's threshold",
  },
  materials: {
    available: true,
    reason: 'One colour per material class, the class pass that resolved the pixel',
  },
  visibility: {
    available: true,
    reason: 'Selected visible pages; rejected hierarchy nodes are counted, not drawn',
  },
  pages: {
    available: true,
    reason: 'Attached index pages; missing pages are not drawn; not physical VRAM',
  },
  'texture-mip': { available: false, reason: 'Texture mip residency not instrumented' },
  overdraw: { available: false, reason: 'No fragment counter' },
  'frame-difference': {
    available: true,
    reason:
      'The final displayed image against the one before, the luminance of their difference amplified eight times: still pixels black, any change from one image to the next lit',
  },
  reflections: {
    available: true,
    reason:
      'The reflection term the lighting adds — the screen trace and the probes behind it — alone, black where nothing is reflected',
  },
  shadows: {
    available: true,
    reason:
      'The visibility of the shadowed lights at each surface, weighed by their energy, raw grey: white in full light, black in full shadow, no material colour',
  },
  lighting: {
    available: true,
    reason:
      'The whole lighting — declared lights, reflection, bounce and environment — on a white surface, no material colour and no emission',
  },
  'no-temporal-aa': {
    available: true,
    reason: 'The beauty image with the temporal accumulation bypassed: the raw image of the frame',
  },
  'taa-input': {
    available: true,
    reason:
      'The image the temporal resolve receives, jitter on and nothing accumulated: each display pixel shows the render pixel it falls in',
  },
  'taa-rejection': {
    available: true,
    reason:
      'The shading rejection the history update applies at each pixel, raw grey: white the history kept, black rejected, off screen black',
  },
  'taa-validity': {
    available: true,
    reason:
      'The history validity each pixel holds after the update, raw grey: white a full history, black one that restarts',
  },
  'taa-flicker': {
    available: true,
    reason:
      "The flicker measure at each pixel, raw: red its error amplified eight times, green its flicker count against its most, blue the transparents' coverage that discounts it",
  },
  'taa-shading': {
    available: true,
    reason:
      "The shading rejection at each pixel, raw, white the history kept: red without the flicker error's widening, green with it, blue spread over the 3×3 — the factor the update applies",
  },
  'taa-reprojection': {
    available: true,
    reason:
      "The reprojection's restarts at each pixel, raw: red disoccluded by parallax, green hole-filled with the occluder's motion, blue off the last screen",
  },
  'taa-motion': {
    available: true,
    reason:
      'The motion the temporal analysis sees at each pixel, raw: red how far it moves to the flicker measure, green a pixel animation, blue the reprojection edge, white where the motion is flat',
  },
  'taa-thin': {
    available: true,
    reason:
      'The thin geometry detection at each pixel, raw: red the relaxation weight of its history clamp, green a cluster hole region, blue the coverage history',
  },
  'taa-material-history': {
    available: true,
    reason:
      'The most of its history the temporal anti-aliasing keeps at each pixel, by its material, opaque or transparent at its coverage, raw: white the whole history, 0.75 grey a responsive material, black none',
  },
}
