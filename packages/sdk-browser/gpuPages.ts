import type {PageSource} from '../sdk-core/index.ts';
export interface ResidentPage {key:string;slot:number;offset:number;bytes:number;generation:number}
/** WebGPU allocation/queue boundary. Page bytes and policy are supplied by the host. Queue writes are ordered; dispose waits for in-flight submits before destroy. */
export function createGpuPageCache(device:GPUDevice,source:PageSource,options:{pageBytes:number;slots:number}){
 const {pageBytes,slots}=options,size=pageBytes*slots;
 if(!Number.isSafeInteger(pageBytes)||pageBytes<4||pageBytes%4||!Number.isSafeInteger(slots)||slots<1||size>device.limits.maxBufferSize)throw new Error('INVALID_PAGE_BUDGET');
 if(device.limits.maxStorageBufferBindingSize!==undefined&&size>device.limits.maxStorageBufferBindingSize)throw new Error('INVALID_PAGE_BUDGET');
 const buffer=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
 const resident=new Map<string,ResidentPage>(),pins=new Set<string>(),free=Array.from({length:slots},(_,i)=>i),staging=new Uint8Array(pageBytes),abort=new AbortController();
 const fetches=new Map<string,Promise<Uint8Array>>();
 let pending:Promise<unknown>=Promise.resolve(),disposed=false,generation=0,bytesRead=0,uploadedBytes=0,evictions=0;
 const check=(signal?:AbortSignal)=>{if(disposed)throw new Error('PAGE_CACHE_DISPOSED');signal?.throwIfAborted();};
 const fetchBytes=(key:string,combined:AbortSignal)=>{
  let job=fetches.get(key);
  if(!job){job=source.read(key,combined);fetches.set(key,job);void job.catch(()=>{});}
  return job;
 };
 return {buffer,
  load(key:string,signal?:AbortSignal):Promise<ResidentPage>{const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;const fetched=(!disposed&&!resident.has(key))?fetchBytes(key,combined):undefined;const operation=pending.then(async()=>{try{check(combined);const existing=resident.get(key);if(existing){resident.delete(key);resident.set(key,existing);return existing;}
    let bytes:Uint8Array;
    try{bytes=await(fetched??fetchBytes(key,combined));}catch(err){if(!combined.aborted&&!disposed)bytes=await source.read(key,combined);else throw err;}
    check(combined);if(bytes.byteLength>pageBytes||bytes.byteLength===0)throw new Error('PAGE_SIZE_MISMATCH');bytesRead+=bytes.byteLength;
    let slot=free.pop();
    if(slot===undefined){let victim:ResidentPage|undefined;for(const page of resident.values()){if(!pins.has(page.key)){victim=page;break;}}if(!victim)throw new Error('ALL_PAGES_PINNED');resident.delete(victim.key);slot=victim.slot;evictions++;}
    staging.fill(0,bytes.byteLength);staging.set(bytes);device.queue.writeBuffer(buffer,slot*pageBytes,staging);uploadedBytes+=pageBytes;
    const page={key,slot,offset:slot*pageBytes,bytes:bytes.byteLength,generation:++generation};resident.set(key,page);return page;
   }finally{fetches.delete(key);}});pending=operation.catch(()=>{});return operation;},
  get(key:string){return resident.get(key);},pin(key:string){check();if(!resident.has(key))throw new Error('PAGE_NOT_RESIDENT');pins.add(key);},unpin(key:string){pins.delete(key);},
  stats(){return {allocatedBytes:size,residentPages:resident.size,bytesRead,uploadedBytes,evictions,physicalVramBytes:null};},
  dispose(){if(disposed)return pending.then(()=>{});disposed=true;abort.abort();resident.clear();pins.clear();pending=pending.catch(()=>{}).then(async()=>{try{await device.queue.onSubmittedWorkDone();}catch{/* Queue may already be lost. */}buffer.destroy();});return pending;},
 };
}
export function httpPageSource(baseUrl:string):PageSource{return {async read(key,signal){const response=await fetch(new URL(key,baseUrl),{signal});if(!response.ok)throw new Error(`PAGE_HTTP_${response.status}`);return new Uint8Array(await response.arrayBuffer());}};}
