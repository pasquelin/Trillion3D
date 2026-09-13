import {checked} from './clusterPages.ts';
import type {BackendDiagnostic} from './backendTypes.ts';

export interface StreamPage {url:string;bytes:number;sha256:string}
const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

/** On-demand SHA-verified index pages. Hierarchy culling does not need the bytes; attach does. */
export function createPageStreamer(pages:readonly StreamPage[],base:string,signal?:AbortSignal,workerCount=8,maxPages?:number,onEvict?:(url:string)=>void,onDiagnostic?:(diagnostic:BackendDiagnostic)=>void){
 const catalog=new Map(pages.map(page=>[page.url,page]));
 const cache=new Map<string,Uint32Array>();
 const inflight=new Map<string,Promise<Uint32Array>>();
 const pinned=new Set<string>();
 const failures=new Map<string,Error>();
 const abort=new AbortController();
 const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
 let requested=0,hits=0,misses=0,bytesRead=0,loaded=0,evictions=0,admissionBlocked=0;
 const report=typeof onDiagnostic==='function'?onDiagnostic:undefined;
 const emit=(phase:string,message:string,context:()=>Record<string,unknown>)=>{
  if(!report)return;
  try{report({phase,message,context:context()});}catch{/* Diagnostic observers cannot affect streaming. */}
 };
 const now=()=>report?performance.now():0;
 emit('page-catalogue','Catalogue et configuration du streamer prêts',()=>({version:1,pages:catalog.size,workerCount:Math.max(1,workerCount),maxPages:maxPages??null,totalBytes:pages.reduce((total,page)=>total+page.bytes,0)}));
 const externalAbortListener=report&&signal?()=>emit('page-stream-abort','Chargement des pages annulé',()=>({reason:String(signal.reason??'aborted')})):undefined;
 if(externalAbortListener)signal?.addEventListener('abort',externalAbortListener,{once:true});
 const touch=(url:string,array:Uint32Array)=>{cache.delete(url);cache.set(url,array);};
 const evict=()=>{
  if(!maxPages||maxPages<1||cache.size<=maxPages)return;
  let evicted=false;
  for(const url of cache.keys()){
   if(cache.size<=maxPages)break;
   if(pinned.has(url)||inflight.has(url))continue;
   cache.delete(url);evictions++;evicted=true;
   emit('page-cache-eviction','Page retirée du cache LRU',()=>({version:1,url,reason:'capacity',drawDetached:false,resident:cache.size,maxPages}));
   onEvict?.(url);
  }
  if(!evicted&&cache.size>maxPages){admissionBlocked++;emit('page-cache-admission-blocked','Aucune page évictable pour respecter le budget',()=>({version:1,reason:'all-resident-pages-pinned-or-loading',resident:cache.size,maxPages,pinned:pinned.size,loading:inflight.size}));}
 };
 const loadOne=async(url:string,attempt:number)=>{
  const page=catalog.get(url);if(!page){emit('page-error','Page inconnue dans le catalogue',()=>({version:1,url,attempt,error:'Unknown page'}));throw new Error(`Unknown page ${url}`);}
  const attemptStarted=now();
  emit('page-attempt-start','Tentative de lecture de page',()=>({version:1,url,attempt,maxAttempts:3,expectedBytes:page.bytes}));
  let response:Response|undefined;
  try{
   const readStarted=now();
   emit('page-read-start','Lecture de page démarrée',()=>({version:1,url,attempt,expectedBytes:page.bytes}));
   response=await checked(new URL(url,base).href,combined);
   const bytes=await response.arrayBuffer();
   const readDurationMs=report?performance.now()-readStarted:null;
   emit('page-read-end','Lecture de page terminée',()=>({version:1,url,attempt,status:response?.status??null,actualBytes:bytes.byteLength,expectedBytes:page.bytes,durationMs:readDurationMs}));
   combined.throwIfAborted();
   const sizeMatches=bytes.byteLength===page.bytes;
   let actualHash:string|undefined,hashDurationMs:number|null=null;
   if(sizeMatches){const hashStarted=now();actualHash=await digest(bytes);hashDurationMs=report?performance.now()-hashStarted:null;}
   const hashMatches=sizeMatches&&actualHash===page.sha256;
   emit('page-hash-check',sizeMatches&&hashMatches?'Hash et taille de page vérifiés':'Échec de vérification de page',()=>({version:1,url,attempt,expectedBytes:page.bytes,actualBytes:bytes.byteLength,expectedHash:page.sha256,actualHash:actualHash??null,sizeMatches,hashMatches,durationMs:hashDurationMs}));
   if(!sizeMatches||!hashMatches){emit('page-corruption','Page corrompue ou de taille inattendue',()=>({version:1,url,attempt,expectedBytes:page.bytes,actualBytes:bytes.byteLength,expectedHash:page.sha256,actualHash:actualHash??null}));throw new Error('Corrupt cluster page');}
   const array=new Uint32Array(bytes);touch(url,array);bytesRead+=bytes.byteLength;loaded++;evict();
   emit('page-attempt-end','Tentative de lecture réussie',()=>({version:1,url,attempt,status:response?.status??null,actualBytes:bytes.byteLength,expectedBytes:page.bytes,durationMs:report?performance.now()-attemptStarted:null,resident:cache.size}));
   return array;
  }catch(error){
   const status=error&&typeof error==='object'&&'details' in error?((error as {details?:{status?:number}}).details?.status??response?.status??null):response?.status??null;
   emit('page-attempt-end','Tentative de lecture échouée',()=>({version:1,url,attempt,status,error:String(error),durationMs:report?performance.now()-attemptStarted:null}));
   throw error;
  }
 };
 const loadWithRetries=async(url:string)=>{
  let cause:unknown;
  for(let attempt=1;attempt<=3;attempt++){
   combined.throwIfAborted();
   try{return await loadOne(url,attempt);}catch(error){combined.throwIfAborted();cause=error;if(attempt<3)emit('page-retry','Nouvelle tentative après échec de lecture',()=>({version:1,url,attempt,nextAttempt:attempt+1,error:String(error)}));}
  }
  const error=new Error(`PAGE_STREAM_FAILED: ${url} after 3 attempts: ${String(cause)}`,{cause});
  failures.set(url,error);emit('page-error','Échec persistant du chargement de page',()=>({version:1,url,attempts:3,error:String(cause),sticky:true}));throw error;
 };
 const enqueue=(url:string,kind:'single'|'batch'='single')=>{
  emit('page-request','Demande de page reçue',()=>({version:1,url,kind}));
  if(combined.aborted){emit('page-error','Demande refusée après annulation',()=>({version:1,url,error:String(combined.reason??'aborted')}));return Promise.reject(combined.reason);}
  const failure=failures.get(url);if(failure){emit('page-error','Demande refusée après échec persistant',()=>({version:1,url,error:String(failure),sticky:true}));return Promise.reject(failure);}
  const cached=cache.get(url);if(cached){hits++;touch(url,cached);emit('page-cache-hit','Page déjà résidente',()=>({version:1,url,source:'cache',resident:cache.size}));return Promise.resolve(cached);}
  misses++;emit('page-cache-miss','Page absente du cache',()=>({version:1,url,source:'request',resident:cache.size}));
  let job=inflight.get(url);
  if(!job){job=loadWithRetries(url).finally(()=>inflight.delete(url));inflight.set(url,job);}else emit('page-request-coalesced','Demande jointe à une lecture en cours',()=>({version:1,url,loading:inflight.size}));
  return job;
 };
 return {
  get(url:string){const array=cache.get(url);if(array)touch(url,array);return array;},
  has(url:string){return cache.has(url);},
  loading(url:string){return inflight.has(url);},
  failed(url:string){return failures.has(url);},
  read(url:string){requested++;return enqueue(url);},
  retain(urls:readonly string[]){const before=report?new Set(pinned):undefined;pinned.clear();for(const url of urls)if(catalog.has(url))pinned.add(url);emit('page-retain','Épingles de pages mises à jour',()=>({version:1,requested:urls.length,retained:pinned.size,added:[...pinned].filter(url=>!before?.has(url)),removed:[...(before??[])].filter(url=>!pinned.has(url)),unknown:urls.filter(url=>!catalog.has(url))}));evict();},
  async request(urls:readonly string[]){
   const unique=[...new Set(urls.filter(url=>catalog.has(url)))];
   emit('page-request-batch','Demande groupée de pages reçue',()=>({version:1,requested:urls.length,unique:unique.length,unknown:urls.filter(url=>!catalog.has(url)).length}));
   requested+=unique.length;
   const limit=Math.min(Math.max(1,workerCount),Math.max(1,unique.length));
   let next=0;
   const workers=Array.from({length:limit},async()=>{while(next<unique.length){combined.throwIfAborted();await enqueue(unique[next++],'batch');}});
   const settled=await Promise.allSettled(workers);
   const failure=settled.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
  },
  stats(){return {requested,loaded,hits,misses,bytesRead,loading:inflight.size,resident:cache.size,evictions,cacheEvictions:evictions,drawDetaches:0,failed:failures.size,admissionBlocked};},
  dispose(){emit('page-stream-dispose','Streamer de pages libéré',()=>({version:1,resident:cache.size,loading:inflight.size,failed:failures.size}));if(externalAbortListener)signal?.removeEventListener('abort',externalAbortListener);abort.abort();cache.clear();inflight.clear();pinned.clear();failures.clear();},
 };
}
export type PageStreamer=ReturnType<typeof createPageStreamer>;
