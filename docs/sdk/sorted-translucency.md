# Sorted translucency

`world.orderIndependentTranslucency` holds the per-pixel sorted translucency settings, each also a
`createWorld` option. Default: translucent layers blend in drawing order, far to near.

`oitSortedPixels` (`false`; read once at session open) collects layers of blending `normal` and
`additive`: each fragment stores light, transmittance and depth in its pixel's list. A full-screen pass
sorts each list by depth and composes it front to back over what was drawn apart from them (other
blendings, transmissive layers, water, particles).

- `oitSortedPixelsEnable` (`true`): switch read each image.
- `oitPassType` (`3`, `0` to `3`): bits `1` standard translucency, `2` separate one. Every layer is
  drawn apart, so bit `2` decides and bit `1` changes nothing.
- `oitMaxSampleCount` (`4`, `1` to `16`): fragments kept a pixel, rounded down to a square (`8` keeps `4`).
- `oitMethod`: `1` (default) multi-layer alpha blending keeps fragments in depth order, merges those past
  the room into the last, drops a fragment behind a stored one whose transmittance is under
  `oitTransmittanceThreshold` (`0.05`, `0` to `1`) in every channel. `0` k-buffer keeps the first
  fragments to arrive, drops the rest (as reference).
- Buffer: `96` bytes a pixel at default (more where the pool grew); needs a device whose fragment stage
  binds nine storage buffers (`maxStorageBuffersInFragmentStage` where listed, else the shared limit).
  A device granting fewer, an image with display layers (`displayFilter`), or an unbindable buffer keeps
  drawing-order blending.

Differences from the reference (which sorts under a raster-ordered view WebGPU lacks):
- Fragments are only appended (atomic add for the pixel slot, atomic exchange linking a shared-pool
  node at the list head): no lock, none dropped.
- Sort, threshold and merge happen in the full-screen pass; equals reference for fragments met nearest
  first with at most one past the room (layers drawn nearest first while sorting is on).
- Multi-layer lists every fragment: the node pool holds at least `oitMaxSampleCount` nodes a pixel and
  grows (doubled at least, never shrunk) to the last images' demand, up to the device's binding limit.
- A pool overflow loses no light: a fragment with no node adds its light and log transmittance to
  per-pixel sums merged into the last layer (approximates reference; pool right-sized next image).
- Fragments pushed out of the sorted array merge the same way: with several past the room, their light
  is summed unweighted through the last layer, not the reference's front-to-back chain.
- Fragments are depth-tested as blended layers are (water included).
- Composed alpha is the target's alpha times the sorted layers' mean transmittance (reference writes the
  mean transmittance over the alpha).

`oitDebug` (`0`, `0` to `3`; `2` for separate translucency) writes over the image the method, samples
kept and, at pixel `oitDebugCursorX`, `oitDebugCursorY` (`-1`, none; pixel must be inside the image, off
its first and last row and column), that pixel's count and each fragment's depth, light, transmittance.

```js
const world = createWorld('viewer', { oitSortedPixels: true }) // crossing glass panes and additive sprites sorted per pixel
world.orderIndependentTranslucency = { oitMaxSampleCount: 9 } // nine fragments a pixel, for deeper stacks of layers
world.orderIndependentTranslucency = { oitMethod: 0, oitMaxSampleCount: 16 } // the k-buffer, sixteen fragments
world.orderIndependentTranslucency = { oitSortedPixelsEnable: false } // blended in drawing order again, without rebuilding the programs
world.orderIndependentTranslucency = { oitDebug: 2, oitDebugCursorX: 640, oitDebugCursorY: 360 } // the samples of the pixel at (640, 360)
world.orderIndependentTranslucency = { oitMaxSampleCount: null } // back to the default, 4
```
