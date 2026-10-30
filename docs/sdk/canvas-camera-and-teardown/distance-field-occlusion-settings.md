# Distance field occlusion settings

`world.distanceFieldOcclusion` holds the settings of the sky light's occlusion by the distance
fields, also a `createWorld` option: how much of the sky each pixel sees, from cones traced against
the global field and the meshes' own fields
([ENGINE.md](../../engine/distance-fields.md#distance-fields)). It is drawn when the sky light is movable
and casts shadows, the bounce is off (with it on, its probes carry the sky and the screen probes its
visibility) and a mesh built a distance field.

The sky light then lights each pixel along the way its sky is most open and by the share of it the
pixel sees: the sky's diffuse light is read along a normal turned toward that direction and scaled by
the visibility, and the sky's reflection off a rough surface is occluded by the cone the sky leaves
open (`distanceFieldOcclusionSpecularMode`: 0 by the share of sky seen, 1 by the intersection of the
reflection's cone with the open one, `skyLightSpecularOcclusionStrength` its strength). The light's
own settings shape it: `occlusionMaxDistance`, `contrast`, `occlusionExponent`, `minOcclusion`,
`occlusionTint` and `occlusionCombineMode`.

The settings, each with its default; lengths are in centimetres:

- `distanceFieldOcclusion` (`true`)
- `distanceFieldOcclusionQuality` (`2`: 0 off, 1 the global field alone, 2 the meshes' fields too)
- `distanceFieldOcclusionObjects` (`true`)
- `distanceFieldOcclusionStepExponentScale` (`0.5`)
- `distanceFieldOcclusionMaxViewDistance` (`20000`, held to 65000)
- `distanceFieldOcclusionViewFadeDistanceScale` (`0.7`)
- `distanceFieldOcclusionSampleSet` (`1`)
- `distanceFieldOcclusionJitterConeDirections` (`false`), `distanceFieldOcclusionUseJitter` (`true`)
- `distanceFieldOcclusionTraverseMips` (`true`)
- `distanceFieldOcclusionUseHistory` (`true`), `distanceFieldOcclusionHistoryStabilityPass` (`true`),
  `distanceFieldOcclusionHistoryWeight` (`0.85`), `distanceFieldOcclusionHistoryDistanceThreshold`
  (`30`)
- `distanceFieldOcclusionSpecularMode` (`1`)
- `skyLightSpecularOcclusionStrength` (`1`, at least 0.1 where it is used)
- `distanceFieldOcclusionObjectsPerCullTile` (`512`)

A write names the settings it changes, `null` one's default; a value of another kind is refused by
name. A scene whose meshes built no distance field is not touched.

```js
const world = createWorld('viewer', { distanceFieldOcclusionQuality: 1 }) // the global field alone
world.distanceFieldOcclusion = { distanceFieldOcclusionMaxViewDistance: 40000 } // light pixels up to 400 m
world.distanceFieldOcclusion = { distanceFieldOcclusionUseHistory: false } // no temporal filter
world.distanceFieldOcclusion = { distanceFieldOcclusionQuality: null } // back to the default, 2
```
