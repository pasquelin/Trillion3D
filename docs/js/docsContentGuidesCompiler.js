/** Compiler guides: what the cluster DAG is built from, and how a host reads what it did. */
const GUIDE = { section: 'guides', kind: 'Guide' };

export const COMPILER_GUIDES = [
  {
    ...GUIDE,
    id: 'dag-simplification',
    title: 'Simplification: the cluster DAG and its two quadrics',
    description:
      'How a coarse level is made, which vertices it is made of, what stays locked, and the report that says what happened.',
    html: `<p>Level 0 of a primitive is an exact spatial partition of its triangles into clusters of at most 128. Every level above it groups 8 to 32 neighbouring clusters, simplifies the merged group to half its triangles, and re-splits the result into clusters of the same size. Two quantities travel with each cluster — the error of the group that produced it and the error of the group that replaces it — and a runtime picks, per frame, the flat cut <code>parentError &gt; threshold ≥ lodError</code> with <code>setPixelError</code>. The option <code>simplification</code> of <code>prepare()</code> says what those coarse levels are allowed to be made of:</p>
<ul class="list-disc pl-6 space-y-1">
<li><code>none</code> — level 0 only. Every cluster is a root; nothing on screen is a surface the source does not have.</li>
<li><code>qem-endpoints</code> — a positional quadric whose collapses land on an existing vertex. A coarse cluster still indexes the source vertex buffer; its attributes are those of whichever copy survived.</li>
<li><code>qem-attributes</code> — the published attribute-aware quadric. Normals, both texture coordinate sets and colours enter the error (weights 0.5, 0.5 and 0.25 per unit against the group's extent; tangents are copied from the survivor), and every surviving vertex is then solved to the position and attributes that minimise its quadric. A coarse level therefore carries vertices the source does not have: the compiler appends them to the primitive's vertex buffer in <code>source.gltf</code>, after the source vertices, and leaves the index accessor as it came.</li>
</ul>
<h3 class="text-lg font-bold mt-4">What stays where it is</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Group borders.</strong> A vertex two groups of the same level share is locked: neither moved nor rewritten, so the cut stays watertight whatever mix of levels a frame draws.</li>
<li><strong>Texture seams.</strong> A position written twice with two texture coordinates is a seam; the simplifier only slides it along itself and never merges its two sides, so a coarse facade never wears the texture from across the seam. A position copied for a hard edge or a colour step is not protected: under <code>qem-attributes</code> its copies collapse together and their normals are solved.</li>
<li><strong>The input.</strong> Before any partition the compiler welds every vertex identical in position and attributes onto its first copy, whatever the source format wrote — one vertex per face corner, or the same vertex twice. A weld that would make an edge non-manifold is refused, and the report says so.</li>
</ul>
<h3 class="text-lg font-bold mt-4">Reading it</h3>
<ul class="list-disc pl-6 space-y-1">
<li>Per primitive, <code>clusters.json</code> carries <code>vertices</code> — <code>{ source, used, welded, weldRefused, coarse }</code> — and <code>dag</code>: <code>depth</code>, <code>levels[]</code> with the error band of each level, and <code>groups[]</code> tallying, level by level, the groups that reduced and why the others did not (<code>noCollapse</code>, <code>borderLost</code>), with <code>welded</code> and <code>relocked</code> counting the retries.</li>
<li>A DAG that did not climb is a warning the compiler carries on the primitive's progress event and the engine reports as the <code>dag-warnings</code> diagnostic: <code>DAG_FLAT</code> (clusters, no coarse level) or <code>DAG_ROOTS</code> (too many roots for its size).</li>
<li>In the image, <code>render()</code> returns <code>selectedTriangles</code> and <code>drawnTriangles</code> for the cut of the frame; the <code>lod</code> diagnostic colours exact clusters and coarse fallbacks.</li>
</ul>
<p>The lesson <a class="link link-primary" href="#/en/examples/runtime-pixel-error">Cross the observatory at any scale</a> shows the cut move with the tolerance on a cache compiled with <code>qem-endpoints</code>; the same scene compiled with <code>qem-attributes</code> reveals levels made of solved vertices, their normals interpolated rather than picked.</p>`,
  },
];
