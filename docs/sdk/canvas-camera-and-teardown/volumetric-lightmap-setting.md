# Volumetric lightmap setting

`world.volumetricLightmap` holds the setting of the precomputed indirect light a baked scene carries
(a `volumetric-lightmap.bin`, [FORMAT.md](../../format/volumetric-lightmapbin.md#volumetric-lightmapbin)),
also a `createWorld` option:

- `volumetricLightmap` (`true`): the lightmap is read by the fog's static term and by the lighting
  of movable objects; `false`: every read of it answers black, as in a scene without one. It does
  nothing where the scene has no lightmap.
- `volumetricLightmapLoadingRange` (64): the metres around the view within which the cells of the
  finest bricks are loaded.
- `volumetricLightmapBrickMemory` (30): the megabytes of finest bricks that stay resident, the cells
  nearest the view winning them.

Then the view of the samples:

- `volumetricLightmapVisualize` (`false`): a sphere is drawn at every sample of the lightmap as an
  unlit surface right after the opaque resolve, so the lighting, the velocity and the fog treat it
  as such. It is lit by the harmonics stored there on a grey of 0.18 (the brightness of the lighting
  view in the `lighting` diagnostic), tested against the scene depth.
- `volumetricLightmapVisualizeRadiusScale` (`0.01`): the sphere's radius as a fraction of the world
  size of its brick.
- `volumetricLightmapVisualizeMinScreenFraction` (`0.001`): the least share of the screen a sphere
  takes, measured with the projection's horizontal scale, i.e. the width, so a far one does not
  alias.

The fog's static term is scaled by the `heightFog` part's
`volumetric.staticLightingScatteringIntensity` (`1`, never below `0`; `0` leaves the term out). The
fog's sky light follows the sky light part's `mobility`:

- `'static'`: the fog is lit by none of the sky light's own harmonics (its light is the lightmap's);
- `'stationary'` that casts shadows: scatters multiplied by the lightmap's sky visibility (a
  lightmap baked with a sky light; the compiler does not bake one yet);
- `'movable'`: scatters by the global distance field's.

A write names the setting it changes, `null` its default; a value of another kind is refused by
name.

```js
const world = createWorld('viewer', { volumetricLightmap: false }) // the precomputed light off
// finest bricks streamed within 100 m of the view, 60 MB of them resident at most
world.volumetricLightmap = {
  volumetricLightmapLoadingRange: 100,
  volumetricLightmapBrickMemory: 60,
}
world.volumetricLightmap = { volumetricLightmap: null } // back to the default, on
world.volumetricLightmap = { volumetricLightmapVisualize: true, volumetricLightmapVisualizeRadiusScale: 0.02 } // the samples as spheres
```
