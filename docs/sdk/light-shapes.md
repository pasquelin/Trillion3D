# Light shapes
`world.lightShape` holds the settings of the light shapes' visualization, each an option of `createWorld` too. `visualizeLightShape` (`false`, the default) draws every point, spot and rectangle light the view draws as a wireframe of its reach over the lit image once the scene is on it: the sphere of its range for a point light, the cone of a spot light up to its range, the box of a rectangle light between its barn doors and the sphere of its range (a rectangle light has no barn doors of its own here: its doors open to 88 degrees and are 20 centimetres long). Each light is drawn in a hue of its own, from the farthest light to the nearest, with an opacity of `visualizeLightShapeMaxOpacity` (`0.1`, from `0` to `1`) that falls to nothing where the surface behind the shape comes within a metre of it. Switching the setting fades the shapes in or out over `visualizeLightShapeFadeDuration` seconds (`0.5`, at least `0`): they fade in later the nearer they are to the eye, up to `visualizeLightShapeMaxDelay` seconds (`2.5`, at least `0`) for a shape at the eye, within `visualizeLightShapeMaxDelayDistance` centimetres of it (`4000`, at least `100`), so that the far ones appear first, and they fade out together. A fade of `0` seconds is instant.

```js
const world = createWorld('viewer', { visualizeLightShape: true }) // the shapes fade in as the scene opens
world.lightShape = { visualizeLightShape: false } // they fade out together over half a second
world.lightShape = { visualizeLightShape: true, visualizeLightShapeMaxOpacity: 0.3 } // fainter than they can be, fuller than the default
world.lightShape = { visualizeLightShapeFadeDuration: 2, visualizeLightShapeMaxDelay: 4 } // a slower switch, the far shapes four seconds ahead
world.lightShape = { visualizeLightShapeMaxDelayDistance: null } // back to the default, 4000 centimetres
```
