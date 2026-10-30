# Resolution of the translucent layers

`world.separateTranslucency` holds the resolution settings of the translucent layers (blends,
transmissive layers, particles), each also a `createWorld` option. They are drawn into their own
targets and composed onto the lit image; default: the image's size, over the scene's depth.

- `translucencyScreenPercentage` (`100`, `0` to `100`): share of the image's size (a side is a
  whole number, one at least); depth is taken at that size (first texel of each square); the
  composition scales up.
- `translucencyScreenPercentageBasis` (`0`): `0` render size; `1` display size (share divided by
  the render scale).
- `translucencyUpsampleMode` (`1`), when the share is `50` and the image's sides are even: `1` takes
  of the four texels around a pixel the one with depth nearest the scene's (bilinear when the four
  are within a tenth of it); `0` bilinear. Any other share composes bilinear.

The share applies to every pass of the layers. Depth of field composes them in its recombine pass,
scaling up by the nearest depth neighbour whatever the mode and share. The temporal pass reads
smaller layers bilinear. Layers drawn after the motion blur are laid by it, bilinear; without a
motion blur they compose by the nearest depth neighbour (distances along the view axis). Share 100
on the render basis, or on the display basis with render size equal to display's, runs no
smaller-layer pass. An image with display layers (`blending: 'multiply'` or
`'subtractive'`) or an alpha channel (`propagateAlpha`) draws layers at its size whatever the share.
Not ported: reference `r.Translucency.DynamicRes.*`.

```js
const world = createWorld('viewer', { translucencyScreenPercentage: 50 }) // layers at half the image's size, nearest-depth upsample
world.separateTranslucency = { translucencyUpsampleMode: 0 } // bilinear upsample
world.separateTranslucency = { translucencyScreenPercentage: 75 } // three quarters of the size, bilinear
world.separateTranslucency = { translucencyScreenPercentage: 100, translucencyScreenPercentageBasis: 1 } // the display's size when the render scale is below 1
world.separateTranslucency = { translucencyScreenPercentage: null } // back to the default, 100
```
