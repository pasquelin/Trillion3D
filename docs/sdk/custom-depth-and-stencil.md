# Custom depth and stencil

A second depth of the view, and a stencil beside it, that holds **only the objects that ask for
it**, whatever stands in front of them: what an outline or a post-process reads against the scene's
depth. An object asks with three properties, each saved with the world when it is not at its
default:

- **`renderCustomDepth`** (boolean, `false`): the object is drawn into the custom depth.
- **`customDepthStencilValue`** (whole number from 0 to 255, `0`): the value its pixels write into
  the custom stencil.
- **`customDepthStencilWriteMask`** (`'default'`): how it writes it. `'default'` writes the whole
  value; `255`, or one bit (`1`, `2`, `4`, `8`, `16`, `32`, `64`, `128`), writes the value under
  that mask. In both the pixel holds the stencil of the surface in front there among the objects
  that ask: the bits are not merged over a surface behind, and the mask does not ignore the depth
  (the reference's non-Nanite path does, `CustomDepthRendering.cpp:539-548`; its Nanite emission has
  the same limit as ours, `NaniteExportGBuffer.usf:33-44`).

The view's settings (`world.customDepth`, `world.setCustomDepth(field, value)`) are the reference's:

| Setting | Default | Meaning |
| --- | --- | --- |
| `customDepth` | `1` | `0` off; `1` on, the targets made when an object asks and given back after; `2` on, the targets kept once made; `3` as `2` with the stencil written too |
| `customDepthOrder` | `2` | `0` before the opaque surfaces, `1` after them, `2` before them only where the view reads decals, else after; no effect here: the custom depth is a view of its own, drawn before the main view's |
| `customDepthTemporalAAJitter` | `true` | the custom depth is drawn with the jitter the main view's image takes (the same sample of the same phases), so its edges meet the image's; `false` draws it steady |
| `customDepthEnableFastClear` | `false` | lets the device clear the depth target by its fast path; no effect in WebGPU, which exposes none |

```js
// An outline target: the statue is drawn into the custom depth and stencil with the value 7, written to the third bit only.
world.customDepth = { customDepth: 3 }
statue.renderCustomDepth = true
statue.customDepthStencilValue = 7
statue.customDepthStencilWriteMask = 4
```

Where no object asks, nothing is made, drawn or kept, and the image is the one it would be without
the feature. While one does, the main view's image is drawn again before the main view, by a view of
its own that sees only the objects that ask (the roots of the others are left out of its cut): its
visibility buffer is emitted into the custom depth target (the view's depth, `depth32float`, cleared
to 0, the far) and, in the mode `3`, the custom stencil target (two 16-bit channels, the value in
the second).
