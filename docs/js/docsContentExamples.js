import { engineExampleCode } from './engine-scene/code.js';
/** Application examples: code in `example`, rendered by the React Entry component. */
const EXAMPLE = { section: 'examples', kind: 'Example' };

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
<p>Read the cadence on peaks, never on medians: <code>textureUploadPeakMs</code> is the worst budgeted pass since the start, <code>textureUploadMs</code> the last pass (<code>null</code> when it had nothing to serve), <code>textureTilesDeferred</code> what the budget pushed to the next frame, and <code>stageProfile()</code> gives the p50/p95 of the "Textures" stage. Measured on the Emerald cache at commit 8c20f71b, general view, cold cache and moving camera (1280×720, DPR 1, threshold 1 px, two runs, Apple M2 Max, Chrome 153): the "Textures" stage p95 went from 4.2–9.3 ms to 1.1–1.2 ms, the browser frame interval p99 from 33–133 ms to 16.8 ms; the declared cost is a coarser image while tiles land — 8–12 tiles per frame, 1.2–1.8 missing levels on average at the end of the traversal against 0.6–0.7 before — and a still pose converges to the same 0 px capture. The bench reads it with <code>--budget-textures &lt;ms&gt;</code> (<code>scripts/mesure/README.md</code>).</p>`,
    example: `import { createExplorer } from 'web-geometry';

const explorer = await createExplorer('viewer', {
  manifestUrl: '/cache/city/manifest.json',
  scope: 'full',
  textureSource: 'cache', // baked levels read on demand, source images never decoded
  maxTextureUploadMsPerFrame: 1, // CPU milliseconds of tile copies per frame (default)
  maxTextureTransferBytesPerFrame: 16 * 1024 * 1024, // tile bytes per frame (default)
  stageProfile: true,
});
const metrics = explorer.render();
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
explorer.setDiagnostic('materials'); // one colour per material class: the pass that resolved the pixel
explorer.setDiagnostic('beauty'); // back to the lit image
explorer.setPixelError(2); // coarser cut: up to two pixels of projected error
console.log(explorer.diagnostics); // which modes this backend can produce, and why not
console.log(explorer.stageProfile()); // per-stage CPU/GPU quantiles over the last frames`,
  },
];
