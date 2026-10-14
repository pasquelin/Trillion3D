import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { ceilDivWgsl, highHalf, lowHalf } from '../../../math/src/wgsl/integer.ts'
import type { VsmLayout } from './layout.ts'
import { VSM_TRANSMISSION_FORMAT, VSM_TRANSMISSION_WIDTH } from './transmissionLayout.ts'
import { VSM_TRANSMISSION_COVER_WGSL } from './transmissionGeometryWgsl.ts'
import {
  CELL_COUNT,
  CLOCKWISE_BIT,
  RECORDS_TEXEL,
  TEXTURED_BIT,
  VSM_TRANSMISSION_CELLS,
  VSM_TRANSMISSION_CHAIN,
  VSM_TRANSMISSION_PAGE_GROUP,
  frameWgsl,
  transmissionTablesWgsl,
} from './transmissionShared.ts'

/**
 * `vsmTransmissionResolve`, a group of 256 per slice numbered this frame, a thread per cell: its
 * records read from the order into the group's memory, 256 at a time; each cell counts those that
 * may cover it (the record's cell range, then \`vsmTCoversCell\`); a prefix sum places the lists
 * after the records; the slice takes ⌈texels / 512⌉ blocks from the pool and chains them; the
 * cell headers, the chain and the lists (each entry its record's texel in the slice, in the order)
 * are written, then the records (a thread each) and their patches. A slice past
 * \`VSM_TRANSMISSION_CHAIN\` blocks (\`full\`), or one the pool cannot hold (\`blocksShort\`, its
 * blocks), is counted and left without (its shadow uncoloured this frame; the host grows the pool
 * and redraws the world).
 * \`vsmTransmissionHeaders\`, a thread per dirty slice: its page header texel from the table.
 * Group 0: 0 frame uniform, 1 build buffer, 2 table, 3 pool, 4 links, 5 the memory (storage).
 */
export const vsmTransmissionResolveWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(0) @binding(0) var<uniform> frame:VsmTransmissionFrame;
@group(0) @binding(1) var<storage,read_write> build:array<atomic<u32>>;
fn vsmTBuild(i:u32)->u32{return atomicLoad(&build[i]);}
@group(0) @binding(5) var memory:texture_storage_2d<${VSM_TRANSMISSION_FORMAT},write>;
/** A record as the cells read it: its corners in page texels and its cells (\`vsmTCellsWord\`). */
struct VsmTStaged{a:vec2f,b:vec2f,c:vec2f,cells:u32,}
var<workgroup> staged:array<VsmTStaged,${CELL_COUNT}>;
var<workgroup> sums:array<u32,${CELL_COUNT}>;
var<workgroup> counts:array<u32,${CELL_COUNT}>;
var<workgroup> chain:array<u32,${VSM_TRANSMISSION_CHAIN}>;
var<workgroup> held:array<u32,3>;
/** Slice texel \`v\` in the memory, through the workgroup's chain. */
fn vsmTAt(v:u32)->vec2u{return vsmTBlockTexel(chain[v/VSM_T_BLOCK_TEXELS],v%VSM_T_BLOCK_TEXELS);}
fn vsmTRecordWord(g:u32,w:u32)->u32{return vsmTBuild(frame.regionRecords+g*VSM_T_RECORD_WORDS+w);}
/** Record \`batch + lane\` of the slice into the group's memory. */
fn vsmTStage(first:u32,batch:u32,records:u32,lane:u32){
 if(batch+lane>=records){return;}
 let g=vsmTBuild(VSM_T_ORDER+first+batch+lane);
 let f=vec4f(bitcast<f32>(vsmTRecordWord(g,0u)),bitcast<f32>(vsmTRecordWord(g,1u)),bitcast<f32>(vsmTRecordWord(g,2u)),bitcast<f32>(vsmTRecordWord(g,3u)));
 staged[lane]=VsmTStaged(f.xy,f.zw,vec2f(bitcast<f32>(vsmTRecordWord(g,4u)),bitcast<f32>(vsmTRecordWord(g,5u))),vsmTRecordWord(g,19u));
}
/** Whether staged record \`s\` may cover \`cell\`: within its range, then the bin's cover test. */
fn vsmTCovered(s:VsmTStaged,cell:vec2u)->bool{
 let r=vec4u(s.cells&15u,(s.cells>>4u)&15u,(s.cells>>8u)&15u,(s.cells>>12u)&15u);
 if(any(cell<r.xy)||any(cell>r.zw)){return false;}
 return vsmTCoversCell(s.a,s.b,s.c,select(1.0,-1.0,(s.cells&${CLOCKWISE_BIT}u)!=0u),vec2f(cell));
}
/** Record \`g\`, the slice's \`i\`th, into its four texels; its patch after the lists. */
fn vsmTCopy(g:u32,i:u32,patches:u32){
 let v=VSM_T_RECORDS_TEXEL+4u*i;
 let textured=(vsmTRecordWord(g,10u)&${TEXTURED_BIT}u)!=0u;
 let patchWord=4u*patches+vsmTRecordWord(g,12u);
 for(var t=0u;t<4u;t++){
  var w=vec4u(vsmTRecordWord(g,4u*t),vsmTRecordWord(g,4u*t+1u),vsmTRecordWord(g,4u*t+2u),vsmTRecordWord(g,4u*t+3u));
  if(t==3u){w.x=select(0u,patchWord,textured);}
  textureStore(memory,vsmTAt(v+t),w);
 }
 if(!textured){return;}
 let size=vsmTRecordWord(g,14u);
 let words=lowHalf(size)*highHalf(size);
 let source=frame.regionPatches+vsmTRecordWord(g,18u);
 for(var j=0u;j<words;j+=4u){
  var w=vec4u(0u);
  for(var c=0u;c<4u;c++){if(j+c<words){w[c]=vsmTBuild(source+j+c);}}
  textureStore(memory,vsmTAt((patchWord+j)/4u),w);
 }
}
@compute @workgroup_size(${CELL_COUNT}) fn vsmTransmissionResolve(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let k=flatIndex(wid,nwg,1u);
 if(lane==0u){
  held[0]=0u;held[1]=0u;
  if(k<vsmTBuild(VSM_TC_SLICES)){held[1]=vsmTBuild(VSM_T_KEYS+k);held[0]=vsmTBuild(VSM_T_COUNTS+held[1]);}
 }
 let records=workgroupUniformLoad(&held[0]);
 if(records==0u){return;}
 let key=held[1];
 let first=vsmTBuild(VSM_T_FIRST+key);
 let cell=vec2u(lane%${VSM_TRANSMISSION_CELLS}u,lane/${VSM_TRANSMISSION_CELLS}u);
 // This cell's records, counted.
 var count=0u;
 for(var batch=0u;batch<records;batch+=${CELL_COUNT}u){
  vsmTStage(first,batch,records,lane);
  workgroupBarrier();
  let n=min(${CELL_COUNT}u,records-batch);
  for(var j=0u;j<n;j++){if(vsmTCovered(staged[j],cell)){count++;}}
  workgroupBarrier();
 }
 count=min(count,0xFFFFu);
 let texels=ceilDiv(count,4u);
 counts[lane]=count;
 sums[lane]=texels;
 workgroupBarrier();
 for(var d=1u;d<${CELL_COUNT}u;d<<=1u){
  var add=0u;
  if(lane>=d){add=sums[lane-d];}
  workgroupBarrier();
  sums[lane]+=add;
  workgroupBarrier();
 }
 let lists=VSM_T_RECORDS_TEXEL+4u*records;
 let patches=lists+sums[${CELL_COUNT - 1}u];
 let total=patches+ceilDiv(vsmTBuild(VSM_T_PATCH+key),4u);
 let blocks=ceilDiv(total,VSM_T_BLOCK_TEXELS);
 if(lane==0u){
  held[2]=0u;
  if(blocks>VSM_T_CHAIN){atomicAdd(&build[VSM_TC_FULL],1u);}
  else{
   // Taken by compare-exchange: a count never moves below what is free, so a group that finds
   // the pool short leaves it as it was and every group that takes gets its own blocks.
   var free=atomicLoad(&pool[0]);
   loop{
    if(free<blocks){break;}
    let r=atomicCompareExchangeWeak(&pool[0],free,free-blocks);
    if(r.exchanged){held[2]=1u;break;}
    free=r.old_value;
   }
   if(held[2]==0u){atomicAdd(&build[VSM_TC_BLOCKSSHORT],blocks);}
   else{
    for(var j=0u;j<VSM_T_CHAIN;j++){
     var b=${NO_INDEX}u;
     if(j<blocks){b=atomicLoad(&pool[2u+free-blocks+j]);}
     chain[j]=b;
    }
    for(var j=0u;j<blocks;j++){
     var next=${NO_INDEX}u;
     if(j+1u<blocks){next=chain[j+1u];}
     links[chain[j]]=next;
    }
    table[key]=chain[0];
   }
  }
 }
 if(workgroupUniformLoad(&held[2])==0u){return;}
 // The cell headers, four a texel (first texel of the list << 16 | its count), and the chain.
 if(lane<${CELL_COUNT / 4}u){
  var h=vec4u(0u);
  for(var c=0u;c<4u;c++){
   let at=4u*lane+c;
   h[c]=((lists+sums[at]-ceilDiv(counts[at],4u))<<16u)|counts[at];
  }
  textureStore(memory,vsmTAt(lane),h);
 }else if(lane<${RECORDS_TEXEL}u){
  let j=4u*(lane-${CELL_COUNT / 4}u);
  textureStore(memory,vsmTAt(lane),vec4u(chain[j],chain[j+1u],chain[j+2u],chain[j+3u]));
 }
 // This cell's list: each entry its record's first texel, padded to a texel. One batch of
 // records is still staged from the count.
 var at=lists+sums[lane]-texels;
 var entry=vec4u(0u);var filled=0u;var left=count;
 for(var batch=0u;batch<records;batch+=${CELL_COUNT}u){
  if(records>${CELL_COUNT}u){vsmTStage(first,batch,records,lane);}
  workgroupBarrier();
  let n=min(${CELL_COUNT}u,records-batch);
  for(var j=0u;j<n&&left>0u;j++){
   if(!vsmTCovered(staged[j],cell)){continue;}
   entry[filled]=VSM_T_RECORDS_TEXEL+4u*(batch+j);
   filled++;left--;
   if(filled==4u||left==0u){textureStore(memory,vsmTAt(at),entry);at++;filled=0u;entry=vec4u(0u);}
  }
  workgroupBarrier();
 }
 for(var i=lane;i<records;i+=${CELL_COUNT}u){vsmTCopy(vsmTBuild(VSM_T_ORDER+first+i),i,patches);}
}
@compute @workgroup_size(${VSM_TRANSMISSION_PAGE_GROUP}) fn vsmTransmissionHeaders(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=flatIndex(wid,nwg,1u)*${VSM_TRANSMISSION_PAGE_GROUP}u+lane;
 if(i>=vsmTBuild(VSM_TC_DIRTY)){return;}
 let t=vsmTBuild(VSM_T_DIRTY+i)>>2u;
 let w=vec4u(table[4u*t],table[4u*t+1u],table[4u*t+2u],table[4u*t+3u]);
 textureStore(memory,vec2u(t%${VSM_TRANSMISSION_WIDTH}u,t/${VSM_TRANSMISSION_WIDTH}u),w);
}
`,
    [
      frameWgsl(layout),
      transmissionTablesWgsl(0, 2),
      VSM_TRANSMISSION_COVER_WGSL,
      ceilDivWgsl,
      lowHalf,
      highHalf,
    ],
  )
