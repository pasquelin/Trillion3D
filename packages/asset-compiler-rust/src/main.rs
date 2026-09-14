//! Command line front of the compiler. Hosts talk to it with three streams only:
//! - arguments (one job) or `--jobs FILE|-` (a JSON batch) tell it what to prepare;
//! - stderr carries one JSON event per line: queued, accepted, progress, complete, error, done;
//! - stdout carries the final pointer(s), a few hundred bytes, never the compiled manifest.
//! A JSON line `{"cancel":"*"}` or `{"cancel":"<job>"}` on stdin cancels; killing the process is also safe
//! because every output file is written atomically.
use web_geometry_compiler::{compile,parse_compiler_args,Options,CompilerError,COMPILER_VERSION,FORMAT_VERSION};
use web_geometry_compiler::import::IMPORTER_VERSION;
use std::{collections::{HashMap,VecDeque},io::{BufRead,Write},path::Path,sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}},time::Instant};
use serde_json::{Value,json};

fn emit(mut event:Value,job:&str){if let Some(object)=event.as_object_mut(){object.insert("job".into(),json!(job));}let stderr=std::io::stderr();let mut lock=stderr.lock();let _=writeln!(lock,"{event}");}
fn error_value(error:&CompilerError)->Value{json!({"status":"error","code":error.code,"message":error.message})}

/// What a host needs after a job: where the pointer lives and the headline numbers. The full manifest stays on disk.
fn pointer(result:&Value,cache:&Path)->Value{
 let scope=result["scope"].as_str().unwrap_or("");let key=result["key"].as_str().unwrap_or("");
 json!({"status":"ready","key":key,"scope":scope,"url":format!("{key}/clusters.json"),"pointer":cache.join("native").join(scope).join("manifest.json").to_string_lossy(),"cache":cache.to_string_lossy(),
  "formatVersion":result["formatVersion"],"compilerVersion":result["compilerVersion"],"selectedTriangles":result["selectedTriangles"],"sourceTriangles":result["sourceTriangles"],"selectedNodes":result["selectedNodes"].as_array().map(|a|a.len()).unwrap_or(0),"totalNodes":result["totalNodes"],"primitives":result["primitives"].as_array().map(|a|a.len()).unwrap_or(0),"simplification":result["simplification"],
  "metrics":{"importMs":result["metrics"]["importMs"],"clusterHierarchyPagesMs":result["metrics"]["clusterHierarchyPagesMs"],"wallMs":result["metrics"]["wallMs"],"outputGeometryBytes":result["metrics"]["outputGeometryBytes"],"threads":result["metrics"]["threads"],"ramBudgetMb":result["metrics"]["ramBudgetMb"]},
  "unsupported":result["unsupported"]})
}

struct Cancellation{all:AtomicBool,jobs:Mutex<HashMap<String,Arc<AtomicBool>>>}
impl Cancellation{
 fn flag(&self,job:&str)->Arc<AtomicBool>{let flag=Arc::new(AtomicBool::new(self.all.load(Ordering::Relaxed)));self.jobs.lock().unwrap().insert(job.to_string(),flag.clone());flag}
 fn cancel(&self,target:&str){if target=="*"{self.all.store(true,Ordering::Relaxed);for flag in self.jobs.lock().unwrap().values(){flag.store(true,Ordering::Relaxed);}}else if let Some(flag)=self.jobs.lock().unwrap().get(target){flag.store(true,Ordering::Relaxed);}}
}
/// stdin is optional: a host that ignores it gets EOF at once and the listener ends.
fn listen_stdin(cancellation:Arc<Cancellation>){std::thread::spawn(move||{let stdin=std::io::stdin();for line in stdin.lock().lines(){let Ok(line)=line else {break};if let Ok(value)=serde_json::from_str::<Value>(&line){if let Some(target)=value.get("cancel"){match target{Value::String(s)=>cancellation.cancel(s),Value::Bool(true)=>cancellation.cancel("*"),_=>{}}}}}});}

/// Whole-job completion estimate carried by every progress event, so a host shows one bar without
/// knowing the phases. Weights: source import (FBX/OBJ only) up to 0.30, glTF import 0.35, clustering
/// 0.35–0.95 (per primitive, total announced by the `import` event), root bundles 0.95–0.99, pointer 1.
#[derive(Default)] struct Ratio{primitives_total:usize,primitives_done:usize}
impl Ratio{
 fn update(&mut self,event:&Value)->f64{
  let frac=|e:&Value|{let total=e["total"].as_f64().unwrap_or(0.0);if total>0.0{(e["completed"].as_f64().unwrap_or(0.0)/total).clamp(0.0,1.0)}else{0.0}};
  match event["phase"].as_str(){
   Some("import-source")=>match event["step"].as_str(){Some("parse")=>{let files=event["files"].as_f64().unwrap_or(1.0).max(1.0);let index=event["index"].as_f64().unwrap_or(0.0);0.20*((index+frac(event))/files)}Some("meshes")=>0.20+0.08*frac(event),Some("write")=>0.29,_=>0.30},
   Some("import")=>{self.primitives_total=event["primitives"].as_u64().unwrap_or(0) as usize;0.35}
   Some("primitive")=>{self.primitives_done+=1;if self.primitives_total>0{0.35+0.60*(self.primitives_done as f64/self.primitives_total as f64).min(1.0)}else{0.35}}
   Some("bootstrap")=>0.95+0.04*frac(event),
   Some("complete")=>1.0,
   _=>0.0,
  }
 }
}
fn run_job(id:&str,options:&Options)->Result<Value,CompilerError>{
 let started=Instant::now();
 emit(json!({"event":"accepted","ratio":0.0,"source":options.source.to_string_lossy(),"cache":options.cache.to_string_lossy(),"scope":options.scope,"triangles":options.triangle_budget,"threads":options.threads,"ramBudgetMb":options.ram_budget_mb,"simplification":options.simplification}),id);
 let job=id.to_string();
 let ratio=Mutex::new(Ratio::default());
 let result=compile(options,|mut event|{let value=ratio.lock().unwrap().update(&event);if let Some(object)=event.as_object_mut(){object.insert("event".into(),json!("progress"));object.insert("ratio".into(),json!((value*1000.0).round()/1000.0));}emit(event,&job)});
 match result{
  Ok(result)=>{let pointer=pointer(&result,&options.cache);emit(json!({"event":"complete","ratio":1.0,"pointer":pointer,"ms":started.elapsed().as_secs_f64()*1000.0}),id);Ok(pointer)}
  Err(error)=>{let mut event=error_value(&error);event["event"]=json!(if error.code=="CANCELLED"{"cancelled"}else{"error"});event["ms"]=json!(started.elapsed().as_secs_f64()*1000.0);emit(event,id);Err(error)}
 }
}

fn number(value:Option<&Value>,default:usize)->Result<usize,String>{match value{None|Some(Value::Null)=>Ok(default),Some(v)=>v.as_u64().filter(|n|*n>0).map(|n|n as usize).ok_or_else(||format!("{v} must be a positive integer"))}}
fn text<'a>(value:Option<&'a Value>,default:&'a str)->&'a str{value.and_then(Value::as_str).unwrap_or(default)}
/// Batch file: `{"workers":2,"ramBudgetMb":16384,"threads":4,"jobs":[{"id":..,"source":..,"cache":..,"scope":..,"triangles":..,"resourceBaseUrl":..,"simplification":..,"threads":..,"ramBudgetMb":..}]}`.
/// Per-job RAM defaults to the batch budget divided by the number of workers.
fn parse_batch(spec:&Value,cancellation:&Cancellation)->Result<(usize,Vec<(String,Options)>),String>{
 let workers=number(spec.get("workers"),1)?.min(64);
 let ram_total=number(spec.get("ramBudgetMb"),256*workers)?;
 let default_threads=number(spec.get("threads"),2)?;
 let default_ram=(ram_total/workers).max(64);
 let jobs=spec.get("jobs").and_then(Value::as_array).ok_or("jobs must be an array")?;
 if jobs.is_empty(){return Err("jobs must not be empty".into());}
 let mut parsed=Vec::new();let mut seen=std::collections::HashSet::new();
 for (i,job) in jobs.iter().enumerate(){
  let id=text(job.get("id"),"").to_string();let id=if id.is_empty(){format!("job-{i}")}else{id};
  if !seen.insert(id.clone()){return Err(format!("duplicate job id {id}"));}
  let source=text(job.get("source"),"");let cache=text(job.get("cache"),"");let resource_base=text(job.get("resourceBaseUrl"),"");
  if source.is_empty()||cache.is_empty()||resource_base.is_empty(){return Err(format!("job {id}: source, cache and resourceBaseUrl are required"));}
  let args=vec![source.to_string(),cache.to_string(),text(job.get("scope"),"full").to_string(),number(job.get("triangles"),150000)?.to_string(),number(job.get("threads"),default_threads)?.to_string(),number(job.get("ramBudgetMb"),default_ram)?.to_string(),resource_base.to_string(),text(job.get("simplification"),"none").to_string()];
  let options=parse_compiler_args(&args,cancellation.flag(&id)).map_err(|e|format!("job {id}: {e}"))?;
  parsed.push((id,options));
 }
 Ok((workers,parsed))
}

fn run_batch(spec_path:&str,cancellation:Arc<Cancellation>)->Result<i32,String>{
 let started=Instant::now();
 let text=if spec_path=="-"{let mut s=String::new();std::io::stdin().lock().read_line(&mut s).map_err(|e|e.to_string())?;s}else{std::fs::read_to_string(spec_path).map_err(|e|format!("{spec_path}: {e}"))?};
 let spec:Value=serde_json::from_str(&text).map_err(|e|format!("batch JSON: {e}"))?;
 let (workers,jobs)=parse_batch(&spec,&cancellation)?;
 if spec_path!="-"{listen_stdin(cancellation.clone());}
 emit(json!({"event":"batch","jobs":jobs.len(),"workers":workers}),"*");
 for (id,options) in &jobs{emit(json!({"event":"queued","source":options.source.to_string_lossy()}),id);}
 let queue=Mutex::new(jobs.into_iter().collect::<VecDeque<_>>());
 let outcomes:Mutex<Vec<Value>>=Mutex::new(Vec::new());
 std::thread::scope(|scope|{
  for _ in 0..workers{
   scope.spawn(||loop{
    let next=queue.lock().unwrap().pop_front();
    let Some((id,options))=next else {break};
    let outcome=match run_job(&id,&options){Ok(pointer)=>json!({"job":id,"status":"ready","pointer":pointer}),Err(error)=>{let mut v=error_value(&error);v["job"]=json!(id);v}};
    outcomes.lock().unwrap().push(outcome);
   });
  }
 });
 let mut outcomes=outcomes.into_inner().unwrap();
 outcomes.sort_by(|a,b|a["job"].as_str().cmp(&b["job"].as_str()));
 let ready=outcomes.iter().filter(|o|o["status"]=="ready").count();
 let cancelled=outcomes.iter().filter(|o|o["code"]=="CANCELLED").count();
 let failed=outcomes.len()-ready-cancelled;
 emit(json!({"event":"done","completed":ready,"failed":failed,"cancelled":cancelled,"ms":started.elapsed().as_secs_f64()*1000.0}),"*");
 let status=if failed==0&&cancelled==0{"ready"}else if ready>0{"partial"}else{"failed"};
 println!("{}",json!({"status":status,"completed":ready,"failed":failed,"cancelled":cancelled,"jobs":outcomes}));
 Ok(if failed==0&&cancelled==0{0}else{2})
}

fn main(){
 let args:Vec<String>=std::env::args().skip(1).collect();
 let cancellation=Arc::new(Cancellation{all:AtomicBool::new(false),jobs:Mutex::new(HashMap::new())});
 let code=match args.first().map(String::as_str){
  Some("--version")=>{println!("{}",json!({"compilerVersion":COMPILER_VERSION,"formatVersion":FORMAT_VERSION,"importer":IMPORTER_VERSION,"platform":std::env::consts::OS,"arch":std::env::consts::ARCH}));0}
  Some("--jobs")=>match args.get(1){Some(path)=>match run_batch(path,cancellation){Ok(code)=>code,Err(message)=>{emit(json!({"event":"error","status":"error","code":"INVALID_BATCH","message":message}),"*");println!("{}",json!({"status":"error","code":"INVALID_BATCH","message":message}));2}},None=>{eprintln!("Usage: web-geometry-compiler --jobs FILE|-");2}},
  _=>match parse_compiler_args(&args,cancellation.flag("job")){
   Ok(options)=>{listen_stdin(cancellation.clone());match run_job("job",&options){Ok(pointer)=>{println!("{pointer}");0}Err(error)=>{println!("{}",error_value(&error));2}}}
   Err(usage)=>{emit(json!({"event":"error","status":"error","code":"INVALID_ARGS","message":usage}),"job");eprintln!("{usage}");2}
  }
 };
 std::process::exit(code);
}
