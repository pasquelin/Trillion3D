import { SELECTION_WORKGROUP as WORKGROUP } from './gpuSelection.ts';
import { ESCALATION_ROUNDS } from './pageSelectionTypes.ts';
import type { createDagResources } from './gpuDagResources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

/**
 * Les noyaux de la coupe, encodés dans l'ordre. Deux passes et non une : `dagArgs` écrit l'argument
 * de répartition dans `flags`, et WebGPU refuse un tampon à la fois écrit et lu comme argument dans
 * une même portée de synchronisation. La coupure porte la recopie de ces trois mots, rien d'autre.
 */
export function encodeDagKernels(encoder: GPUCommandEncoder, resources: DagResources) {
  const {
    residentCut,
    pageCount,
    nodeCount,
    worldCount,
    liveArgsOffset,
    flags,
    liveArgs,
    bindGroup,
    resetPipeline,
    planePipeline,
    argsPipeline,
    nodePipeline,
    wantedPipeline,
    escalatePipeline,
    checkPipeline,
    maskPipeline,
    drawCountPipeline,
    drawPrefixPipeline,
    drawScatterPipeline,
  } = resources;
  const groups = (count: number) => Math.max(1, Math.ceil(count / WORKGROUP));
  const blockCount = Math.max(1, Math.ceil(pageCount / WORKGROUP));
  const pass = encoder.beginComputePass({ label: 'WG DAG selection' });
  pass.setBindGroup(0, bindGroup);
  const run = (pipeline: GPUComputePipeline, count: number) => {
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(groups(count));
  };
  run(resetPipeline, worldCount);
  run(planePipeline, worldCount);
  run(nodePipeline, Math.max(1, nodeCount));
  run(wantedPipeline, pageCount);
  run(argsPipeline, 1);
  pass.end();
  // WebGPU refuse un tampon à la fois écrit et lu comme argument de répartition dans une même
  // portée de synchronisation : les trois mots que `dagArgs` vient d'écrire sont recopiés, hors
  // passe, vers leur propre tampon. C'est la seule raison de la coupure entre les deux passes.
  encoder.copyBufferToBuffer(flags, liveArgsOffset, liveArgs, 0, 12);
  const live = encoder.beginComputePass({ label: 'WG DAG selection' });
  live.setBindGroup(0, bindGroup);
  // Ces noyaux ne visitent que les grappes vivantes, celles que `dagWanted` vient de lister :
  // leur verdict est celui d'avant, il n'est plus prononcé sur celles dont il ne disait rien.
  const runLive = (pipeline: GPUComputePipeline) => {
    live.setPipeline(pipeline);
    live.dispatchWorkgroupsIndirect(liveArgs, 0);
  };
  if (residentCut) {
    for (let round = 0; round < ESCALATION_ROUNDS; round++) runLive(escalatePipeline);
    runLive(checkPipeline);
  }
  runLive(maskPipeline);
  // La liste des pages dessinables est compactée ici, dans l'ordre croissant : le relevé ne
  // rapporte plus un drapeau par page mais le seul compte et ses rangs.
  if (residentCut) {
    live.setPipeline(drawCountPipeline);
    live.dispatchWorkgroups(groups(blockCount));
    live.setPipeline(drawPrefixPipeline);
    live.dispatchWorkgroups(1);
    live.setPipeline(drawScatterPipeline);
    live.dispatchWorkgroups(groups(pageCount));
  }
  live.end();
}
