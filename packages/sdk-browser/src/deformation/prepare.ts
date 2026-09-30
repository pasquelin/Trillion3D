import { createSessionDeformation } from './session.ts';
import { prepareWebgpuGeometry } from '../webgpu/core/geometryPrepare.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { families } from '../host/families.ts';

/**
 * One setup for clustered and material-driven whole-copy deformation, sharing the vertex pool. A
 * session that deforms — a root or a whole copy with a record, a page with deformed results —
 * first awaits the family's code (`deformationCode.ts`), as its scene's other resources, before
 * any frame (#1353); one that does not loads none of it, and its pool holds no whole copy.
 */
export async function prepareDeformationGeometry(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis, layout, setup, blendState } = rt;
  vis.wholeDeformation?.table.destroy();
  vis.wholeDeformation = undefined;
  vis.geometryBlocks.clear();
  vis.deformationCode = undefined; // a refused import below leaves no earlier prepare's code
  vis.deformation = createSessionDeformation(
    layout.selectionRoots,
    setup.worlds,
    setup.blendCopies.filter((copy) => !copy.userData.pagedBlend),
  );
  const deforms = vis.deformation.any || setup.allPages.some((page) => page.deformationOutput);
  vis.deformationCode = deforms ? await families.deformation.load() : undefined;
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
      vis.deformationCode?.wholeDeformationPool,
    ),
  );
}
