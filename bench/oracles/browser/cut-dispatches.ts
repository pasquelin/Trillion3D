/**
 * The cut from BEFORE the "persistent selection" batch, copied whole: its descent kernel, the
 * layout of its work buffer, its buffers and its encoding. Two toggling queues, whose
 * counter can only restart from zero by a CPU copy, and an arming of the indirect argument
 * per level.
 *
 * This is the ORACLE of `cut-dispatches-gpu.ts`. It is copied — not imported — for the
 * reason that makes an oracle: it must stay what the deposit did at `develop`, whatever
 * happens to the shipped code. The shipped side is never copied: the bench calls
 * `encodeDagKernels` and `createDagResources` for real, otherwise it would measure a copy
 * of the cut instead of it.
 *
 * Its offsets in `work` are those from before: each queue carries a counter AND a group
 * count, since it was read indirectly, and everything that follows is shifted by that.
 */
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import {
  DAG_UNIFORM_BYTES,
  VIEW_WORD_ROWS,
} from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import { FRAME_VEC4 } from '../../../packages/sdk-browser/src/gpu/dag/types.ts';
import { ESCALATION_ROUNDS } from '../../../packages/sdk-browser/src/page/selection/types.ts';
export { DAG_LEVEL_WGSL_AVANT } from './cut-dispatches-wgsl.ts';

/** What `ressourcesAvant` reads of the bench's packed scene: the same fields the shipped
 *  `createDagResources` reads, before the batch renamed and reshaped a few of them. */
interface PackedAvant {
  pageCount: number;
  worldCount: number;
  clusters: BufferSource;
  nodes: BufferSource;
  nodeCount: number;
  worldStretch: Float32Array;
  rootNodes: Uint32Array;
  worlds: BufferSource;
  pageCones: BufferSource;
  levelSizes: readonly unknown[];
}

const NOYAUX_AVANT = [
  'dagPrepare',
  'dagClearDrawn',
  'dagWanted',
  'dagEscalate',
  'dagCheck',
  'dagMask',
  'dagDrawPrefix',
  'dagDrawScatter',
];

/** Buffers, steps and offsets of the previous cut, mounted on the bench's `packed`. */
export function ressourcesAvant(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  packed: PackedAvant,
  readbackBytes: number,
) {
  const pageCount = packed.pageCount,
    worldCount = Math.max(1, packed.worldCount);
  const blockCount = Math.ceil(pageCount / SELECTION_WORKGROUP);
  const base = worldCount * 2 + blockCount * 2;
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const frameData = new Float32Array(worldCount * FRAME_VEC4 * 4),
    frameInts = new Uint32Array(frameData.buffer);
  for (let w = 0; w < packed.worldCount; w++) {
    frameData[(w * FRAME_VEC4 + 6) * 4] = packed.worldStretch[w];
    frameInts[(w * FRAME_VEC4 + 6) * 4 + 1] = packed.rootNodes[w];
  }
  const tampon = (taille: number, source?: BufferSource | null, usage = STORAGE) => {
    const buffer = device.createBuffer({ size: Math.max(taille, source?.byteLength ?? 0), usage });
    if (source) device.queue.writeBuffer(buffer, 0, source);
    return buffer;
  };
  const buffers = [
    tampon(64, packed.clusters),
    tampon(64, packed.nodes),
    // The uniform array and the per-view words the shipped prepare resets, around the frozen descent.
    tampon(DAG_UNIFORM_BYTES, null, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    tampon(Math.max(16, (packed.nodeCount * 2 + pageCount * 4) * 4)),
    tampon(readbackBytes),
    tampon(Math.max(8, (base + 10 + worldCount * 2 + VIEW_WORD_ROWS) * 4)),
    tampon(64, packed.worlds),
    tampon(16, frameData),
    tampon(48, packed.pageCones),
  ];
  const dispatchArgs = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(dispatchArgs, 0, new Uint32Array([0, 1, 1, 0]));
  const zeros = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const etape = (entryPoint: string) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
  return {
    buffers,
    uniforms: buffers[2],
    output: buffers[4],
    work: buffers[5],
    dispatchArgs,
    zeros,
    worldCount,
    blockCount,
    levelCount: packed.levelSizes.length,
    queueResetOffset: [(base + 2) * 4, (base + 4) * 4],
    queueGroupsOffset: [(base + 3) * 4, (base + 5) * 4],
    candGroupsOffset: (base + 7) * 4,
    liveGroupsOffset: (base + 1) * 4,
    drawnGroupsOffset: (base + 9) * 4,
    noyaux: Object.fromEntries(NOYAUX_AVANT.map((nom) => [nom, etape(nom)])),
    niveaux: [etape('dagLevel0'), etape('dagLevel1')],
    bindGroup: device.createBindGroup({
      layout,
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
    }),
  };
}

/** Encoding of a frame as `packages/sdk-browser/src/gpu/dag/encode.ts` wrote it at `develop`, resident cut. */
export function encodeAvant(
  encoder: GPUCommandEncoder,
  r: ReturnType<typeof ressourcesAvant>,
  profondeur = r.levelCount,
) {
  const { bindGroup, dispatchArgs, work, zeros, noyaux, niveaux } = r;
  const groupes = (n: number) => Math.max(1, Math.ceil(n / SELECTION_WORKGROUP));
  const arme = (octets: number) => encoder.copyBufferToBuffer(work, octets, dispatchArgs, 0, 4);
  const seule = (pipeline: GPUComputePipeline) => {
    const passe = encoder.beginComputePass();
    passe.setBindGroup(0, bindGroup);
    passe.setPipeline(pipeline);
    passe.dispatchWorkgroupsIndirect(dispatchArgs, 0);
    passe.end();
  };
  arme(r.drawnGroupsOffset);
  const tete = encoder.beginComputePass();
  tete.setBindGroup(0, bindGroup);
  tete.setPipeline(noyaux.dagClearDrawn);
  tete.dispatchWorkgroupsIndirect(dispatchArgs, 0);
  tete.setPipeline(noyaux.dagPrepare);
  tete.dispatchWorkgroups(groupes(Math.max(r.worldCount, r.blockCount)));
  tete.setPipeline(niveaux[0]);
  tete.dispatchWorkgroups(groupes(r.worldCount));
  tete.end();
  for (let niveau = 1; niveau < profondeur; niveau++) {
    const source = niveau & 1;
    encoder.copyBufferToBuffer(zeros, 0, work, r.queueResetOffset[1 - source], 8);
    arme(r.queueGroupsOffset[source]);
    seule(niveaux[source]);
  }
  arme(r.candGroupsOffset);
  seule(noyaux.dagWanted);
  arme(r.liveGroupsOffset);
  const vif = encoder.beginComputePass();
  vif.setBindGroup(0, bindGroup);
  const surListe = (pipeline: GPUComputePipeline) => {
    vif.setPipeline(pipeline);
    vif.dispatchWorkgroupsIndirect(dispatchArgs, 0);
  };
  for (let ronde = 0; ronde < ESCALATION_ROUNDS; ronde++) surListe(noyaux.dagEscalate);
  surListe(noyaux.dagCheck);
  surListe(noyaux.dagMask);
  vif.setPipeline(noyaux.dagDrawPrefix);
  vif.dispatchWorkgroups(1);
  surListe(noyaux.dagDrawScatter);
  vif.end();
}
