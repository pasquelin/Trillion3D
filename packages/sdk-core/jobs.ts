export type JobStatus='queued'|'running'|'completed'|'cancelled'|'failed';
export interface JobProgress {phase:string;completed?:number;total?:number;message?:string;[key:string]:unknown}
export interface JobSnapshot<T> {eventVersion:1;id:string;status:JobStatus;progress:JobProgress|null;result:T|null;error:{code:string;message:string}|null}
function disposeOwned<T>(value:T,hook?:(result:T)=>void){if(value&&typeof value==='object'&&'dispose' in value&&typeof (value as {dispose:unknown}).dispose==='function'){try{(value as {dispose:()=>void}).dispose();}catch{/* Disposal cannot change job status. */}}try{hook?.(value);}catch{/* Host disposal hooks cannot change job status. */}}
/** No timers, DOM, filesystem or UI. Hosts inject work, cancellation and telemetry. */
export function createJob<T>(id:string,work:(context:{signal:AbortSignal;progress:(event:JobProgress)=>void})=>Promise<T>,options:{signal?:AbortSignal;telemetry?:(snapshot:JobSnapshot<T>)=>void;disposeResult?:(result:T)=>void}={}){
 const controller=new AbortController(),listeners=new Set<()=>void>();
 let snapshot:JobSnapshot<T>={eventVersion:1,id,status:'queued',progress:null,result:null,error:null};
 const publish=(patch:Partial<JobSnapshot<T>>)=>{snapshot=Object.freeze({...snapshot,...patch});for(const listener of listeners){try{listener();}catch{/* Observers do not own job execution. */}}try{options.telemetry?.(snapshot);}catch{/* Telemetry cannot turn successful work into failure. */}};
 const relay=()=>controller.abort(options.signal?.reason);options.signal?.addEventListener('abort',relay,{once:true});if(options.signal?.aborted)relay();
 const promise=Promise.resolve().then(async()=>{let result:T|undefined,completed=false;try{controller.signal.throwIfAborted();publish({status:'running'});result=await work({signal:controller.signal,progress:event=>{controller.signal.throwIfAborted();publish({progress:event});}});controller.signal.throwIfAborted();completed=true;publish({status:'completed',result});return result;}catch(error){if(result!==undefined&&!completed)disposeOwned(result,options.disposeResult);const message=String(error);publish({status:controller.signal.aborted?'cancelled':'failed',error:{code:controller.signal.aborted?'CANCELLED':'JOB_FAILED',message}});throw error;}finally{options.signal?.removeEventListener('abort',relay);}});
 return {promise,cancel:(reason?:unknown)=>controller.abort(reason),getSnapshot:()=>snapshot,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}};
}
