/** Engine guides — memory, admission, texture lanes — kept apart so the guide list stays within its line budget. */
import { GUIDE } from './guides.ts';
import type { PortalEntry } from '../model.ts';

export const ENGINE_GUIDES: PortalEntry[] = [
  {
    ...GUIDE,
    id: 'memory-pools',
    title: 'Memory pools and cut admission',
    description:
      'Two fixed pools set by the host, what a view asks beyond them, and how to read the verdict.',
    html: `<p>The engine holds two fixed pools, in bytes, never read off the machine: <code>geometryPoolBytes</code> for cluster pages (512 MiB by default, <code>floor(bytes / pageBytes)</code> slots) and <code>texturePoolBytes</code> for virtual-texture tiles. A budget that cannot be held as given is brought to what can and the reason is published: <code>geometryPoolClamp</code> reads <code>root-cover</code> (raised to the root cover, which is always resident), <code>scene</code> (the scene is smaller), <code>ceiling</code> (above <code>geometryPoolCeilingBytes</code>, the most a session may grow to), <code>page-cap</code>, <code>device-limit</code> or <code>null</code>.</p>
<h3 class="text-lg font-bold mt-4">What a view asks beyond the pool</h3>
<p>Nothing is refused and nothing stops: the cut is <strong>coarsened, never truncated</strong>. When the pages the cut asks for — root cover included — exceed the slots, the admission doubles the screen error the image was drawn at (1 px at least on a first overflow, then 2, 4…), and relaxes it rung by rung down to 0.125 px once the cut fits with room to spare. Two rules keep it still: a rung moves only on a cut sampled at the rung in force, and a rung whose requested cut overflowed for this view is not asked again until the view or the pool changes. A still camera therefore settles in a few samples and holds its frame.</p>
<h3 class="text-lg font-bold mt-4">Changing a pool mid-session</h3>
<p><code>explorer.setMemoryBudgets({ geometryPoolBytes, texturePoolBytes })</code> resizes without emptying: the root cover keeps its place before any other page, then the pinned pages, then the most recent; only what no longer fits leaves, and the report says how many (<code>evictedPages</code>, <code>evictedTiles</code>, <code>durationMs</code>). Bind groups that named the old pool are rebuilt on the next image by the identity of what they name.</p>
<h3 class="text-lg font-bold mt-4">Reading the verdict</h3>
<p>Per frame, <code>render()</code> returns <code>coverageBudgetLimited</code> (the requested cut does not fit yet) and <code>budgetPixelError</code> (0 while the requested detail fits, else the rung the image is drawn at), plus <code>geometryPoolSaturated</code>. The <code>coverage-budget</code> diagnostic, delivered during <code>flush()</code>, names each change of verdict with the slots asked and held.</p>`,
    example: `const explorer = await createExplorer('viewer', {
  manifestUrl: '/cache/city/manifest.json',
  scope: 'full',
  geometryPoolBytes: 64 * 1024 * 1024,        // slots = floor(bytes / pageBytes)
  geometryPoolCeilingBytes: 256 * 1024 * 1024, // the most a slider may ask mid-session
  texturePoolBytes: 256 * 1024 * 1024,
  onDiagnostic: (event) => {
    if (event.phase === 'coverage-budget') console.log(event.context); // limited, requiredSlots, slots, pixelError
  },
});
const frame = explorer.render();
frame.geometryPoolClamp;      // 'root-cover' | 'scene' | 'ceiling' | 'page-cap' | 'device-limit' | null
frame.coverageBudgetLimited;  // true while the requested cut does not fit
frame.budgetPixelError;       // 0, or the coarser threshold the image is drawn at
const pools = await explorer.setMemoryBudgets({ geometryPoolBytes: 32 * 1024 * 1024 });
pools.evictedPages;           // what the smaller pool could not keep`,
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
<li><strong>Normal maps on two channels, never on BC7.</strong> A texture only <code>normalTexture</code> reads is fitted channel by channel — X and Y each on their own ladder — and the shader rebuilds Z as the unit remainder. A stored Z that is not that remainder fails the gate, and the map stays lossless.</li>
</ul>
<h3 class="text-lg font-bold mt-4">What the engine does with it</h3>
<p>Each atlas has one pool per <strong>lane</strong>: <code>lossless</code> (RGBA8), <code>rgba</code> (BC7 or ASTC blocks) and <code>two-channel</code> (BC5 or ASTC luminance-alpha). <code>textureCompression</code> (<code>'auto'</code> by default) names the family the session samples — the first the device has and the cache holds kept chains in, BC before ASTC; RGBA8 when the device has neither, when no chain was kept in a family it has, or when the host asks for <code>'none'</code> —, and every texture takes the lane its chain was kept in: a refused chain, a texture without a whole baked chain or a host image reads from the lossless lane, whatever the device. <code>texturePoolBytes</code> is the same fixed reservoir, half per atlas; within an atlas each lane that has textures gets one layer, then the rest by the bytes its tiles would take, and never more than its tiles need.</p>
<h3 class="text-lg font-bold mt-4">What to read</h3>
<p>The compile report (<code>texturePreviews</code> in <code>clusters.json</code>) publishes the bar, how many chains each family kept in each layout, their PSNR quantiles, and every chain left lossless with its figures. In the frame metrics <code>texturePoolFormat</code> names the family held (<code>bc7</code>, <code>astc</code> or <code>rgba8</code>), <code>texturePoolLayers</code> and <code>texturePoolBytes</code> add every lane pool, <code>textureResidentBytes</code> counts each lane at its own texel cost; the <code>material-textures-ready</code> diagnostic lists the pools and the textures per lane. Measured on the reference scene, the still captures of three views move by at most 3 of 255 on any channel of any pixel with either family, for 25.5 → 19.7 MB, 56.1 → 40.3 MB and 76.4 → 64.3 MB of resident texture bytes with the BC family (21.6, 43.2 and 71.1 MB with ASTC).</p>
<p>Contract in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a>, cache layout and the gate in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/FORMAT.md">docs/FORMAT.md</a>, the cook option in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/COMPILER.md">docs/COMPILER.md</a>.</p>`,
    example: `import { createExplorer, type ExplorerOptions } from 'web-geometry';

const options: ExplorerOptions = {
  manifestUrl: '/cache/city/manifest.json',
  scope: 'full',
  interactive: true,
  textureSource: 'cache', // read the baked levels, never the source images
  textureCompression: 'auto', // BC, then ASTC; 'none' keeps every lane RGBA8 for a comparison
  texturePoolBytes: 256 * 1024 * 1024,
};
const explorer = await createExplorer('viewer', options);
const metrics = explorer.render();
// 'bc7' on a desktop card, 'astc' on a phone, 'rgba8' when the device samples neither;
// a chain the cook's gate left lossless reads from the RGBA8 lane in every case.
console.log(metrics.texturePoolFormat, metrics.texturePoolLayers, metrics.textureResidentBytes);`,
  },
];
