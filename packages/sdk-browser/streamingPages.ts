import {checked} from './clusterPages.ts';
import type {BackendDiagnostic} from './backendTypes.ts';

export interface StreamPage {url:string;bytes:number;sha256:string}
const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

type Job={
 url:string;priority:number;order:number;controller:AbortController;state:'queued'|'active';consumers:Set<symbol>;
 promise:Promise<Uint8Array>;resolve:(value:Uint8Array)=>void;reject:(reason:unknown)=>void;
};

/** Resident bytes kept by default. Streaming bundles are far larger than a single cluster page, so
 *  a cache bounded only by entry count would hold hundreds of megabytes. */
export const DEFAULT_CACHED_BYTES=256*1024*1024;
/** Bounded, prioritized and deduplicated reads. A request still waiting in the queue is dropped once
 *  its last consumer leaves; one already transferring is allowed to land in the cache.
 *  The cache is a least-recently-used set bounded by both entries and bytes; pinned entries survive
 *  eviction, so a caller keeps its displayed cover by retaining it. */
export function createPageStreamer(pages:readonly StreamPage[],base:string,signal?:AbortSignal,workerCount=8,maxPages?:number,onEvict?:(url:string)=>void,maxTransferBytes=8*1024*1024,onDiagnostic?:(diagnostic:BackendDiagnostic)=>void,maxCachedBytes=DEFAULT_CACHED_BYTES){
 const catalog=new Map(pages.map(page=>[page.url,page]));
 const cache=new Map<string,Uint8Array>(),jobs=new Map<string,Job>(),queue:Job[]=[];
 const pinned=new Set<string>(),failures=new Map<string,Error>(),abort=new AbortController();
 if(signal){if(signal.aborted)abort.abort(signal.reason);else signal.addEventListener('abort',()=>abort.abort(signal.reason),{once:true});}
 const limit=Number.isSafeInteger(workerCount)?Math.max(1,workerCount):1;
 if(!Number.isSafeInteger(maxTransferBytes)||maxTransferBytes<1)throw new Error('INVALID_PAGE_TRANSFER_BUDGET');
 if(!Number.isSafeInteger(maxCachedBytes)||maxCachedBytes<1)throw new Error('INVALID_PAGE_CACHE_BUDGET');
 let order=0,active=0,activeBytes=0,requested=0,hits=0,misses=0,bytesRead=0,loaded=0,evictions=0,admissionBlocked=0,disposed=false,cachedBytes=0;
 const emit=(phase:string,message:string,context:()=>Record<string,unknown>)=>{if(onDiagnostic)try{onDiagnostic({phase,message,context:context()});}catch{/* Observers cannot alter streaming. */}};
 emit('page-catalogue','Catalogue et configuration du streamer prêts',()=>({version:1,pages:catalog.size,workerCount:limit,maxPages:maxPages??null,maxTransferBytes,maxCachedBytes,totalBytes:pages.reduce((sum,page)=>sum+page.bytes,0)}));
 const abortError=()=>new DOMException('Page request cancelled','AbortError');
 const touch=(url:string,array:Uint8Array)=>{const held=cache.get(url);if(held)cachedBytes-=held.byteLength;cache.delete(url);cache.set(url,array);cachedBytes+=array.byteLength;};
 const over=()=>(maxPages&&maxPages>=1&&cache.size>maxPages)||cachedBytes>maxCachedBytes;
 const evict=()=>{
  if(!over())return;
  let evicted=false;
  for(const url of cache.keys()){
   if(!over())break;
   if(pinned.has(url)||jobs.has(url))continue;
   const held=cache.get(url);if(held)cachedBytes-=held.byteLength;
   cache.delete(url);evictions++;evicted=true;emit('page-cache-eviction','Page retirée du cache LRU',()=>({version:1,url,reason:'capacity',drawDetached:false,resident:cache.size,residentBytes:cachedBytes,maxPages:maxPages??null,maxCachedBytes}));onEvict?.(url);
  }
  if(!evicted&&over()){admissionBlocked++;emit('page-cache-admission-blocked','Aucune page évictable pour respecter le budget',()=>({version:1,resident:cache.size,residentBytes:cachedBytes,maxPages:maxPages??null,maxCachedBytes,pinned:pinned.size,loading:active}));}
 };
 const loadOne=async(url:string,jobSignal:AbortSignal)=>{
  const page=catalog.get(url);if(!page)throw new Error('Unknown page '+url);
  const combined=AbortSignal.any([abort.signal,jobSignal]);
  let cause:unknown;
  for(let attempt=1;attempt<=3;attempt++){
   combined.throwIfAborted();
   const attemptStart=onDiagnostic?performance.now():0;
   emit('page-attempt-start','Tentative de lecture de page',()=>({version:1,url,attempt,maxAttempts:3,expectedBytes:page.bytes}));
   try{
    emit('page-read-start','Lecture de page démarrée',()=>({version:1,url,attempt,expectedBytes:page.bytes}));
    const bytes=await(await checked(new URL(url,base).href,combined)).arrayBuffer();
    emit('page-read-end','Lecture de page terminée',()=>({version:1,url,attempt,actualBytes:bytes.byteLength,expectedBytes:page.bytes,durationMs:onDiagnostic?performance.now()-attemptStart:null}));
    combined.throwIfAborted();
    const sizeMatches=bytes.byteLength===page.bytes;
    const actualHash=sizeMatches?await digest(bytes):undefined;
    const hashMatches=sizeMatches&&actualHash===page.sha256;
    emit('page-hash-check',hashMatches?'Hash et taille de page vérifiés':'Échec de vérification de page',()=>({version:1,url,attempt,expectedBytes:page.bytes,actualBytes:bytes.byteLength,expectedHash:page.sha256,actualHash:actualHash??null,sizeMatches,hashMatches}));
    if(!hashMatches){emit('page-corruption','Page corrompue ou de taille inattendue',()=>({version:1,url,attempt}));throw new Error('Corrupt cluster page');}
    combined.throwIfAborted();
    const array=new Uint8Array(bytes);touch(url,array);bytesRead+=bytes.byteLength;loaded++;emit('page-attempt-end','Tentative de lecture réussie',()=>({version:1,url,attempt,actualBytes:bytes.byteLength,durationMs:onDiagnostic?performance.now()-attemptStart:null,resident:cache.size}));return array;
   }catch(error){emit('page-attempt-end','Tentative de lecture échouée',()=>({version:1,url,attempt,error:String(error),durationMs:onDiagnostic?performance.now()-attemptStart:null}));combined.throwIfAborted();cause=error;if(attempt<3)emit('page-retry','Nouvelle tentative après échec de lecture',()=>({version:1,url,attempt,nextAttempt:attempt+1,error:String(error)}));}
  }
  const error=new Error('PAGE_STREAM_FAILED: '+url+' after 3 attempts: '+String(cause),{cause});
  failures.set(url,error);emit('page-error','Échec persistant du chargement de page',()=>({version:1,url,attempts:3,error:String(cause),sticky:true}));throw error;
 };
 const pump=()=>{
  if(disposed||abort.signal.aborted)return;
  while(active<limit&&queue.length){
   queue.sort((a,b)=>a.priority-b.priority||a.order-b.order);
   const at=queue.findIndex(item=>active===0||activeBytes+(catalog.get(item.url)?.bytes??0)<=maxTransferBytes);
   if(at<0)break;
   const job=queue.splice(at,1)[0];
   if(job.consumers.size===0||job.controller.signal.aborted)continue;
   job.state='active';active++;activeBytes+=catalog.get(job.url)!.bytes;
   emit('page-transfer-start','Transfert de page admis',()=>({version:1,url:job.url,active,transferInFlightBytes:activeBytes,maxTransferBytes}));
   void loadOne(job.url,job.controller.signal).then(job.resolve,job.reject).finally(()=>{
    active--;activeBytes-=catalog.get(job.url)!.bytes;if(jobs.get(job.url)===job)jobs.delete(job.url);emit('page-transfer-end','Transfert de page terminé',()=>({version:1,url:job.url,active,transferInFlightBytes:activeBytes}));evict();pump();
   });
  }
 };
 const subscribe=(url:string,requestSignal?:AbortSignal,priority=1):Promise<Uint8Array>=>{
  emit('page-request','Demande de page reçue',()=>({version:1,url,priority}));
  if(disposed||abort.signal.aborted)return Promise.reject(abort.signal.reason??abortError());
  if(requestSignal?.aborted)return Promise.reject(requestSignal.reason??abortError());
  if(!catalog.has(url))return Promise.reject(new Error('Unknown page '+url));
  const failure=failures.get(url);if(failure)return Promise.reject(failure);
  const cached=cache.get(url);if(cached){hits++;touch(url,cached);emit('page-cache-hit','Page déjà résidente',()=>({version:1,url,resident:cache.size}));return Promise.resolve(cached);}
  misses++;emit('page-cache-miss','Page absente du cache',()=>({version:1,url,resident:cache.size}));
  let job=jobs.get(url);
  if(!job){
   let resolve!:(value:Uint8Array)=>void,reject!:(reason:unknown)=>void;
   const promise=new Promise<Uint8Array>((yes,no)=>{resolve=yes;reject=no;});
   job={url,priority,order:order++,controller:new AbortController(),state:'queued',consumers:new Set(),promise,resolve,reject};
   jobs.set(url,job);queue.push(job);
  }else{job.priority=Math.min(job.priority,priority);emit('page-request-coalesced','Demande jointe à une lecture en cours',()=>({version:1,url,loading:jobs.size}));}
  const shared=job,token=Symbol(url);
  shared.consumers.add(token);
  const combined=requestSignal?AbortSignal.any([abort.signal,requestSignal]):abort.signal;
  const result=new Promise<Uint8Array>((resolve,reject)=>{
   let settled=false;
   const finish=(ok:boolean,value:Uint8Array|unknown)=>{
    if(settled)return;settled=true;combined.removeEventListener('abort',onAbort);shared.consumers.delete(token);
    // A transfer that has already started is paid for: letting it land in the cache costs nothing
    // more and keeps a superseded camera from throwing away bytes it is about to ask for again.
    // Only a request still waiting in the queue is dropped.
    if(shared.consumers.size===0&&jobs.get(url)===shared&&shared.state==='queued'){
     jobs.delete(url);shared.controller.abort(abortError());emit('page-stream-abort','Demande en attente annulée',()=>({version:1,url}));
     const at=queue.indexOf(shared);if(at>=0)queue.splice(at,1);
    }
    if(ok)resolve(value as Uint8Array);else reject(value);
   };
   const onAbort=()=>finish(false,combined.reason??abortError());
   combined.addEventListener('abort',onAbort,{once:true});
   shared.promise.then(value=>finish(true,value),error=>finish(false,error));
   if(combined.aborted)onAbort();
  });
  pump();return result;
 };
 const indexViews=new WeakMap<Uint8Array,Uint32Array>();
 const asIndices=(bytes:Uint8Array)=>{if(bytes.byteLength%4!==0)throw new Error('INVALID_INDEX_PAGE_SIZE');let view=indexViews.get(bytes);if(!view){view=new Uint32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);indexViews.set(bytes,view);}return view;};
 return {
  get(url:string){const array=cache.get(url);if(array)touch(url,array);return array?asIndices(array):undefined;},
  getBytes(url:string){const array=cache.get(url);if(array)touch(url,array);return array;},
  has(url:string){return cache.has(url);},loading(url:string){return jobs.has(url);},failed(url:string){return failures.has(url);},
  read(url:string,requestSignal?:AbortSignal){requested++;return subscribe(url,requestSignal,0).then(asIndices);},
  readBytes(url:string,requestSignal?:AbortSignal){requested++;return subscribe(url,requestSignal,0);},
  retain(urls:readonly string[]){const before=onDiagnostic?new Set(pinned):undefined;pinned.clear();for(const url of urls)if(catalog.has(url))pinned.add(url);emit('page-retain','Épingles de pages mises à jour',()=>({version:1,requested:urls.length,retained:pinned.size,added:[...pinned].filter(url=>!before?.has(url)),removed:[...(before??[])].filter(url=>!pinned.has(url))}));evict();},
  async request(urls:readonly string[],options:{signal?:AbortSignal;priority?:number}={}){
   const unique=[...new Set(urls.filter(url=>catalog.has(url)))];requested+=unique.length;emit('page-request-batch','Demande groupée de pages reçue',()=>({version:1,requested:urls.length,unique:unique.length}));
   await Promise.all(unique.map(url=>subscribe(url,options.signal,options.priority??1)));
  },
  stats(){return {requested,loaded,hits,misses,bytesRead,loading:active,queued:queue.length,transferInFlightBytes:activeBytes,resident:cache.size,residentBytes:cachedBytes,maxCachedBytes,evictions,failed:failures.size,admissionBlocked};},
  dispose(){if(disposed)return;disposed=true;emit('page-stream-dispose','Streamer de pages libéré',()=>({version:1,resident:cache.size,loading:active,failed:failures.size}));abort.abort(abortError());for(const job of jobs.values())job.controller.abort(abortError());jobs.clear();queue.length=0;cache.clear();cachedBytes=0;pinned.clear();failures.clear();},
 };
}
export type PageStreamer=ReturnType<typeof createPageStreamer>;
