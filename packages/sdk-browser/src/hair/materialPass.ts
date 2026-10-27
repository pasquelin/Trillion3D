import { autoKernel } from '../gpu/core/computeStages.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { MATERIAL_WGSL, SAMPLE_COVERAGE_WGSL } from './materialWgsl.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import type { HairNodes } from './compactionPass.ts'
import type { HairTiles } from './tilesPass.ts'
import { HAIR_ALL_TILES_DISPATCH } from './visibilityMath.ts'

const materialKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}material`,
  MATERIAL_WGSL,
  'hairMaterial',
)
const coverageKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}sample coverage`,
  SAMPLE_COVERAGE_WGSL,
  'hairSampleCoverage',
)

/** The pipelines of the material pass and, where the samples of a pixel are sorted by depth, the
 *  update of their coverage; none while one compiles. */
export function materialPipelines(device: GPUDevice, sorted: boolean) {
  const material = materialKernel(device).get()
  const coverage = sorted ? coverageKernel(device).get() : undefined
  return material && (coverage || !sorted) ? { material, coverage } : undefined
}

/** The bind groups of the material pass over a view's compacted samples, kept while they stay: the
 *  group 1 of the material kernel, and the group 0 of the coverage's. `view` and `image` are the
 *  view's blocks, which the view keeps for as long as it lives. */
export function materialBinds(view: GPUBuffer, image: GPUBuffer) {
  return {
    nodes: boundGroups<HairNodes, undefined, undefined>(1, (device, pipeline, nodes) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: sequentialEntries([
          { buffer: view },
          { buffer: nodes.nodeVis },
          { buffer: nodes.nodeCoord },
          { buffer: nodes.nodeCounter },
          { buffer: nodes.nodeData },
        ]),
      }),
    ),
    coverage: boundGroups<HairTiles, GPUTextureView, HairNodes>(
      1,
      (device, pipeline, tiles, index, nodes) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: sequentialEntries([
            { buffer: image },
            { buffer: tiles.counts },
            { buffer: tiles.data },
            index,
            { buffer: nodes.nodeData },
          ]),
        }),
    ),
  }
}

/**
 * Writes the material of the compacted samples in `pass`, an instance after another (each takes the
 * samples whose identifier names it, so every sample is given one material), over the stored samples
 * `nodes.nodeArgs` says; then, where the pixels are sorted, the coverage of their samples over the
 * tiles with strands. `index` is the descriptors' texture.
 */
export function encodeHairMaterial(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipelines: NonNullable<ReturnType<typeof materialPipelines>>,
  binds: ReturnType<typeof materialBinds>,
  nodes: HairNodes,
  drawn: readonly DrawnInstance[],
  tiles: HairTiles,
  index: GPUTextureView,
) {
  pass.setPipeline(pipelines.material)
  pass.setBindGroup(1, binds.nodes(device, pipelines.material, nodes, undefined, undefined))
  for (const instance of drawn) {
    pass.setBindGroup(0, instance.group(pipelines.material))
    pass.dispatchWorkgroupsIndirect(nodes.nodeArgs, 0)
  }
  if (!pipelines.coverage) return
  pass.setPipeline(pipelines.coverage)
  pass.setBindGroup(0, binds.coverage(device, pipelines.coverage, tiles, index, nodes))
  pass.dispatchWorkgroupsIndirect(tiles.dispatchArgs, HAIR_ALL_TILES_DISPATCH)
}
