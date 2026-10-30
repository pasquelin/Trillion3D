# Ambient occlusion

**Ambient occlusion** (`lighting/ao/`). After depth pyramid and screen probes, before the lit image's
passes, a view drawing it runs one of two methods (`AoMethod`).

- Disc search, up to five fragment passes:
  - setup of half and quarter (four surfaces per pixel, farthest depth, normals averaged by depth);
  - search per coarser resolution (`rgba16float` setup in, `r8unorm` occlusion out);
  - last pass at image size: blends coarser result by depth and normal, fades, raises to the power,
    weighs by intensity; at one resolution it is alone, taps reading the depth pyramid.
  - Compute option: that pass over the depth's normals, no quad blur, then a smoothing pass.
- Horizon search, four passes:
  - search with its integral;
  - spatial filter, compute: 16 × 8 workgroup, float texture, **stored value held to [0, 1]**;
  - temporal filter (history reprojected by camera motion or the surface's own vector; two
    alternating textures; history is white outside its texture);
  - upsample.

Colour and indirect passes multiply emission, sky light diffuse and, where asked, screen probes'
light by it (`ambientOcclusionApplied`); off, a one-texel stand-in and view word 0 are bound.

**Horizon history settles before the view rests.** Temporal filter keeps `1 − blend` of history per
image; after `n` images the first weighs `(1 − blend)ⁿ`: within a tenth of convergence after `ceil(ln 0.1 / ln(1 − blend))` images
(`settlingImages`: 22 at blend 0.1; 1 for blend 0 or at least 1). `HorizonHistory.images`
counts images drawn since history was dropped (a cut or remade view restarts it; an intensity change
doesn't). A view with horizon occlusion on, temporal and drawn is redrawn until it has them
(`ambientOcclusionSettling`, `'occlusion'` reason of `frame/loop/unsettled.ts`). History reprojects by
the previous camera (`frame/backend/state/previousCamera.ts`) when its last image is the preceding
one; else it restarts as after a cut.

Not drawn: where the bounce is on, without drawn depth, in a diagnostic or unlit view. Textures are
budget-refused as screen probes' (`ledgerAdmitted`, `ResourceAllocator`).
