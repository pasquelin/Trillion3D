import type { PortalEntry } from '../model.ts';

/** Guides: prose in `html`, rendered by the React Entry component. */
export const GUIDE = { section: 'guides', kind: 'Guide' };

export const GUIDES: PortalEntry[] = [
  {
    ...GUIDE,
    id: 'quick-start',
    title: 'Quick start',
    description:
      'From a glTF file to a streamed scene in a canvas: compile once, explore in the browser.',
    html: `<p>The engine streams geometry by clusters: a native compiler cuts a source scene into pages once, a browser world then reads only the pages the camera needs, within fixed memory budgets. Both environments use the same public package specifier.</p>
<ol>
<li><strong>Compile</strong> on the machine that holds the source, with <code>web-geometry</code>. The Node condition provides preparation. The cache directory receives the manifest, the pages and the texture sidecars; <code>resourceBaseUrl</code> is the URL the browser will read them from.</li>
<li><strong>Explore</strong> in the browser, also with <code>web-geometry</code>. The browser condition provides rendering. <code>createWorld</code> accepts a canvas ID or element and returns an empty world; <code>scene.load</code> then adds a compiled model to it, like anything else added to the scene. The world submits frames on demand and pauses once the image has held; give the canvas a CSS width and height, and dispose on unmount.</li>
</ol>
<p>The full contract — options, budgets, lighting, temporal antialiasing, diagnostics — is in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a> and <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/ENGINE.md">docs/ENGINE.md</a>.</p>`,
    example: `// 1. Node — compile once (set \`executable\` or WEB_GEOMETRY_COMPILER_BIN).
import { prepare, type PrepareOptions } from 'web-geometry';
const compilation: PrepareOptions = { resourceBaseUrl: '/cache/city/' };
await prepare('scenes/city', 'cache/city', 'full', 150000, compilation);

// 2. Browser — HTML: <canvas id="viewer" style="width:100%;height:70vh"></canvas>
import { createWorld } from 'web-geometry';
const world = createWorld('viewer');
await world.scene.load('/cache/city/manifest.json');
// A first image is submitted; detail and temporal antialiasing settle progressively.
// In your page/component teardown: world.dispose();`,
  },
  {
    ...GUIDE,
    id: 'architecture',
    title: 'Architecture & rules',
    description: 'What the engine promises and the conventions every function below follows.',
    html: `<p>The mission, in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md#principles">Product principles</a>: virtualized geometry for the web at the performance of the best desktop engines — geometry streamed by clusters, one cut through a DAG per frame, a visibility buffer, temporal antialiasing, fixed streaming and memory budgets. The lighting is what the geometry is for; its stages are in <code>docs/ENGINE.md</code>.</p>
<h3 class="text-lg font-bold mt-4">One frame, on the WebGPU path</h3>
<p>The GPU cuts the DAG and compacts the clusters to draw; the hardware raster writes a <strong>visibility buffer</strong> (one identifier per pixel) behind a Hi-Z occlusion test; the <strong>material resolve</strong> then rebuilds each pixel's surface — base colour, normal, roughness, emission — <em>one material class per pass</em>: a pass writes every pixel's class as an exact depth, and each class draws one full-screen triangle at its own depth under the hardware <code>equal</code> test, with a pipeline compiled for that class's features alone (maps, cut-out, vertex normals, tangents). Deferred lighting, transparents, temporal antialiasing and presentation follow. Observe it live with <code>world.diagnostic.mode = 'triangles'</code> and the <code>material-classes-ready</code> diagnostic (the scene's classes).</p>
<h3 class="text-lg font-bold mt-4">Conventions of the world API</h3>
<p>State read and written is a property (<code>camera.near = 0.1</code>, <code>world.exposure</code>); a value with several components is an object with <code>.set()</code> (<code>position.set(0, 1, 0)</code>); a method is an action or a computation (<code>lookAt</code>, <code>add</code>, <code>load</code>, <code>world.stageProfile()</code>) — a setter applies its own consequences, so nothing is ever updated by hand. Families are singular; a member that produces a thing of the scene is named after the thing (<code>geometry.box</code>), one that sets up machinery is <code>create</code> + its name (<code>page.createStreamer</code>). Full contract, every family and an example each: <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md#api-rule">docs/SDK.md</a>.</p>
<h3 class="text-lg font-bold mt-4">Conventions of the math API</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Column-major 4×4 matrices</strong> in sixteen consecutive numbers, <code>[12..14]</code> the translation — a host-library matrix copies without reordering.</li>
<li><strong>Output first, allocation never.</strong> A function writes into the <code>out</code> buffer it receives and returns it; <code>outAt</code>/<code>aAt</code> offsets let one large buffer hold many operands.</li>
<li><strong><code>Float64Array</code> for what is computed</strong>, <code>ArrayLike&lt;number&gt;</code> for what is only read. Single precision is a send conversion, done when a result is copied into a GPU buffer.</li>
<li><strong>Same bits as the reference</strong>, proven by <code>pnpm run perf:core</code>: each line runs the host library and the engine on the same seeded inputs and refuses an engine slower than the reference. Two declared exceptions: the sRGB curve (gap ≤ 1e-11) and the depth terms of the projection (reversed, infinite far plane).</li>
<li><strong>Measure before optimising.</strong> A per-step CPU profile (<code>cpu-timing</code> diagnostic) and a GPU stage profile (<code>world.stageProfile()</code>) say where a frame goes; nothing is optimised on a supposition.</li>
<li><strong>Materials proven on screen.</strong> <code>pnpm run test:gpu</code> renders twelve material fixtures — base colour and its map, alpha MASK at its cutoff, BLEND, back faces, metal-roughness, emissive, normal map — with the engine and with the Three witness, both from <code>dist/</code>, and holds every read pixel within one level of the witness; the one declared gap, a blend over an opaque surface, is measured at 45 levels and held there (<code>docs/SDK.md</code> § Separated surfaces and lighting).</li>
</ul>
<h3 class="text-lg font-bold mt-4">Reading this portal</h3>
<p>Every application example imports <code>web-geometry</code>. The source-module link on each entry is implementation provenance, not a consumer import path. An entry with an <span class="badge badge-warning badge-sm">in development</span> badge names a function the repository does not deliver yet: its page states the issue that carries it and the signature that issue commits to. Everything else is on <code>develop</code> today.</p>`,
  },
  {
    ...GUIDE,
    id: 'three-migration',
    title: 'Migration from Three.js',
    description:
      'On the left a complete Three.js program, on the right the engine program that draws the same scene, section by section.',
  },
  {
    ...GUIDE,
    id: 'occlusion-two-phase',
    title: 'Occlusion: the two-phase Hi-Z',
    description:
      'How a cluster hidden behind another leaves the image, what decides it, and the counters that say so.',
    html: `<p>The WebGPU visibility path draws its opaque clusters in two passes, following the published two-phase design. There is no option to set: the mechanism is fixed, automatic, and reads its own history.</p>
<ol class="list-decimal pl-6 space-y-1">
<li><strong>Main pass.</strong> A cluster is an <em>occluder</em> when the previous image drew it and the previous image's depth pyramid does not hide it: its rectangle and depth bound from that image are read against that pyramid, still in its buffer. The occluders are rasterised first.</li>
<li><strong>Pyramid.</strong> The depth of the main pass becomes a Hi-Z pyramid: a mip chain where each texel keeps the farthest depth of its footprint.</li>
<li><strong>Post pass.</strong> Every other cluster — withdrawn from the occluders, or rejected last image — is tested against that pyramid: a footprint clipped to the viewport, the mip that covers it in sixteen texels, and the comparison of the cluster's nearest depth to the farthest depth read there. What stays hidden is not drawn; what is not is rasterised in a second pass over the same targets.</li>
</ol>
<p>The post-pass test is the only thing allowed to reject, and it is conservative to the ulp: the rectangle contains the reference's, the depth bound stays below it, a box that crosses the near plane is never rejected. The main-pass verdict only decides <em>draw order</em>: a wrong one costs a second test, never a pixel. That is why a moved world, a resized target or a page that changed rank need no invalidation — only a rank that changed page forgets what it held.</p>
<p>In a still view the two halves converge within one antialiasing jitter cycle: a cluster the test kept stays an occluder until the view, or a world, moves. The image is then held — no pass runs — which a moving pyramid would forbid.</p>
<h3 class="text-lg font-bold mt-4">Reading it</h3>
<ul class="list-disc pl-6 space-y-1">
<li><code>metric.frame(world)</code> carries <code>hizTestedClusters</code>, <code>hizRejectedClusters</code>, <code>hizRejectedTriangles</code> and <code>hizCountedFrame</code>: what the post pass tested and rejected on the image the last periodic sample described — the device counts, the host rereads one image in fifteen, and <code>null</code> means no sample yet, never zero.</li>
<li><code>world.stageProfile()</code> carries the partition stage: <code>lignes</code> (resident rows), <code>occulteurs</code>, <code>testees</code>, <code>historiqueOcculteurs</code> (rows the previous image drew) and <code>retiresParLaPyramide</code> (rows that pyramid withdrew), with the GPU milliseconds of the <code>WG partition</code>, <code>WG HiZ pyramid</code>, <code>WG HiZ test</code>, <code>WG visibility primary</code> and <code>WG visibility secondary</code> passes.</li>
<li>The measurement harness prints the same numbers per view as <em>Hi-Z tested/rejected</em>; the street view of the reference scene rejects 5,131 of 24,902 rows where the former history rejected 440.</li>
</ul>
<p>The lesson <a class="link link-primary" href="#/en/lessons/occlusion-two-phase">Hide a ring behind a ring</a> shows the counters move on the garden as the eye drops to ring height.</p>`,
  },
  {
    ...GUIDE,
    section: 'families',
    id: 'families-reference',
    title: 'Every family, one line each',
    description:
      'Every family a world hands a page, member by member — the full contract lives in docs/SDK.md.',
    html: `<p>Everything a world builds with comes from one of these families. Twelve come from the whole-mesh renderer a page already knows; eight exist because geometry here is <strong>cut into pages</strong> the engine moves in and out of memory according to what the frame reads — not parity, but what this engine is. Every member, and one example each: <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md#families">docs/SDK.md, "Families"</a>.</p>
<div class="overflow-x-auto my-4"><table class="table table-zebra table-sm"><thead><tr><th>Family</th><th>Members</th></tr></thead><tbody>
<tr><td><code>geometry</code></td><td>the shape alone: <code>box</code>, <code>sphere</code>, <code>cylinder</code>, <code>cone</code>, <code>torus</code>, <code>torusKnot</code>, <code>plane</code>, <code>circle</code>, <code>ring</code>, <code>capsule</code>, <code>lathe</code>, <code>extrude</code>, <code>tube</code>, <code>shape</code>, <code>polyhedron</code>, <code>edges</code>, <code>wireframe</code>, <code>createBuffer</code></td></tr>
<tr><td><code>material</code></td><td>the matter alone: <code>meshStandard</code>, <code>meshPhysical</code>, <code>meshBasic</code>, <code>meshPhong</code>, <code>meshLambert</code>, <code>meshToon</code>, <code>meshNormal</code>, <code>meshMatcap</code>, <code>meshDepth</code>, <code>points</code>, <code>line</code>, <code>lineDashed</code>, <code>sprite</code>, <code>shadow</code>, <code>createShader</code></td></tr>
<tr><td><code>light</code></td><td><code>ambient</code>, <code>directional</code>, <code>point</code>, <code>spot</code>, <code>hemisphere</code>, <code>rectArea</code>, <code>probe</code></td></tr>
<tr><td><code>camera</code></td><td><code>perspective</code>, <code>orthographic</code>, <code>cube</code>, <code>stereo</code>, <code>array</code></td></tr>
<tr><td><code>object</code></td><td>shape and matter, placed: <code>mesh</code>, <code>group</code>, <code>points</code>, <code>line</code>, <code>lineSegments</code>, <code>lineLoop</code>, <code>sprite</code></td></tr>
<tr><td><code>math</code></td><td><code>vector2/3/4</code>, <code>matrix3/4</code>, <code>quaternion</code>, <code>euler</code>, <code>box3</code>, <code>sphere</code>, <code>plane</code>, <code>ray</code>, <code>triangle</code>, <code>frustum</code>, <code>color</code>, <code>spherical</code>, <code>curve</code>, <code>path</code>, <code>shape</code>, <code>clamp</code>, <code>lerp</code>, <code>degToRad</code></td></tr>
<tr><td><code>texture</code></td><td><code>image</code>, <code>data</code>, <code>canvas</code>, <code>video</code>, <code>depth</code>, <code>cube</code>, <code>array</code>, <code>compressed</code></td></tr>
<tr><td><code>loader</code></td><td><code>texture</code>, <code>cubeTexture</code>, <code>imageBitmap</code>, <code>file</code>, <code>data</code></td></tr>
<tr><td><code>helper</code></td><td>the marks you work with: <code>axes</code>, <code>grid</code>, <code>polarGrid</code>, <code>box</code>, <code>plane</code>, <code>arrow</code>, <code>camera</code>, <code>directionalLight</code>, <code>pointLight</code>, <code>spotLight</code>, <code>hemisphereLight</code></td></tr>
<tr><td><code>animation</code></td><td><code>createMixer</code>, <code>clip</code>, <code>track</code>, <code>numberTrack</code>, <code>vectorTrack</code>, <code>quaternionTrack</code>, <code>colorTrack</code></td></tr>
<tr><td><code>buffer</code></td><td><code>float32/16</code>, <code>uint32/16/8</code>, <code>int32/16/8</code>, <code>interleaved</code></td></tr>
<tr><td><code>blending</code>, <code>side</code>, <code>wrap</code>, <code>filter</code>, <code>colorSpace</code>, <code>toneMapping</code></td><td>frozen string-literal constants, each its own family</td></tr>
<tr><td><code>page</code></td><td>geometry in pages: <code>createStreamer</code>, <code>createCache</code>, <code>httpSource</code>, <code>decode</code></td></tr>
<tr><td><code>budget</code></td><td>the fixed envelopes that are not exceeded: <code>memory</code>, <code>geometryPool</code>, <code>texturePool</code></td></tr>
<tr><td><code>metric</code></td><td>what the image cost, never estimated: <code>frame</code>, <code>cpuSteps</code>, <code>gpuPasses</code>, <code>createProfiler</code></td></tr>
<tr><td><code>diagnostic</code></td><td>watching the engine work: <code>createChannel</code>, <code>presentationColor</code>, <code>partitionAudit</code>, <code>transparentOcclusion</code>, <code>shadowAtlas</code></td></tr>
<tr><td><code>capability</code></td><td>what the machine grants: <code>detect</code>, <code>lighting</code></td></tr>
<tr><td><code>capture</code></td><td>an image taken aside: <code>surface</code>, <code>buffer</code></td></tr>
<tr><td><code>pose</code></td><td>named poses, framing, replay: <code>fromBounds</code>, <code>runPath</code>, <code>pointOfInterest</code></td></tr>
<tr><td><code>batch</code></td><td>a thousand matrices at once: <code>multiplyMatrix4</code>, <code>transformPoints</code>, <code>composeMatrix4</code>, <code>frustumKeepsBox</code></td></tr>
</tbody></table></div>
<p>The world itself is not a family: it is the object <code>createWorld</code> returns, carrying <code>scene</code>, <code>camera</code>, <code>controls</code>, <code>budget</code>, <code>diagnostic</code>, <code>onFrame</code>/<code>loop</code>, <code>render</code>, <code>invalidate</code> and <code>dispose</code>. <code>LOD</code>, <code>InstancedMesh</code> and <code>BatchedMesh</code> have no counterpart here — deliberately: the DAG cut is what they exist to approximate.</p>`,
  },
  {
    ...GUIDE,
    section: 'measurement',
    id: 'measurement-entry',
    title: 'The measurement entry point',
    description:
      'Where a witness, a forced backend or an internal session is still nameable — never through the published `web-geometry` entry.',
    html: `<p>A page imports <code>web-geometry</code> and never sees a backend, a witness or an internal session: <code>createWorld</code> draws with one renderer, chosen from the machine or refused by name if forced and missing. The bench, the proofs and the comparison views still need to name a witness — bare Three.js, <code>THREE.LOD</code>, the internal <code>openMeasuredWorld</code> session — and that is the one job of the separate measurement entry point, <code>packages/sdk-browser/src/measurement/measurement.ts</code>.</p>
<p>It re-exports everything the published entry does, plus what a host never needs: <code>openMeasuredWorld</code>/<code>createMeasuredWorldJob</code> (the internal session a world opens on itself), the backend factories (<code>referenceBackend</code>, <code>exactPagesBackend</code>, <code>threeLodBackend</code>, <code>webgpuPagesBackend</code>, <code>autonomousPagesBackend</code>), and measurement-only helpers such as <code>replicateInstances</code>. None of it reaches a published world, and none of it is imported by an application.</p>`,
  },
];
