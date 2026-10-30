# Volumetric lightmap

Baked by the compiler (`lightmapBake`, [COMPILER.md](../compiler/volumetric-lightmap.md#volumetric-lightmap)),
read by position (`lighting/volumetricLightmap/`, `sdk-core/src/lighting/volumetricLightmapFile.ts`;
file: [FORMAT.md](../format/volumetric-lightmapbin.md#volumetric-lightmapbin)).
`parseVolumetricLightmap(bytes)`; `createVolumetricLightmapTextures(device, data)` (nine 3D textures);
`writeVolumetricLightmapView(words, at, data, shown)` (four `vec4f`; zeros when absent or `shown`, the
`volumetricLightmap` setting, is false); `volumetricLightmapWgsl(group, first)`: 11 bindings from `first`
(`volumetricLightmapLayoutEntries`, `volumetricLightmapGroupEntries`).

- `vlmBrickUvs(world)`: position clamped into the volume (at most 0.99 of its size) to brick atlas place.
- `vlmSh1`, `vlmSh2`, `vlmSh3(uv)`: one to three bands; coefficients [0, 1] back to [-1, 1], times the
  ambient and the scales `0.488603/0.282095` (linear ones), `1.092548/0.282095`,
  `4 · 0.315392/0.282095`, `2 · 0.546274/0.282095`. `vlmDotSh1`, `vlmDotSh2`, `vlmDotSh3` project them.
- `vlmSkyBentNormal(uv)` ([-1, 1]; length is the sky's visibility). The stationary sun's shadowing
  layer is unread; a `static` light is baked into the indirect light. Baked without a shadowing sky
  light (`skyLight`), the fog's sky shadowing stays off (`lightmap.skyBentNormal` undefined).

Finest bricks, where the file keeps cells (`loadingCellSize`), stream: atlas room at most
`volumetricLightmapBrickMemory` MB (default 30); each image, cells within
`volumetricLightmapLoadingRange` metres (default 64) are Range-read nearest first
(`lighting/volumetricLightmap/cells.ts`). A cell the room cannot hold is told once
(`volumetric-lightmap-room`); a failed read, `volumetric-lightmap-cell-failed`. The fog's static term:

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

`staticIntensity` is the height fog's `volumetric.staticLightingScatteringIntensity` (default 1, at
least 0) while `volumetricLightmap` is on, else 0. The session reads the file with the manifest
(`readVolumetricLightmap`, `lighting/volumetricLightmap/fileLoad.ts`, checked against its size and
digest; `EngineContext.volumetricLightmapData`); textures are made once (`volumetricLightmapOf`).
