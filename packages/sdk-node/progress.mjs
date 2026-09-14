/**
 * Terminal progress for compiler jobs: one live line per job on a TTY (spinner, bar, phase, elapsed),
 * one plain line per phase change elsewhere. Built on the `ratio` every compiler event carries, so a
 * host needs no knowledge of the phases. Pass `progress.event` as `onProgress` (or `onEvent` for batches).
 */
const SPINNER=['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
const mb=bytes=>`${(Number(bytes??0)/1048576).toFixed(0)} MB`;
const PHASES={
 accepted:()=>'starting',
 'import-source':e=>({parse:`reading ${e.file??'source'} ${mb(e.completed)}/${mb(e.total)}`,meshes:`converting meshes ${e.completed}/${e.total}`,write:`writing glTF ${mb(e.bytes)}`,reused:'import reused',complete:'import done'})[e.step]??'importing',
 import:()=>'source geometry written',
 primitive:(e,s)=>`clustering ${s.primitives}${s.primitivesTotal?`/${s.primitivesTotal}`:''} primitives`,
 bootstrap:e=>`root bundles ${e.completed}/${e.total}`,
 prune:e=>`pruning cache (${e.removedKeys} keys, ${mb(e.removedBytes)})`,
 complete:()=>'writing pointer',
};
const clip=(text,width)=>{const chars=[...text];return chars.length>width?`${chars.slice(0,Math.max(1,width-1)).join('')}…`:text;};
function summaryOf(pointer){if(!pointer)return 'ready';const parts=[];if(typeof pointer.selectedTriangles==='number')parts.push(`${pointer.selectedTriangles.toLocaleString()} triangles`);if(typeof pointer.primitives==='number')parts.push(`${pointer.primitives} primitives`);if(pointer.metrics?.wallMs)parts.push(`${Math.round(pointer.metrics.wallMs)} ms`);return parts.join(', ')||'ready';}
export function createTerminalProgress({label='job',index=0,total=1,stream=process.stderr,width=24,interval=100}={}){
 const tty=Boolean(stream.isTTY);
 const started=performance.now();
 const state={ratio:0,phase:'',text:'waiting',primitives:0,primitivesTotal:0,frame:0,lastKey:'',timer:null,finished:false};
 const elapsed=()=>`${((performance.now()-started)/1000).toFixed(1)}s`;
 const bar=()=>{const filled=Math.round(state.ratio*width);return `[${'█'.repeat(filled)}${'░'.repeat(width-filled)}] ${String(Math.round(state.ratio*100)).padStart(3)}%`;};
 const line=()=>`${SPINNER[state.frame++%SPINNER.length]} ${index+1}/${total} ${label} ${bar()} ${state.text} ${elapsed()}`;
 const draw=()=>{if(state.finished)return;const text=line();if(tty)stream.write(`\r\x1b[K${clip(text,Math.max(20,(stream.columns??80)-1))}`);else{const key=`${state.phase}:${state.text.split(' ')[0]}`;if(key!==state.lastKey){stream.write(`${text}\n`);state.lastKey=key;}}};
 const stop=()=>{if(state.timer){clearInterval(state.timer);state.timer=null;}};
 const finish=(mark,summary)=>{if(state.finished)return;stop();state.finished=true;stream.write(`${tty?'\r\x1b[K':''}${mark} ${index+1}/${total} ${label} ${summary} ${elapsed()}\n`);};
 if(tty)state.timer=setInterval(draw,interval);
 return {
  /** Feed every compiler event here; the line completes or fails by itself. */
  event(event){
   if(event.event==='complete'){finish('✔',summaryOf(event.pointer));return;}
   if(event.event==='error'||event.event==='cancelled'){finish('✖',`${event.code??'error'}${event.message?` ${event.message}`:''}`);return;}
   if(typeof event.ratio==='number')state.ratio=Math.min(1,Math.max(state.ratio,event.ratio));
   if(event.phase==='import'&&typeof event.primitives==='number')state.primitivesTotal=event.primitives;
   if(event.phase==='primitive')state.primitives+=1;
   state.phase=event.phase??event.event??'';
   const describe=PHASES[state.phase];
   if(describe)state.text=describe(event,state);
   draw();
  },
  /** Host-side step happening before or between compiler events (a manifest check, a copy...). */
  note(text){state.text=text;state.phase='host';draw();},
  done(summary){finish('✔',summary);},
  fail(message){finish('✖',message);},
  get primitives(){return state.primitives;},
 };
}
/** Batch companion for `prepareMany({onEvent})`: one line per job id, in arrival order. */
export function createBatchProgress({stream=process.stderr}={}){
 const lines=new Map();let total=0;
 return {
  event(event){
   if(event.event==='batch'){total=event.jobs;return;}
   if(event.job==='*')return;
   let line=lines.get(event.job);
   if(!line){line=createTerminalProgress({label:event.job,index:lines.size,total:total||1,stream});lines.set(event.job,line);}
   line.event(event);
  },
 };
}
