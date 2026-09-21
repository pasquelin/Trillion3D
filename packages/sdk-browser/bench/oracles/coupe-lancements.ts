/**
 * The cut from BEFORE the "persistent selection" batch, copied whole: its descent kernel, the
 * layout of its work buffer, its buffers and its encoding. Two toggling queues, whose
 * counter can only restart from zero by a CPU copy, and an arming of the indirect argument
 * per level.
 *
 * This is the ORACLE of `coupe-lancements-gpu.ts`. It is copied — not imported — for the
 * reason that makes an oracle: it must stay what the deposit did at `develop`, whatever
 * happens to the shipped code. The shipped side is never copied: the bench calls
 * `encodeDagKernels` and `createDagResources` for real, otherwise it would measure a copy
 * of the cut instead of it.
 *
 * Its offsets in `work` are those from before: each queue carries a counter AND a group
 * count, since it was read indirectly, and everything that follows is shifted by that.
 */
import { SELECTION_UNIFORM_BYTES, SELECTION_WORKGROUP } from '../../gpuSelection.ts';
import { FRAME_VEC4 } from '../../gpuDagTypes.ts';
import { ESCALATION_ROUNDS } from '../../pageSelectionTypes.ts';

export const DAG_LEVEL_WGSL_AVANT = `fn queueBase(q:u32)->u32{return select(0u,uni.nodeCount+uni.clusterCount*4u,q==1u);}
fn candBase()->u32{return uni.nodeCount+uni.clusterCount*3u;}
fn queueCounter(q:u32)->u32{return liveCounter()+2u+q*2u;}
fn queueGroups(q:u32)->u32{return queueCounter(q)+1u;}
fn candCounter()->u32{return liveCounter()+6u;}
fn candGroups()->u32{return candCounter()+1u;}
fn drawnCounter()->u32{return liveCounter()+8u;}
fn drawnGroups()->u32{return drawnCounter()+1u;}
/** Index of the primitive's root node, deposited once and for all behind its stretch. */
fn rootOf(w:u32)->u32{return bitcast<u32>(frames[w*FRAME+6u].y);}
/** A range append: the group count follows the opening of each sixty-four slice,
 *  so it is exactly \`ceil(total/64)\` without a single-thread kernel pulling it afterwards. */
fn spanAppend(counter:u32,groups:u32,base:u32,first:u32,count:u32){
 let at=atomicAdd(&work[counter],count);
 for(var k=0u;k<count;k++){
  flags[base+at+k]=first+k;
  if(((at+k)&63u)==0u){atomicAdd(&work[groups],1u);}
 }
}
fn drawnAppend(page:u32){spanAppend(drawnCounter(),drawnGroups(),candBase(),page,1u);}
/** Frame counters, reset by a single thread. Queue 0 already counts its roots: one
 *  thread per primitive has just deposited its own, at its own rank, with no counter to dispute. */
fn resetCounters(){
 atomicStore(&work[liveCounter()],0u);atomicStore(&work[liveGroups()],0u);
 atomicStore(&work[queueCounter(0u)],uni.worldCount);atomicStore(&work[queueGroups(0u)],(uni.worldCount+63u)/64u);
 atomicStore(&work[queueCounter(1u)],0u);atomicStore(&work[queueGroups(1u)],0u);
 atomicStore(&work[candCounter()],0u);atomicStore(&work[candGroups()],0u);
 atomicStore(&work[drawnCounter()],0u);atomicStore(&work[drawnGroups()],0u);
}
/** Drawn pages of the previous frame, reset by range: the only pages whose draw flag
 *  can be one. No other is visited, and none is walked in full. */
@compute @workgroup_size(64)
fn dagClearDrawn(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=atomicLoad(&work[drawnCounter()])){return;}
 flags[uni.nodeCount+flags[candBase()+s]]=0u;
}
/** A node of queue \`src\`: rejected, it yields nothing; kept, it deposits its children in the
 *  opposite queue, or its pages in the candidate list when it is a leaf. */
fn levelStep(src:u32,s:u32){
 if(s>=atomicLoad(&work[queueCounter(src)])){return;}
 let i=flags[queueBase(src)+s];
 if(i==0xffffffffu){return;}
 let node=nodes[i];
 if(outsideFrustum(node.worldIndex*FRAME,node.minimum,node.maximum)){atomicAdd(&out.frustumRejected,1u);return;}
 if(node.maxParentError>=0.0){
  let e=uni.view*worlds[node.worldIndex];
  if(projected(node.maxParentError,node.sphere,e,stretchOf(node.worldIndex),focalPixels())<=uni.pixelError){atomicAdd(&out.frustumRejected,1u);return;}
 }
 if(node.childCount>0u){spanAppend(queueCounter(1u-src),queueGroups(1u-src),queueBase(1u-src),node.firstChild,node.childCount);return;}
 spanAppend(candCounter(),candGroups(),candBase(),node.firstPage,node.pageCount);
}
@compute @workgroup_size(64)
fn dagLevel0(@builtin(global_invocation_id) id:vec3u){levelStep(0u,id.x);}
@compute @workgroup_size(64)
fn dagLevel1(@builtin(global_invocation_id) id:vec3u){levelStep(1u,id.x);}
`;

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
export function ressourcesAvant(device, module, layout, packed, readbackBytes) {
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
  const tampon = (taille, source, usage = STORAGE) => {
    const buffer = device.createBuffer({ size: Math.max(taille, source?.byteLength ?? 0), usage });
    if (source) device.queue.writeBuffer(buffer, 0, source);
    return buffer;
  };
  const buffers = [
    tampon(64, packed.clusters),
    tampon(64, packed.nodes),
    tampon(SELECTION_UNIFORM_BYTES, null, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    tampon(Math.max(16, (packed.nodeCount * 2 + pageCount * 4) * 4)),
    tampon(readbackBytes),
    tampon(Math.max(8, (base + 10) * 4)),
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
  const etape = (entryPoint) =>
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

/** Encoding of a frame as `gpuDagEncode.ts` wrote it at `develop`, resident cut. */
export function encodeAvant(encoder, r, profondeur = r.levelCount) {
  const { bindGroup, dispatchArgs, work, zeros, noyaux, niveaux } = r;
  const groupes = (n) => Math.max(1, Math.ceil(n / SELECTION_WORKGROUP));
  const arme = (octets) => encoder.copyBufferToBuffer(work, octets, dispatchArgs, 0, 4);
  const seule = (pipeline) => {
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
  const surListe = (pipeline) => {
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
