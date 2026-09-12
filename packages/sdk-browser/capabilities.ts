/** WebGL mode never reads or calls navigator.gpu and never binds the host canvas. */
let cachedWebgl: {tier:'baseline';renderer:'webgl2'|null;extensions:string[];reason:string;adapter:null}|undefined;
export async function detectCapabilities(mode:'webgl'|'webgpu',_canvas:HTMLCanvasElement,environment:{gpu?:GPU;createWebglCanvas?:()=>HTMLCanvasElement}={}){
 if(mode==='webgl'){
  if(!environment.createWebglCanvas&&cachedWebgl)return cachedWebgl;
  const probe=environment.createWebglCanvas?.()??(typeof document==='undefined'?undefined:document.createElement('canvas'));
  const gl=probe?.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:false});
  const extensions=gl?.getSupportedExtensions()??[];
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  const result={tier:'baseline' as const,renderer:gl?'webgl2' as const:null,extensions,reason:gl?'Standard Three.js WebGL2 available':'WebGL2 unavailable',adapter:null};
  if(!environment.createWebglCanvas)cachedWebgl=result;
  return result;
 }
 const gpu=environment.gpu??(typeof navigator==='undefined'?undefined:navigator.gpu);if(!gpu)return {tier:'baseline' as const,renderer:null,extensions:[],reason:'WebGPU unavailable; create a separate WebGL canvas',adapter:null};
 const adapter=await gpu.requestAdapter();return {tier:adapter?(adapter.features.has('timestamp-query')?'full' as const:'degraded' as const):'baseline' as const,renderer:adapter?'webgpu':null,extensions:adapter?[...adapter.features]:[],reason:adapter?'WebGPU adapter available; backend-specific capabilities still require checking':'No WebGPU adapter; use baseline',adapter};
}
