/**
 * La coupe d'AVANT le lot « sélection persistante », recopiée entière : son noyau de descente, la
 * disposition de son tampon de travail, ses tampons et son encodage. Deux files en bascule, dont le
 * compteur ne peut repartir de zéro que par une copie du processeur, et un armement de l'argument
 * indirect par niveau.
 *
 * C'est l'ORACLE de `coupe-lancements-gpu.mjs`. Il est recopié — et non importé — pour la raison qui
 * fait un oracle : il doit rester ce que le dépôt faisait à `develop`, quoi qu'il advienne du code
 * livré. Le côté livré, lui, n'est jamais recopié : le banc appelle `encodeDagKernels` et
 * `createDagResources` pour de vrai, sans quoi il mesurerait une copie de la coupe au lieu d'elle.
 *
 * Ses décalages dans `work` sont ceux d'avant : chaque file porte un compteur ET un compte de
 * groupes, puisqu'elle était lue indirectement, et tout ce qui les suit s'en trouve décalé.
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
/** L'indice du nœud racine de la primitive, déposé une fois pour toutes derrière son étirement. */
fn rootOf(w:u32)->u32{return bitcast<u32>(frames[w*FRAME+6u].y);}
/** Un ajout de plage : le compte de groupes suit l'ouverture de chaque tranche de soixante-quatre,
 *  donc vaut exactement \`ceil(total/64)\` sans qu'un noyau d'un seul fil le tire après coup. */
fn spanAppend(counter:u32,groups:u32,base:u32,first:u32,count:u32){
 let at=atomicAdd(&work[counter],count);
 for(var k=0u;k<count;k++){
  flags[base+at+k]=first+k;
  if(((at+k)&63u)==0u){atomicAdd(&work[groups],1u);}
 }
}
fn drawnAppend(page:u32){spanAppend(drawnCounter(),drawnGroups(),candBase(),page,1u);}
/** Les compteurs de l'image, remis à zéro par un seul fil. La file 0 compte déjà ses racines : un
 *  fil par primitive vient d'y déposer la sienne, à son propre rang, sans compteur à disputer. */
fn resetCounters(){
 atomicStore(&work[liveCounter()],0u);atomicStore(&work[liveGroups()],0u);
 atomicStore(&work[queueCounter(0u)],uni.worldCount);atomicStore(&work[queueGroups(0u)],(uni.worldCount+63u)/64u);
 atomicStore(&work[queueCounter(1u)],0u);atomicStore(&work[queueGroups(1u)],0u);
 atomicStore(&work[candCounter()],0u);atomicStore(&work[candGroups()],0u);
 atomicStore(&work[drawnCounter()],0u);atomicStore(&work[drawnGroups()],0u);
}
/** Les dessinées de l'image précédente, remises à zéro par plage : les seules pages dont le drapeau
 *  de dessin puisse valoir un. Aucune autre n'est visitée, et aucune n'est parcourue en entier. */
@compute @workgroup_size(64)
fn dagClearDrawn(@builtin(global_invocation_id) id:vec3u){
 let s=id.x;if(s>=atomicLoad(&work[drawnCounter()])){return;}
 flags[uni.nodeCount+flags[candBase()+s]]=0u;
}
/** Un nœud de la file \`src\` : rejeté, il n'engendre rien ; retenu, il dépose ses enfants dans la
 *  file opposée, ou ses pages dans la liste des candidates quand c'est une feuille. */
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

/** Les tampons, les étapes et les décalages de la coupe d'avant, montés sur le `packed` du banc. */
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

/** L'encodage d'une image tel que `gpuDagEncode.ts` l'écrivait à `develop`, coupe résidente. */
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
