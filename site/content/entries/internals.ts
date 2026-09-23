import { engineLink } from '../engineLink.ts';
import type { PortalEntry } from '../model.ts';

/** "How it works": what the engine does inside, one screen each, for a curious reader. */
const INTERNAL = { section: 'internals', kind: 'Guide' };

export const INTERNALS: PortalEntry[] = [
  {
    ...INTERNAL,
    id: 'architecture',
    title: 'How a frame is drawn',
    description:
      'The path from your scene to the picture: the pieces that are kept, the pixels that are filled, the light that is added.',
    html: `<ol>
<li><strong>Choose the pieces.</strong> Every model is made of small patches of triangles, <em>clusters</em>, stored at several levels of detail. Each frame, the GPU picks for each part of the model the coarsest level that still looks exact on screen.</li>
<li><strong>Write who is where.</strong> The chosen triangles are drawn once into a <em>visibility buffer</em>: for every pixel, only the number of the triangle it shows.</li>
<li><strong>Paint the surfaces.</strong> Then each pixel reads its triangle's material: colour, roughness, metal, normal map. Surfaces of the same kind are painted together, in one pass.</li>
<li><strong>Light, then smooth.</strong> Lights and shadows are added, see-through surfaces come last, and <em>temporal antialiasing</em> blends each frame with the ones before it, so edges stay smooth.</li>
</ol>
<p>When nothing moves, none of this runs: the world keeps the last picture.</p>
${engineLink('webgpu-page-raster', 'The whole path')}`,
  },
  {
    ...INTERNAL,
    id: 'occlusion-two-phase',
    title: 'Skipping what is hidden',
    description:
      'Why a wall hides the room behind it for free: the engine does not draw what the last frame proved hidden.',
    html: `<p>A town has thousands of objects behind the first row of houses. Drawing them would cost time for pixels nobody sees. So the engine draws in two passes:</p>
<ol>
<li>First, what was visible in the previous frame. That gives a rough picture of the depth: how far the nearest surface is at each place of the screen.</li>
<li>Then every other piece is tested against that depth. A piece that is fully behind is skipped; the rest is drawn.</li>
</ol>
<p>The test only skips what is surely hidden: a wrong guess costs a second test, never a missing pixel. There is nothing to set; it is always on.</p>
${engineLink('webgpu-page-raster', 'In depth')}`,
  },
  {
    ...INTERNAL,
    id: 'cluster-format',
    title: 'How models are packed',
    description:
      'What the compiler writes: small pages of triangles, stored compactly, each one readable on its own.',
    html: `<p>The compiler cuts a model into clusters of at most a hundred and twenty-eight triangles, and saves each one as a <em>page</em> the browser can read on its own.</p>
<ul>
<li>Positions, texture coordinates and normals are rounded onto fine grids. That makes a page several times smaller than plain numbers, and the rounding stays far below a pixel.</li>
<li>Each page says how far its rounding moved a point, so the engine never guesses.</li>
<li>Pages are named by their content: two models that share a piece share its page.</li>
</ul>
<p>The exact layout is in <a href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/FORMAT.md">docs/FORMAT.md</a>.</p>`,
  },
  {
    ...INTERNAL,
    id: 'water-pass',
    title: 'Water and glass',
    description:
      'How a see-through material bends what is behind it: the engine reads back the picture it already drew.',
    html: `<p>Water and thick glass are not drawn like paint. The engine first draws everything solid, keeps a copy of that picture, and then, for each pixel of water or glass, reads the copy a little to the side, as light bends through the surface.</p>
<ul>
<li>How much it bends and what colour it takes come from the imported material: its index of refraction, its thickness and its tint.</li>
<li>The surface also reflects the sky and the lights, more at a grazing angle, as real water does.</li>
<li>One limit: a glass does not show another glass behind it.</li>
</ul>
${engineLink('transparent-surfaces', 'In depth')}`,
  },
  {
    ...INTERNAL,
    id: 'memory-pools',
    title: 'Where memory goes',
    description:
      'Two fixed amounts of GPU memory, one for shapes and one for textures, and what happens when a view asks for more.',
    html: `<p>The engine keeps two <em>pools</em> in GPU memory: one for the pages of shapes, one for the tiles of textures. You set their size with <code>world.budget</code> (chapter 8); the engine never reads the machine to guess it.</p>
<ul>
<li>The coarsest version of every model always stays in, so there is never a hole.</li>
<li>When a view needs more than a pool holds, the engine draws with coarser pieces until it fits: less detail, never a missing part.</li>
<li>Changing a pool while the scene runs keeps what still fits and lets go of the rest.</li>
</ul>
${engineLink('memory', 'In depth')}`,
  },
  {
    ...INTERNAL,
    id: 'texture-compression',
    title: 'Smaller textures',
    description:
      'Textures are cut into tiles, loaded only where the picture needs them, and compressed when that does not change the image.',
    html: `<p>A texture is an image painted on a surface. The compiler prepares each one at every size, from full down to tiny, and cuts them into square tiles. The browser loads only the tiles the picture shows, at the size it shows them.</p>
<p>The compiler can also store the tiles in a compressed format the GPU reads directly, about four times smaller. It keeps the compressed version only when it looks the same as the original; otherwise the tile stays uncompressed. A tile that has not arrived yet shows a smaller version of itself, never a hole.</p>
${engineLink('virtual-textures', 'In depth')}`,
  },
  {
    ...INTERNAL,
    id: 'shadow-pages',
    title: 'Shadows in pieces',
    description:
      'Why a moving camera redraws only a strip of its shadows: the shadow map is cut into pages, like the models.',
    html: `<p>To know what is in shadow, each light renders the scene from its own point of view into a <em>shadow map</em>: a picture of distances. The engine cuts these maps into pages.</p>
<ul>
<li>The sun covers the view with a few maps, fine near the camera and coarser far away.</li>
<li>When the camera moves a little, only the strip of pages that came into view is redrawn; the others are kept.</li>
<li>A page that is not ready yet borrows the coarser map, so a shadow is never missing.</li>
</ul>
${engineLink('direct-lighting', 'In depth')}`,
  },
];
