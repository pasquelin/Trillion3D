# A light that is left out at a distance

In a perspective view a point, a spot or a rectangle light is left out of the image, its lighting and its shadow both, when it spans too
little of the screen, or lies past its own distance. Its bounding sphere has a radius `W` (metres) and lies at the distance `d` from the
view: the light is drawn while `min(0.02, lightMinScreenRadius / W) * factor * d < 1` (so a light of 1.5 m or less, or of no
size, is dropped past 50 m, a larger one past `W / 0.03`), and, when its `maxDrawDistance` (`0`, no limit, in metres) is above 0,
while `d < maxDrawDistance * lightMaxDrawDistanceScale` (a scale of 0 drops every light that names a distance). `factor` is the
view's horizontal field of view in degrees over 90 (a zoomed view keeps its lights farther away), or 1 where
`lightDrawRangeFollowsFieldOfView` is `false`. The three view settings are `lightMinScreenRadius` (`0.03`),
`lightMaxDrawDistanceScale` (`1`) and `lightDrawRangeFollowsFieldOfView` (`true`), written with the view's shadow settings (`world.shadows`, each frame). A directional light and an
orthographic view always draw. A directional light refuses `maxDrawDistance` (`INVALID_SCENE_LIGHT`). The value is saved with the world.

```js
const lamp = light.point({ intensity: 20, distance: 8, maxDrawDistance: 120 }) // gone past 120 m
lamp.maxDrawDistance = 0 // no limit again, the next frame
world.shadows = { lightMinScreenRadius: 0.06 } // small lights are dropped twice as near
```
