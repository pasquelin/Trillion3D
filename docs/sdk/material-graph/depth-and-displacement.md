# Pixel depth offset and displacement

## Pixel depth offset

`g.output('pixelDepthOffset', offset)` pushes each pixel away from the camera by `offset` metres
along the camera vector, in the visibility raster's depth; a negative offset leaves the pixel.
Evaluated in a cutout's context (first texture coordinate set, footprint, clocks). A graph reading
a world position, the camera, a normal, a vertex colour or two texture sets there, or naming
another set than the `opacityMask`'s or `worldPositionOffset`'s, is refused
(`material-graph-refused`); the surface keeps its triangles' depth. Shadow maps, tessellated and
translucent surfaces ignore it (translucent: only the temporal responsiveness mark moves).

```js
const g = material.graph('surface')
g.output('baseColor', g.constant(0.5, 0.5, 0.5))
// A bump of 5 cm at the middle of each tile of the texture coordinate, seen as depth.
g.output(
  'pixelDepthOffset',
  g.multiply(g.channel(g.textureSample(heightMap), 'r'), g.constant(0.05)),
)
```

## Displacement

`g.output('displacement', height)` gives the normalized height, 0 to 1; tessellation moves a point
along its normal by `(height - displacementCenter) * displacementMagnitude` metres, faded with
distance. Material numbers:

- **`displacementMagnitude`** (metres, `4`);
- **`displacementCenter`** (`0.5`, the height that stays on the surface);
- **`displacementFadeStart`** and **`displacementFadeEnd`**: on-screen size in pixels of the
  largest displacement at which it starts to fade and is gone, the first the larger; both left
  out, it never fades.

Read in a cutout's context, one texture coordinate set (one unit is a metre); follows the
project's `tessellation` settings. A graph reading more is refused as above (surface drawn flat).
Reference's `TessellationMultiplier` output does not exist here.

```js
const rock = material.graph('surface')
rock.output('baseColor', rock.constant(0.35, 0.33, 0.3))
rock.output('displacement', rock.channel(rock.textureSample(rockHeight), 'r'))
const stone = material.meshStandard({
  graph: rock,
  displacementMagnitude: 0.3,
  displacementCenter: 0.5,
})
```
