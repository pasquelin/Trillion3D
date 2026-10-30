# Volumetric lightmap

Precomputed indirect light, baked by the compiler (`lightmapBake`, [COMPILER.md](../compiler/volumetric-lightmap.md#volumetric-lightmap)) and read by position (`lighting/volumetricLightmap/`,
`sdk-core/src/lighting/volumetricLightmapFile.ts`; the file is [FORMAT.md](../format/volumetric-lightmapbin.md#volumetric-lightmapbin)).
`parseVolumetricLightmap(bytes)` reads the file; `createVolumetricLightmapTextures(device, data)`
makes its nine 3D textures (a black texel each where there is no lightmap, or no bent normal);
`writeVolumetricLightmapView(words, at, data, shown)` writes the four `vec4f` a shader finds a
position with (zeros when the lightmap is absent or `shown` is false, the `volumetricLightmap`
setting). `volumetricLightmapWgsl(group, first)` is the sampling, for a program that binds
11 consecutive bindings from `first`
(`volumetricLightmapLayoutEntries`, `volumetricLightmapGroupEntries`): the view block, a bilinear
sampler clamped to the edge, the indirection volume (a read-only storage texture, read by load:
none of the stage's sixteen sampled textures), eight filtered textures.

- `vlmBrickUvs(world)`: the position clamped into the volume (at most 0.99 of its size), its
  indirection texel, then the brick's place in the atlas at the fraction of its span the position
  lies at, in padded bricks, half a texel in. A zero view answers the origin.
- `vlmSh1`, `vlmSh2`, `vlmSh3(uv)`: the light in one, two or three bands. The coefficients are
  read from [0, 1] back to [-1, 1] and multiplied by the ambient and by the scales
  `0.488603/0.282095` (the three linear ones), `1.092548/0.282095`, `4 · 0.315392/0.282095` and
  `2 · 0.546274/0.282095` the file divided them by. `vlmDotSh1`, `vlmDotSh2`, `vlmDotSh3` project
  them on a basis.
- `vlmSkyBentNormal(uv)` (mapped back to [-1, 1]; its length is the sky's visibility). The file also
  keeps the stationary sun's shadowing layer, which no reader takes: a stationary light is treated as a movable one while virtual shadow maps are on (they always are here), and the sun's shadow then comes from its shadow map alone — the lightmap's directional shadowing is read only for a light baked into its shadow channel, which that treatment removes. A `static` light is baked wholly into the indirect light and has no shadowing to read.
  A lightmap baked with a shadowing sky light (`skyLight`) carries real
  data in the bent normal; one baked without reads (-1, -1, -1) from the black stand-in, and the fog's
  sky shadowing stays off (`lightmap.skyBentNormal` is then undefined).

A scene's one lightmap covers all of it. Its finest bricks, where the file keeps them in cells
(`loadingCellSize`), stream: the atlas is made with room for the bricks of the cells (at most
`volumetricLightmapBrickMemory` megabytes, 30 by default), and each image the cells within
`volumetricLightmapLoadingRange` metres of the view (64 by default) are read by a Range, nearest
first, written into free slots of the atlas, and their indirection texels pointed at them; a cell
that leaves the range gives its slots back and its texels read the coarser brick again
(`lighting/volumetricLightmap/cells.ts`). A cell the room cannot hold is not loaded and is told once
(`volumetric-lightmap-room`); a cell that fails to read, `volumetric-lightmap-cell-failed`. The
fog reads it as its static term:

```wgsl
// where the cell's world position is `world`, the fog's phase `phaseG` and the view direction `cameraVector`
// (from the eye to the point; the bake's coefficients are those of the scene's own axes, up or not)
var brickUvs=vec3f(0.0);
if(skyScattering>0.0||staticIntensity>0.0){brickUvs=vlmBrickUvs(world);}
// the sky's visibility, where the sky light wants its static shadowing
if(skyStaticShadowing>0.0){visibility=length(vlmSkyBentNormal(brickUvs));}
// the static term: the indirect light of the stationary lights, the direct and indirect of the static
if(staticIntensity>0.0){
 let hg=vec4f(1.0,cameraVector.y,cameraVector.z,cameraVector.x)*vec4f(1.0,phaseG,phaseG,phaseG);
 lightScattering+=(staticIntensity/PI)*max(vlmDotSh2(vlmSh2(brickUvs),hg),vec3f(0.0));
}
```

`staticIntensity` is the height fog part's `volumetric.staticLightingScatteringIntensity` (default 1, never
below 0) while the image's lighting and the `volumetricLightmap` setting are on, else 0. The session reads the file
with the manifest (`readVolumetricLightmap`, `lighting/volumetricLightmap/fileLoad.ts`, verified against the size and digest
the manifest announces; `EngineContext.volumetricLightmapData`), none for a cache that baked none; its textures are made once,
at the first image that reads them and the setting is on (`volumetricLightmapOf`), and freed with the runtime. A scene
without a lightmap allocates none.
