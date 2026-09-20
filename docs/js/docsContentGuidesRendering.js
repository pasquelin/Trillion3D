/** Rendering guides: what a frame does with a material class, and the counters that say so. */
const GUIDE = { section: 'guides', kind: 'Guide' };

export const RENDERING_GUIDES = [
  {
    ...GUIDE,
    id: 'water-pass',
    title: 'Water and glass: the fullscreen water pass',
    description:
      'How a transmissive material is composed on the WebGPU path — one surface buffer, one fullscreen composite on the frozen backdrop — and what the imported material decides.',
    html: `<p>A material that transmits — glTF <code>KHR_materials_transmission</code>, with <code>KHR_materials_ior</code> and <code>KHR_materials_volume</code>; water, thick glass — is not blended by its opacity: it rereads what the frame already drew behind it. On the WebGPU path that reading is a pass of its own, after the ordinary blends, and there is no option to set: the class is read on the imported material, never on a name.</p>
<ol class="list-decimal pl-6 space-y-1">
<li><strong>Frozen backdrop.</strong> The lit image and the opaque depth are copied once. Every transmissive surface reads these copies, so the order between two of them changes nothing — and none sees through another, the same declared limit as the glTF reference viewer.</li>
<li><strong>Surface stage</strong> (<code>WG water surfaces</code>). The transmissive items draw with the blend vertex stage and the blend material read, into a surface buffer of the opaque resolve's layout — base colour, normal, roughness, emission, occlusion — plus the item rank and the opacity, with hardware depth tested against the opaque copy and written: the nearest surface of a pixel is the one kept, whatever the number of surfaces stacked there, and a surface behind an opaque never reaches the composite.</li>
<li><strong>Composite</strong> (<code>WG water composite</code>). One fullscreen triangle lights each water pixel once, with the engine's only lighting formula: the backdrop refracted by the IOR and attenuated by the volume colour, the probe reflection weighted by Fresnel, the declared lights' specular, and the surface's own lit colour for the share the material does not transmit. A pixel with no water discards, and the image keeps what it held.</li>
</ol>
<p><strong>The volume ends where the opaque scene begins.</strong> The ray travels the declared thickness, or the distance to the backdrop under the pixel when that is shorter; both the exit it is reread at and the attenuation follow that distance. A basin declared deeper than its floor renders the same pixel as one declared exactly as deep; a block just below the surface is displaced and tinted by its own depth, not by the basin's. In front of nothing, the transmitted share leaves the display background through instead of a black radiance.</p>
<h3 class="text-lg font-bold mt-4">Reading it</h3>
<ul class="list-disc pl-6 space-y-1">
<li><code>stageProfile()</code> deposits both passes on the <em>transparents</em> stage, by label; a scene with no transmissive material never encodes them, and allocates one texel for their targets.</li>
<li>The frame-target budget counts the backdrop (12 bytes per pixel), the water surfaces (28) and their depth (4) only when the scene transmits: <code>gpuFrameTargetBytes</code> says so.</li>
<li>A diagnostic view — clusters, wireframe, screen error — or a diagnostic GPU variant draws the transmission slice as one more blend, so the variant measures the same fragment stage on every transparent.</li>
</ul>`,
  },
];
