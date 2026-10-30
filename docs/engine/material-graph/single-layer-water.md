# Single-layer water

**Single-layer water** (`blend/water/`, `isWaterGraph`, `VisMaterial.water`). A lit surface whose
graph wires a water output is a blend item of the rank class `WATER_BASE` (three culls past the
refracting ones, `waterRank`). Every blend pass but two skips it (`drawBlendRuns`, `water: 'only' | 'with'`);
the front pass draws it with the others (its fragment covers its pixel whatever its coverage,
`GRAPH_FLAG.water`) and `encodeWater` draws it, at the head of `encodeBlend`, in the order of the
reference's pass (`waterPass.ts`):
1. the scene's depth copied, the water drawn into the copy (`fsWaterDepth`,
   `singleLayerWaterDepthPrepass`);
2. the scene's linear depth, at `singleLayerWaterRefractionDownsample` (`waterPassWgsl.ts`);
3. the tiles of 8 by 8 pixels holding water, marked then listed in Z-order, by subgroups where granted
   (`waterTileWgsl.ts`);
4. the scene's colour, for the listed tiles alone where the refraction mask limits what is read;
5. the refraction mask (`fsWaterMask`: distance, Fresnel and depth cullings, packed with a water flag);
6. the shading (`fsWater`, no blend): forward lights split into the diffuse share under the base
   material's coverage and the specular share, ambient, `waterVolume` (the reference's
   `EvaluateWaterVolumeLighting` on the bilateral read of the copy's depth, the refraction offset of
   the distortion's constants, the sun the light buffer names as the forward directional light), the
   fog; it writes the water's normal, roughness, reflectance and flag beside;
7. the water's velocity (`waterVelocity` in the velocity stage, `csWaterIds`: the camera's vector at
   the water's depth, its identifier cleared);
8. the sun kept apart where `singleLayerWaterShadersSupportVsmFiltering` holds (`waterSunSplit`: the
   forward directional light lit alone and taken off the walk's sum, written to a fifth target, its
   in-scattering too);
9. the sun's shadow where `singleLayerWaterVsmFiltering` is on and the depth pass listed the tiles
   (`encodeSunShadow`: the suns' projection of the shadow maps run by an indirect dispatch over the
   listed tiles on the water's depth and normals, input `water` of `waterSunProjection.ts`, then
   `fsWaterSunShadow` multiplies the separated sun by the forward sun's layer of its mask,
   `Zero, Src`);
10. the composite (`fsWaterComposite`, `One, SrcAlpha`): the separated sun, shadowed, and the
    surface's reflection (`surfaceReflection` for the technique), faded in over 50 cm above the scene,
    dimmed by the fog;
11. the water's depth copied over the scene's.

The reflections' indirect light is gated here: `waterFrontOf` asks the settings for the front layer
(`resolveReflections`, `water`), which is then traced at every level that traces, in blocks of the
water's own side, with the reconstruction and denoising the water's settings leave on
(`ReflectionSettings.frontBlock`, `frontReconstruction`, `frontTemporal`, `frontBilateral`,
`frontSceneTraces`: the second layer's flags ride in `reflectionView.scene.w` and its block in
`grid.w`, read by `reflectionBlock` and `reflectionDone` through the pipeline's `REFLECTION_LAYER`).
The front stage is compiled for the reflecting surface wherever the items hold water. The module holds
the water's code only in a scene holding water (`BlendProgramSetup.water`); `BlendGraph` holds its
four outputs only then. A graph wires the coefficients per centimetre as the reference does: depths
are metres in the world, centimetres in the law (`WATER_CM`).

