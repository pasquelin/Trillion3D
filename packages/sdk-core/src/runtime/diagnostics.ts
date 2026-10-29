/** The diagnostic views of the heterogeneous volumes' voxel grids, each by the debug mode (1 to 9, `heterogeneousVolumesDebug`) that finds the
 *  transmittance through the grids the way it names: they replace the volumes' image while the grids are built (`heterogeneousVolumesShadowsPipeline` 1). */
export const HETEROGENEOUS_VOLUME_GRID_VIEWS = {
  'heterogeneous-volumes-dda-marching': 1,
  'heterogeneous-volumes-sample-marching': 2,
  'heterogeneous-volumes-sample-majorant': 3,
  'heterogeneous-volumes-sample-max-majorant': 4,
  'heterogeneous-volumes-sample-majorant-dda': 5,
  'heterogeneous-volumes-delta-tracking': 6,
  'heterogeneous-volumes-ratio-tracking': 7,
  'heterogeneous-volumes-spectral-ratio-tracking': 8,
  'heterogeneous-volumes-tracking-majorant-dda': 9,
} as const
export type HeterogeneousVolumeGridView = keyof typeof HETEROGENEOUS_VOLUME_GRID_VIEWS
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
  | 'surface-cache-albedo'
  | 'surface-cache-normal'
  | 'surface-cache-depth'
  | 'surface-cache-cards'
  | 'surface-cache-fill'
  | 'surface-cache-age'
  | 'hair-light-bounds'
  | 'hair-deep-opacity-maps'
  | 'hair-macro-group-screen-rect'
  | 'hair-voxels-density'
  | 'sampled-lights-overview'
  | 'sampled-lights-shadow-casters'
  | 'sampled-lights-shadow-caster-quality'
  | 'sampled-lights-complexity-opaque'
  | 'sampled-lights-complexity-hair-strands'
  | 'sampled-lights-complexity-front-layer'
  | 'sampled-lights-complexity-volume'
  | 'sampled-lights-complexity-translucency-volume'
  | 'subsurface-profiles'
  | 'rect-light-atlas'
  | 'surface-cache-direct-stats'
  | 'surface-cache-indirect-stats'
  | 'surface-cache-direct-lighting-stats'
  | 'surface-cache-scene-stats'
  | 'surface-cache-primitive-groups'
  | 'radiance-cache-stats'
  | 'screen-probe-gather-debug'
  | 'screen-probe-tile-stats'
  | HeterogeneousVolumeGridView
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
 *  @property taa-material-history - The responsiveness each pixel carries into the temporal analysis.
 *  @property surface-cache-albedo - The atlas of the cards' surfaces: their albedo.
 *  @property surface-cache-normal - The atlas: the normals the cards captured, in their frames.
 *  @property surface-cache-depth - The atlas: the depth of each texel in its card's box.
 *  @property surface-cache-cards - The atlas: one colour for each card.
 *  @property surface-cache-fill - The atlas: which texels hold a page, the coarsest levels apart.
 *  @property surface-cache-age - The atlas: how long ago each page was captured.
 *  @property hair-light-bounds - The hair strands' deep shadows' settings and bounds over the image.
 *  @property hair-deep-opacity-maps - A deep shadow's depth and layers over the image.
 *  @property hair-macro-group-screen-rect - The pixels each macro group of strands covers.
 *  @property hair-voxels-density - The strands' count along each pixel's ray through the voxels.
 *  @property heterogeneous-volumes-dda-marching - The transmittance through the ortho and frustum voxel grids, walked cell by cell (DDA) from the camera to the opaque surface.
 *  @property heterogeneous-volumes-sample-marching - The transmittance through the ortho grid by samples, steps of a voxel along the ray of each pixel.
 *  @property heterogeneous-volumes-sample-majorant - The transmittance through the ortho grid by samples of the majorant of the cell under each step.
 *  @property heterogeneous-volumes-sample-max-majorant - The transmittance through the ortho grid by samples of the greatest majorant of the grid.
 *  @property heterogeneous-volumes-sample-majorant-dda - The transmittance through the ortho grid by samples, the cells of the majorant grid walked in turn.
 *  @property heterogeneous-volumes-delta-tracking - The transmittance through the ortho grid by spectral weighted delta tracking, one random walk a pixel.
 *  @property heterogeneous-volumes-ratio-tracking - The transmittance through the ortho grid by ratio tracking, one random walk a pixel.
 *  @property heterogeneous-volumes-spectral-ratio-tracking - The transmittance through the ortho grid by spectral ratio tracking, one random walk a pixel.
 *  @property heterogeneous-volumes-tracking-majorant-dda - The transmittance through the ortho grid by delta tracking, the cells of the majorant grid walked in turn.
 *  @property sampled-lights-overview - The shadow casters and their quality of the sampled lighting side by side.
 *  @property sampled-lights-shadow-casters - The surfaces the sampled lighting’s rays meet, one colour each.
 *  @property sampled-lights-shadow-caster-quality - Where the traced surfaces lie off the drawn ones.
 *  @property sampled-lights-complexity-opaque - The lights of the cell under the cursor on the surfaces, sorted by weight, and a heat map of the cost of sampling.
 *  @property sampled-lights-complexity-hair-strands - The same for the hair strands.
 *  @property sampled-lights-complexity-front-layer - The same for the nearest translucent layer.
 *  @property sampled-lights-complexity-volume - The lights of the fog cell under the cursor, sorted by weight.
 *  @property sampled-lights-complexity-translucency-volume - The lights of the translucency lighting volume cell under the cursor, sorted by weight.
 *  @property subsurface-profiles - The subsurface profile of each pixel as a coloured, lettered map.
 *  @property rect-light-atlas - The atlas of the pictures mapped on the rectangle lights, its slots and its figures, over the image.
 *  @property surface-cache-direct-stats - The table of the direct light update of the surface cache over the image: its priority histogram, its budget and the pages and tiles it lights.
 *  @property surface-cache-indirect-stats - The table of the indirect light update of the surface cache over the image.
 *  @property surface-cache-direct-lighting-stats - The lights the direct light update gathers, the atlas and update sizes, the trace method and count, and the cards and tiles it lights, over the image.
 *  @property surface-cache-scene-stats - The counts of the placements, mesh cards and cards of the surface cache over the image.
 *  @property surface-cache-primitive-groups - The box of every placement that has mesh cards, in white.
 *  @property radiance-cache-stats - The update statistics of the world's probes over the image.
 *  @property screen-probe-gather-debug - The count of the screen probes, uniform and adaptive, over the image.
 *  @property screen-probe-tile-stats - The tiles of each mode of the screen probes' integration over the image. */
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
 * @property taa-material-history - The responsiveness each pixel carries into the temporal
 *   analysis, by its material — the opaque surface's and the transparents' over it, the largest —,
 *   as grey: black none (the default), a third a pixel animation (`'medium'`, or a dynamic
 *   surface), white a pixel animation whose history restarts (`'full'`).
 * @property surface-cache-albedo - The atlas the cards of the meshes are captured into, as an image
 *   of the whole atlas: the albedo of each texel, black where none was captured.
 * @property surface-cache-normal - The same atlas: the normal of each texel in its card's frame,
 *   `x` and `y` as read, black where none was captured.
 * @property surface-cache-depth - The same atlas: the depth of each texel in its card's box, white at
 *   the card's inner face, black at its outer one, magenta where none was captured.
 * @property surface-cache-cards - The same atlas: a colour for each card, black where no page is.
 * @property surface-cache-fill - The same atlas: a texel that holds a page in green where it is of a
 *   card's coarsest level, always kept, blue where it is a finer page, black where it is free.
 * @property surface-cache-age - The same atlas: the images since each page was captured, white under
 *   one, from red to blue as it ages, black where no page is.
 * @property hair-light-bounds - Over the image, the settings of the strands (their components, the
 *   voxelization, the deep shadows' atlas) and, as the settings `hairDeepShadowDebugMacroBounds` and
 *   `hairDeepShadowDebugShadowBounds` ask, the boxes of the macro groups and the frusta of the deep shadows.
 * @property hair-deep-opacity-maps - Over the image, the depth and the layers of the deep shadow
 *   `hairDeepShadowDebugIndex`, side by side, with the same information as the light bounds.
 * @property hair-macro-group-screen-rect - Over the image, a green frame around the pixels each macro group
 *   covers and one around all of them.
 * @property hair-voxels-density - Over the image, the strands' count along the ray of each pixel
 *   through the voxels, from green to red, or the first page that holds voxels (`hairVoxelDebugDrawPages`).
 * @property heterogeneous-volumes-dda-marching - Instead of the heterogeneous volumes, the transmittance through their voxel grids, found by walking the
 *   rays cell by cell, as grey in the alpha and the opacity left in the colour; the grids are built while `heterogeneousVolumesShadowsPipeline` is 1.
 * @property heterogeneous-volumes-sample-marching, heterogeneous-volumes-sample-majorant, heterogeneous-volumes-sample-max-majorant, heterogeneous-volumes-sample-majorant-dda -
 *   The same by samples along each ray: steps of a voxel, the majorant of the cell under each step, the greatest majorant of the grid, the cells of the majorant grid in turn.
 * @property heterogeneous-volumes-delta-tracking, heterogeneous-volumes-ratio-tracking, heterogeneous-volumes-spectral-ratio-tracking, heterogeneous-volumes-tracking-majorant-dda -
 *   The same by tracking, one random walk a pixel with the grid's greatest majorant as its step (the last walks the majorant grid cell by cell).
 * @property sampled-lights-overview - Over the image, the shadow casters and the shadow caster quality views side by side in tiles, as the numbered views 2 and 3 show them; the rest of the image as it is.
 * @property sampled-lights-shadow-casters - The surface the shadow rays of the sampled lighting meet from the eye at each pixel, one colour per object, lit by a fixed light, the sky where nothing is hit.
 * @property sampled-lights-shadow-caster-quality - Where the surface the shadow rays meet lies behind the drawn one by more than `sampledLightsVisualizeShadowCasterMissingDistance` (orange to red, a caster missing) or in front of it by more than `…PoorDistance` (blue, mismatching).
 * @property sampled-lights-complexity-opaque, sampled-lights-complexity-hair-strands, sampled-lights-complexity-front-layer, sampled-lights-complexity-volume, sampled-lights-complexity-translucency-volume -
 *   The light complexity view of one input (`sampledLightsVisualizeLightComplexity` 1 to 5): for the pixel under the debug cursor (`sampledLightsDebugCursorX` / `…Y`) or the fog cell on its ray, the lights of its cell with their share of the sampling weight,
 *   whether they were seen in the image before, their kind and name, each drawn as a line and a symbol from the pixel, the one under the mouse in orange; the first three also paint a heat map of the cost of sampling every pixel (`sampledLightsVisualizeLightComplexityMaxCost`).
 * @property subsurface-profiles - The subsurface profile of each pixel over the middle of the image, one colour and one character per profile (the default skin buff, then red, green, blue, magenta, cyan, yellow; 100 dark green, 255 white), faded where the scattering is narrower than a pixel, with the title and the list of profiles.
 * @property rect-light-atlas - Over the image, the atlas of the pictures the rectangle lights name, drawn small at the chosen mip level (`rectLightAtlasDebugMipLevel`) with a green border round each slot in use, a red one round the horizon lines of the packing and a yellow one round the free rectangles, and its figures as text (resolution, mip levels, occupancy, pictures, source mip bias, format, the switches); the same as `rectLightAtlasDebug` shows.
 * @property surface-cache-direct-stats - Over the image, the table of the surface cache’s direct light update as `surfaceCacheLightingStats` 1 writes it: the tiles of each of the 16 priority buckets, the bucket the budget ends in and its tiles, the pages and the tiles the image lights; read back from the GPU a few images late.
 * @property surface-cache-indirect-stats - Over the image, the same table for the surface cache’s indirect light update (`surfaceCacheLightingStats` 2).
 * @property surface-cache-direct-lighting-stats - Over the image, the table of the surface cache’s direct light update as `surfaceCacheLightingStats` 3 writes it: the views and lights (batched with their type, standalone, whether rectangles, light functions and IES profiles are among them), the atlas and update sizes, the update factor, the trace method and count, and the cards and tiles lit; read back from the GPU a few images late.
 * @property surface-cache-scene-stats - Over the image, the count of the placements, of the mesh cards and of the cards the surface cache holds (`surfaceCacheSceneStats`).
 * @property surface-cache-primitive-groups - The box of every placement that has mesh cards, drawn in white in the world (`surfaceCacheVisualizePrimitiveGroups`).
 * @property radiance-cache-stats - Over the image, the update statistics of the world’s probes as `screenProbeRadianceCacheStats` writes them: the probes the atlas holds out of the most it can, those holding nothing yet, those not traced since the lights changed, those refused for want of a slot, those queued this image and the cells marked.
 * @property screen-probe-gather-debug - Over the image, the number of screen probes, of the uniform ones and of the adaptive ones, as `screenProbeGatherDebug` writes it.
 * @property screen-probe-tile-stats - Over the image, the tiles of the screen probes’ integration of each mode (simple, importance sampled, complete) and their total, with the legend, as `screenProbeTileDebugMode` writes it.
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
      'The responsiveness each pixel carries into the temporal analysis, by its material, opaque or transparent, raw: black none, a third grey a pixel animation, white a pixel animation whose history restarts',
  },
  'surface-cache-albedo': {
    available: true,
    reason:
      'The whole atlas of the cards of the meshes, its albedo layer as stored, black where no surface was captured; needs a raster of the cards plugged in to show a capture',
  },
  'surface-cache-normal': {
    available: true,
    reason:
      "The whole atlas, each texel's normal in its card's frame (x and y, z recovered), black where no surface was captured",
  },
  'surface-cache-depth': {
    available: true,
    reason:
      "The whole atlas, each texel's depth in its card's box as grey (white the inner face), magenta where no surface was captured",
  },
  'surface-cache-cards': {
    available: true,
    reason: 'The whole atlas, one colour for each card, black where no page of the atlas is held',
  },
  'surface-cache-fill': {
    available: true,
    reason:
      "The whole atlas, green where a texel is of a card's coarsest level (always kept), blue of a finer page, black free",
  },
  'surface-cache-age': {
    available: true,
    reason:
      'The whole atlas, the images since each page was captured: white under one, red to blue as it ages, black where no page is held',
  },
  'hair-light-bounds': {
    available: true,
    reason:
      "The strands' components, voxelization and deep shadow atlas listed over the image, with the macro groups' boxes and the deep shadows' frusta the settings ask for; needs hairStrands and a scene that carries strands",
  },
  'hair-deep-opacity-maps': {
    available: true,
    reason:
      'The depth and the layers of the deep shadow hairDeepShadowDebugIndex side by side over the image, the layers divided by hairDeepShadowDebugScale; needs a light that casts hair deep shadows',
  },
  'hair-macro-group-screen-rect': {
    available: true,
    reason:
      'A green frame around the pixels each macro group of strands covers, and one around all of them; needs hairStrands and a scene that carries strands',
  },
  'hair-voxels-density': {
    available: true,
    reason:
      "The strands' count along each pixel's ray through the voxels, green to red, or the first page that holds voxels; needs hairVoxelization",
  },
  'heterogeneous-volumes-dda-marching': {
    available: true,
    reason:
      'The transmittance through the ortho and frustum voxel grids, walked cell by cell (DDA) from the camera to the opaque surface; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'heterogeneous-volumes-sample-marching': {
    available: true,
    reason:
      'The transmittance through the ortho grid by samples, steps of a voxel along the ray of each pixel; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'heterogeneous-volumes-sample-majorant': {
    available: true,
    reason:
      'The transmittance through the ortho grid by samples of the majorant of the cell under each step; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'heterogeneous-volumes-sample-max-majorant': {
    available: true,
    reason:
      'The transmittance through the ortho grid by samples of the greatest majorant of the grid; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'heterogeneous-volumes-sample-majorant-dda': {
    available: true,
    reason:
      'The transmittance through the ortho grid by samples, the cells of the majorant grid walked in turn; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'heterogeneous-volumes-delta-tracking': {
    available: true,
    reason:
      'The transmittance through the ortho grid by spectral weighted delta tracking, one random walk a pixel; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'heterogeneous-volumes-ratio-tracking': {
    available: true,
    reason:
      'The transmittance through the ortho grid by ratio tracking, one random walk a pixel; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'heterogeneous-volumes-spectral-ratio-tracking': {
    available: true,
    reason:
      'The transmittance through the ortho grid by spectral ratio tracking, one random walk a pixel; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'heterogeneous-volumes-tracking-majorant-dda': {
    available: true,
    reason:
      'The transmittance through the ortho grid by delta tracking, the cells of the majorant grid walked in turn; needs a heterogeneous volume and heterogeneousVolumesShadowsPipeline 1',
  },
  'sampled-lights-overview': {
    available: true,
    reason:
      'The shadow casters view and the quality view side by side, over the normal image; needs sampledLights',
  },
  'sampled-lights-shadow-casters': {
    available: true,
    reason:
      'The surface the shadow rays meet at each pixel, one colour per object, lit by a fixed light, the sky where none; needs sampledLights',
  },
  'sampled-lights-shadow-caster-quality': {
    available: true,
    reason:
      'Where the surface the rays meet lies behind the drawn one (orange to red, a caster missing) or in front of it (blue, mismatching), by the distances sampledLightsVisualizeShadowCasterMissingDistance and PoorDistance; needs sampledLights',
  },
  'sampled-lights-complexity-opaque': {
    available: true,
    reason:
      'The lights of the cell under the cursor on the surfaces, sorted by weight with their kind and name and drawn to the pixel, and a heat map of the cost of sampling every pixel; needs sampledLights',
  },
  'sampled-lights-complexity-hair-strands': {
    available: false,
    reason:
      'The light complexity of the hair strands is not drawn yet: only the surfaces and the nearest translucent layer are',
  },
  'sampled-lights-complexity-front-layer': {
    available: true,
    reason:
      'The lights of the cell under the cursor on the nearest translucent layer, sorted by weight, and a heat map of the cost of sampling; needs sampledLights and sampledLightsFrontLayer',
  },
  'sampled-lights-complexity-volume': {
    available: false,
    reason:
      'The light complexity of the fog volume is not drawn yet: only the surfaces and the nearest translucent layer are',
  },
  'sampled-lights-complexity-translucency-volume': {
    available: false,
    reason:
      'The light complexity of the translucency lighting volume is not drawn yet: only the surfaces and the nearest translucent layer are',
  },
  'subsurface-profiles': {
    available: true,
    reason:
      'The profile of each subsurface pixel over the middle of the image, one colour and one character per profile, faded where the scattering is narrower than a pixel, with the title and the profile list; needs subsurfaceScattering',
  },
  'rect-light-atlas': {
    available: true,
    reason:
      'The atlas of the rectangle lights’ pictures over the image, with its slots, horizon lines, free rectangles and figures; needs a rectangle that names a sourceTexture',
  },
  'surface-cache-direct-stats': {
    available: true,
    reason:
      'The table of the surface cache’s direct light update over the image (histogram of the tiles by priority bucket, budget, pages and tiles lit); needs a scene whose meshes carry cards',
  },
  'surface-cache-indirect-stats': {
    available: true,
    reason:
      'The table of the surface cache’s indirect light update over the image; needs a scene whose meshes carry cards',
  },
  'surface-cache-direct-lighting-stats': {
    available: true,
    reason:
      'The lights the surface cache’s direct light update gathers, its atlas and update sizes, trace method and count, and the cards and tiles it lights, over the image; needs a scene whose meshes carry cards',
  },
  'surface-cache-scene-stats': {
    available: true,
    reason:
      'The counts of the placements, mesh cards and cards of the surface cache over the image; needs a scene whose meshes carry cards',
  },
  'surface-cache-primitive-groups': {
    available: true,
    reason:
      'The box of every placement that has mesh cards, in white; needs a scene whose meshes carry cards',
  },
  'radiance-cache-stats': {
    available: true,
    reason:
      'The update statistics of the world’s probes over the image (probes in the atlas, unfilled, refreshing, refused, queued, cells marked); needs screen probes with the radiance cache',
  },
  'screen-probe-gather-debug': {
    available: true,
    reason:
      'The count of the screen probes, uniform and adaptive, over the image; needs screen probes',
  },
  'screen-probe-tile-stats': {
    available: true,
    reason:
      'The tiles of each mode of the screen probes’ integration over the image, with the legend; needs screen probes with the integration’s tile classification',
  },
}
