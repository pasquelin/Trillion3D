# Sorted translucency

`world.orderIndependentTranslucency` holds the settings of the per-pixel sorted translucency, each an
option of `createWorld` too. By default the translucent layers blend in drawing order, objects far to
near.

With `oitSortedPixels` (`false`, the default; the project switch, read once when the session opens
because the layers' programs are made with it) the layers of blending `normal` and `additive` are
collected instead of blended: each fragment puts its light, transmittance and depth in a short list its
pixel holds. Once the pass has drawn the layers, a full-screen pass sorts every list by depth and
composes it front to back over what the pass drew apart from them (the other blendings, the transmissive
layers, the water and the particles), so two crossing layers are ordered right at every pixel.

- `oitSortedPixelsEnable` (`true`) is the switch read each image.
- `oitPassType` (`3`, from `0` to `3`) is a set of bits: `1` the standard translucency, `2` the separate
  one. Every layer the engine draws is drawn apart from the lit image, so bit `2` decides and bit `1`
  changes nothing.
- A pixel keeps `oitMaxSampleCount` fragments (`4`, from `1` to `16`, rounded down to a square: `8` keeps
  `4`).
- `oitMethod` picks how. `1`, the default, the multi-layer alpha blending, keeps the fragments in depth
  order and merges those past the room into the last, dropping a fragment behind a stored one whose
  transmittance is under `oitTransmittanceThreshold` (`0.05`, from `0` to `1`) in every channel. `0`, the
  k-buffer, keeps the first fragments to arrive and drops the rest, as the reference does.
- The buffer is `96` bytes a pixel at the default (more where the pool has grown, see below) and needs a
  device whose fragment stage binds nine storage buffers (its own limit,
  `maxStorageBuffersInFragmentStage`, where the browser lists one, and the limit every stage shares). A
  device that grants fewer, an image with display layers (`displayFilter`), or a buffer the device
  cannot bind keeps the layers blended in drawing order.

Deliberate differences from the reference, which sorts under a raster-ordered view WebGPU does not have:
- Fragments are only appended (a slot of the pixel taken by an atomic add, a node of a shared pool by
  another, linked at the head of the pixel's list by an atomic exchange): no lock, no wait, no fragment
  given up for contention.
- The sort, the transmittance threshold and the merge of fragments past the room into the last are made
  by the full-screen pass, ties broken by the packed words, so the image is the same whatever order the
  fragments arrive in, and equals the reference's for fragments met nearest first and at most one past
  the room (the layers are drawn nearest first while the sorting is on, as the reference does).
- The multi-layer method lists every fragment a pixel receives, as the reference's lock never drops one:
  the pool of nodes holds `oitMaxSampleCount` nodes a pixel at least and is grown (doubled at least, the
  old buffer retired, never shrunk) to the number of nodes the last images' fragments asked, read back a
  few images late, up to what the device binds.
- An image that outgrows the pool loses no light: a fragment with no node adds its light and the
  logarithm of its transmittance to sums the pixel holds in whole numbers (an exact sum, whatever the
  arrival order), and the full-screen pass merges those sums into the last layer as the reference merges
  a fragment past the room (the light added through the last layer's transmittance, the transmittances
  multiplied). This approximates the reference for those fragments, whose order and mutual occlusion are
  not known; the pool is right-sized from the next image on.
- The same merge takes the fragments the sorted array pushes out: the pass walks each list once, inserts
  each fragment into the array of the `oitMaxSampleCount` nearest (a cost of fragments times samples),
  and sums the pushed-out light unweighted by one another, so with more than one fragment past the room
  the merged light is the sum of their lights through the last layer, not the reference's front-to-back
  chain.
- Fragments are tested against the depth the blended layers are tested against (water included).
- The composed alpha is the target's alpha multiplied by the mean transmittance of the sorted layers (the
  reference writes the mean transmittance over the alpha, losing what the layers drawn apart from the
  sorted ones left in it).

`oitDebug` (`0`, from `0` to `3`; `2` for the separate translucency) writes over the image the method,
the samples kept and, at the pixel `oitDebugCursorX`, `oitDebugCursorY` (`-1`, none; the pixel must lie
inside the image, off its first row and column and its last), that pixel's count and each fragment's
depth, light and transmittance.

```js
const world = createWorld('viewer', { oitSortedPixels: true }) // crossing glass panes and additive sprites sorted per pixel
world.orderIndependentTranslucency = { oitMaxSampleCount: 9 } // nine fragments a pixel, for deeper stacks of layers
world.orderIndependentTranslucency = { oitMethod: 0, oitMaxSampleCount: 16 } // the k-buffer, sixteen fragments
world.orderIndependentTranslucency = { oitSortedPixelsEnable: false } // blended in drawing order again, without rebuilding the programs
world.orderIndependentTranslucency = { oitDebug: 2, oitDebugCursorX: 640, oitDebugCursorY: 360 } // the samples of the pixel at (640, 360)
world.orderIndependentTranslucency = { oitMaxSampleCount: null } // back to the default, 4
```
