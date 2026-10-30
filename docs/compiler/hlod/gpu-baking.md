# GPU baking

The atlases of the `approximate` layers are baked on the GPU, and their shells are built there too:
each point the solid is sampled at learns whether it lies inside, and the gaps are closed from each
point's distance to the nearest triangle. A shell's scene holds each source mesh once, in its own
space, however many objects place it: a point is brought into the mesh's space by each object whose
box holds it, and there reads the mesh's winding number, its far triangles expanded to the second
order; the first object that finds it inside ends the sum. Each part is measured for thinness in its
mesh's own space, under each scale its objects carry: a thin part is copied once per scale,
thickened by a shell, and placed by its objects with their scale taken out — a turned copy reads as
an unturned one. The surface is followed from some of each mesh's vertices as they lie, a thin
part's too. A source mesh is welded by position unless the layer reads its render meshes
(`useRenderLODMeshes`), its vertices then as its buffers hold them. A layer capping its base
(`baseCapping`) adds one mesh last: the convex hull of each object's vertices within the base's
height above the scene's lowest point, hulled again together, flat there and facing down or extruded
up into a slab. A layer clipping at a ground plane (`groundClipping`) drops, with the hidden
triangles, those wholly on or under it (`discard`), or cuts the shell along it once its hidden
triangles are dropped, what lies under removed, its degenerate cut edges collapsed and, with
`cutAndFill`, each cut loop filled by a constrained Delaunay triangulation of its outline. The
compiler opens one headless device per process the first time a layer needs one (Metal, Vulkan,
Direct3D 12 or GL), never reopens it, and fails the job with `GPU_UNAVAILABLE` on a machine that has
none; a `merge` layer merging its materials and a `simplify` layer bake their entries on that device
too, by the same program, and are refused the same way. A shell's scene is one GPU binding, never
split: past the adapter's `max_storage_buffer_binding_size` the job fails with `GPU_BAKE_FAILED`; so
does a merged or simplified entry's, which holds its own triangles — every part of the merged mesh
when the entry is seen through (`translucency`). A shell is simplified whole, each pass over every
triangle at once. Its atlas reads the sources through 22 views of them — the six axes, the cube's
eight corners, four edges of its top and its four side edges, each square image `captureResolution`
pixels a side framing the sphere of the objects' bounds — each object's mesh box placed by its
matrix, its sphere scaled by the matrix's largest axis, gathered as a merged actor's are —, grown by
a quarter, within `captureFieldOfView` —: each texel takes the view that faces its normal most
squarely among those that see its point past the shell, bilinearly between the four pixels around
it, each pixel what the view draws along the one ray through its centre — the property images are
drawn with no anti-aliasing —, its materials filtered over the pixel's footprint as an anisotropic
sampler filters a texture — as many samples along the footprint's longer side as it spans the
shorter, up to `captureAnisotropy` (8), each trilinear at that share's level —: the first surface it
meets, a translucent one composed over what lies behind it ([Translucent
sources](translucent-sources.md#translucent-sources)), each pixel then kept at the precision a
view's buffers hold it: the base colour in eight-bit sRGB, the normal at ten bits a channel,
roughness, metallic and specular at eight bits, the emission at half precision; with
`translucency: 'surfaceOnly'`, a view draws no translucent surface, so the surface behind it shows:
a glass curtain wall takes the colour of what lies behind its panes. Only the pixels a texel reads
are traced. A texel no view sees is a hole, filled from the texels around it on the base colour, the
metal-roughness map and the emission; the normal map is never filled. A baked specular
(`maps.specular`) rides in the packed metal-roughness map's red channel — a source's own is its
`KHR_materials_specular` factor times its specular texture's alpha, one half where it declares none
—, which no material input reads yet; a baked emission (`maps.emissive`) is the sources'
`emissiveFactor`, strength and emissive texture, held as an sRGB map of the emission over its
largest channel, that channel the material's emission factor (`KHR_materials_emissive_strength` past
one). The atlas is sized by `textureSizing`, baked at its largest side and each map averaged down to
its own. The normal map is written in the shell's own tangents — per corner, averaged over the
corners about its vertex that share its normal and its coordinates —, which its pages store and the
engine bends the map with. Before that, by default (`emptyTexels: 'nearestChart'`), every texel that
holds no chart's value — outside every chart, or in a gutter copying a hole — takes the nearest
chart's on every map, the normal map's too: ring by ring outward from the charts, each the mean of
its neighbours already holding one, the dilation a `merge` layer's atlas fills its gutters and empty
cells by. So the holes filled beside a chart, the supersampling's averaging down and the mips read
no black; `black` leaves those texels black, the frame's up and zero, and far charts' borders
darken. One GPU always bakes the same bytes; two GPUs may part by a unit in a texel's byte, so a
cache cooked on one machine stays valid there.
