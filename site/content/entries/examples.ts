import { engineExampleCode } from '../../lessons/engine-scene/code.ts';
import type { PortalEntry } from '../model.ts';
/** Application examples: code in `example`, rendered by the React Entry component. */
const EXAMPLE = { section: 'examples', kind: 'Example' };

export const EXAMPLES: PortalEntry[] = [
  {
    ...EXAMPLE,
    id: 'example-many-lights',
    title: 'Many lights, one budget',
    description:
      'Declare a ring of shadowed lamps, read the sampling budget, and tell a converged still image from a moving one.',
    html: `<p>Every declared light is culled per 16×16 screen tile, kept up to a fixed count. What a pixel does with its tile's list depends on the image: a <strong>moving</strong> image that temporal antialiasing accumulates weighs every light without its shadow — the cheap part — and shades in full only a few of them, the shadow read included: a light worth a sample's share is shaded exactly, the rest are drawn in proportion to their weight and divided by their probability, so the history averages an unbiased estimate. A <strong>still</strong> image shades every light of the tile and converges to the exact sum over its accumulated frames, then holds: two runs give the same image to the bit.</p>
<p>What a host observes: <code>metric.frame(world)</code> reads the resident pages and selected triangles of a settled frame; the world itself pauses once the image has held for 120 frames, which is what tells a converged still image from a moving one. The declared cost is a faint grain on lit surfaces while the camera moves, measured in <code>docs/SDK.md</code>; the gain, on a moving camera over thirty-two shadowed lamps reaching one pixel, is a GPU envelope of 39.9 → 17.9 ms at 2496×1404. The <a class="link link-primary" href="#/en/playground/many-lights-sampling">ring lesson</a> shows it live.</p>`,
    example: `for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  world.scene.add(light.point({
    castShadow: true, distance: 11, intensity: 45,
    position: [Math.cos(angle) * 6, 4.5, Math.sin(angle) * 6],
    color: i % 2 ? [0.08, 0.35, 1] : [1, 0.3, 0.08],
  }));
}
world.invalidate();
// While the camera moves, the shaded set is a sampled subset; once still, the world pauses once
// the image has held for 120 frames — that pause is what "converged" means here.
world.onFrame(({ metrics }) => console.log(metrics.selectedTriangles, metrics.residentPages));`,
  },
  {
    ...EXAMPLE,
    id: 'example-world',
    title: 'World startup and budgets',
    description:
      'Interactive startup with explicit memory budgets; the world owns controls, sizing and demand-driven rendering.',
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
<p>Read the cadence on peaks, never on medians: <code>textureUploadPeakMs</code> is the worst budgeted pass since the start, <code>textureUploadMs</code> the last pass (<code>null</code> when it had nothing to serve, or under a barrier), <code>textureTilesDeferred</code> what the budget pushed to the next frame, and <code>world.stageProfile()</code> gives the p50/p95 of the "Textures" stage. Measured on the Emerald cache at commit 8c20f71b, general view, cold cache and moving camera (1280×720, DPR 1, threshold 1 px, two runs, Apple M2 Max, Chrome 153): the "Textures" stage p95 went from 4.2–9.3 ms to 1.1–1.2 ms, the browser frame interval p99 from 33–133 ms to 16.8 ms; the declared cost is a coarser image while tiles land — 8–12 tiles per frame, 1.2–1.8 missing levels on average at the end of the traversal against 0.6–0.7 before — and a still pose converges to the same 0 px capture. With the pass clock also covering the shadow follow of the landed tiles (619e34fb, same command, two runs): "Textures" 1.0 / 1.2 ms p50/p95, session peak 5.1–16.6 ms over the four sessions (the two runs and their A/A repeats), on the one frame that lands the first colour tile. The bench reads it with <code>--budget-textures &lt;ms&gt;</code> (<code>scripts/mesure/README.md</code>).</p>`,
    example: `const world = createWorld('viewer');
await world.scene.load('/cache/city/manifest.json'); // baked levels read on demand
world.budget.texturePool = 256 * 1024 * 1024;
// Per-frame transfer and upload budgets are the engine's own; a host reads the outcome, not the
// knob: \`metric.frame(world)\` gives the resident pages and triangles of a settled frame.
world.onFrame(({ metrics }) => console.log(metrics.residentPages, metrics.selectedTriangles));`,
  },
  {
    ...EXAMPLE,
    id: 'example-diagnostics',
    title: 'Diagnostics and quality',
    description:
      'Switching what the frame draws, on a live world; and what a lost GPU device leaves on screen — nothing stale.',
    example: `world.diagnostic.mode = 'clusters'; // one stable colour per cluster, on the real cut
world.diagnostic.mode = 'wireframe';
world.diagnostic.mode = 'triangles';
world.diagnostic.mode = 'beauty'; // back to the lit image
console.log(world.diagnostic.modes); // which modes this device can produce
world.onFrame(({ metrics }) => console.log(metrics.selectedTriangles, metrics.residentPages));

// A lost GPU device leaves nothing stale: the world withdraws and blanks the canvas it
// presented. Recovery is a new world: dispose this one, then createWorld again.`,
  },
];
