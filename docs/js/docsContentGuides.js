import { engineExampleCode } from './engine-scene/code.js';
/** Guides and examples: prose in `html`, code in `example`, both rendered by the React Entry component. */
const GUIDE = { section: 'guides', kind: 'Guide' };
const EXAMPLE = { section: 'examples', kind: 'Example' };

export const GUIDES = [
  {
    ...GUIDE,
    id: 'quick-start',
    title: 'Quick start',
    description:
      'From a glTF file to a streamed scene in a canvas: compile once, explore in the browser.',
    html: `<p>The engine streams geometry by clusters: a native compiler cuts a source scene into pages once, a browser explorer then reads only the pages the camera needs, within fixed memory budgets. Both environments use the same public package specifier.</p>
<ol>
<li><strong>Compile</strong> on the machine that holds the source, with <code>web-geometry</code>. The Node condition provides preparation. The cache directory receives the manifest, the pages and the texture sidecars; <code>resourceBaseUrl</code> is the URL the browser will read them from.</li>
<li><strong>Explore</strong> in the browser, also with <code>web-geometry</code>. The browser condition provides rendering. <code>createExplorer</code> accepts a canvas ID or element. Set <code>interactive: true</code> for controls, automatic sizing and rendering only while needed. Give the canvas a CSS width and height; dispose on unmount. WebGPU is required by this simple path.</li>
</ol>
<p>The full contract — options, budgets, lighting, temporal antialiasing, diagnostics — is in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a>.</p>`,
    example: `// 1. Node — compile once (set \`executable\` or WEB_GEOMETRY_COMPILER_BIN).
import { prepare, type PrepareOptions } from 'web-geometry';
const compilation: PrepareOptions = { resourceBaseUrl: '/cache/city/' };
await prepare('scenes/city', 'cache/city', 'full', 150000, compilation);

// 2. Browser — HTML: <canvas id="viewer" style="width:100%;height:70vh"></canvas>
import { createExplorer, type Explorer, type ExplorerOptions } from 'web-geometry';
const options: ExplorerOptions = {
  manifestUrl: '/cache/city/manifest.json',
  scope: 'full',
  interactive: true,
};
const explorer: Explorer = await createExplorer('viewer', options);
// A first image is submitted; detail and temporal antialiasing settle progressively.
// In your page/component teardown: explorer.dispose();`,
  },
  {
    ...GUIDE,
    id: 'architecture',
    title: 'Architecture & rules',
    description: 'What the engine promises and the conventions every function below follows.',
    html: `<p>The mission, in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/architecture/PRODUCT_PRINCIPLES.md">Product principles</a>: virtualized geometry for the web at the performance of the best desktop engines — geometry streamed by clusters, one cut through a DAG per frame, a visibility buffer, temporal antialiasing, fixed streaming and memory budgets. The lighting is what the geometry is for; its stages are in <code>docs/SPEC_ENGINE_WITHOUT_THREE.md</code> §8.</p>
<h3 class="text-lg font-bold mt-4">Conventions of the math API</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Column-major 4×4 matrices</strong> in sixteen consecutive numbers, <code>[12..14]</code> the translation — a host-library matrix copies without reordering.</li>
<li><strong>Output first, allocation never.</strong> A function writes into the <code>out</code> buffer it receives and returns it; <code>outAt</code>/<code>aAt</code> offsets let one large buffer hold many operands.</li>
<li><strong><code>Float64Array</code> for what is computed</strong>, <code>ArrayLike&lt;number&gt;</code> for what is only read. Single precision is a send conversion, done when a result is copied into a GPU buffer.</li>
<li><strong>Same bits as the reference</strong>, proven by <code>pnpm run perf:core</code>: each line runs the host library and the engine on the same seeded inputs and refuses an engine slower than the reference. Two declared exceptions: the sRGB curve (gap ≤ 1e-11) and the depth terms of the projection (reversed, infinite far plane).</li>
<li><strong>Measure before optimising.</strong> A per-step CPU profile (<code>cpu-timing</code> diagnostic) and a GPU stage profile (<code>stageProfile()</code>) say where a frame goes; nothing is optimised on a supposition.</li>
</ul>
<h3 class="text-lg font-bold mt-4">Reading this portal</h3>
<p>Every application example imports <code>web-geometry</code>. The source-module link on each entry is implementation provenance, not a consumer import path. An entry with an <span class="badge badge-warning badge-sm">in development</span> badge names a function the repository does not deliver yet: its page states the issue that carries it and the signature that issue commits to. Everything else is on <code>develop</code> today.</p>`,
  },
  {
    ...GUIDE,
    id: 'three-migration',
    title: 'Three.js migration',
    description:
      'What a Three.js host replaces, function by function, and what changes in the numbers.',
    issue: 79,
    html: `<p>The engine no longer depends on the host library for its maths: a Three.js host keeps its scene and hands the engine numbers. The rows below are delivered; the adapter package (<code>packages/three-adapter</code>) and the full 77-function table (<code>docs/MIGRATION_THREE.md</code>) are the work of #79, once the engine-owned scene model (#78) lands.</p>
<div class="overflow-x-auto my-4"><table class="table table-zebra table-sm"><thead><tr><th>Three.js</th><th>Engine</th><th>Declared difference</th></tr></thead><tbody>
<tr><td><code>Matrix4.multiplyMatrices(a, b)</code></td><td><code>multiplyMatrix4(out, a, b)</code></td><td>none — same bits, ×1.2</td></tr>
<tr><td><code>Matrix4.invert()</code></td><td><code>invertMatrix4(out, m)</code></td><td>none — a singular matrix gives sixteen zeros, ×1.3</td></tr>
<tr><td><code>Matrix4.compose / decompose</code></td><td><code>composeMatrix4 / decomposeMatrix4</code></td><td>none, ×1.4 / ×1.1</td></tr>
<tr><td><code>Vector3.dot / crossVectors / applyMatrix4</code></td><td><code>dotVector3 / crossVector3 / transformAffinePoint</code></td><td>none — reads at offsets, ×3.9 / ×5.0 / ×2.4</td></tr>
<tr><td><code>Color.convertSRGBToLinear()</code></td><td><code>srgbToLinear(c)</code></td><td>exact curve instead of rounded constants: gap ≤ 1e-11, invisible at 8 bits</td></tr>
<tr><td><code>PerspectiveCamera.updateProjectionMatrix()</code></td><td><code>perspectiveProjection(out, fov, aspect, near, zoom)</code></td><td>reversed depth, infinite far plane: <code>near</code> → 1, infinity → 0</td></tr>
<tr><td><code>Frustum.setFromProjectionMatrix</code></td><td><code>updateCameraFrame(frame, projection, world, far)</code></td><td>the far plane comes from the declared <code>far</code>, not from the projection</td></tr>
<tr><td><code>FrontSide / BackSide / DoubleSide</code></td><td><code>Side = 'front' | 'back' | 'double'</code></td><td>read once at the import boundary by <code>sideOf</code></td></tr>
<tr><td><code>Object3D.updateMatrixWorld</code></td><td><code>updateNodeMatrixWorld(tree, node)</code></td><td>same traversal on flat arrays; <code>hierarchyUpdateBatch</code> does the whole tree in one pass</td></tr>
<tr><td><code>THREE.LOD</code></td><td>—</td><td>no equivalent: the level of detail is the DAG cut, chosen per frame by the screen error</td></tr>
</tbody></table></div>
<p>The delivered functions are listed batch by batch, with their proof, in
<a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/API.md">docs/API.md</a>.</p>
<p>Two-step path for a host: keep Three.js for loading and scene building and render with the engine (what the measurement Lab does today); then replace the loading by the compiled cache and drop <code>three</code> from the dependencies.</p>`,
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
<li><code>render()</code> returns <code>hizTestedClusters</code>, <code>hizRejectedClusters</code>, <code>hizRejectedTriangles</code> and <code>hizCountedFrame</code>: what the post pass tested and rejected on the image the last periodic sample described — the device counts, the host rereads one image in fifteen, and <code>null</code> means no sample yet, never zero.</li>
<li><code>stageProfile()</code> carries the partition stage: <code>lignes</code> (resident rows), <code>occulteurs</code>, <code>testees</code>, <code>historiqueOcculteurs</code> (rows the previous image drew) and <code>retiresParLaPyramide</code> (rows that pyramid withdrew), with the GPU milliseconds of the <code>WG partition</code>, <code>WG HiZ pyramid</code>, <code>WG HiZ test</code>, <code>WG visibility primary</code> and <code>WG visibility secondary</code> passes.</li>
<li>The measurement harness prints the same numbers per view as <em>Hi-Z tested/rejected</em>; the street view of the reference scene rejects 5,131 of 24,902 rows where the former history rejected 440.</li>
</ul>
<p>The lesson <a class="link link-primary" href="#/en/examples/occlusion-two-phase">Hide a ring behind a ring</a> shows the counters move on the garden as the eye drops to ring height.</p>`,
  },
];

export const EXAMPLES = [
  {
    ...EXAMPLE,
    id: 'example-many-lights',
    title: 'Many lights, one budget',
    description:
      'Declare a ring of shadowed lamps, read the sampling budget, and tell a converged still image from a moving one.',
    html: `<p>Every declared light is culled per 16×16 screen tile (<code>lightSettings.maxLightsPerTile</code> of them kept). What a pixel does with its tile's list depends on the image: a <strong>moving</strong> image that temporal antialiasing accumulates weighs every light without its shadow — the cheap part — and shades in full only <code>lightSettings.samplesPerPixel</code> (4) of them, the shadow read included: a light worth a sample's share is shaded exactly, the rest are drawn in proportion to their weight and divided by their probability, so the history averages an unbiased estimate. A <strong>still</strong> image shades every light of the tile and converges to the exact sum over its sixteen accumulated frames, then holds: two runs give the same image to the bit.</p>
<p>What a host observes: <code>explorer.lightSettings</code> publishes the budgets; <code>metrics().lightsSampled</code> is the mode flag: <code>true</code> when the resolve ran in its sampled mode — a moving image on a history, where a pixel with more lights than samples draws a subset —, <code>false</code> when it ran the full loop; <code>metrics().frameHeld</code> says the still image has converged; <code>stageProfile()</code> carries the lighting resolve stage. The declared cost is a faint grain on lit surfaces while the camera moves, measured in <code>docs/SDK.md</code>; the gain, on a moving camera over thirty-two shadowed lamps reaching one pixel, is a GPU envelope of 39.9 → 17.9 ms at 2496×1404. The <a class="link link-primary" href="#/en/playground/many-lights-sampling">ring lesson</a> shows it live.</p>`,
    example: `const { maxLightsPerTile, samplesPerPixel } = explorer.lightSettings; // 32 per tile, 4 shaded per moving pixel
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  explorer.addLight({
    id: \`ring-\${i}\`, kind: 'point', castsShadow: true, range: 11, intensity: 45,
    position: [Math.cos(angle) * 6, 4.5, Math.sin(angle) * 6],
    color: i % 2 ? [0.08, 0.35, 1] : [1, 0.3, 0.08],
  });
}
const metrics = explorer.render();
// While the camera moves on a history: lightsSampled === true, at most samplesPerPixel lamps shaded per pixel.
// Once still and converged: lightsSampled === false, frameHeld === true — the exact image, held.
console.log(metrics.lightsSampled, metrics.frameHeld, metrics.lightsActive);`,
  },
  {
    ...EXAMPLE,
    id: 'example-explorer',
    title: 'Explorer startup and budgets',
    description:
      'Interactive startup with explicit memory budgets; the engine owns controls, sizing and demand-driven rendering.',
    example: engineExampleCode,
  },
  {
    ...EXAMPLE,
    id: 'example-camera',
    title: 'Camera frame without allocation',
    description:
      'A projection and a camera frame allocated once, rewritten every frame from a world matrix.',
    example: `import { createCameraFrame, perspectiveProjection, updateCameraFrame } from 'web-geometry';

const projection = new Float64Array(16);
const world = new Float64Array(16); // the camera's world matrix, column-major
const frame = createCameraFrame(); // view, viewProjection, frustum planes

function onResize(width, height) {
  perspectiveProjection(projection, 50, width / height, 0.1, 1);
}
function onFrame() {
  // world[12..14] = eye position, columns 0..2 = orientation
  updateCameraFrame(frame, projection, world, 2000);
  // frame.viewProjection feeds the GPU, frame.planes the culling
}`,
  },
  {
    ...EXAMPLE,
    id: 'example-batch',
    title: 'A hierarchy in one batch',
    description:
      'Ten thousand nodes composed and multiplied by their parents in one pass, on flat buffers.',
    example: `import {
  HIERARCHY_ROOT, MATRIX_VALUES, POSITION_VALUES, QUATERNION_VALUES, hierarchyUpdateBatch,
} from 'web-geometry';

const n = 10000;
// One buffer per quantity, and fixed-size sub-views over it — built once, never per frame.
const views = (buffer, stride) =>
  Array.from({ length: n }, (_, i) => buffer.subarray(i * stride, (i + 1) * stride));
const world = new Float64Array(n * MATRIX_VALUES);
const positions = new Float64Array(n * POSITION_VALUES);
const rotations = new Float64Array(n * QUATERNION_VALUES);
const scales = new Float64Array(n * POSITION_VALUES).fill(1);
const parents = new Uint32Array(n).fill(HIERARCHY_ROOT); // parents[i] < i, or a root
for (let i = 0; i < n; i++) rotations[i * QUATERNION_VALUES + 3] = 1; // identity rotation
const local = new Float64Array(MATRIX_VALUES); // scratch, reused by every element

// One pass, parents before children: local = T·R·S, then world = parent world · local.
hierarchyUpdateBatch(
  views(world, MATRIX_VALUES),
  views(positions, POSITION_VALUES),
  views(rotations, QUATERNION_VALUES),
  views(scales, POSITION_VALUES),
  parents,
  n,
  local,
);`,
  },
  {
    ...EXAMPLE,
    id: 'example-texture-streaming',
    title: 'Texture tiles under a per-frame budget',
    description:
      'How material textures stream tile by tile, what bounds each frame, and how a host reads the cadence.',
    html: `<p>Material textures are virtual: 128×128 tiles live in two fixed pools, and the rendered image itself asks for the tiles it reads (<code>textureTilesRequested</code>). A tile that is not resident yet shows its finest resident ancestor level, down to the pinned tail — never a hole. Each frame, one pass copies the requested tiles most looked-at first under two fixed budgets: <code>maxTextureTransferBytesPerFrame</code> (16 MiB) and <code>maxTextureUploadMsPerFrame</code> (1.0 ms of CPU). Once either is spent, the pass stops; the remainder is deferred to the next frames — offered again in the same order until fresh feedback replaces it — so a cold traversal streams at a fixed cadence instead of stalling the frame. The first tile of a pass is always copied: even a zero budget makes progress. <code>flush()</code> lifts both budgets and converges the pose.</p>
<p>Read the cadence on peaks, never on medians: <code>textureUploadPeakMs</code> is the worst budgeted pass since the start, <code>textureUploadMs</code> the last pass (<code>null</code> when it had nothing to serve), <code>textureTilesDeferred</code> what the budget pushed to the next frame, and <code>stageProfile()</code> gives the p50/p95 of the "Textures" stage. Measured on the Emerald cache, general view, cold cache and moving camera (1280×720, DPR 1, threshold 1 px, two runs): the "Textures" stage p95 went from 4.2–9.3 ms to 1.1–1.2 ms, the browser frame interval p99 from 33–133 ms to 16.8 ms; the declared cost is a coarser image while tiles land — 8–12 tiles per frame, 1.2–1.8 missing levels on average at the end of the traversal against 0.6–0.7 before — and a still pose converges to the same 0 px capture. The bench reads it with <code>--budget-textures &lt;ms&gt;</code> (<code>scripts/mesure/README.md</code>).</p>`,
    example: `import { createExplorer } from 'web-geometry';

const explorer = await createExplorer('viewer', {
  manifestUrl: '/cache/city/manifest.json',
  scope: 'full',
  textureSource: 'cache', // baked levels read on demand, source images never decoded
  maxTextureUploadMsPerFrame: 1, // CPU milliseconds of tile copies per frame (default)
  maxTextureTransferBytesPerFrame: 16 * 1024 * 1024, // tile bytes per frame (default)
  stageProfile: true,
});
const metrics = explorer.render(pose);
console.log(metrics.textureTilesRequested, metrics.textureTilesDeferred); // asked, pushed to next frame
console.log(metrics.textureUploadPeakMs); // worst pass since the start: a stutter is a peak
const textures = explorer.stageProfile().stages.find((stage) => stage.stage === 'textures');
console.log(textures?.cpuMs); // { p50, p95 } of the pass, or null when no image asked for tiles
await explorer.flush(); // the barrier lifts both budgets: the pose converges before a capture`,
  },
  {
    ...EXAMPLE,
    id: 'example-diagnostics',
    title: 'Diagnostics and quality',
    description: 'Switching what the frame draws and how fine the cut is, on a live explorer.',
    example: `explorer.setDiagnostic('clusters'); // one stable colour per cluster, on the real cut
explorer.setDiagnostic('screen-error'); // the projected error the cut compares to the threshold
explorer.setDiagnostic('beauty'); // back to the lit image
explorer.setPixelError(2); // coarser cut: up to two pixels of projected error
console.log(explorer.diagnostics); // which modes this backend can produce, and why not
console.log(explorer.stageProfile()); // per-stage CPU/GPU quantiles over the last frames`,
  },
];
