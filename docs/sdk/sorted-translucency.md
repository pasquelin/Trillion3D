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
- `oitMethod` (`1`, `0` or `1`): names the method in the debug text (`1` multi-layer alpha blending, `0` k-buffer). Both run the
  reference's multi-layer blending: fragments kept in depth order, each one past the room merged into the last (its light seen through the
  last one's transmittance, the transmittances multiplied), a fragment behind the last stored one whose merged transmittance is under
  `oitTransmittanceThreshold` (`0.05`, `0` to `1`) in every channel dropped.
- Layers add their light weighed by their opacity and let `1 - opacity` through, additive ones included.
- Buffers: `36` bytes a pixel of the translucency targets (header and spill) and `20` a kept fragment, so `116` at the default four (the
  reference holds `12` a fragment, `48`), plus a pool of `24` bytes a node that starts at one node for eight pixels (`3` bytes a pixel, so
  about `119` bytes a pixel, `247` MB at 1920 x 1080) and grows with the demand. They are two storage buffers (the slots are split between
  them so that each stays under the device's binding limit); the fragment stage must bind ten storage buffers (`maxStorageBuffersInFragmentStage`
  where listed, else the shared limit). A device granting fewer, an image with display layers (`displayFilter`), or buffers that cannot be
  allocated even split keeps drawing-order blending. A smaller drawing size of the layers (`translucencyScreenPercentage`) keeps the buffers.

Differences from the reference (which sorts under a raster-ordered view WebGPU lacks):

- Fragments are only appended and sorted afterwards: the first `oitMaxSampleCount` of a pixel take the slots it owns, the others a node of a
  shared pool (atomic add, linked at the list head by an atomic exchange): no lock. A pixel lists at most `256` fragments (the bound on the
  sorting, so a pixel under a million sprites costs what a pixel under 256 does); the others are summed into the pixel's spill, see below.
  Each fragment carries the order key of its primitive (two words: its plan instance's rank, whole, then its triangle's in the cluster: the
  paint order). The full-screen pass takes a pixel's listed fragments in key order, fragments of equal keys by their place in the pixel, and
  inserts them one after the other as the reference does. So, for the fragments that reach the lists, the result equals the reference's for any
  order they reach the buffer in.
- What depends on the order the fragments arrive in (the rasterizer's and the atomics', not the paint order): only which fragments are listed
  and which are spilled. Counting is atomic, so the first `256` to arrive in a pixel are listed and the later ones spilled, and the first ones
  to ask the pool for a node get one while it lasts. This happens only (1) on a pixel under more than `256` fragments, and (2) while the pool
  is short of the demand: on the images that grow it (the demand is counted and read a few images late) and wherever the pool is held below the
  demand by the device (its cap, below) or by the budget. On every other pixel the image is the same from one frame to the next. Where it happens,
  the spilled fragments are placed behind the last kept sample whatever their depth, so a nearer fragment that arrived late is composed behind
  farther ones that arrived first: the image of such a pixel can change from one frame to the next when the arrival order does. It is a
  bounded error (the lights and transmittances are all counted, only their mutual order is lost), not a drop.
- The spill holds the fragments past the `256` listed of a pixel and those the pool has no node for. Each is summed, never dropped, never
  waited on: its light per channel as a fixed point (`1/256` units, each fragment's light held to `65504`, a half float's top), its transmittance as
  the fixed point of its negative base-2 logarithm (same unit), each value rounded up or down by a hash of the fragment's order key pair (the same
  every image, so the sum of many faint fragments is unbiased: `5000` fragments of an opacity of `0.0015` sum to the exact float sums within
  one percent, where a rounding to the nearest would lose their light and darken their transmittance), by atomic adds that commute: for a
  given set of spilled fragments the spill is the same whatever the order they are added in. A sum is held in 32 bits, so `256` fragments at
  `65504` fit; a sum that wraps past them sets its flag and reads as the top (a light of about `16.7` million). The combination merges the spill
  behind the last kept sample, as the reference merges each fragment past its samples into its last: its light seen through that sample's
  transmittance, the transmittances multiplied. What stays approximate, on the pixels of the cases above only: the spilled fragments are not
  sorted among themselves (their lights add without being seen through each other, whatever their depths), they are placed behind the last
  kept sample even where nearer, and the threshold test does not apply to them. A fragment of an invocation that covers no sample adds nothing.
  The global count of nodes is tested before a node is taken (so it stops at the pool plus the invocations in flight and does not wrap on a
  frame of many millions of fragments), which makes the demand it reports a lower bound once the pool is spent: a demand that reaches the pool
  asks for a larger pool, which at least doubles each time.
- A device that binds too little for the samples asked, even with the slots split over the two buffers, keeps the most that fit (the square
  below: `16`, `9`, `4` or `1`) and warns once per device, instead of leaving the layers blended (the reference has no such case: it creates its
  textures of the size it asks); only where not even one sample fits are the layers blended. Each pass of an image reads a uniform buffer of its
  own (the engine's per-encoder uniform pool: given back when the encoder is submitted or dropped, so an image that is not submitted leaves
  nothing behind), and the pool's demand is the largest of the passes'.
- Memory goes through the engine's budget: every buffer is asked of the device apart from the frame, under its out-of-memory scope and
  tentatively on the memory budget, and used only once granted (until the first buffers are granted, a frame or two, the layers are blended in
  drawing order). The pool starts at one node for eight pixels, is bounded to the nodes the lists can ask (`256` less the samples, a pixel) and to the
  binding limit, grows (doubled at least) to the demand of the last images, and shrinks to twice the demand once the demand has stayed under a
  quarter of it for 60 frames. A refused pool is asked again at half the bytes down to `1024` nodes (the engine's own pool grant, the one of the geometry and texture pools, with its `gpu-out-of-memory` diagnostic; a growth is the replacement of the pool it replaces on the budget);
  the pool in place stays when no larger one is granted, and the pool is held to what was granted. The samples are lowered (to the square below)
  only when not even the `1024`-node pool beside the head buffer and the slots a pixel owns is granted. A refusal is never terminal and is
  said once per device; it is lifted when the extent changes, or after `60` images with the pool spent the whole time (the count of nodes stops at the pool, so a spent
  pool is the sign that more is wanted) or no buffer is held, and the engine asks again, the samples too where they were lowered. The first buffers
  of a view are a grant the frame loop waits for, as it waits for its targets: the frame is held and a capture waits, instead of showing the layers unsorted.
- The binding limit: the engine asks the adapter for its maximum storage-buffer binding and buffer size, so the cap is the adapter's own, read
  from the device; the engine does not state a figure. At that limit the pool buffer holds `limit / 24` nodes less the slots it owns, and the slots
  are split over the head buffer and the pool buffer so that the samples asked fit (`oitSplit`). For a limit of `2 GiB` and `4` samples: at
  `1920 x 1080` (`2.07` million pixels) the head buffer holds all four slots and the pool holds about `89.5` million nodes, `43` a pixel (a list can
  ask `252`); at 4K (`8.29` million pixels) the same `89.5` million nodes, about `10.8` a pixel; at 8K (`33.2` million pixels) the head buffer
  holds one slot and the pool buffer the other three beside about `6.5` million nodes, `0.2` a pixel (above the minimum pool of one node for eight
  pixels, `4.15` million). Where the demand passes the pool, the fragments past its end spill, as above.
- Fragments are depth-tested as blended layers are (water included).
- Composed alpha is the mean transmittance of the sorted layers, written over the target's alpha as the reference does. The light under them
  is the target's multiplied by each channel's own transmittance, as the reference does: one dual-source draw where the device has the
  feature, else a multiply draw then an add draw.

`oitDebug` (`0`, `0` to `3`; `2` for separate translucency) writes over the image the method, samples
kept and, at pixel `oitDebugCursorX`, `oitDebugCursorY` (`-1`, none; pixel must be inside the image, off
its first and last row and column), that pixel's count (held to the samples kept), and each fragment's scene depth in centimetres, light, transmittance.

```js
const world = createWorld('viewer', { oitSortedPixels: true }) // crossing glass panes and additive sprites sorted per pixel
world.orderIndependentTranslucency = { oitMaxSampleCount: 9 } // nine fragments a pixel, for deeper stacks of layers
world.orderIndependentTranslucency = { oitMethod: 0, oitMaxSampleCount: 16 } // sixteen fragments, the debug text naming the k-buffer
world.orderIndependentTranslucency = { oitSortedPixelsEnable: false } // blended in drawing order again, without rebuilding the programs
world.orderIndependentTranslucency = { oitDebug: 2, oitDebugCursorX: 640, oitDebugCursorY: 360 } // the samples of the pixel at (640, 360)
world.orderIndependentTranslucency = { oitMaxSampleCount: null } // back to the default, 4
```
