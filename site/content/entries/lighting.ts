import type { PortalEntry } from '../model.ts';

/** Lighting guides: what the shadow stage does to a frame and how a host observes it. */
const GUIDE = { section: 'guides', kind: 'Guide' };

export const LIGHTING_GUIDES: PortalEntry[] = [
  {
    ...GUIDE,
    id: 'shadow-pages',
    title: 'Shadow pages and the camera',
    description:
      'How shadow maps are cut into pages, why a moving camera redraws only a strip of them, and which counters show it.',
    html: `<p>Every shadow-casting light owns a slice of one 4096² depth atlas: six faces for a point light, one for a spotlight, four cascades for the sun. A face is cut into 128-texel <strong>pages</strong>, the unit of everything below: a page is stale or drawn, is queued or admitted, and is the unit the millisecond budget counts.</p>
<h3 class="text-lg font-bold mt-4">Sun cascades are sliding extents</h3>
<p>Each cascade covers a sphere around a slice of the camera frustum — a sphere, so that turning the camera changes nothing. Its map is an extent of whole pages on the light plane, addressed by absolute page modulo the face, as the pages of a virtual shadow map are. When the camera moves less than a page, the extent does not move. When it moves by whole pages, the extent slides: the pages that stay inside keep their depth and only the strip that entered is redrawn. A move of a whole extent side, a step of the depth anchor along the light axis, a new sun direction or a new lens restart the cascade whole. Until an entered strip is drawn, the shader reads it as absent and takes the next, coarser cascade, exactly as an unmapped page falls back to a coarser clipmap level.</p>
<h3 class="text-lg font-bold mt-4">What stales a page</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>A world change</strong> — an object moved through its <code>position</code>/<code>rotation</code>, a light's <code>position</code> or <code>intensity</code> written directly — stales the pages its box covers at once, in every face whose range it touches.</li>
<li><strong>A representation change</strong> — a cluster swapping level of detail, a page entering or leaving residency, a colour tile arriving for a texture a masked material reads — describes the same world at another precision. It is held while the camera moves and stales its pages at the first frame the camera rests, so the settled map is that of the current cut whatever the history, while a moving camera pays only for the strips that enter.</li>
<li>A colour tile of a texture no cut-out reads, or a colour change on an opaque material, stales nothing: the depth those maps hold does not depend on it.</li>
</ul>
<h3 class="text-lg font-bold mt-4">Budget, culling and counters</h3>
<p>Stale pages are grouped into rectangles and admitted by priority until <code>shadowBudgetMs</code> (1 ms by default), the pass's own GPU time smoothed per page; the first region of a frame always passes. Each region rejects, before its draw, every cluster whose world sphere misses the box it cuts in the extent — its page rectangle by the depth bounds of the map. The frame publishes <code>shadowPagesDrawn</code>, <code>shadowPagesTotal</code> (cumulative, settle drains included), <code>shadowPagesPending</code> and <code>shadowWaitMs</code> in its <code>FrameMetrics</code>; the per-stage profile adds, under <em>Shadows</em>, the pages invalidated, redrawn and pending, the oldest wait in frames, and the clusters the region culls kept on a sampled frame. The <a class="link link-primary" href="#/en/playground/directional-shadow">shadow sun lesson</a> shows these counters live: turn the sun and every page restarts; zoom or orbit and only strips are redrawn; stand still and nothing is.</p>`,
    example: `const world = createWorld('viewer');
await world.scene.load(manifestUrl);
world.scene.add(light.directional({
  position: [-3, 8, -5], target: [0, 0, 0], color: [1, 0.95, 0.85], intensity: 2.5, castShadow: true,
}));
// The shadow-page budget is the engine's own; a host reads what it drew, never sets it.
world.onFrame(({ metrics }) => console.log(metrics.residentPages, metrics.selectedTriangles));
world.camera.position.set(12, 3, 8); // a step of a few metres
world.invalidate(); // only the strip of pages the move entered redraws`,
  },
];
