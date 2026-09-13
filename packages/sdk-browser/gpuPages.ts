import type {PageSource} from '../sdk-core/index.ts';
import type {BackendDiagnostic} from './backendTypes.ts';
export interface ResidentPage {key:string;slot:number;offset:number;bytes:number;generation:number}
/** WebGPU allocation/queue boundary. Page bytes and policy are supplied by the host. Queue writes are ordered; dispose waits for in-flight submits before destroy. */
export function createGpuPageCache(device:GPUDevice,source:PageSource,options:{pageBytes:number;slots:number;onDiagnostic?:((diagnostic:BackendDiagnostic)=>void)}){
 const {pageBytes,slots}=options,size=pageBytes*slots;
 if(!Number.isSafeInteger(pageBytes)||pageBytes<4||pageBytes%4||!Number.isSafeInteger(slots)||slots<1||size>device.limits.maxBufferSize)throw new Error('INVALID_PAGE_BUDGET');
 if(device.limits.maxStorageBufferBindingSize!==undefined&&size>device.limits.maxStorageBufferBindingSize)throw new Error('INVALID_PAGE_BUDGET');
 const buffer=device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
 const resident=new Map<string,ResidentPage>(),pins=new Set<string>(),free=Array.from({length:slots},(_,i)=>i),staging=new Uint8Array(pageBytes),abort=new AbortController();
 const fetches=new Map<string,Promise<Uint8Array>>();
 let pending:Promise<unknown>=Promise.resolve(),disposed=false,generation=0,bytesRead=0,uploadedBytes=0,evictions=0,drawDetaches=0;
 const report=typeof options.onDiagnostic==='function'?options.onDiagnostic:undefined;
 const emit=(phase:string,message:string,context:()=>Record<string,unknown>)=>{
  if(!report)return;
  try{report({phase,message,context:context()});}catch{/* Diagnostic observers cannot affect the GPU cache. */}
 };
 const now=()=>report?performance.now():0;
 const statusOf=(error:unknown)=>{const match=String(error).match(/PAGE_HTTP_(\d{3})/);return match?Number(match[1]):null;};
 emit('gpu-page-catalogue','Cache GPU configuré',()=>({version:1,pageBytes,slots,allocatedBytes:size,source:'host-page-source',drawDetached:false}));
 const check=(signal?:AbortSignal)=>{if(disposed){emit('gpu-page-error','Opération refusée après dispose',()=>({version:1,error:'PAGE_CACHE_DISPOSED'}));throw new Error('PAGE_CACHE_DISPOSED');}signal?.throwIfAborted();};
 const readBytes=(key:string,combined:AbortSignal,attempt:number)=>{
  const started=now();
  emit('gpu-page-read-start','Lecture de page GPU démarrée',()=>({version:1,key,attempt}));
  emit('gpu-page-attempt-start','Tentative de lecture de page GPU',()=>({version:1,key,attempt,maxAttempts:2}));
  let raw:Promise<Uint8Array>;
  try{raw=source.read(key,combined);}catch(error){raw=Promise.reject(error);}
  const job=Promise.resolve(raw).then(bytes=>{
   emit('gpu-page-read-end','Lecture de page GPU terminée',()=>({version:1,key,attempt,status:null,expectedBytes:pageBytes,actualBytes:bytes.byteLength,durationMs:report?performance.now()-started:null}));
   emit('gpu-page-attempt-end','Tentative de lecture GPU réussie',()=>({version:1,key,attempt,status:null,expectedBytes:pageBytes,actualBytes:bytes.byteLength,durationMs:report?performance.now()-started:null}));
   return bytes;
  },error=>{
   emit('gpu-page-read-end','Lecture de page GPU échouée',()=>({version:1,key,attempt,status:statusOf(error),error:String(error),durationMs:report?performance.now()-started:null}));
   emit('gpu-page-attempt-end','Tentative de lecture GPU échouée',()=>({version:1,key,attempt,status:statusOf(error),error:String(error),durationMs:report?performance.now()-started:null}));
   throw error;
  });
  return job;
 };
 const fetchBytes=(key:string,combined:AbortSignal)=>{
  const existing=fetches.get(key);
  if(existing){emit('gpu-page-read-coalesced','Lecture GPU jointe à une demande en cours',()=>({version:1,key,loading:fetches.size}));return existing;}
  const job=readBytes(key,combined,1);fetches.set(key,job);void job.catch(()=>{});return job;
 };
 return {buffer,
  load(key:string,signal?:AbortSignal):Promise<ResidentPage>{const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;const abortListener=report&&signal?()=>emit('gpu-page-abort','Chargement GPU annulé',()=>({version:1,key,reason:String(signal.reason??'aborted')})):undefined;if(abortListener)signal?.addEventListener('abort',abortListener,{once:true});const requestStarted=now();emit('gpu-page-request','Demande de page GPU reçue',()=>({version:1,key,resident:resident.has(key),loading:fetches.has(key)}));const fetched=(!disposed&&!resident.has(key))?fetchBytes(key,combined):undefined;const operation=pending.then(async()=>{const queueStarted=now();try{check(combined);emit('gpu-page-queue-wait','Attente de la file CPU de chargement GPU terminée',()=>({version:1,key,durationMs:report?queueStarted-requestStarted:null}));const existing=resident.get(key);if(existing){resident.delete(key);resident.set(key,existing);emit('gpu-page-cache-hit','Page GPU déjà résidente',()=>({version:1,key,slot:existing.slot,generation:existing.generation,source:'resident-cache'}));return existing;}
    emit('gpu-page-cache-miss','Page absente de la résidence GPU',()=>({version:1,key,source:'page-source'}));
    let bytes:Uint8Array;
    try{bytes=await(fetched??fetchBytes(key,combined));}catch(err){if(!combined.aborted&&!disposed){emit('gpu-page-retry','Nouvelle lecture GPU après échec',()=>({version:1,key,attempt:1,nextAttempt:2,error:String(err)}));bytes=await readBytes(key,combined,2);}else throw err;}
    check(combined);if(bytes.byteLength>pageBytes||bytes.byteLength===0){emit('gpu-page-corruption','Taille de page GPU inattendue',()=>({version:1,key,reason:'page-size-mismatch',expectedBytes:pageBytes,actualBytes:bytes.byteLength}));emit('gpu-page-admission-blocked','Page refusée par la capacité d’un slot GPU',()=>({version:1,key,reason:'page-size-mismatch',expectedBytes:pageBytes,actualBytes:bytes.byteLength}));throw new Error('PAGE_SIZE_MISMATCH');}bytesRead+=bytes.byteLength;
    let slot=free.pop();
    if(slot===undefined){let victim:ResidentPage|undefined;for(const page of resident.values()){if(!pins.has(page.key)){victim=page;break;}}if(!victim){emit('gpu-page-admission-blocked','Aucun slot GPU évictable',()=>({version:1,key,reason:'all-pages-pinned',resident:resident.size,slots,pinned:pins.size}));throw new Error('ALL_PAGES_PINNED');}resident.delete(victim.key);slot=victim.slot;evictions++;emit('gpu-page-eviction','Page évictée de la résidence GPU',()=>({version:1,key:victim!.key,slot:victim!.slot,generation:victim!.generation,bytes:victim!.bytes,reason:'capacity',drawDetached:false}));}
    const uploadStarted=now();staging.fill(0,bytes.byteLength);staging.set(bytes);device.queue.writeBuffer(buffer,slot*pageBytes,staging);const uploadDurationMs=report?performance.now()-uploadStarted:null;uploadedBytes+=pageBytes;
    const page={key,slot,offset:slot*pageBytes,bytes:bytes.byteLength,generation:++generation};resident.set(key,page);emit('gpu-page-upload','Page écrite dans un slot GPU',()=>({version:1,key,slot,offset:slot*pageBytes,generation:page.generation,actualDataBytes:bytes.byteLength,uploadedBytes:pageBytes,uploadDurationMs,gpuMs:null,drawDetached:false}));emit('gpu-page-load-end','Chargement GPU terminé',()=>({version:1,key,slot,generation:page.generation,actualDataBytes:bytes.byteLength,uploadedBytes:pageBytes,durationMs:report?performance.now()-requestStarted:null}));return page;
   }catch(error){emit('gpu-page-error','Chargement GPU échoué',()=>({version:1,key,status:statusOf(error),aborted:combined.aborted,error:String(error),resident:resident.size,pinned:pins.size}));throw error;
   }finally{if(abortListener)signal?.removeEventListener('abort',abortListener);fetches.delete(key);}});pending=operation.catch(()=>{});return operation;},
  get(key:string){return resident.get(key);},pin(key:string){check();const page=resident.get(key);if(!page){emit('gpu-page-pin-refused','Épinglage GPU refusé',()=>({version:1,key,reason:'not-resident'}));throw new Error('PAGE_NOT_RESIDENT');}const changed=!pins.has(key);pins.add(key);if(changed)emit('gpu-page-pin','Page GPU épinglée',()=>({version:1,key,slot:page.slot,generation:page.generation,changed,pinned:pins.size}));},unpin(key:string){const changed=pins.delete(key);if(changed)emit('gpu-page-unpin','Épinglage GPU retiré',()=>({version:1,key,changed,pinned:pins.size}));},
  unload(key:string){const page=resident.get(key);if(!page){emit('gpu-page-unload-refused','Déchargement GPU refusé',()=>({version:1,key,reason:'not-resident'}));return false;}if(pins.has(key)){emit('gpu-page-unload-refused','Déchargement GPU refusé',()=>({version:1,key,slot:page.slot,generation:page.generation,reason:'pinned'}));return false;}resident.delete(key);free.push(page.slot);evictions++;emit('gpu-page-eviction','Page retirée de la résidence GPU',()=>({version:1,key,slot:page.slot,generation:page.generation,bytes:page.bytes,reason:'explicit-unload',drawDetached:false}));return true;},
  stats(){return {allocatedBytes:size,residentPages:resident.size,bytesRead,uploadedBytes,evictions,cacheEvictions:evictions,drawDetaches,physicalVramBytes:null};},
  dispose(){if(disposed)return pending.then(()=>{});emit('gpu-page-dispose','Cache GPU libéré',()=>({version:1,resident:resident.size,loading:fetches.size,evictions}));disposed=true;abort.abort();resident.clear();pins.clear();pending=pending.catch(()=>{}).then(async()=>{try{await device.queue.onSubmittedWorkDone();}catch{/* Queue may already be lost. */}buffer.destroy();});return pending;},
 };
}
export function httpPageSource(baseUrl:string):PageSource{return {async read(key,signal){const response=await fetch(new URL(key,baseUrl),{signal});if(!response.ok)throw new Error(`PAGE_HTTP_${response.status}`);return new Uint8Array(await response.arrayBuffer());}};}
