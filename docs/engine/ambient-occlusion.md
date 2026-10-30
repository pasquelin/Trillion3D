# Ambient occlusion

**Ambient occlusion** (`lighting/ao/`). After the depth pyramid and the screen probes, before the
lit image's passes, a view that draws it makes the passes of one of two methods (`AoMethod`: what it
asks of a view, whether its programs are ready, its passes). The disc search makes up to five
fragment passes: the setup of the half and of the quarter (the four surfaces a pixel stands for, the
farthest of their depths, their normals averaged by how near each depth is to it), the search at
each coarser resolution (an `rgba16float` setup in, an `r8unorm` occlusion out), and the last pass
at the image's size, which reads the surfaces and the depth directly, blends the coarser result in
by depth and normal, fades it, raises it to the power and weighs it by the intensity; at one
resolution the last pass is alone, its taps reading the depth pyramid's cells (the farthest opaque
depth of a block of pixels, never the transparents' front). The compute option makes that last pass
over the depth's normals with no blur among a quad, and a smoothing pass after it. The horizon
search makes four passes: the search with its integral, the spatial filter — a compute pass, a
workgroup of 16 × 8 pixels loading its tile of the occlusion and the depth once, into a float
texture it writes, **the value stored held to [0, 1]** as the reference's 8-bit target holds it,
before any bilinear read — the temporal filter (which reads the history of the last image through
the camera's motion, or the surface's vector where it moves by itself, and writes the other of two
textures that take turns; the history, kept on the view's state, is white outside its texture) and
the upsample. The colour pass and the indirect pass read the last texture by load and multiply the
emission, the sky light's diffuse and, where it is asked, the screen probes' light by it
(`ambientOcclusionApplied`); an image with the occlusion off reads a one-texel stand-in and a view
word at 0, and is lit as it was, bit for bit.

**The horizon history settles before the view rests.** The temporal filter keeps `1 − blend` of its
history at each image, so after `n` images the first image weighs `(1 − blend)ⁿ`: the history is
within a tenth of what it converges to after `ceil(ln 0.1 / ln(1 − blend))` images
(`settlingImages`, 22 at the default blend of 0.1; 1 for a blend of 0 or of 1 or more). The history
counts the images drawn on it since it was last dropped (`HorizonHistory.images`: a cut or a remade
view starts the count again, a change of intensity does not), and a view whose horizon occlusion is
on, temporal and drawn is not held — it is drawn again, whatever the temporal anti-aliasing does —
until it has them (`ambientOcclusionSettling`, the `'occlusion'` reason of
`frame/loop/unsettled.ts`, as the screen probes' own settling). The history reprojects by the view's
previous camera (`frame/backend/state/previousCamera.ts`) where its last image is the one before,
and starts again as after a cut where it skipped one.

Not drawn where the bounce is on (the probes' short-range occlusion is the one there), nor in an
image whose depth was not drawn, a diagnostic view, or an unlit view. Memory: the textures at the
size of the render targets are counted in the view's bytes and refused by the budget like the screen
probes' — one admission sequence for every such view (`ledgerAdmitted`: the held allocation's bytes
credited, the held one given back whichever answers), the bytes asked being those of the same list
of allocations, counted (`ResourceAllocator`). The passes' bind groups are kept by the engine's one
bind-group cache, one set for each of the resources the view has met.
