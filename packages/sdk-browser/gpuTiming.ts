/** Bounded pass timestamps. Sum of timed passes is not end-to-end frame latency. */
export type GpuTimingSample={version:1;frame:number;sumPassMs:number|null;passes:Array<{name:string;gpuMs:number|null;reason?:string}>;truncated:boolean;error?:string;[key:string]:unknown};
export function createGpuTiming(device:GPUDevice,options:{sampleEveryFrames?:number;onSample?:(sample:GpuTimingSample)=>void;retainSamples?:boolean}={}){
 const maxPasses=64,bytes=maxPasses*2*8;
 const sampleEveryFrames=Math.max(1,Math.floor(options.sampleEveryFrames??60));
 let enabled=!!device.features?.has('timestamp-query'),disposed=false,lastFrame=-60;
 let query:GPUQuerySet|undefined,resolve:GPUBuffer|undefined,read:GPUBuffer|undefined;
 let active:{encoder:GPUCommandEncoder;frame:number;names:string[];truncated:boolean;finished:boolean}|undefined;
 let pending:Promise<void>|undefined;
 const samples:GpuTimingSample[]=[];
 let sampledFrames=0,completedSamples=0,droppedSamples=0,droppedOutputSamples=0,invalidSamples=0;
 const skippedFrames:{unsupported:number;interval:number;busy:number;disposed:number}={unsupported:0,interval:0,busy:0,disposed:0};
 const enqueue=(sample:GpuTimingSample)=>{const output={source:'timestamp-query',...sample};try{options.onSample?.(output);}catch{/* Diagnostic observers do not control timing. */}if(options.retainSamples!==false){if(samples.length===8){samples.shift();droppedOutputSamples++;}samples.push(output);}};
 const destroy=()=>{query?.destroy();resolve?.destroy();read?.destroy();query=undefined;resolve=undefined;read=undefined;};
 return {
  get supported(){return enabled&&!disposed;},
  isSampled(encoder:GPUCommandEncoder){return active?.encoder===encoder;},
  createEncoder(frame:number):GPUCommandEncoder{
   const encoder=device.createCommandEncoder();
   if(disposed){skippedFrames.disposed++;return encoder;}
   if(!enabled){skippedFrames.unsupported++;return encoder;}
   if(frame-lastFrame<sampleEveryFrames){skippedFrames.interval++;return encoder;}
   if(active||pending){droppedSamples++;skippedFrames.busy++;return encoder;}
   sampledFrames++;
   try{
    if(!query){query=device.createQuerySet({type:'timestamp',count:maxPasses*2});resolve=device.createBuffer({label:'WG timestamp resolve',size:bytes,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});read=device.createBuffer({label:'WG timestamp readback',size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});}
   }catch(error){enabled=false;destroy();enqueue({version:1,frame,sumPassMs:null,passes:[],truncated:false,error:String(error)});return encoder;}
   const state={encoder,frame,names:[] as string[],truncated:false,finished:false};lastFrame=frame;
   const wrapper=new Proxy(encoder,{
    get(target,key){
     if(key==='beginRenderPass'||key==='beginComputePass')return (descriptor:GPURenderPassDescriptor|GPUComputePassDescriptor={})=>{
      let instrumented=descriptor;
      if(state.names.length<maxPasses&&!descriptor.timestampWrites){const index=state.names.length*2;state.names.push(descriptor.label??String(key));instrumented={...descriptor,timestampWrites:{querySet:query!,beginningOfPassWriteIndex:index,endOfPassWriteIndex:index+1}};}
      else state.truncated=true;
      return key==='beginRenderPass'?target.beginRenderPass(instrumented as GPURenderPassDescriptor):target.beginComputePass(instrumented);
     };
     if(key==='finish')return (descriptor?:GPUCommandBufferDescriptor)=>{
      if(state.names.length){target.resolveQuerySet(query!,0,state.names.length*2,resolve!,0);target.copyBufferToBuffer(resolve!,0,read!,0,state.names.length*16);}
      const command=target.finish(descriptor);state.finished=true;return command;
     };
     const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    },
   });
   state.encoder=wrapper;active=state;return wrapper;
  },
  submitted(encoder:GPUCommandEncoder,metadata:Record<string,unknown>){
   if(!active||active.encoder!==encoder||!active.finished)return;
   const state=active;active=undefined;
   if(!state.names.length||!read)return;
   const staging=read;
   pending=(async()=>{
    try{
     await staging.mapAsync(GPUMapMode.READ);if(disposed)return;
     const values=new BigUint64Array(staging.getMappedRange());
     const passes=state.names.map((name,i)=>{const begin=values[i*2],end=values[i*2+1];if(begin===0n||end===0n||end<begin){invalidSamples++;return {name,gpuMs:null,reason:'invalid-timestamps',beginNs:begin.toString(),endNs:end.toString()};}return {name,gpuMs:Number(end-begin)/1e6};});
     enqueue({...metadata,version:1,frame:state.frame,sumPassMs:state.truncated||passes.some(p=>p.gpuMs===null)?null:passes.reduce((sum,p)=>sum+p.gpuMs!,0),passes,truncated:state.truncated});completedSamples++;
    }catch(error){if(!disposed){enabled=false;enqueue({...metadata,version:1,frame:state.frame,sumPassMs:null,passes:[],truncated:state.truncated,error:String(error)});completedSamples++;}}
    finally{try{staging.unmap();}catch{/* Disposal/device loss can cancel a mapping. */}}
   })().finally(()=>{pending=undefined;});
  },
  cancelUnsubmitted(){active=undefined;},
  async flush(){await pending;},
  drain(){return samples.splice(0);},
  stats(){return {supported:enabled&&!disposed,reason:disposed?'disposed':enabled?'':'timestamp-query-unavailable',sampleEveryFrames,sampledFrames,completedSamples,droppedSamples,droppedOutputSamples,invalidSamples,skippedFrames:{...skippedFrames},pending:pending?1:0,maxPending:1,maxPasses,sampleCount:samples.length};},
  dispose(){disposed=true;active=undefined;samples.length=0;destroy();},
 };
}
