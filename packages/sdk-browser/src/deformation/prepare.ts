import { createSessionDeformation } from './session.ts';
import { prepareWebgpuGeometry } from '../webgpu/core/geometryPrepare.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

/** One setup for clustered and material-driven whole-copy deformation, sharing the vertex pool. */
export function prepareDeformationGeometry(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, layout, setup, blendState } = rt;
  vis.wholeDeformation?.table.destroy();
  vis.wholeDeformation = undefined;
  vis.geometryBlocks.clear();
  vis.deformation = createSessionDeformation(
    layout.selectionRoots,
    setup.worlds,
    setup.blendCopies.filter((copy) => !copy.userData.pagedBlend),
  );
  Object.assign(
    vis,
    prepareWebgpuGeometry(
      device,
      setup.allPages,
      vis.geometryBlocks,
      vis.deformation,
      blendState.blendGpu,
      (growth) => {
        Object.assign(vis, growth);
        rt.run.gate.resourcesChanged();
      },
    ),
  );
}
