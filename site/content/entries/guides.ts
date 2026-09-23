import type { PortalEntry } from '../model.ts';

/** Guides: prose in `html`, rendered by the React Entry component. */
const GUIDE = { section: 'guides', kind: 'Guide' };

export const GUIDES: PortalEntry[] = [
  {
    ...GUIDE,
    id: 'three-migration',
    title: 'Migration from Three.js',
    description:
      'On the left a complete Three.js program, on the right the engine program that draws the same scene, section by section.',
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
