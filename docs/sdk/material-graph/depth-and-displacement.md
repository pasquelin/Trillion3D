# Pixel depth offset and displacement

## Pixel depth offset

`g.output('pixelDepthOffset', offset)` pushes each pixel of the surface away from the camera, by
`offset` in metres along the camera vector, in the depth the visibility raster writes: the offset
times the cosine of the pixel's ray with the view axis is added to the view depth, and a pixel is
never brought nearer (a negative offset leaves it). It is how a decal-like layer sinks into a wall,
or a plane of foliage is given thickness. The software raster's pixels and the hardware raster's
fragments of the rows that wire it evaluate it, in the context a cutout has: its first texture
coordinate set, its footprint and the clocks. A graph that reads a world position, the camera, a
normal, a vertex colour or two texture sets there, or names another set than the `opacityMask`'s or
the `worldPositionOffset`'s, is refused (named once, `material-graph-refused`) and the surface is
written at the depth of its triangles. The shadow maps and the tessellated surfaces write the depth
of their triangles whatever the output says, as the reference does. A translucent surface is drawn
at the depth of its triangles whatever the output says; the output moves it only in the mark the
layer leaves in the temporal pass's responsiveness (see "Thin translucent").

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

`g.output('displacement', height)` gives the normalized height, from 0 to 1, the tessellation
pushes the points of the surface by along their normals, where a displaced glTF material reads its
height map: a point moves by `(height - displacementCenter) * displacementMagnitude` metres, faded
with distance. The material names the numbers, as the reference's material does:

- **`displacementMagnitude`** (metres, `4`);
- **`displacementCenter`** (`0.5`, the height that stays on the surface);
- **`displacementFadeStart`** and **`displacementFadeEnd`**: the on-screen size in pixels of the
  largest displacement at which it starts to fade and is gone, the first the larger; both left out,
  it never fades.

The output is read at the context of a cutout, one texture coordinate set (the texture coordinate
density of the surface being measured for the glTF materials of a prepared scene, one unit of the
set is a metre here), by the dicing of the image and of the shadow maps alike, so the shadow is that
of the displaced surface. It follows the project's `tessellation` settings. A graph that reads more
than that is refused as the pixel depth offset is, and the surface is drawn flat. The reference's
`TessellationMultiplier` output is deprecated there and read by no shader, and is not an output
here.

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
