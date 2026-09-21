/** The cluster geometry format: what a compiled page holds, how it is decoded, how to read its cost. */
const GUIDE = { section: 'guides', kind: 'Guide' };

export const FORMAT_GUIDES = [
  {
    ...GUIDE,
    id: 'cluster-format',
    title: 'Quantized cluster pages',
    description:
      'What a compiled cluster page holds per triangle, on which grids, and where to read what the quantization cost.',
    html: `<p>Every cluster of at most 128 triangles is written once, by the native compiler, as an independently decodable page (<code>docs/FORMAT.md</code>, format <code>WGP3</code>): bit-packed local indices, positions on an object grid, two-byte octahedral normals, integer texture coordinates, byte colours — and no tangent, which a shader rebuilds from the triangle. The header holds the counts, the flags and one quantization record per vector attribute; every stream offset follows from them, so a shader reads any vertex of a resident page in place, in O(1), and the JavaScript or WebAssembly decoder unpacks the same bytes to floats for the autonomous backend.</p>
<h3 class="text-lg font-bold mt-4">The grids, and what they cost</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Positions.</strong> One grid per primitive, the finer of two rules: <code>2^(floor(log2(widest extent)) − 16)</code>, about 65,536 steps across the object, and an eighth of the finest group error its DAG published, so a cluster's displacement projects below an eighth of the threshold wherever the cut selects it — bounded so the object spans at most 2^23 steps, since every page of the primitive keeps that one exponent (two clusters sharing a vertex land it on the same cell; a page too wide for the grid is refused, <code>PAGE_ATTRIBUTE_RANGE</code>, never re-gridded). A cluster spends only the bits its own box needs — 10 to 13 per axis on a city, not 32 —, and its decoded value is <code>min + q × step</code>, an exact product and one rounded sum, the same 32-bit float on every decoder.</li>
<li><strong>Texture coordinates.</strong> A fixed grid of <code>2^-14</code>: a quarter of a texel on a 4096-wide map.</li>
<li><strong>Normals.</strong> Two octahedral bytes, within 1° of the source. <strong>Colours.</strong> A grid of <code>2^-8</code> per channel, with per-page minima: a constant channel — alpha, most often — costs no bits.</li>
<li><strong>Shared vertices.</strong> Two source vertices that land on the same cells are kept once: a source that repeats a vertex per corner comes down to its distinct vertices without changing a triangle.</li>
<li><strong>What is not written.</strong> Tangents, rebuilt by the shader from the triangle; and a texture coordinate set that no texture of the material names in <code>texCoord</code>.</li>
</ul>
<p>The cost is declared, never hidden. Each page carries its worst position displacement in its header; each primitive publishes <code>quantization</code> — <code>positionExponent</code>, <code>positionStep</code>, <code>uvExponent</code>, <code>maxPositionError</code> — in the manifest, and each page descriptor names its resident bytes (<code>geometry.bytes</code>) beside what its float decode occupies (<code>geometry.uncompressedBytes</code>). The cut does not yet add the quantization error to a cluster's error band; the specification's C4 keeps that open.</p>
<h3 class="text-lg font-bold mt-4">How to observe it</h3>
<p>On a live explorer, <code>explorer.metadata.primitives</code> is the opened manifest: sum <code>pages[].geometry.bytes</code> over <code>pages[].count / 3</code> triangles for the packed figure, <code>uncompressedBytes</code> for the float one, and read the largest <code>quantization.maxPositionError</code>. In the repository, <code>node --experimental-strip-types scripts/mesure/octetsParTriangle.mjs &lt;cache&gt;/native/full</code> prints those figures for any compiled cache. These are the cache's figures: the WebGPU drawing engine still uploads the source float vertices and index pages, and its geometry pool says so.</p>
<h3 class="text-lg font-bold mt-4">Contract and refusals</h3>
<p><code>pages[].geometry.formatVersion</code> is 3 and <code>codec</code> is <code>quantized</code>; the binary sidecar that names them is version 6, and a reader refuses another version whole rather than page by page. A page whose header leaves the format — a width above 24 bits, an exponent beyond ±64, an unknown flag, a length that does not match its streams — is refused before any stream is read; an index at or past the vertex count is refused before any float is produced. The WGSL routines are proven on the graphics card against the JavaScript decoder, bit for bit on positions, texture coordinates and colours (<code>test/justesse/decodage-cluster-gpu.mjs</code>).</p>`,
  },
];
