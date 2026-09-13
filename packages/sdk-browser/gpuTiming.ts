/** Bounded pass timestamps. Sum of timed passes is not end-to-end frame latency. */
export type GpuTimingSample={version:1;frame:number;sumPassMs:number|null;passes:Array<{name:string;gpuMs:number|null;reason?:string}>;truncated:boolean;error?:string;[key:string]:unknown};
export function createGpuTiming(device:GPUDevice){
 const maxPasses=64,bytes=maxPasses*2*8;
 let enabled=!!device.features?.has('timestamp-query'),disposed=false,lastFrame=-60;
 let query:GPUQuerySet|undefined,resolve:GPUBuffer|undefined,read:GPUBuffer|undefined;
 let active:{encoder:GPUCommandEncoder;frame:number;names:string[];truncated:boolean;finished:boolean}|undefined;
 let pending:Promise<void>|undefined;
 const samples:GpuTimingSample[]=[];
 const enqueue=(sample:GpuTimingSample)=>{if(samples.length===8)samples.shift();samples.push(sample);};
 const destroy=()=>{query?.destroy();resolve?.destroy();read?.destroy();query=undefined;resolve=undefined;read=undefined;};
 return {
  get supported(){return enabled&&!disposed;},
  isSampled(encoder:GPUCommandEncoder){return active?.encoder===encoder;},
  createEncoder(frame:number):GPUCommandEncoder{
   const encoder=device.createCommandEncoder();
   if(!enabled||disposed||active||pending||frame-lastFrame<60)return encoder;
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
     const passes=state.names.map((name,i)=>{const begin=values[i*2],end=values[i*2+1];if(begin===0n||end===0n||end<begin)return {name,gpuMs:null,reason:'invalid-timestamps',beginNs:begin.toString(),endNs:end.toString()};return {name,gpuMs:Number(end-begin)/1e6};});
     enqueue({...metadata,version:1,frame:state.frame,sumPassMs:state.truncated||passes.some(p=>p.gpuMs===null)?null:passes.reduce((sum,p)=>sum+p.gpuMs!,0),passes,truncated:state.truncated});
    }catch(error){if(!disposed){enabled=false;enqueue({...metadata,version:1,frame:state.frame,sumPassMs:null,passes:[],truncated:state.truncated,error:String(error)});}}
    finally{try{staging.unmap();}catch{/* Disposal/device loss can cancel a mapping. */}}
   })().finally(()=>{pending=undefined;});
  },
  cancelUnsubmitted(){active=undefined;},
  async flush(){await pending;},
  drain(){return samples.splice(0);},
  dispose(){disposed=true;active=undefined;samples.length=0;destroy();},
 };
}
