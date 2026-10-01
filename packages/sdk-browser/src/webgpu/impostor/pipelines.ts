import { core } from '../../impostor/borrowed.ts';
import { cardPassWgsl } from './cardWgsl.ts';

/** The pass label the GPU timings and the tests name the card surfaces by. */
export const IMPOSTOR_PASS = 'Trillion3D impostor cards';

/**
 * The card pipelines (#1335) and their two group layouts: the image's (view uniform, card records)
 * and a mesh's atlas, which the feed fills (`feed.ts`). The visibility stages (`visPipeline`, with
 * and without the pyramid's level 0) write identifier 0 and the depth, with the clusters' targets
 * and depth (`visTargets`, `VIS_DEPTH`); the surface stage (`pipeline`) writes the four opaque
 * surfaces where its depth is the one the visibility stage kept, writing no depth.
 */
function makeCardPipelines(device: GPUDevice) {
  const FRAGMENT = GPUShaderStage.FRAGMENT,
    VERTEX = GPUShaderStage.VERTEX;
  const imageLayout = device.createBindGroupLayout({
    label: 'Trillion3D impostor image',
    entries: [
      { binding: 0, visibility: VERTEX | FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VERTEX | FRAGMENT, buffer: { type: 'read-only-storage' } },
    ],
  });
  const atlasLayout = device.createBindGroupLayout({
    label: 'Trillion3D impostor atlas',
    entries: [
      ...[0, 1, 2].map((binding) => ({
        binding,
        visibility: FRAGMENT,
        texture: { sampleType: 'float' as const },
      })),
      { binding: 3, visibility: FRAGMENT, sampler: { type: 'filtering' as const } },
    ],
  });
  const module = device.createShaderModule({ label: IMPOSTOR_PASS, code: cardPassWgsl() });
  const layout = device.createPipelineLayout({ bindGroupLayouts: [imageLayout, atlasLayout] });
  const make = (
    label: string,
    entryPoint: string,
    targets: GPUColorTargetState[],
    depthStencil: GPUDepthStencilState,
  ) =>
    device.createRenderPipeline({
      label,
      layout,
      vertex: { module, entryPoint: 'card_vs' },
      fragment: { module, entryPoint, targets },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil,
    });
  const visibility = (hiz: boolean) =>
    make(
      `${IMPOSTOR_PASS} visibility`,
      hiz ? 'card_vis_hiz_fs' : 'card_vis_fs',
      core.visTargets(hiz),
      core.VIS_DEPTH,
    );
  const vis = { hiz: visibility(true), ids: visibility(false) };
  return {
    imageLayout,
    atlasLayout,
    pipeline: make(
      IMPOSTOR_PASS,
      'card_fs',
      core.SURFACE_FORMATS.map((format) => ({ format })),
      {
        format: 'depth32float',
        depthCompare: core.DEPTH_COMPARE_OR_EQUAL,
        depthWriteEnabled: false,
      },
    ),
    /** The visibility stage's pipeline, with the pyramid's level 0 when `hiz`. */
    visPipeline: (hiz: boolean) => (hiz ? vis.hiz : vis.ids),
  };
}

const made = new WeakMap<GPUDevice, ReturnType<typeof makeCardPipelines>>();

/** The device's card pipelines: those its prepare checked, made at once otherwise. */
export function cardPipelines(device: GPUDevice) {
  let pipelines = made.get(device);
  if (!pipelines) made.set(device, (pipelines = makeCardPipelines(device)));
  return pipelines;
}

/**
 * THE CARD PIPELINES CHECKED BEFORE THE FIRST IMAGE (#1336): made under the device's validation
 * scope where the session prepares. Refused — a card shader that does not compile, a pipeline that
 * does not link —, the failure is told once (`onFailure`) and the answer is false: the session then
 * keeps no impostor code, as a refused import, so it plans no card and every root keeps its
 * clusters. An invalid pipeline set in a pass would lose every image's commands instead.
 */
export async function prepareImpostorPipelines(
  device: GPUDevice,
  onFailure: (phase: string, error: unknown) => void,
) {
  let failure: unknown;
  try {
    const { value, error } = await core.validationScope(device, () => makeCardPipelines(device));
    if (!error) return (made.set(device, value), true);
    failure = new Error(error.message);
  } catch (error) {
    failure = error;
  }
  made.delete(device);
  onFailure('impostor-card-program-failed', failure);
  return false;
}
