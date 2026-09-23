/** Engine guides — memory, admission, texture lanes — kept apart so the guide list stays within its line budget. */
import { GUIDE } from './guides.ts';
import type { PortalEntry } from '../model.ts';

export const ENGINE_GUIDES: PortalEntry[] = [
  {
    ...GUIDE,
    id: 'camera-controls',
    title: 'Camera controllers, owned by the world',
    description:
      'The controller a world is given at creation — orbit, flight, first person, trackball, planar pan-zoom, or none — and how a host swaps one for another.',
    html: `<p>A world owns its camera controller: it reads <code>PointerEvent</code>, <code>WheelEvent</code> and <code>KeyboardEvent</code> against the world's own camera, and brings no library of its own into the page. One option chooses it, at creation, and saying nothing is <strong>none</strong> — the world reads no input and the host drives <code>world.camera</code> itself, until it names one. <code>'orbit'</code> is the turntable a viewer expects: primary drag turns the azimuth and the elevation around the framed target, world up kept and the poles never reached; secondary drag or two fingers pan; wheel and pinch zoom.</p>
<ul class="list-disc pl-6 space-y-1">
<li><code>'none'</code> — the world reads no input; the host drives <code>world.camera</code> itself. The default when nothing is named.</li>
<li><code>'orbit'</code> — the turntable above.</li>
<li><code>'fly'</code> — six degrees of freedom: W/S forward and back, A/D left and right, R/F up and down, arrows pitch and yaw, Q/E roll, and a drag looks around.</li>
<li><code>'firstPerson'</code> — the pointer lock is asked for on the gesture, the horizon stays level, the walk follows the yaw alone.</li>
<li><code>'trackball'</code> — the scene spins about the two axes of the screen, roll included and no pole to stall on.</li>
<li><code>'panZoom'</code> — the camera never turns; drags slide the view, wheel and pinch move it in and out of the plane it faces.</li>
</ul>
<p><strong>Nothing happens in a still scene.</strong> The world redraws only while the controller is moving the pose, or while the host calls <code>invalidate()</code>; a settled orbit or a released key costs nothing.</p>
<p><strong><code>world.controls</code> is a live handle, not a one-time choice.</strong> The <code>controls</code> option only sets what the world starts with; <code>world.controls.kind</code> reads or changes which controller drives the camera at any time — the previous one is released and the next built on the world's own camera. <code>world.controls.enabled</code> turns it off without losing it, and <code>world.controls.target</code> is the point a pivot controller turns around.</p>
<p>Controls live on the world for two reasons: they read input on the canvas the world already owns — a second listener would double the gestures — and they follow <code>world.camera</code> when it is replaced, so a host never rebuilds its controller by hand. Live example: <a class="link link-primary" href="#/en/examples/walk-through-a-temple">Walk through a temple</a>.</p>`,
    example: `const world = createWorld('viewer', { controls: 'orbit' }); // at creation
world.controls.kind = 'fly';          // switch live
world.controls.enabled = false;       // pause input
world.controls.target.set(0, 1, 0);   // orbit pivot`,
  },
  {
    ...GUIDE,
    id: 'memory-pools',
    title: 'Memory pools and cut admission',
    description:
      'Two fixed pools set by the host, what a view asks beyond them, and how to read the verdict.',
    html: `<p>The engine holds two fixed pools, in bytes, never read off the machine: a geometry pool for cluster pages (512 MiB by default, <code>floor(bytes / pageBytes)</code> slots) and a texture pool for virtual-texture tiles. <code>world.budget.geometryPool</code> and <code>world.budget.texturePool</code> are read/write properties: writing one sets it, clamped to the read-only <code>world.budget.geometryPoolCeiling</code>/<code>world.budget.texturePoolCeiling</code> — a fixed 512 MiB each, the engine's starting budgets, never read from the machine; reading either back returns what is actually held.</p>
<h3 class="text-lg font-bold mt-4">What a view asks beyond the pool</h3>
<p>Nothing is refused and nothing stops: the cut is <strong>coarsened, never truncated</strong>. When the pages the cut asks for — root cover included — exceed the slots, the admission relaxes the screen error the image is drawn at, rung by rung, until the cut fits with room to spare. A still camera settles in a few samples and holds its frame; <code>metric.frame(world)</code> reads what a settled frame actually drew.</p>
<h3 class="text-lg font-bold mt-4">Changing a pool mid-session</h3>
<p>Assigning <code>world.budget.geometryPool</code> or <code>world.budget.texturePool</code> resizes without emptying: the root cover keeps its place before any other page, then the pinned pages, then the most recent; only what no longer fits leaves. Two writes in one frame rebalance once.</p>`,
    example: `const world = createWorld('viewer', {
  // the public surface leaves pool sizing to \`budget\`, not to a constructor option
});
await world.scene.load('/cache/city/manifest.json');
world.budget.geometryPool = 64 * 1024 * 1024;
world.budget.texturePool = 256 * 1024 * 1024;

console.log(world.budget.geometryPool, world.budget.geometryPoolCeiling);`,
  },
  {
    ...GUIDE,
    id: 'texture-compression',
    title: 'Block-compressed textures under a quality gate',
    description:
      'BC7/BC5 for desktop cards, ASTC 4×4 for mobile ones, baked once by the compiler and kept only where the image does not move; the pools hold one lane per format.',
    html: `<p>Material textures are virtual: the compiler bakes the whole mip chain of every texture an atlas reads, the browser reads only the 128×128 tiles the image asks for, and fixed pools hold them. Uncompressed, a texel costs four bytes in the pool. The compiler can also bake each level in one <strong>block family</strong> beside the lossless PNG — the BC family (<code>--textures-format=bc7</code>, the default: BC7 for colour and smooth data maps, BC5 for normal maps) or ASTC 4×4 (<code>astc</code>: colour endpoint mode 12, or luminance-alpha for normal maps) — one byte per texel, and the tail of every chain travels in the manifest sidecar in that family too. The rule of the repository is that no optimisation may move the image: a chain is kept in blocks <strong>only under a quality gate</strong>.</p>
<h3 class="text-lg font-bold mt-4">The gate, at cook time</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Read back, never trusted.</strong> Every level is decoded again through an independent decoder and compared with the RGBA8 chain on the channels the materials read: an opaque base colour's alpha is not read, a normal map's three channels are, its Z rebuilt against the Z it stores.</li>
<li><strong>The bar.</strong> PSNR of 48 dB over the whole chain, no texel more than 3 levels of 255 off on a read channel — the bar of a still capture, below what an 8-bit display discriminates, carried to the texel —, and no texel of a masked texture changing side of its alpha cutoff. Under the bar the chain stays lossless in that family: no block file, no block tail, and the sidecar's layout word says so.</li>
<li><strong>Normal maps on two channels, never on BC7.</strong> A texture only a normal map reads is fitted channel by channel — X and Y each on their own ladder — and the shader rebuilds Z as the unit remainder. A stored Z that is not that remainder fails the gate, and the map stays lossless.</li>
</ul>
<h3 class="text-lg font-bold mt-4">What the engine does with it</h3>
<p>Each atlas has one pool per <strong>lane</strong>: <code>lossless</code> (RGBA8), <code>rgba</code> (BC7 or ASTC blocks) and <code>two-channel</code> (BC5 or ASTC luminance-alpha). The family the session samples is the first the device has and the cache holds kept chains in, BC before ASTC; RGBA8 when the device has neither, or when no chain was kept in a family it has — and every texture takes the lane its chain was kept in: a refused chain, or a texture without a whole baked chain, reads from the lossless lane, whatever the device. The texture pool is the same fixed reservoir, half per atlas; within an atlas each lane that has textures gets one layer, then the rest by the bytes its tiles would take, and never more than its tiles need.</p>
<h3 class="text-lg font-bold mt-4">What to read</h3>
<p>The compile report (<code>texturePreviews</code> in <code>clusters.json</code>) publishes the bar, how many chains each family kept in each layout, their PSNR quantiles, and every chain left lossless with its figures. In <code>metric.frame(world)</code> the resident-page and triangle counts read what the frame actually drew. Measured on the reference scene, the still captures of three views move by at most 3 of 255 on any channel of any pixel with either family, for 25.5 → 19.7 MB, 56.1 → 40.3 MB and 76.4 → 64.3 MB of resident texture bytes with the BC family (21.6, 43.2 and 71.1 MB with ASTC).</p>
<p>Contract in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a>, cache layout and the gate in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/FORMAT.md">docs/FORMAT.md</a>, the cook option in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/COMPILER.md">docs/COMPILER.md</a>.</p>`,
    example: `const world = createWorld('viewer');
await world.scene.load('/cache/city/manifest.json');
world.budget.texturePool = 256 * 1024 * 1024;
// The compressed family a device samples ('bc7', 'astc' or 'rgba8' when neither) is chosen by
// the engine from what the cache holds and what the device supports; it is not a host option.
const { residentPages } = metric.frame(world);
console.log(residentPages);`,
  },
];
