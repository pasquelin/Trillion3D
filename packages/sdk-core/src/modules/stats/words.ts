/**
 * The words of the stats panel: a label and a one-sentence hint (what it is; what raises it) for
 * every row, summary figure and tab, in English. A page translates by passing `StatsWords`.
 */

/** A page's translations: any label or hint it gives replaces the English one. */
export type StatsWords = Partial<Record<string, { label?: string; hint?: string }>>

const word = (label: string, hint: string) => ({ label, hint })

/** The English words by key; a key is a row's (`gpu.<stage>`, `cpu.<stage>` for a stage of `WEBGPU_STAGES`, `shadows.<counter>`,
 *  `memory.screen`, `scene.drawCalls`), a summary figure's (`summary.…`), a tab's (`tab.<id>`) or a GPU
 *  pass's (`pass.<short name>`: the label without its `Trillion3D ` prefix and trailing ` v<digits>`,
 *  `.`, `_` and `-` read as spaces, so `Trillion3D temporal antialiasing` is `temporal antialiasing`
 *  and `vsm.projection` is `vsm projection`). */
const STATS_WORDS: Record<string, { label: string; hint: string }> = {
  'tab.page': word(
    'All worlds',
    'How busy every world and view of the page keeps the GPU and the main thread, as a share of each second; shown only on a page of several worlds or views.',
  ),
  'tab.gpu': word('GPU', 'Where the graphics processor spends the image, stage by stage.'),
  'tab.cpu': word(
    'CPU',
    "Where the engine spends the CPU time of an image, as medians over the last second; the header's CPU figure is the main thread's whole frame. More work per frame raises it.",
  ),
  'tab.shadows': word(
    'Shadows',
    'The shadow passes and their page counters; their time is part of the GPU time.',
  ),
  'tab.memory': word('Memory', 'The GPU memory the engine holds, by kind.'),
  'tab.scene': word('Scene', 'What the cut selected and drew, and the geometry pool.'),
  'page.gpuBusy': word(
    'GPU busy',
    "Share of each second the page's worlds and views keep the GPU busy; past 100 % their GPU times overlap and the GPU holds the frame.",
  ),
  'page.cpuBusy': word(
    'CPU busy',
    "Share of each second the page's worlds keep the main thread busy; they share one main thread, so it adds up.",
  ),
  'page.view': word(
    'view {n}',
    "GPU time of the last image of a view beside the main one, and its share of the world's frame.",
  ),
  'profile.cpuFrame': word(
    'CPU frame',
    'Main-thread time of the animation-frame callbacks of a frame, as median / 95th percentile over the last second; only with ?profile.',
  ),
  'profile.pageHooks': word(
    'Page hooks',
    "Time of the page's own frame hooks in a frame, as median / 95th percentile over the last second; only with ?profile.",
  ),
  'profile.engineCpu': word(
    'Engine CPU',
    "The engine's whole-image CPU time, as median / 95th percentile over the last second; only with ?profile.",
  ),
  'profile.workerStep': word(
    'Physics worker step',
    "The physics worker's slowest fixed step of a tick, as median / 95th percentile over the last second; only with ?profile.",
  ),
  'shadows.included': word(
    'included in GPU',
    'These times are already inside the GPU total: never add them to it.',
  ),

  'summary.frame': word(
    'Frame',
    'Time between two displayed images; rises when either processor takes longer than a refresh.',
  ),
  'summary.gpu': word(
    'GPU',
    'Mean GPU time of an image over the last second; rises with pixels, lights and geometry drawn.',
  ),
  'summary.cpu': word(
    'CPU',
    'Median main-thread time of a frame over the last second; rises with the work sent to the GPU.',
  ),
  'summary.wait': word(
    'Wait',
    'Time the frame waits for the display after the slower processor finished.',
  ),
  'summary.bottleneck': word(
    'Limited by',
    "The engine's verdict on what holds the frame: the first limit the window hits.",
  ),
  'summary.screen': word(
    'Screen {hz} Hz',
    "How long each image stays on screen, counted in the display's refreshes: 1 is every refresh, more means images are late.",
  ),
  'summary.screenValue': word(
    '1 image / {n} refreshes',
    'The refreshes a typical image of the last second stayed on screen.',
  ),
  'summary.screenShare': word(
    '{share} % of images in {n} refreshes',
    "One bucket of the screen distribution: its share of the last second's images.",
  ),
  'summary.screenShareOrMore': word(
    '{share} % in {n} or more',
    'The last bucket of the screen distribution: its share of the images, at that many refreshes or more.',
  ),
  'summary.gpuIdle': word(
    'GPU idle',
    'Time the GPU sat idle before its last measured image; rises when the CPU feeds it late.',
  ),
  'summary.mainView': word('main view', "The first world the page made, the page's main view."),
  'summary.world': word('world', 'A world of the page other than the main view.'),
  'summary.budget': word(
    'budget',
    'The time one display refresh allows a frame; the dashed line of the graph.',
  ),
  'bottleneck.healthy': word(
    'Display',
    "The frame fits in a refresh: the frame rate is the display's.",
  ),
  'bottleneck.memory_pressure': word(
    'Stutters',
    'Frames took longer than the stutter limit: free memory or lower the streaming load.',
  ),
  'bottleneck.gpu_bound': word(
    'GPU',
    'The GPU takes longer than a refresh and holds the frame: lower the resolution or the lighting.',
  ),
  'bottleneck.cpu_bound': word(
    'CPU',
    'The main thread takes longer than a refresh and holds the frame: lower the work per frame.',
  ),
  'bottleneck.gpu_submit_bound': word(
    'GPU submit',
    'Sending the commands to the GPU takes over half a refresh: lower the draw calls and passes.',
  ),
  'bottleneck.streaming_bound': word(
    'Streaming',
    'More pages are in flight than the fetch workers can serve: the network or the disk holds the scene.',
  ),
  'panel.label': word('Statistics', 'The profiler overlay.'),
  'panel.hint': word('Click: compact · drag: move · key ` / ²', 'The header line gestures.'),
  'unit.fps': word('fps', 'Frames drawn a second.'),
  'summary.cpuShort': word('CPU', 'The main thread time of a frame.'),
  'summary.gpuShort': word('GPU', 'The graphics processor time of an image.'),
  'row.max': word('max', 'The highest value in the last second.'),
  'summary.held': word(
    'held',
    'No new frame in the last second: nothing moved, the image is redisplayed.',
  ),
  'summary.last': word(
    'last',
    "The GPU time shown is an earlier image's: the device has not sampled a newer one yet.",
  ),

  'gpu.physics': word(
    'Physics',
    'Rigid and soft body steps on the GPU; rises with the bodies simulated.',
  ),
  'gpu.animations': word(
    'Animations',
    'Skinning and deformation of animated objects; rises with the animated vertices.',
  ),
  'gpu.lights': word(
    'Lights',
    'Preparing the scene lights for the frame; rises with the light count.',
  ),
  'gpu.cutAdoption': word(
    'Cut adoption',
    'Taking in the cut the selection chose; rises when the cut changes much between images.',
  ),
  'gpu.selection': word(
    'Selection',
    'Choosing which clusters to draw by view and detail; rises with the hierarchy nodes tested.',
  ),
  'gpu.transparents': word(
    'Transparents',
    'Drawing see-through surfaces; rises with transparent triangles and layers.',
  ),
  'gpu.residency': word(
    'Residency',
    'Deciding which geometry pages must be in memory; rises while the view changes.',
  ),
  'gpu.hostPages': word(
    'Host pages',
    'Copying page data the CPU streamed to the GPU; rises while new pages arrive.',
  ),
  'gpu.uploads': word(
    'Uploads',
    'Sending data to GPU buffers; rises with dynamic geometry and streaming.',
  ),
  'gpu.textures': word(
    'Textures',
    'Streaming and decoding texture levels; rises while new textures load.',
  ),
  'gpu.partition': word(
    'Partition',
    'Sorting the drawn clusters into draw batches; rises with the clusters drawn.',
  ),
  'gpu.encode': word(
    'Encode',
    'Building the commands the raster stage reads; rises with the draw batches.',
  ),
  'gpu.submit': word(
    'Submit',
    'Passes that hand work to the queue; rises with the number of submissions.',
  ),
  'gpu.hiZ': word(
    'Hi-Z',
    'Building the depth pyramid the occlusion test reads; rises with the resolution.',
  ),
  'gpu.geometry': word(
    'Geometry',
    'Rasterising the visibility buffer and writing surfaces; rises with triangles drawn and pixels covered.',
  ),
  'gpu.coplanar': word(
    'Coplanar',
    'Resolving surfaces that lie on the same plane; rises with overlapping decals.',
  ),
  'gpu.shadows': word(
    'Shadows',
    'Rendering and projecting shadow pages; rises with the lights that cast and the pages redrawn.',
  ),
  'gpu.lightLists': word(
    'Light lists',
    'Gathering the lights that reach each screen tile; rises with the light count and their reach.',
  ),
  'gpu.bounce': word('Bounce', 'Light bounced between surfaces; rises with the rays traced.'),
  'gpu.reflections': word(
    'Reflections',
    'Reflected images of the scene; rises with reflective pixels and the rays traced.',
  ),
  'gpu.lighting': word(
    'Lighting',
    'Shading every pixel from its surface and the lights; rises with pixels and lights.',
  ),
  'gpu.antialiasing': word('Antialiasing', 'Smoothing edges over time; rises with the resolution.'),
  'gpu.effects': word(
    'Effects',
    'Post-processing such as bloom, exposure and fog; rises with the effects switched on and the resolution.',
  ),
  'gpu.present': word(
    'Present',
    'Resampling and handing the image to the display; rises with the display resolution.',
  ),
  'gpu.unclassified': word(
    'Unclassified',
    'Timed passes that no stage names; they are listed so the stages still add up.',
  ),
  'gpu.untimed': word(
    'Outside timed passes',
    'GPU time of the image no timed pass covers: copies, gaps between passes, timestamp resolves.',
  ),

  'cpu.physics': word(
    'Physics',
    'Stepping the simulation on the main thread; rises with the bodies simulated.',
  ),
  'cpu.animations': word(
    'Animations',
    'Preparing animated objects on the main thread; rises with the animated objects.',
  ),
  'cpu.textures': word(
    'Textures',
    'Feeding the texture streamer on the main thread; rises while new textures load.',
  ),
  'cpu.transparents': word(
    'Transparents',
    'Preparing and drawing see-through surfaces; rises with transparent meshes and layers.',
  ),
  'cpu.cutAdoption': word(
    'Cut adoption',
    'Taking in the cut the selection chose; rises when the cut changes much between images.',
  ),
  'cpu.residency': word(
    'Residency',
    'Deciding and queuing which geometry pages must be in memory; rises while the view changes.',
  ),
  'cpu.uploads': word(
    'Uploads',
    'Sending data to GPU buffers; rises with dynamic geometry and streaming.',
  ),
  'cpu.selection': word(
    'Selection',
    'Dispatching the cluster selection; rises with the hierarchy nodes tested.',
  ),
  'cpu.encode': word('Encode', 'Recording the GPU commands; rises with passes and draw batches.'),
  'cpu.submit': word(
    'Submit',
    'Handing the recorded commands to the queue; rises with the number of submissions.',
  ),
  'cpu.hostPages': word(
    'Host pages',
    'Integrating geometry pages the CPU streamed; rises while new pages arrive.',
  ),
  'cpu.rest': word(
    'Rest of the frame',
    "The engine's whole-image CPU time that no stage above covers (0 when work outside the image makes the stages exceed it); page scripts, input and layout are not in it.",
  ),

  'shadows.invalidation': word(
    'Invalidation',
    'Marking shadow pages stale after something moved; rises with moving casters.',
  ),
  'shadows.marking': word(
    'Marking',
    'Finding which shadow pages the view needs; rises with the pixels lit by shadowed lights.',
  ),
  'shadows.pageManagement': word(
    'Page management',
    'Allocating and recycling shadow pages; rises with the pages requested.',
  ),
  'shadows.render': word(
    'Render',
    'Drawing the shadow pages that changed; rises with the pages redrawn and the casters in them.',
  ),
  'shadows.projection': word(
    'Projection',
    'Projecting shadow maps onto the image; rises with the shadowed lights and the resolution.',
  ),
  'shadows.transmission': word(
    'Transmission',
    "The see-through casters' atlas; rises with translucent casters.",
  ),
  'shadows.lights': word(
    'Shadowed lights',
    'Lights that cast virtual shadow maps this frame; the scene count in Scene is all active lights.',
  ),
  'shadows.maps': word('Maps', 'Virtual shadow maps this frame; rises with the lights that cast.'),
  'shadows.pagesRequested': word(
    'Shadow pages requested',
    'Shadow pages the frame asked for; rises with the shadowed area on screen.',
  ),
  'shadows.pagesAllocated': word(
    'Shadow pages allocated',
    'Shadow pages newly taken from the pool this frame; rises when the view or lights move.',
  ),
  'shadows.pagesCached': word(
    'Shadow pages cached',
    'Requested shadow pages found already drawn; falls when casters or lights move.',
  ),
  'shadows.pagesRendered': word(
    'Shadow pages rendered',
    'Shadow pages cleared and drawn this frame; rises when casters or lights move.',
  ),
  'shadows.freePages': word(
    'Shadow pages free',
    'Physical shadow pages left in the pool; falls when more are requested.',
  ),
  'shadows.lodBias': word(
    'Shadow detail bias',
    'How much coarser than asked the shadow maps are drawn; rises when the pool is full.',
  ),
  'shadows.projectionPasses': word(
    'Projection passes',
    'Projection passes this frame, four lights each; rises with the shadowed lights.',
  ),
  'shadows.resolutionBias': word(
    'Shadow resolution bias',
    'Levels the shadows draw coarser than asked because of their pool; 0 is healthy.',
  ),

  'memory.screen': word(
    'Screen images',
    'Targets that depend on the resolution; rises with the render size.',
  ),
  'memory.shadows': word(
    'Shadow pool',
    'The shadow page pool; rises with the shadow quality setting.',
  ),
  'memory.geometry': word(
    'Geometry',
    'The geometry page pool reserved on the GPU, used or not; its use is in Scene.',
  ),
  'memory.textures': word(
    'Texture pool',
    'The texture pool, fixed for the session; set by the texture budget.',
  ),
  'memory.liveTextures': word(
    'Live textures',
    'Working textures kept apart from the pool; rises with the live textures in the scene.',
  ),
  'memory.other': word(
    'Other resources',
    'GPU memory no kind above names: buffers, history images, caches.',
  ),

  'scene.trianglesSelected': word(
    'Triangles selected',
    'Triangles the cut kept past the view and detail tests; rises with scene detail in view.',
  ),
  'scene.trianglesDrawn': word(
    'Triangles drawn',
    'Triangles drawn once occlusion dropped the hidden ones; rises with visible detail.',
  ),
  'scene.trianglesScene': word(
    'Triangles (scene)',
    'Triangles of the visible meshes in the scene, counted by the page when the frame publishes no selected triangles.',
  ),
  'scene.drawCalls': word(
    'Draw calls',
    'Draw commands sent this frame; rises with the number of batches.',
  ),
  'scene.geometryPages': word(
    'Geometry pages',
    'Geometry pages resident in memory; rises with the detail loaded.',
  ),
  'scene.poolUsed': word(
    'Geometry pool used',
    'Bytes of the geometry pool that hold pages; rises as pages load.',
  ),
  'scene.poolCapacity': word(
    'Geometry pool capacity',
    'Bytes reserved for the geometry pool; set by the scene and the device limits.',
  ),
  'scene.lights': word('Lights', 'Scene lights that lit the frame.'),

  // The GPU passes, by `pass.<short name>`: the label's `Trillion3D ` prefix and version dropped, `._-` as spaces (`statsPassWord`).
  'pass.compose roots': word(
    'compose roots',
    'Computes the world matrix of every placement root from its parents; rises with the number of animated or moving placements.',
  ),
  'pass.compose motion': word(
    'compose motion',
    'Computes how each placement moved since the previous image, for motion vectors; rises with the number of moving placements.',
  ),
  'pass.compose rows': word(
    'compose rows',
    'Computes the world matrices of the placement rows; rises with the number of placements.',
  ),
  'pass.root boxes': word(
    'root boxes',
    'Fits the world box and stretch of every placement root; rises with the number of roots.',
  ),
  'pass.placement tree leaves': word(
    'placement tree leaves',
    "Fits the boxes of the placement tree's leaves; rises with the number of placements.",
  ),
  'pass.placement tree refit': word(
    'placement tree refit',
    "Refits the placement tree's inner boxes after its leaves moved; rises with the number of moving placements.",
  ),
  'pass.DAG selection': word(
    'DAG selection',
    'Walks the geometry graph and selects the detail each view needs; rises with the detail in view.',
  ),
  'pass.DAG mask swap': word(
    'DAG mask swap',
    'Swaps the selection masks between images; small and fixed.',
  ),
  'pass.partition': word(
    'partition',
    'Compacts the selected clusters into the draws of the image; rises with the clusters selected.',
  ),
  'pass.HiZ': word(
    'HiZ',
    'Builds the depth pyramid used to hide what is occluded; rises with the render size.',
  ),
  'pass.visibility primary': word(
    'visibility primary',
    'Draws the depth of the occluders so the rest can be tested against it; rises with the occluders in view.',
  ),
  'pass.visibility secondary': word(
    'visibility secondary',
    "Draws the tested half of the geometry against the occluders' depth; rises with the geometry that passed the test.",
  ),
  'pass.visibility identifiers': word(
    'visibility identifiers',
    'Draws the identifier of the surface under each pixel; rises with the render size and the geometry drawn.',
  ),
  'pass.raster binning': word(
    'raster binning',
    'Sorts the small triangles of the software raster into screen tiles; rises with the small triangles in view.',
  ),
  'pass.raster occluder depth': word(
    'raster occluder depth',
    "Software raster of the occluders' depth; rises with the small occluding triangles.",
  ),
  'pass.raster tested depth': word(
    'raster tested depth',
    'Software raster of the depth of the tested geometry; rises with the small triangles tested.',
  ),
  'pass.raster identifiers': word(
    'raster identifiers',
    'Software raster of the surface identifiers; rises with the small triangles drawn.',
  ),
  'pass.raster occluder hiz': word(
    'raster occluder hiz',
    "Builds the depth pyramid from the software raster's occluders; rises with the render size.",
  ),
  'pass.raster resolve': word(
    'raster resolve',
    "Merges the software raster's pixels into the visibility buffer; rises with the render size.",
  ),
  'pass.empty surfaces': word(
    'empty surfaces',
    'Clears the surface images when the image draws no material; small and fixed.',
  ),
  'pass.material cache, bins and shading': word(
    'material cache, bins and shading',
    "Composes what the frame shares, sorts pixels by material and shades each material's bin; rises with the materials and pixels in view.",
  ),
  'pass.material surfaces': word(
    'material surfaces',
    'Clears the surface and feedback images before the materials are shaded; rises with the render size.',
  ),
  'pass.texture feedback reduce': word(
    'texture feedback reduce',
    'Reduces which texture tiles the image asked for; rises with the textures in view.',
  ),
  'pass.texture eviction queue': word(
    'texture eviction queue',
    "Ranks the texture tiles to give up when the pool is full; rises with the pool's size.",
  ),
  'pass.transparents': word(
    'transparents',
    'Draws the transparent surfaces layer by layer; rises with the transparent surfaces in view.',
  ),
  'pass.blend companion': word(
    'blend companion',
    'Draws the companion image of the dual blend; rises with the transparent surfaces in view.',
  ),
  'pass.distortion': word(
    'distortion',
    'Accumulates the refraction of the transmissive surfaces; rises with their number and size on screen.',
  ),
  'pass.distortion apply': word(
    'distortion apply',
    'Applies the accumulated refraction to the image; rises with the render size.',
  ),
  'pass.transparent compaction': word(
    'transparent compaction',
    'Compacts the visible transparent draws; rises with the transparent geometry.',
  ),
  'pass.transparent occlusion': word(
    'transparent occlusion',
    'Tests the transparent geometry against the depth; rises with the transparent geometry.',
  ),
  'pass.blend order and expansion': word(
    'blend order and expansion',
    'Orders and expands the transparent surfaces for blending; rises with the transparent surfaces in view.',
  ),
  'pass.display mask': word(
    'display mask',
    'Builds the mask of the pixels the display filter acts on; rises with the render size.',
  ),
  'pass.display filter': word(
    'display filter',
    'Applies the display filter over the image; rises with the render size.',
  ),
  'pass.transparent front': word(
    'transparent front',
    "Keeps the transparents' front surface the reflections trace against; rises with the render size.",
  ),
  'pass.particle draw': word(
    'particle draw',
    'Draws the particles; rises with the particles alive and the area they cover.',
  ),
  'pass.light tiles': word(
    'light tiles',
    'Builds the per-tile light lists; rises with the lights and the render size.',
  ),
  'pass.bounce': word(
    'bounce',
    'Updates the bounced light: marks the cells in view, writes the table and refreshes the probes; rises with the lit cells in view.',
  ),
  'pass.bounce light lists': word(
    'bounce light lists',
    "Builds the light lists over the bounce's world lattice; rises with the lights near the lit cells.",
  ),
  'pass.proxy pose': word(
    'proxy pose',
    'Poses the proxies of the deformed placements for the reflections and the bounce; rises with the deformed placements.',
  ),
  'pass.reflections': word(
    'reflections',
    'Reduces the depth pyramid for the reflections; rises with the render size.',
  ),
  'pass.reflection trace': word(
    'reflection trace',
    'Classifies the screen tiles and traces the reflections through the screen; rises with the reflective pixels.',
  ),
  'pass.reflection scene': word(
    'reflection scene',
    'Traces the rays the screen could not answer through the scene; rises with the reflective pixels the screen missed.',
  ),
  'pass.reflection denoise': word(
    'reflection denoise',
    'Reuses neighbouring and earlier reflections to clean the image; rises with the render size.',
  ),
  'pass.reflection radiance': word(
    'reflection radiance',
    "Builds the radiance pyramid of the lit image for the next image's reflections; rises with the render size.",
  ),
  'pass.particles': word(
    'particles',
    "Simulates the particles' step; rises with the particles alive.",
  ),
  'pass.deferred lighting': word(
    'deferred lighting',
    'Lights every pixel from the surfaces, the lights and the shadows; rises with the render size and the lights.',
  ),
  'pass.as is share seed': word(
    'as is share seed',
    'Seeds the share of the image kept as it is by the temporal resolve; rises with the render size.',
  ),
  'pass.temporal antialiasing': word(
    'temporal antialiasing',
    'Blends the image with the earlier ones to smooth the edges; rises with the render size.',
  ),
  'pass.exposure': word(
    'exposure',
    "Meters the image's brightness and updates the automatic exposure; small and fixed.",
  ),
  'pass.scene downsample': word(
    'scene downsample',
    'Builds the chain of ever smaller copies of the image read by the bloom and the local exposure; rises with the render size.',
  ),
  'pass.local exposure': word(
    'local exposure',
    'Adapts the exposure region by region; rises with the render size.',
  ),
  'pass.bloom': word(
    'bloom',
    'Spreads the bright parts of the image into a glow; rises with the render size.',
  ),
  'pass.outline': word(
    'outline',
    'Scans and draws the outlines of the selected objects; rises with the render size and the outlines asked.',
  ),
  'pass.HDR composition': word(
    'HDR composition',
    'Composes the final image from the lit image and the effects; rises with the render size.',
  ),
  'pass.HDR composition + present': word(
    'HDR composition + present',
    'Composes the final image and presents it to the screen in one pass; rises with the render size.',
  ),
  'pass.direct present': word(
    'direct present',
    'Draws the image straight to the screen; rises with the render size.',
  ),
  'pass.view present': word(
    'view present',
    "Draws the image into a view of the page; rises with the view's size.",
  ),
  'pass.guides': word('guides', 'Draws the guides over the image; rises with the guides shown.'),
  'pass.x ray': word(
    'x ray',
    'Draws the edges of the x-ray view over the lit image; rises with the render size.',
  ),
  'pass.frame difference': word(
    'frame difference',
    'Shows the image against the one before it; rises with the render size.',
  ),
  'pass.see through background': word(
    'see through background',
    'Lays the background of the see-through views before their transparents; rises with the render size.',
  ),
  'pass.capture emission and occlusion': word(
    'capture emission and occlusion',
    'Captures the emission and occlusion layer of the surfaces; rises with the render size.',
  ),
  'pass.texture mips': word(
    'texture mips',
    'Builds the smaller levels of the textures just loaded; rises with the textures uploaded.',
  ),
  'pass.deformation': word(
    'deformation',
    'Deforms the geometry of the deformed placements; rises with their vertices.',
  ),
  'pass.animation banks': word(
    'animation banks',
    'Plays the animation banks of the crowds; rises with the animated instances.',
  ),
  'pass.vsm': word(
    'vsm',
    'Any pass of the virtual shadow maps: render, clear, projection and merge of the shadow pages; rises with the shadowed lights and the pages they need.',
  ),
}

/** The label and hint of `key`: the page's `words` over the English ones, and for a key neither
 *  names (a GPU pass's own name, a counter the engine added) the key's last part spelled out. */
export function statsWord(key: string, words?: StatsWords): { label: string; hint: string } {
  const english = STATS_WORDS[key]
  const spelled = key.slice(key.lastIndexOf('.') + 1).replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  return {
    label: words?.[key]?.label || english?.label || spelled,
    hint: words?.[key]?.hint ?? english?.hint ?? '',
  }
}

/** `label` without its `Trillion3D ` prefix and trailing ` v<digits>`, its separators kept. */
const withoutAffixes = (label: string) =>
  label.replace(/^Trillion3D\s+/i, '').replace(/\s+v\d+$/i, '')

/** The label and hint of a GPU pass named `label`: the words of `pass.<short name>` (the page's over
 *  the English), the short name itself when none names it. A pass of a family (`vsm.…`) with no
 *  words of its own takes the hint of its family, `pass.<first part of the label>`. */
export function statsPassWord(label: string, words?: StatsWords): { label: string; hint: string } {
  const short = withoutAffixes(label)
    .replace(/[._-]+/g, ' ')
    .trim()
  const family = withoutAffixes(label).split('.')[0]
  const field = (key: string, which: 'label' | 'hint') =>
    words?.[key]?.[which] ?? STATS_WORDS[key]?.[which]
  return {
    label: field(`pass.${short}`, 'label') ?? short,
    hint: field(`pass.${short}`, 'hint') ?? field(`pass.${family}`, 'hint') ?? '',
  }
}
