# Sky light, capture and sky meshes

**Sky light.** The `skyLight` part (a light that affects the world) gives the scene the sky it captures
into a cube (`modules/sky/skyLight`): the cube, filtered by roughness, and nine harmonics summed from
it (the real-time capture's from the filtered cube; a captured scene's and a specified cubemap's from
the captured cube's mips, before the filter), on the GPU, never read back. Every reader reads that one
cube through the light's read (`modules/sky/skyLight/read.ts`), at the light's colour times its
intensity, black in a view whose `skyLighting` override is off.
- Diffuse: a surface's diffuse light is the harmonics along its normal (`skyLightDiffuse`). Where the
  bounce probes answer they carry the sky, occluded by the scene
  ([Light that bounces](../light-that-bounces.md#light-that-bounces)); the share they leave is the sky
  light's own diffuse light, the sky nothing hides. The volumetric fog scatters the harmonics' first
  three terms along the way to the eye, times the part's `volumetricScatteringIntensity`.
- Specular: a read takes the cube along the reflection vector at the mip its roughness asks
  (`skyLightReflection`); a bounce probe's ray that leaves the scene reads it sharp (`skyLightRay`).
- Lower half: the sky's own, or, where the part's `lowerHemisphereIsSolidColor` is on (off by
  default), the part's `lowerHemisphereColor` (black by default), laid into the cube at the capture by
  `lowerHemisphereCoverage` (1 by default: the colour whole; less lets the sky and clouds below the
  horizon show through). Without an atmosphere the cube is black (clouds aside).
- Specified cubemap: the part's own `cubemap` (six faces of linear texels as data, `SkyLightCubemap`,
  the form of the fog's cubemap); the engine makes the texture and keeps it while the data is the same
  (`followSkyCubemaps`). It is half floats, the whole cube written times the scale that brings the
  brightest texel of the cube and of the one it blends to down to the half float's largest, 65504,
  where it passes it: one scale for the pair (`cubemapPairFit`), so the mix is of two lights in one
  unit, and the light given the inverse (`skyLightCubemapScales`, `SkyLightInputs.cubemapScale`). No
  texel is clamped, on any device. The faces are written one after the other, over several images, no
  more than about a million channels converted per image, from one buffer; the cube is the light's once
  its six faces are written, `SkyCubemaps.pending` holding the image drawn until then. It blends to a
  second cubemap by a fraction (the part's `cubemapBlend`, `SkyLightInputs.blend`): both are filtered,
  and the light mixes the two cubes and their harmonics.
- The harmonics are seven vectors a cube. A mean brightness of the cube (an eighth vector) is not
  kept: its one reader weighed the reflections of a surface lit by baked light (a lightmap, or the
  volumetric lightmap read at the surface) by it, under a sky light that is not movable, and the
  volumetric lightmap here lights the volumetric fog alone, no surface (`lighting/fog/staticPass.ts`).
- The sky light's `cloudAmbientOcclusion…` fields do not act on the cube, the harmonics or any
  surface's light: they dim the air's multiple scattering (Shade the clouds cast on the air, above).

**The real-time capture.** The light is read from the first frame the cube has been drawn whole in (the
frame draws it in the command buffer that lights the image): until then a surface sees no sky light and
the bounce waits, never a cube made and not drawn into. The capture is made once per frame, from the
main view's air and clouds; a view drawn beside the main one, and the image drawn aside for a capture,
read the light and make none. The faces are written multiplied by the capture's pre-exposure
(`cachedLightingPreExposure`,
[Pre-exposure](../exposure-and-the-display-curve.md#exposure-and-the-display-curve)) and the light's colour
holds its inverse. The capture's sky is held, like the view's, to 32256 per channel once multiplied by
it (half of what a 10-bit float holds, room for what is added after); the clouds and the lower
hemisphere are not held by it. The sky is marched from the light's height over the planet's ground, no
lower than a view's eye is held (5 m). A bright sun disk is not in the capture (it is a light of its
own). The cube's side is the part's `cubemapResolution` (made a power of two), or the quality's
`skyLightResolutionOverride` when that is 16 or more: the override is the real-time capture's alone.

The sky pass. The surfaces of a sky material (the compiler's `sky` property) are drawn by a pass of
their own, `encodeSkyPass` (`frame/render/encodeSkyPass.ts`), into the lit image right after the opaque
surfaces are lit and before the atmosphere, fog and clouds are laid over it, as the base pass's sky
pass comes ahead of them: unlit, at an alpha of one (a cutout keeps its mask), tested against the
opaque depth and writing none. They are in no layer of the translucency: the plan marks them in the
item's filter word (`ITEM_FILTER.sky`) and the expansion keeps them out of every view but their own
(`SKY_VIEW`, `blend/expand/expansionViews.ts`), so the front pass, the hierarchical depth, the shadow
page marking, the screen traces, the cards and the shadows never see them. They take no fog of their
own (`FLAG_FOG_FREE` on their row): the fog composition lays it once, the dome in it.

The sky meshes. Where the scene has a sky material drawn (`sceneHasSkyMaterial`,
`frame/render/skyRoots.ts`: a root whose surface has the compiler's `sky` property, not hidden by its
host, or a sky surface of the plan that no node stands for, an actor of an HLOD cell or of the world
DAG), the faces of the real-time capture show the sky meshes in the atmosphere's place.
- Before the main view, each face is a light draw (`frame/render/encodeSkyMeshes.ts`,
  `encodeSkyMeshFace.ts`): the blend pass's own plan (cut, cull, sort, expansion, runs) called for the
  face's 90 degree camera at the light's place, drawing the sky surfaces alone (the plan's sky view,
  the same runs as the sky pass; the face's cut is `Camera.showOnly` of the sky nodes while each sky
  surface has one) into the face's colour and depth targets in one pass, with no lighting, shadow, fog,
  sky, cloud or effect (`ViewOverrides.skyMeshCapture`); the face's view only holds its cut and
  targets. A sky surface is opaque, its cutout alone reading the base alpha.
- With `skyLightDepthBuffer` (on) the pass writes the meshes' depth (`BlendModePipelines.skyFace`):
  they cover each other by distance, the depth is copied beside the image into the meshes' cube
  (`modules/sky/skyLight/skyMeshes.ts`, `skyMeshDepthMain`), and the height fog is laid over each pixel
  at the distance of the mesh drawn there (`fogFaceProgram`'s `depth`, `fogBeyondAlong`), an endless ray
  only where no mesh is. Off, the meshes are painted in their sort order and the fog is laid along an
  endless ray. The fog is laid once, by the capture, never by the faces' own surfaces (`FLAG_FOG_FREE`
  on the sky surfaces' rows).
- The image is copied into the face multiplied by the pre-exposure (`skyMeshMain`), the clouds going
  over it as over the atmosphere. The quality settings slice it as they slice the capture
  (`skyLightTimeSlicing`, `skyLightFacesPerFrame`); the first images draw all six faces, and the
  atmosphere shows until the cube is whole. A face that draws nothing for `600` images in a row is
  given up (`sky-meshes-failed`, said once) and the frame holds again; the faces are tried again when
  the plan's sky surfaces change.
- The same fact orders the fog drawn in textures of its own (above): with a sky material the sky and
  haze are drawn before the fog's textures; without one the textures come first and the sky is drawn
  over the image whole.

