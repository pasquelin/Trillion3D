# Ambient cubemap, reflection captures and planar reflections

## Ambient cubemap

`ambientCubemap` is a light from a cube of the page's, off until the world is given one: a world
option, `{ size, texels }`, the side of a face in texels (a power of two from 16 to 1024) and the six
faces' linear colours (`6 · size² · 3` numbers, none negative; a cube of another form is refused by
name at the opening).

It is a second source of the indirect light, beside the environment's and the sky light's:

- a surface's diffuse colour is lit by the cube read along its normal at the mip where the cube is
  convolved by the whole hemisphere;
- its specular reflectance is lit by the cube read along its reflection at the mip its roughness
  picks, weighed by the same energy terms as the other sources, so the coat, the cloth's fuzz and a
  thin surface's back take it as they take the others'.

Its settings are `ambientCubemapTintRed`, `ambientCubemapTintGreen` and `ambientCubemapTintBlue`
(`1` each, from 0), the tint, and `ambientCubemapIntensity` (`1`, from 0), the scale that multiplies
it. A colour that is black draws nothing, and an image that sets no cube, or a black one, compiles no
code for it and binds no texture.

The cube's mip chain is filtered by angle on the GPU, once for a cube, over the images a budget of
texels an image allows (a cube of 16 texels a face in one image, a cube of 1024 in some tens); the
images drawn meanwhile are drawn again and light nothing from the cube. The cube can be changed or
taken away while the world runs: `explorer.setAmbientCubemapCube(cube)` replaces it (its chain is
filtered again, the old one freed), `explorer.setAmbientCubemapCube(null)` takes the light away, and a
cube of another form is refused by name. The translucent surfaces take no light from it. An agent sets
the settings through `trillion3d_set_ambient_cubemap`.

```js
const world = createWorld({
  canvas,
  ambientCubemap: { size: 16, texels: new Float32Array(6 * 16 * 16 * 3).fill(0.4) }, // a grey cube
  ambientCubemapIntensity: 2, // twice its light
})
world.ambientCubemap = { ambientCubemapTintBlue: 1.5 } // bluer, from the next frame
world.ambientCubemap = { ambientCubemapIntensity: 0 } // off: no code, no texture
explorer.setAmbientCubemapCube({ size: 16, texels: new Float32Array(6 * 16 * 16 * 3).fill(0.1) }) // another cube, filtered from the next images
explorer.setAmbientCubemapCube(null) // no cube: the light goes, the texture is freed
```

## Reflection captures

`reflectionCapture` holds the settings of the scene's reflection captures. A capture is an object of
the scene (`explorer.addReflectionCapture`): a place the scene is drawn from through the six faces of
a cube, which the surfaces around it read as the light that comes from far away.

Its fields:

- `id` (unique);
- `shape` (`'sphere'`, the default, or `'box'`);
- `matrix` (sixteen numbers, column-major, metres: the translation is the centre, and for a box the
  lengths of the columns are its half extents and their directions its axes);
- `influenceRadius` (a sphere's radius, `30` m by default, at least `0.08`);
- `boxTransitionDistance` (`1` m by default: how far inside its faces a box's cube fades out);
- `brightness` (`1`, from 0: the factor its light is multiplied by);
- `captureOffset` (`[0, 0, 0]`: where the scene is drawn from, relative to the centre).

Inside its shape the cube is read as if the scene it holds were the shape itself (the reflection ray
is intersected with the sphere or the box, so a reflection moves with the viewer), faded toward the
shape's edge; where captures overlap the smallest is read first and lets through what it does not
cover, the sky light taking the rest. They light the rough reflection of the opaque surfaces (the
share of a lobe that neither the screen nor the scene's rays answer), composited over the sky
light's. Where the reflection ray of the scene is answered, the capture adds nothing. A capture is
drawn between two images, one at a time, and again when its place moves or one of the face settings
changes; `explorer.recaptureReflectionCaptures()` asks them all again.

The settings, all run-time:

- `reflectionCaptures` (`true`; off, none is made or read);
- `reflectionCaptureResolution` (`128`, from 16 to 1024, the power of two at or below it);
- `reflectionCaptureSupersample` (`1`, from 1 to 8);
- `reflectionCaptureNearPlane` (`0.05` m);
- `reflectionCaptureLightFunctions` (`false`);
- `reflectionCaptureDiffuse` (`false`): the cube's four smallest mips (1, 2, 4 and 8 texels) hold the
  capture's diffuse light and the opaque surfaces take their diffuse light from the captures where
  they reach, in place of the sky light's;
- `reflectionCaptureDiffuseReference` (`true`): that diffuse light is the exhaustive convolution of
  the cube; `false`, it is evaluated from nine harmonics summed from the cube.

The diffuse light is the mean radiance weighted by the cosine in both ways. The captures hold the sky
past the sky light's distance threshold, where a sky light that is not static shines. The translucent
surfaces and the strands take no light from the captures. An agent sets the settings through
`trillion3d_set_reflection_capture`.

```js
explorer.addReflectionCapture({ id: 'hall', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 1.5, -2, 1], influenceRadius: 12 }) // a sphere
explorer.addReflectionCapture({ id: 'room', shape: 'box', matrix: [5, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 3, 0, 1], boxTransitionDistance: 2, brightness: 1.5 }) // 10 x 6 x 8 m
explorer.setReflectionCaptureObject('hall', { brightness: 0.8 }) // the records change, no new capture
explorer.setReflectionCapture('reflectionCaptureResolution', 256) // every cube is made again
world.reflectionCapture = { reflectionCaptureDiffuse: true } // the diffuse light of the captures, from the next images
explorer.removeReflectionCapture('hall')
```

## Planar reflections

A planar reflection is an object of the scene too (`explorer.addPlanarReflection`): a mirror the scene
is drawn in again. The scene is drawn from the main camera reflected across the plane, in a view of
its own beside the main one, at a percentage of the main view's size and without temporal jitter,
clipped to the viewer's side of the plane. The opaque surfaces that stand near the plane and face it
read that image as their reflection, sharp and exact for a flat floor, water or window, in place of
the screen's and the environment's. The image is blurred along its vertical by a gaussian that grows
with the distance of the reflected surface behind the plane (`prefilterRoughness`), and fades out with
the surface's distance to the plane, its distance to the box's edges, the angle of its normal to the
plane's and its roughness (rougher than 0.2 reads none, fully rough than 0.3).

Its fields:

- `id` (unique);
- `matrix` (sixteen numbers, column-major, metres: the translation is a point of the plane, the
  second column its normal, the lengths of the first and third columns the factors of the 20 metres
  the box reaches along them);
- `normalDistortionStrength` (`5` m): how far along the mirrored reflection direction the image is
  read, so the larger it is the more the surface's normal distorts the image;
- `prefilterRoughness` (`0.01`, from 0 to 0.04), `prefilterRoughnessDistance` (`100` m);
- `screenPercentage` (`50`, from 25 to 100);
- `extraFov` (`0` degrees, from 0): the image is drawn with a wider field so the distortion does not
  read outside it;
- `distanceFromPlaneFadeoutStart` and `distanceFromPlaneFadeoutEnd` (`0.6` and `1` m);
- `angleFromPlaneFadeStart` and `angleFromPlaneFadeEnd` (`20` and `30` degrees);
- `hidden`: the objects the mirrored view does not draw, each with everything under it (the water
  plane itself, usually).

The mirrored view is drawn only while the viewer stands on the side the normal points to and the box
meets the view's frustum, and only for a perspective camera. The cut is clipped to the plane only
where the world was made with the project switch `cutClipPlane` on
(`createWorld({ cutClipPlane: true })`); without it the image shows what lies under the plane too.
The reflections are read by the opaque surfaces of the main view alone (not by the translucent
surfaces, the strands, the water's own reflection or the views `world.addView` draws), and they win
over the screen's, the scene's and the environment's reflection where their fade is whole. The
mirrored view is lit by the lights and the sky light, with no traced reflection, light shaft or effect
of its own. The image is drawn before the main view, from the same camera.

```js
// the world is made with createWorld({ cutClipPlane: true }), so the image is clipped to the plane
explorer.addPlanarReflection({
  id: 'lake',
  matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 12.4, 0, 1], // the plane y = 12.4, facing up
  prefilterRoughness: 0.02, // blur the image more
  screenPercentage: 75,
  hidden: [lakeSurface], // the mesh of the water, which would hide its own reflection
})
explorer.setPlanarReflection('lake', { normalDistortionStrength: 2 }) // a gentler distortion
explorer.removePlanarReflection('lake')
```
