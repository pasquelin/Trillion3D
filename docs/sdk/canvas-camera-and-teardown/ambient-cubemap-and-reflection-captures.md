# Ambient cubemap, reflection captures and planar reflections

## Ambient cubemap

`ambientCubemap`: off until the world is given a cube `{ size, texels }`: face side in texels (power
of two, 16 to 1024) and six faces' linear colours (`6 · size² · 3` numbers, none negative; another form
is refused by name at opening).

An indirect light beside the environment's and the sky light's: diffuse reads the cube along the
normal at the hemisphere-convolved mip; specular along the reflection at the mip its roughness picks,
with the same energy terms as the other sources (coat, cloth fuzz, thin back included).

Settings: `ambientCubemapTintRed`, `ambientCubemapTintGreen`, `ambientCubemapTintBlue` (`1` each, from
0), `ambientCubemapIntensity` (`1`, from 0). No cube, or a black one, compiles no code and binds no
texture.

The mip chain is filtered on the GPU once per cube, over the images a texel budget allows; images
drawn meanwhile light nothing from the cube. `explorer.setAmbientCubemapCube(cube)` replaces it at run
time, `explorer.setAmbientCubemapCube(null)` removes the light. Translucent surfaces take no light
from it. Agent tool: `trillion3d_set_ambient_cubemap`.

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

`reflectionCapture` holds the capture settings. A capture is a scene object
(`explorer.addReflectionCapture`): a place the scene is drawn from through six cube faces, read by
surrounding surfaces as far light.

Fields:

- `id` (unique);
- `shape` (`'sphere'` default, or `'box'`);
- `matrix` (sixteen numbers, column-major, metres: translation is the centre; a box's column lengths
  are its half extents, their directions its axes);
- `influenceRadius` (sphere radius, `30` m default, at least `0.08`);
- `boxTransitionDistance` (`1` m: how far inside its faces a box's cube fades out);
- `brightness` (`1`, from 0);
- `captureOffset` (`[0, 0, 0]`: where the scene is drawn from, relative to the centre).

Inside its shape the cube is read by intersecting the reflection ray with the sphere or box, faded
toward the edge; where captures overlap the smallest is read first, the sky light takes the rest. They
light the rough reflection of opaque surfaces (the lobe share neither the screen nor the scene's rays
answer), over the sky light's; where the scene's reflection ray is answered, the capture adds nothing.
A capture is drawn between two images, one at a time, and again when its place moves or a face
setting changes; `explorer.recaptureReflectionCaptures()` redraws all.

Settings, all run-time:

- `reflectionCaptures` (`true`; off, none is made or read);
- `reflectionCaptureResolution` (`128`, 16 to 1024, the power of two at or below);
- `reflectionCaptureSupersample` (`1`, 1 to 8);
- `reflectionCaptureNearPlane` (`0.05` m);
- `reflectionCaptureLightFunctions` (`false`);
- `reflectionCaptureDiffuse` (`false`): the cube's four smallest mips (1, 2, 4, 8 texels) hold diffuse
  light, which opaque surfaces take from the captures where they reach, in place of the sky light's;
- `reflectionCaptureDiffuseReference` (`true`): exhaustive cube convolution; `false`: nine harmonics.

Captures hold the sky past the sky light's distance threshold, where a non-static sky light shines.
Translucent surfaces and strands take no light from captures. Agent tool:
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

A scene object (`explorer.addPlanarReflection`): the scene drawn again from the main camera reflected
across the plane, in a view of its own at a percentage of the main size, no temporal jitter, clipped
to the viewer's side. Opaque surfaces near the plane and facing it read it as reflection instead of
the screen's and environment's. The image is blurred vertically by a gaussian growing with the
reflected surface's distance behind the plane (`prefilterRoughness`), and fades with distance to the
plane, distance to the box's edges, angle of the normal to the plane's, and roughness (rougher than
0.2 reads none, fully rough at 0.3).

Fields:

- `id` (unique);
- `matrix` (sixteen numbers, column-major, metres: translation is a point of the plane, second column
  its normal, first and third column lengths the factors of the 20 m the box reaches along them);
- `normalDistortionStrength` (`5` m): how far along the mirrored reflection direction the image is
  read; larger distorts more;
- `prefilterRoughness` (`0.01`, 0 to 0.04), `prefilterRoughnessDistance` (`100` m);
- `screenPercentage` (`50`, 25 to 100);
- `extraFov` (`0` degrees, from 0): wider field for the image;
- `distanceFromPlaneFadeoutStart` and `distanceFromPlaneFadeoutEnd` (`0.6` and `1` m);
- `angleFromPlaneFadeStart` and `angleFromPlaneFadeEnd` (`20` and `30` degrees);
- `hidden`: objects the mirrored view does not draw, each with everything under it.

Drawn only while the viewer is on the side the normal points to, the box meets the frustum, and the
camera is perspective. Clipped to the plane only when the world has `cutClipPlane` on
(`createWorld({ cutClipPlane: true })`); otherwise the image shows what lies under the plane too. Read
by the main view's opaque surfaces alone (not translucent surfaces, strands, water's own reflection or
`world.addView` views); wins over screen, scene and environment reflection where its fade is whole.
Lit by lights and sky light, no traced reflection, light shaft or effect. Drawn before the main view.

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
