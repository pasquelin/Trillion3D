/** Guide on cook-time texture compression: prose in `html`, code in `example`. */
export const TEXTURE_GUIDES = [
  {
    section: 'guides',
    kind: 'Guide',
    id: 'texture-compression',
    title: 'Textures compressed at cook time',
    description:
      'BC7 for desktop cards, ASTC 4×4 for mobile ones, baked once by the compiler; the device picks, the pool holds one byte per texel.',
    html: `<p>Material textures are virtual: the compiler bakes the whole mip chain of every texture an atlas reads, the browser reads only the 128×128 tiles the image asks for, and two fixed pools hold them. Uncompressed, a texel costs four bytes in the pool. The compiler now bakes every level three times — a lossless PNG, and the same level in <strong>BC7</strong> and in <strong>ASTC 4×4</strong>, one byte per texel — and the tail of every chain travels in the manifest sidecar in the three encodings. One cache serves every device.</p>
<h3 class="text-lg font-bold mt-4">What the engine decides</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>The device chooses the format.</strong> A device with <code>texture-compression-bc</code> samples BC7, one with <code>texture-compression-astc</code> samples ASTC, one with neither keeps RGBA8 — the reason is published, never guessed. <code>textureCompression</code> (<code>'auto'</code> by default) can insist on <code>'bc7'</code> or <code>'astc'</code>, or ask for <code>'none'</code>: the lossless "before" of a comparison.</li>
<li><strong>Budgets do not move, tiles do.</strong> <code>texturePoolBytes</code> is the same fixed reservoir; in a block format it carries four times the tiles — sixteen layers per atlas at 512 MiB instead of four — and every pinned tail costs a quarter.</li>
<li><strong>All or nothing.</strong> It applies under <code>textureSource: 'cache'</code>, and a source image cannot fill a block pool: one texture without a whole baked chain brings both pools back to RGBA8, by name.</li>
</ul>
<h3 class="text-lg font-bold mt-4">What to read</h3>
<p><code>texturePoolFormat</code> in the frame metrics names the colour pool actually held (<code>bc7-rgba-unorm-srgb</code>, <code>astc-4x4-unorm-srgb</code> or <code>rgba8unorm-srgb</code>); <code>texturePoolBytes</code>, <code>texturePoolLayers</code> and <code>textureResidentBytes</code> follow the format. The <code>material-textures-ready</code> diagnostic carries the choice and its reason under <code>pool.compression</code>. The bench pits the formats on one cache with <code>--textures cache --compression-avant none --compression-apres bc7</code>.</p>
<h3 class="text-lg font-bold mt-4">The declared cost</h3>
<p>Both codecs are the compiler's own, one layout each and no mode search: BC7 mode 6, ASTC single partition at the 192-level range with 3-bit weights, each block fitted to one segment of RGBA space and proved on an independent decoder. Measured by <code>pnpm run mesure:blocs:natif</code> on the reference scene's 336 textures, the loss reads a median of 53.0 dB PSNR (BC7) and 53.6 dB (ASTC), 43 dB at the tenth percentile, 23 dB at worst — thirteen brick normal maps and foliage sheets whose blocks vary in two directions, the case a two-subset mode or BC5 would serve, left to a measured batch. The bench's 0 px thresholds do not apply to this lot; the pixel difference is measured and published with the batch.</p>
<p>Try it live in the playground: <em>Resize the two pools</em> reads back the texture pool's format and its accepted allocation. Contract in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a>, cache layout in <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/FORMAT.md">docs/FORMAT.md</a>.</p>`,
    example: `import { createExplorer, type ExplorerOptions } from 'web-geometry';

const options: ExplorerOptions = {
  manifestUrl: '/cache/city/manifest.json',
  scope: 'full',
  interactive: true,
  textureSource: 'cache', // read the baked levels, never the source images
  textureCompression: 'auto', // BC7, then ASTC; 'none' keeps RGBA8 for a comparison
  texturePoolBytes: 256 * 1024 * 1024,
};
const explorer = await createExplorer('viewer', options);
const metrics = explorer.render();
// 'bc7-rgba-unorm-srgb' on a desktop card, 'astc-4x4-unorm-srgb' on a phone,
// 'rgba8unorm-srgb' when the device samples neither or a chain is not baked.
console.log(metrics.texturePoolFormat, metrics.texturePoolLayers, metrics.texturePoolBytes);`,
  },
];
