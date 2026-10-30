# Single-layer water

**Single-layer water** (`blend/water/`, `isWaterGraph`, `VisMaterial.water`). A lit surface whose
graph wires a water output is a blend item of rank class `WATER_BASE` (`waterRank`). Blend passes
skip it except two (`drawBlendRuns`, `water: 'only' | 'with'`); the front pass draws it
(`GRAPH_FLAG.water`); `encodeWater` draws it at the head of `encodeBlend` (`waterPass.ts`):

1. scene depth copied, water drawn into the copy (`fsWaterDepth`, `singleLayerWaterDepthPrepass`);
2. scene linear depth at `singleLayerWaterRefractionDownsample` (`waterPassWgsl.ts`);
3. 8 by 8 pixel tiles holding water, marked then listed in Z-order (`waterTileWgsl.ts`);
4. scene colour, for listed tiles alone where the refraction mask limits what is read;
5. refraction mask (`fsWaterMask`: distance, Fresnel and depth cullings, packed with a water flag);
6. shading (`fsWater`, no blend): forward lights split into diffuse share under the base material's
   coverage and specular share, ambient, `waterVolume` (the reference's
   `EvaluateWaterVolumeLighting`, on the bilateral read of the copy's depth; sun = forward directional light), fog;
   writes water normal, roughness, reflectance and flag beside;
7. water velocity (`waterVelocity`, `csWaterIds`);
8. where `singleLayerWaterShadersSupportVsmFiltering` holds, sun kept apart (`waterSunSplit`: written
   to a fifth target, in-scattering too);
9. where `singleLayerWaterVsmFiltering` is on, sun shadow (`encodeSunShadow`, input `water` of
   `waterSunProjection.ts`, then `fsWaterSunShadow` multiplies the separated sun by the forward
   sun's mask layer, `Zero, Src`);
10. composite (`fsWaterComposite`, `One, SrcAlpha`): separated sun, shadowed, and surface reflection
    (`surfaceReflection`), faded in over 50 cm above scene, dimmed by fog;
11. water depth copied over the scene's.

Reflections: `waterFrontOf` asks the settings for the front layer (`resolveReflections`, `water`),
traced at every level that traces, in blocks of the water's own side, with the reconstruction and
denoising its settings leave on (`ReflectionSettings.frontBlock`, `frontReconstruction`,
`frontTemporal`, `frontBilateral`, `frontSceneTraces`; the second layer's flags ride in
`reflectionView.scene.w`, its block in `grid.w`, read by `reflectionBlock` and `reflectionDone`
through the pipeline's `REFLECTION_LAYER`). Water code and the four `BlendGraph` outputs
exist only in a scene holding water (`BlendProgramSetup.water`). Coefficients are per centimetre:
depths are metres in the world, centimetres in the law (`WATER_CM`).

Exclusion volumes cut the surface: in a world holding one, the water programs are a variant whose
`fsWater` and `fsWaterDepth` discard a fragment inside a volume that excludes its body (the item's
rank, handed by the vertex stage in a spare lane of its extras, whatever else the program reads; the
volumes' table is the water group's binding 10 and grows to what the world holds, no volume or body
left out). The front pass draws the water's items apart in the same variant, with the table in its own group. The programs are rebuilt through the one blend rebuild (`followWaterExclusion`, `buildGranted`) when a volume appears or goes. No volume: the texts and layouts are the default's.
