# A sun's shadow distance and its far casters

A directional light's shadows follow the eye. A sun has a **shadow distance**: `shadowDistance`, in
metres, `400` by default, `true` the same, `false` or `0` none; scaled by the view
(`shadowDistanceScale`). It lays the sun's shadow levels and the **edge** where its distance-field
cascade begins; it does not leave a caster out of the shadow maps (every caster is cluster geometry
and the maps take it at any distance). No distance-field shadow replaces it on the view.

`farShadowCulling` decides whether the sun has a near edge and the distance-field cascade after it.
Difference from the reference (UE 5.8): no switch for its far-shadow test, none per object.

The edge lies a little past the distance: the far end of the sun's last near level, plus that
level's overlap into the next when another follows. Levels are the sun's own settings:

| Light option | Default | Meaning |
| - | - | - |
| `shadowCascades` | `4` | near levels the distance is cut into (at most the view's `shadowNearLevels`) |
| `shadowCascadeExponent` | `3` | times the span of the previous level each takes |
| `shadowCascadeTransition` | `0.1` | share of its span a level overlaps into the next |
| `farShadowCascades` | `0` | far levels between the distance and `farShadowDistance`, while that is over a metre farther: counted, never drawn; a light with some ends its near levels with the overlap |
| `farShadowDistance` | `3000` m | where those levels end |
| `distanceFieldShadows` | `true` | whether the distance-field cascade follows the near levels |
| `distanceFieldShadowDistance` | `512` m | where that cascade ends (`true` default, `false` none) |
| `distanceFieldShadowTraceDistance` | `100` m | how far a ray of that cascade goes toward the light |
| `distanceFieldShadowRayStartOffsetDepthScale` | `0.003` | share of a pixel's depth its ray starts off the surface by, over a fixed 2 cm |

Defaults give an edge of 427.0 m (400 m, near plane 0.05 m): the last level starts at 130.03 m and
overlaps 27 m into the cascade after it; the distance itself from 512 m on.

```js
const sun = light.directional({ castShadow: true, shadowDistance: 600, shadowCascades: 3 })
sun.shadowDistance = 250 // metres, from the next frame; the light is made again, its cached pages drawn again
sun.distanceFieldShadowDistance = false // no distance-field cascade after the near levels
sun.distanceFieldShadowTraceDistance = 50 // metres: a mesh farther than that along the ray casts no shadow
sun.distanceFieldShadowRayStartOffsetDepthScale = 0.005 // raise it where far surfaces shadow themselves
```

View settings, each also a `createWorld` option, resolved over the quality preset:

| View option | Default | Meaning |
| - | - | - |
| `shadowDistanceScale` | `1` (0 to 2) | factor on every sun's distance (`0.5` halves it); `0` leaves nothing to cull |
| `farShadowCulling` | `true` | whether a sun has a near edge and the distance-field cascade after it |
| `shadowNearLevels` | `10` (0 to 10) | most near levels; `0` leaves no edge: nothing is culled |
| `shadowOverlapScale` | `1` (0 to 2) | factor on the overlap |
| `shadowFarField` | `true` | whether the distance-field cascade follows the near levels, where the scene has distance fields |
| `shadowMaxFarCascades` | `10` | most far levels a light may count (`farShadowCascades`) |
| `shadowFarDistanceOverride` | `0` | metres, where far levels end for every light when above 0; no visible effect |
| `distanceFieldDistanceScale` | `1` (0.0001 to 10000) | factor on every light's distance-field distance |

A distance-field cascade also needs the sun's `distanceFieldShadows` and meshes with distance fields
(mesh build's `distanceField`, on by default). Without fields the edge is the distance (400 m).

```js
const world = createWorld('viewer', { shadowDistanceScale: 0.85, distanceFieldDistanceScale: 2 })
world.shadows = { farShadowCulling: false } // no near edge, no distance-field cascade, from the next frame
world.shadows = { farShadowCulling: null } // back to the default
```

The gate every light's shadow passes is the view setting `shadowQuality` (`5`, whole number 0 to 5).
At `0` no light takes a shadow, the sun's included: no shadow map, page, trace or page pool (an
existing pool is freed with its cache), and lit passes drop their shadow code. At `1` to `5` every
light takes the same shadow (levels above 0 differ in nothing today). A declared `castsShadow` is
kept; a scene turned back above 0 redraws its shadows from a fresh cache. The setting does not reach
the indirect light's occlusion of a light (bounce probes still trace toward each shadow-casting
light) nor the clouds' shadow on the sun.

```js
const world = createWorld('viewer', { shadowQuality: 0 }) // no light takes a shadow
world.shadows = { shadowQuality: 3 } // from the next frame: every light does
world.shadows = { shadowQuality: null } // back to the default, 5
world.quality.preset = 'smooth' // the first level: no shadow at all, unless the page set one
```
