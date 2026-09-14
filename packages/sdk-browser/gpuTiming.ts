import type {GpuFrameMs,GpuPassTimings} from '../sdk-core/index.ts';
/**
 * GPU durations pass by pass, from `timestamp-query`. One image may span several command encoders —
 * the selection dispatch is submitted before the render encoder — so a sample collects every part of
 * the same image and closes when the caller submits the last one. The readback never blocks an image:
 * the sample is handed to `onSample` when the mapping resolves, which is later than the image it
 * describes. `totalMs` sums the listed passes and nothing else; it is never added to a CPU duration.
 * `frameMs` is the enclosing span instead — earliest beginning to latest end over every part — so a
 * device that runs passes concurrently, where the sum overcounts, still yields one honest duration.
 */
export type GpuTimingSample=GpuPassTimings&{frameMs:GpuFrameMs;[key:string]:unknown};
/** Query slots per encoder part, and parts per image: the query set holds `PARTS × PART_QUERIES`. */
const PART_QUERIES=128,PARTS=4;
export function createGpuTiming(device:GPUDevice,options:{sampleEveryFrames?:number;onSample:(sample:GpuTimingSample)=>void}){
 const maxPasses=PART_QUERIES/2,queryCount=PART_QUERIES*PARTS,bytes=queryCount*8;
 const sampleEveryFrames=Math.max(1,Math.floor(options.sampleEveryFrames??60));
 let enabled=!!device.features?.has('timestamp-query'),disposed=false,lastFrame=-sampleEveryFrames;
 let query:GPUQuerySet|undefined,resolve:GPUBuffer|undefined,read:GPUBuffer|undefined;
 type Part={slot:number;names:string[];resolved:boolean};
 let active:{frame:number;parts:Map<GPUCommandEncoder,Part>;truncated:boolean}|undefined;
 let pending:Promise<void>|undefined;
 let sampledFrames=0,completedSamples=0,droppedSamples=0,invalidSamples=0,unresolvedParts=0;
 const skippedFrames={unsupported:0,interval:0,busy:0,disposed:0,parts:0};
 const emit=(sample:GpuTimingSample)=>{try{options.onSample({source:'timestamp-query',...sample});}catch{/* Diagnostic observers do not control timing. */}};
 const destroy=()=>{query?.destroy();resolve?.destroy();read?.destroy();query=undefined;resolve=undefined;read=undefined;};
 const timing={
  get supported(){return enabled&&!disposed;},
  isSampled(encoder:GPUCommandEncoder){return !!active?.parts.has(encoder);},
  createEncoder(frame:number):GPUCommandEncoder{
   const encoder=device.createCommandEncoder();
   if(disposed){skippedFrames.disposed++;return encoder;}
   if(!enabled){skippedFrames.unsupported++;return encoder;}
   // A frame left open never got its closing submission; it is dropped rather than mixed into this one.
   if(active&&active.frame!==frame){active=undefined;droppedSamples++;}
   if(!active){
    if(frame-lastFrame<sampleEveryFrames){skippedFrames.interval++;return encoder;}
    if(pending){droppedSamples++;skippedFrames.busy++;return encoder;}
    try{
     if(!query){
      query=device.createQuerySet({type:'timestamp',count:queryCount});
      resolve=device.createBuffer({label:'WG timestamp resolve',size:bytes,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
      read=device.createBuffer({label:'WG timestamp readback',size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     }
    }catch(error){enabled=false;destroy();emit({frame,totalMs:null,frameMs:null,passes:[],truncated:false,error:String(error)});return encoder;}
    active={frame,parts:new Map(),truncated:false};lastFrame=frame;sampledFrames++;
   }
   const state=active;
   if(state.parts.size>=PARTS){state.truncated=true;skippedFrames.parts++;return encoder;}
   const part:Part={slot:state.parts.size,names:[],resolved:false};
   const wrapper=new Proxy(encoder,{
    get(target,key){
     if(key==='beginRenderPass'||key==='beginComputePass')return (descriptor:GPURenderPassDescriptor|GPUComputePassDescriptor={})=>{
      let instrumented=descriptor;
      if(part.names.length<maxPasses&&!descriptor.timestampWrites){
       const index=part.slot*PART_QUERIES+part.names.length*2;
       part.names.push(descriptor.label??String(key));
       instrumented={...descriptor,timestampWrites:{querySet:query!,beginningOfPassWriteIndex:index,endOfPassWriteIndex:index+1}};
      }
      else state.truncated=true;
      return key==='beginRenderPass'?target.beginRenderPass(instrumented as GPURenderPassDescriptor):target.beginComputePass(instrumented);
     };
     if(key==='finish')return (descriptor?:GPUCommandBufferDescriptor)=>{
      if(part.names.length){
       const base=part.slot*PART_QUERIES;
       target.resolveQuerySet(query!,base,part.names.length*2,resolve!,base*8);
       target.copyBufferToBuffer(resolve!,base*8,read!,base*8,part.names.length*16);
       part.resolved=true;
      }
      return target.finish(descriptor);
     };
     const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },
   });
   state.parts.set(wrapper,part);
   return wrapper;
  },
  /** Closes the image: `encoder` is its last submission, and every part resolved so far is read. */
  submitted(encoder:GPUCommandEncoder,metadata:Record<string,unknown>){
   const state=active;
   if(!state||!state.parts.has(encoder))return;
   active=undefined;
   const parts=[...state.parts.values()].sort((a,b)=>a.slot-b.slot);
   let truncated=state.truncated;
   const entries:Array<{slot:number;name:string;part:number}>=[];
   for(const part of parts){
    if(!part.resolved){if(part.names.length){truncated=true;unresolvedParts++;}continue;}
    for(let i=0;i<part.names.length;i++)entries.push({slot:part.slot*PART_QUERIES+i*2,name:part.names[i],part:part.slot});
   }
   if(!entries.length||!read)return;
   const staging=read;
   pending=(async()=>{
    try{
     await staging.mapAsync(GPUMapMode.READ);if(disposed)return;
     const values=new BigUint64Array(staging.getMappedRange());
     // The enclosing span of the image, and of each submission inside it, come from these same
     // timestamps: the earliest beginning to the latest end. Passes the device overlaps are covered
     // once, which a sum of durations cannot claim.
     let firstBegin=0n,lastEnd=0n,spanValid=true;
     const submissionSpans=new Map<number,{beginNs:bigint;endNs:bigint;passes:number}>();
     const passes=entries.map(entry=>{
      const begin=values[entry.slot],end=values[entry.slot+1];
      if(begin===0n||end===0n||end<begin){invalidSamples++;spanValid=false;return {name:entry.name,gpuMs:null,reason:'invalid-timestamps',beginNs:begin.toString(),endNs:end.toString()};}
      if(firstBegin===0n||begin<firstBegin)firstBegin=begin;
      if(end>lastEnd)lastEnd=end;
      const span=submissionSpans.get(entry.part);
      if(!span)submissionSpans.set(entry.part,{beginNs:begin,endNs:end,passes:1});
      else{if(begin<span.beginNs)span.beginNs=begin;if(end>span.endNs)span.endNs=end;span.passes++;}
      return {name:entry.name,gpuMs:Number(end-begin)/1e6};
     });
     const total=truncated||passes.some(pass=>pass.gpuMs===null)?null:passes.reduce((sum,pass)=>sum+pass.gpuMs!,0);
     const frameMs=truncated||!spanValid||firstBegin===0n?null:Number(lastEnd-firstBegin)/1e6;
     const submissions=[...submissionSpans].sort((a,b)=>a[0]-b[0]).map(([part,span])=>({part,passes:span.passes,spanMs:Number(span.endNs-span.beginNs)/1e6}));
     const hostGapMs=frameMs===null?null:frameMs-submissions.reduce((sum,span)=>sum+span.spanMs,0);
     emit({...metadata,frame:state.frame,totalMs:total,frameMs,submissions,hostGapMs,passes,truncated});completedSamples++;
    }catch(error){if(!disposed){enabled=false;emit({...metadata,frame:state.frame,totalMs:null,frameMs:null,passes:[],truncated,error:String(error)});completedSamples++;}}
    finally{try{staging.unmap();}catch{/* Disposal or device loss can cancel a mapping. */}}
   })().finally(()=>{pending=undefined;});
  },
  cancelUnsubmitted(){if(active){active=undefined;droppedSamples++;}},
  async flush(){await pending;},
  stats(){return {supported:enabled&&!disposed,reason:disposed?'disposed':enabled?'':'timestamp-query-unavailable',sampleEveryFrames,sampledFrames,completedSamples,droppedSamples,invalidSamples,unresolvedParts,skippedFrames:{...skippedFrames},pending:pending?1:0,maxPending:1,maxPasses,maxParts:PARTS,queryCount};},
  dispose(){disposed=true;active=undefined;destroy();},
 };
 return timing;
}
