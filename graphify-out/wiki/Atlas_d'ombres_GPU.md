# Atlas d'ombres GPU

> 33 nodes

## Key Concepts

- **LIGHT_SETTINGS** (28 connections) — `packages/sdk-core/sceneLightContracts.ts`
- **gpuShadowAtlas.ts** (27 connections) — `packages/sdk-browser/gpuShadowAtlas.ts`
- **webgpuPagesStateLights.ts** (24 connections) — `packages/sdk-browser/webgpuPagesStateLights.ts`
- **gpuShadowCull.ts** (16 connections) — `packages/sdk-browser/gpuShadowCull.ts`
- **webgpuPagesPrepareLights.ts** (16 connections) — `packages/sdk-browser/webgpuPagesPrepareLights.ts`
- **createCheckedShaderModule()** (14 connections) — `packages/sdk-browser/gpuShaderModule.ts`
- **gpuLightTiles.ts** (14 connections) — `packages/sdk-browser/gpuLightTiles.ts`
- **gpuLightTilesShader.ts** (10 connections) — `packages/sdk-browser/gpuLightTilesShader.ts`
- **WebgpuLightState** (9 connections) — `packages/sdk-browser/webgpuPagesStateLights.ts`
- **prepareDirectLights()** (8 connections) — `packages/sdk-browser/webgpuPagesPrepareLights.ts`
- **directLightWgsl.ts** (8 connections) — `packages/sdk-browser/directLightWgsl.ts`
- **createGpuShadowAtlas()** (6 connections) — `packages/sdk-browser/gpuShadowAtlas.ts`
- **createWebgpuLightState()** (6 connections) — `packages/sdk-browser/webgpuPagesStateLights.ts`
- **GpuShadowAtlas** (4 connections) — `packages/sdk-browser/gpuShadowAtlas.ts`
- **ShadowPlan** (4 connections) — `packages/sdk-core/sceneLightShadowPlan.ts`
- **createGpuLightTiles()** (4 connections) — `packages/sdk-browser/gpuLightTiles.ts`
- **shadowAtlasBytes()** (4 connections) — `packages/sdk-browser/gpuShadowAtlas.ts`
- **createGpuShadowCull()** (4 connections) — `packages/sdk-browser/gpuShadowCull.ts`
- **DEPTH_NEAR** (4 connections) — `packages/sdk-browser/depthConvention.ts`
- **DIRECT_LIGHT_WGSL** (4 connections) — `packages/sdk-browser/directLightWgsl.ts`
- **MAX_SHADOW_REGIONS** (4 connections) — `packages/sdk-browser/gpuShadowAtlas.ts`
- **SCENE_LIGHT_BUFFER_FLOATS** (4 connections) — `packages/sdk-core/sceneLightContracts.ts`
- **SHADOW_CULL_FLOATS** (4 connections) — `packages/sdk-core/sceneLightShadowFaces.ts`
- **GpuLightTiles** (3 connections) — `packages/sdk-browser/gpuLightTiles.ts`
- **GpuShadowCull** (3 connections) — `packages/sdk-browser/gpuShadowCull.ts`
- *... and 8 more nodes in this community*

## Relationships

- [sdk-core · Slices](sdk-core_·_Slices.md) (16 shared connections)
- [Intégration des pages arrivées](Intégration_des_pages_arrivées.md) (12 shared connections)
- [sdk-browser · DeferredBindings](sdk-browser_·_DeferredBindings.md) (10 shared connections)
- [Étapes et profilage de trame](Étapes_et_profilage_de_trame.md) (7 shared connections)
- [Sondes et rebond GPU](Sondes_et_rebond_GPU.md) (6 shared connections)
- [sdk-core · Inputs](sdk-core_·_Inputs.md) (6 shared connections)
- [sdk-browser · GeometryBlock](sdk-browser_·_GeometryBlock.md) (5 shared connections)
- [sdk-core · matrix](sdk-core_·_matrix.md) (5 shared connections)
- [Sélection DAG et pages WebGPU](Sélection_DAG_et_pages_WebGPU.md) (4 shared connections)
- [sdk-browser · DagBuffers](sdk-browser_·_DagBuffers.md) (4 shared connections)
- [Mathématiques du tampon de visibilité](Mathématiques_du_tampon_de_visibilité.md) (4 shared connections)
- [sdk-browser · LayoutEntries](sdk-browser_·_LayoutEntries.md) (4 shared connections)

## Source Files

- `packages/sdk-browser/depthConvention.ts`
- `packages/sdk-browser/directLightWgsl.ts`
- `packages/sdk-browser/gpuLightTiles.ts`
- `packages/sdk-browser/gpuLightTilesShader.ts`
- `packages/sdk-browser/gpuShaderModule.ts`
- `packages/sdk-browser/gpuShadowAtlas.ts`
- `packages/sdk-browser/gpuShadowCull.ts`
- `packages/sdk-browser/gpuShadowCullShader.ts`
- `packages/sdk-browser/webgpuPagesPrepareLights.ts`
- `packages/sdk-browser/webgpuPagesStateLights.ts`
- `packages/sdk-core/sceneLightContracts.ts`
- `packages/sdk-core/sceneLightShadowFaces.ts`
- `packages/sdk-core/sceneLightShadowPlan.ts`

## Audit Trail

- EXTRACTED: 180 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*