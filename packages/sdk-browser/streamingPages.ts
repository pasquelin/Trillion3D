import {checked} from './clusterPages.ts';

export interface StreamPage {url:string;bytes:number;sha256:string}
const digest=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

/** On-demand SHA-verified index pages. Hierarchy culling does not need the bytes; attach does. */
export function createPageStreamer(pages:readonly StreamPage[],base:string,signal?:AbortSignal,workerCount=8,maxPages?:number){
 const catalog=new Map(pages.map(page=>[page.url,page]));
 const cache=new Map<string,Uint32Array>();
 const inflight=new Map<string,Promise<Uint32Array>>();
 const pinned=new Set<string>();
 const abort=new AbortController();
 const combined=signal?AbortSignal.any([signal,abort.signal]):abort.signal;
 let requested=0,hits=0,misses=0,bytesRead=0,loaded=0,evictions=0;
 const touch=(url:string,array:Uint32Array)=>{cache.delete(url);cache.set(url,array);};
 const evict=()=>{
  if(!maxPages||maxPages<1||cache.size<=maxPages)return;
  for(const url of cache.keys()){
   if(cache.size<=maxPages)break;
   if(pinned.has(url)||inflight.has(url))continue;
   cache.delete(url);evictions++;
  }
 };
 const loadOne=async(url:string)=>{
  const page=catalog.get(url);if(!page)throw new Error(`Unknown page ${url}`);
  const bytes=await(await checked(new URL(url,base).href,combined)).arrayBuffer();
  combined.throwIfAborted();
  if(bytes.byteLength!==page.bytes||await digest(bytes)!==page.sha256)throw new Error('Corrupt cluster page');
  const array=new Uint32Array(bytes);touch(url,array);bytesRead+=bytes.byteLength;loaded++;evict();return array;
 };
 const enqueue=(url:string)=>{
  const cached=cache.get(url);if(cached){hits++;touch(url,cached);return Promise.resolve(cached);}
  misses++;
  let job=inflight.get(url);
  if(!job){job=loadOne(url).finally(()=>inflight.delete(url));inflight.set(url,job);}
  return job;
 };
 return {
  get(url:string){const array=cache.get(url);if(array)touch(url,array);return array;},
  has(url:string){return cache.has(url);},
  loading(url:string){return inflight.has(url);},
  retain(urls:readonly string[]){pinned.clear();for(const url of urls)if(catalog.has(url))pinned.add(url);evict();},
  async request(urls:readonly string[]){
   const unique=[...new Set(urls.filter(url=>catalog.has(url)))];
   requested+=unique.length;
   const limit=Math.min(Math.max(1,workerCount),Math.max(1,unique.length));
   let next=0;
   const workers=Array.from({length:limit},async()=>{while(next<unique.length){combined.throwIfAborted();await enqueue(unique[next++]);}});
   await Promise.all(workers);
  },
  stats(){return {requested,loaded,hits,misses,bytesRead,loading:inflight.size,resident:cache.size,evictions};},
  dispose(){abort.abort();cache.clear();inflight.clear();pinned.clear();},
 };
}
export type PageStreamer=ReturnType<typeof createPageStreamer>;
