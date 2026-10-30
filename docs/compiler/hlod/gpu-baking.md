# GPU baking

`approximate` layers' atlases and shells are built on the GPU. A shell's scene holds each source
mesh once in its own space; a point is brought into the mesh's space by each object whose box holds
it and reads the mesh's winding number (far triangles expanded to the second order); the first
object finding it inside ends the sum. A part's thinness is measured in mesh space under each scale
its objects carry: a thin part is copied once per scale, thickened by a shell, and placed with
scale taken out. A source mesh is welded by position unless the layer sets `useRenderLODMeshes`
(vertices as its buffers hold them). `baseCapping` adds one last mesh: the convex hull of each
object's vertices within the base's height above the scene's lowest point, hulled again together,
flat and facing down or extruded up into a slab. `groundClipping` drops hidden triangles and those
wholly on or under the plane (`discard`), or cuts the shell along it after dropping hidden
triangles, removes what lies under, collapses degenerate cut edges and, with `cutAndFill`, fills
each cut loop by a constrained Delaunay triangulation.

The compiler opens one headless device per process on first need (Metal, Vulkan, Direct3D 12 or
GL); none fails the job with `GPU_UNAVAILABLE`. A `merge` layer merging its materials and a
`simplify` layer bake on that device too, with the same refusal. A shell's scene is one GPU binding,
never split: past the adapter's `max_storage_buffer_binding_size` the job fails with
`GPU_BAKE_FAILED`; so does a merged or simplified entry's.
The atlas reads the sources through 22 views: six axes, the cube's eight corners, four top edges and
four side edges; each a square image of `captureResolution` pixels framing the objects' bounding
sphere grown by a quarter, within `captureFieldOfView`. Each texel takes the view facing its normal
most squarely among those seeing its point past the shell, bilinear between four pixels. A pixel is
the first surface along the ray through its centre (no anti-aliasing), materials filtered
anisotropically (up to `captureAnisotropy` (8) trilinear samples); a translucent surface is composed over what lies behind
([Translucent sources](translucent-sources.md#translucent-sources)). Pixel precision: base colour
8-bit sRGB, normal 10 bits a channel, roughness, metallic, specular 8 bits, emission half float.
With `translucency: 'surfaceOnly'` a view draws no translucent surface, so the one behind shows.

A texel no view sees is a hole, filled from surrounding texels on the base colour, metal-roughness
map and emission; never on the normal map. Baked specular (`maps.specular`) rides in the packed
metal-roughness map's red channel (a source's own: `KHR_materials_specular` factor times its
texture's alpha, 0.5 where none); no material reads it yet. Baked emission
(`maps.emissive`) is the sources' `emissiveFactor`, strength and emissive texture, held as an sRGB
map of the emission over its largest channel, that channel being the emission factor
(`KHR_materials_emissive_strength` past one). The atlas is sized by `textureSizing`, baked at its largest side, then averaged
down per map. The normal map is in the shell's own tangents, which the pages store.

With the default `emptyTexels: 'nearestChart'`, every texel holding no chart's value
(outside every chart, or a gutter copying a hole) takes the nearest chart's on every map, normal
map included: ring by ring outward, each the mean of neighbours already holding one. `black` leaves
those texels black (frame's up and zero), so far charts' borders darken. Two GPUs may differ by a unit in a
texel's byte.
