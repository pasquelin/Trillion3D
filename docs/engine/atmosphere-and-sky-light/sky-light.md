# Sky light, capture and sky meshes

**Sky light.** The `skyLight` part captures the sky into a cube (`modules/sky/skyLight`): cube
filtered by roughness plus nine harmonics (real-time capture: from the filtered cube; captured scene
and specified cubemap: from the captured cube's mips, before the filter), on GPU. Readers use
`modules/sky/skyLight/read.ts`, at light colour × intensity, black in a view whose `skyLighting`
override is off.

- Diffuse: harmonics along the surface normal (`skyLightDiffuse`). Where bounce probes answer, they
  carry the sky ([Light that bounces](../light-that-bounces.md#light-that-bounces)); their leftover
  share is the sky light's own. Volumetric fog scatters the harmonics' first three terms ×
  `volumetricScatteringIntensity`.
- Specular: cube along the reflection vector at the roughness mip (`skyLightReflection`); a bounce
  probe ray leaving the scene reads it sharp (`skyLightRay`).
- Lower half: sky's own, or, with `lowerHemisphereIsSolidColor` (default off), `lowerHemisphereColor`
  (default black) laid in at capture by `lowerHemisphereCoverage` (default 1: whole; less lets sky
  and clouds show). No atmosphere: black.
- Specified cubemap: the part's `cubemap` (six faces of linear texels, `SkyLightCubemap`); texture
  kept while data is the same (`followSkyCubemaps`).
  - Half floats; cube written × the scale bringing the brightest texel of it and of its blend target
    down to 65504 where they pass it (one scale for the pair, `cubemapPairFit`); light gets the
    inverse (`skyLightCubemapScales`, `SkyLightInputs.cubemapScale`). No texel clamped.
  - Faces written over several images, at most about a million channels per image; cube is the
    light's once all six are written (`SkyCubemaps.pending`).
  - `cubemapBlend` (`SkyLightInputs.blend`) mixes in a second cubemap.
- Harmonics = seven vectors per cube (no mean-brightness eighth); the volumetric lightmap lights the
  volumetric fog alone, no surface (`lighting/fog/staticPass.ts`). `cloudAmbientOcclusion…` fields only dim the air's multiple
  scattering.

**Real-time capture.** Read from the first frame the cube is drawn whole in; until then no sky light,
bounce waits. One capture per frame, from the main view's air and clouds. Faces written × capture pre-exposure (`cachedLightingPreExposure`,
[Pre-exposure](../exposure-and-the-display-curve.md#exposure-and-the-display-curve)); light colour
holds its inverse. Capture sky is held to 32256 per channel after pre-exposure (not clouds, lower
hemisphere). Sky marched from the light's height (>= 5 m). No sun disk. Cube side = `cubemapResolution` (power of two), or quality's
`skyLightResolutionOverride` when 16 or more (real-time capture only).

Sky pass. Surfaces of a sky material (compiler's `sky` property) are drawn by `encodeSkyPass`
(`frame/render/encodeSkyPass.ts`) into the lit image after opaque lighting, before atmosphere, fog and
clouds: unlit, alpha 1 (cutout keeps its mask), depth-tested against opaque, no depth write. In no
translucency layer: `ITEM_FILTER.sky`; expansion keeps them in their own view only (`SKY_VIEW`,
`blend/expand/expansionViews.ts`): front pass, hierarchical depth, shadow page marking, screen
traces, cards and shadows never see them. `FLAG_FOG_FREE`: fog composition lays fog once.

Sky meshes. Where the scene has a drawn sky material (`sceneHasSkyMaterial`,
`frame/render/skyRoots.ts`: a root with compiler's `sky` property not hidden by its host, or a plan
sky surface no node stands for), real-time capture faces show them in the atmosphere's place.

- Before the main view each face is a light draw (`frame/render/encodeSkyMeshes.ts`,
  `encodeSkyMeshFace.ts`): sky surfaces alone (`Camera.showOnly`), 90 degree camera at the light's
  place, into the face's colour and depth targets in one pass; no lighting, shadow, fog, sky, cloud
  or effect (`ViewOverrides.skyMeshCapture`). Opaque; only cutout reads base alpha.
- `skyLightDepthBuffer` (on): mesh depth written (`BlendModePipelines.skyFace`) and copied into the
  meshes' cube (`modules/sky/skyLight/skyMeshes.ts`, `skyMeshDepthMain`); height fog per pixel at the
  mesh's distance (`fogFaceProgram`'s `depth`, `fogBeyondAlong`), endless ray only where no mesh is.
  Off: sort order, fog along an endless ray.
- Copied into the face × pre-exposure (`skyMeshMain`), clouds over it. Sliced as the capture
  (`skyLightTimeSlicing`, `skyLightFacesPerFrame`); atmosphere until the cube is whole. A face
  drawing nothing for `600` consecutive images is given up (`sky-meshes-failed`, said once); retried
  when plan sky surfaces change.
- With a sky material, sky and haze draw before fog's textures; without, after.
