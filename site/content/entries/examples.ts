import { engineExampleCode } from '../../lessons/engine-scene/code.ts';
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
