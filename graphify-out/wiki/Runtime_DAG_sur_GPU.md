# Runtime DAG sur GPU

> 24 nodes

## Key Concepts

- **gpuDagRuntime.ts** (24 connections) — `packages/sdk-browser/gpuDagRuntime.ts`
- **gpuDagDispatch.ts** (18 connections) — `packages/sdk-browser/gpuDagDispatch.ts`
- **gpuDagWorlds.test.ts** (12 connections) — `packages/sdk-browser/gpuDagWorlds.test.ts`
- **residentWords()** (10 connections) — `packages/sdk-browser/gpuDagLayout.ts`
- **gpuDagWorlds.ts** (10 connections) — `packages/sdk-browser/gpuDagWorlds.ts`
- **createDagDispatch()** (9 connections) — `packages/sdk-browser/gpuDagDispatch.ts`
- **residentBase()** (9 connections) — `packages/sdk-browser/gpuDagLayout.ts`
- **createDagRuntime()** (9 connections) — `packages/sdk-browser/gpuDagRuntime.ts`
- **sameSelectionUniforms()** (7 connections) — `packages/sdk-browser/gpuSelection.ts`
- **FRAME_VEC4** (6 connections) — `packages/sdk-browser/gpuDagTypes.ts`
- **refreshWorldStretch()** (5 connections) — `packages/sdk-browser/gpuDagWorlds.ts`
- **createDagOutputScratch()** (3 connections) — `packages/sdk-browser/gpuDagUniforms.ts`
- **copySelectionUniforms()** (3 connections) — `packages/sdk-browser/gpuSelection.ts`
- **coalesceResidencyRanges()** (3 connections) — `packages/sdk-browser/webgpuResidencyRanges.ts`
- **webgpuResidencyRanges.ts** (3 connections) — `packages/sdk-browser/webgpuResidencyRanges.ts`
- **ResidencyChanges** (2 connections) — `packages/sdk-browser/gpuSelection.ts`
- **reference()** (2 connections) — `packages/sdk-browser/gpuDagWorlds.test.ts`
- **RESIDENCY_RANGE_MAX** (2 connections) — `packages/sdk-browser/webgpuResidencyRanges.ts`
- **DagResources** (1 connections) — `packages/sdk-browser/gpuDagDispatch.ts`
- **DagRuntimeState** (1 connections) — `packages/sdk-browser/gpuDagDispatch.ts`
- **DagResources** (1 connections) — `packages/sdk-browser/gpuDagRuntime.ts`
- **packedOf()** (1 connections) — `packages/sdk-browser/gpuDagWorlds.test.ts`
- **scene()** (1 connections) — `packages/sdk-browser/gpuDagWorlds.test.ts`
- **LINEAR** (1 connections) — `packages/sdk-browser/gpuDagWorlds.ts`

## Relationships

- [Erreur d'écran hors axe](Erreur_d'écran_hors_axe.md) (12 shared connections)
- [sdk-browser · colonne](sdk-browser_·_colonne.md) (9 shared connections)
- [Lancements de coupe et relevé](Lancements_de_coupe_et_relevé.md) (9 shared connections)
- [Adoption et reprise de la coupe](Adoption_et_reprise_de_la_coupe.md) (8 shared connections)
- [sdk-browser · DagOutputScratch](sdk-browser_·_DagOutputScratch.md) (7 shared connections)
- [Priorité de diffusion et textures (2)](Priorité_de_diffusion_et_textures_2.md) (6 shared connections)
- [sdk-browser · DagResources](sdk-browser_·_DagResources.md) (3 shared connections)
- [sdk-browser · DagBuffers](sdk-browser_·_DagBuffers.md) (3 shared connections)
- [Oracle DAG et plancher de coupe](Oracle_DAG_et_plancher_de_coupe.md) (3 shared connections)
- [Intégration des pages arrivées](Intégration_des_pages_arrivées.md) (2 shared connections)
- [Sélection DAG et pages WebGPU](Sélection_DAG_et_pages_WebGPU.md) (2 shared connections)
- [Dessin GPU et contrat](Dessin_GPU_et_contrat.md) (1 shared connections)

## Source Files

- `packages/sdk-browser/gpuDagDispatch.ts`
- `packages/sdk-browser/gpuDagLayout.ts`
- `packages/sdk-browser/gpuDagRuntime.ts`
- `packages/sdk-browser/gpuDagTypes.ts`
- `packages/sdk-browser/gpuDagUniforms.ts`
- `packages/sdk-browser/gpuDagWorlds.test.ts`
- `packages/sdk-browser/gpuDagWorlds.ts`
- `packages/sdk-browser/gpuSelection.ts`
- `packages/sdk-browser/webgpuResidencyRanges.ts`

## Audit Trail

- EXTRACTED: 104 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [index](index.md) to navigate.*