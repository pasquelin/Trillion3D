//! Command line front of the compiler. Hosts talk to it with three streams only:
//! - arguments (one job) or `--jobs FILE|-` (a JSON batch) tell it what to prepare;
//! - stderr carries one JSON event per line: queued, accepted, progress, complete, error, done;
//! - stdout carries the final pointer(s), a few hundred bytes, never the compiled manifest.
//!
//! A JSON line `{"cancel":"*"}` or `{"cancel":"<job>"}` on stdin cancels; killing the process is also safe
//! because every output file is written atomically.
mod cli_batch;
use cli_batch::run_batch;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use web_geometry_compiler::{
    compile, parse_compiler_args, plugins, CompilerError, Options, COMPILER_VERSION, FORMAT_VERSION,
};

fn emit(mut event: Value, job: &str) {
    if let Some(object) = event.as_object_mut() {
        object.insert("job".into(), json!(job));
    }
    let stderr = std::io::stderr();
    let mut lock = stderr.lock();
    let _ = writeln!(lock, "{event}");
}
fn error_value(error: &CompilerError) -> Value {
    json!({"status":"error","code":error.code,"message":error.message})
}

/// What a host needs after a job: where the pointer lives and the headline numbers. The full manifest stays on disk.
fn pointer(result: &Value, cache: &Path) -> Value {
    let scope = result["scope"].as_str().unwrap_or("");
    let key = result["key"].as_str().unwrap_or("");
    json!({"status":"ready","key":key,"scope":scope,"url":format!("{key}/clusters.json"),"pointer":cache.join("native").join(scope).join("manifest.json").to_string_lossy(),"cache":cache.to_string_lossy(),
  "formatVersion":result["formatVersion"],"compilerVersion":result["compilerVersion"],"selectedTriangles":result["selectedTriangles"],"sourceTriangles":result["sourceTriangles"],"selectedNodes":result["selectedNodes"].as_array().map(|a|a.len()).unwrap_or(0),"totalNodes":result["totalNodes"],"primitives":result["primitives"].as_array().map(|a|a.len()).unwrap_or(0),"simplification":result["simplification"],
  "metrics":{"importMs":result["metrics"]["importMs"],"clusterHierarchyPagesMs":result["metrics"]["clusterHierarchyPagesMs"],"wallMs":result["metrics"]["wallMs"],"outputGeometryBytes":result["metrics"]["outputGeometryBytes"],"threads":result["metrics"]["threads"],"ramBudgetMb":result["metrics"]["ramBudgetMb"]},
  "unsupported":result["unsupported"]})
}

struct Cancellation {
    all: AtomicBool,
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
impl Cancellation {
    fn flag(&self, job: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(self.all.load(Ordering::Relaxed)));
        self.jobs
            .lock()
            .unwrap()
            .insert(job.to_string(), flag.clone());
        flag
    }
    fn cancel(&self, target: &str) {
        if target == "*" {
            self.all.store(true, Ordering::Relaxed);
            for flag in self.jobs.lock().unwrap().values() {
                flag.store(true, Ordering::Relaxed);
            }
        } else if let Some(flag) = self.jobs.lock().unwrap().get(target) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}
/// stdin is optional: a host that ignores it gets EOF at once and the listener ends.
fn listen_stdin(cancellation: Arc<Cancellation>) {
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else { break };
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if let Some(target) = value.get("cancel") {
                    match target {
                        Value::String(s) => cancellation.cancel(s),
                        Value::Bool(true) => cancellation.cancel("*"),
                        _ => {}
                    }
                }
            }
        }
    });
}

fn run_job(id: &str, options: &Options) -> Result<Value, CompilerError> {
    let started = Instant::now();
    emit(
        json!({"event":"accepted","ratio":0.0,"source":options.source.to_string_lossy(),"cache":options.cache.to_string_lossy(),"scope":options.scope,"triangles":options.triangle_budget,"threads":options.threads,"ramBudgetMb":options.ram_budget_mb,"simplification":options.simplification}),
        id,
    );
    let job = id.to_string();
    let result = compile(options, |mut event| {
        if let Some(object) = event.as_object_mut() {
            object.insert("event".into(), json!("progress"));
        }
        emit(event, &job)
    });
    match result {
        Ok(result) => {
            let pointer = pointer(&result, &options.cache);
            emit(
                json!({"event":"complete","ratio":1.0,"pointer":pointer,"ms":started.elapsed().as_secs_f64()*1000.0}),
                id,
            );
            Ok(pointer)
        }
        Err(error) => {
            let mut event = error_value(&error);
            event["event"] = json!(if error.code == "CANCELLED" {
                "cancelled"
            } else {
                "error"
            });
            event["ms"] = json!(started.elapsed().as_secs_f64() * 1000.0);
            emit(event, id);
            Err(error)
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cancellation = Arc::new(Cancellation {
        all: AtomicBool::new(false),
        jobs: Mutex::new(HashMap::new()),
    });
    let code = match args.first().map(String::as_str) {
        Some("--version") => {
            println!(
                "{}",
                json!({"compilerVersion":COMPILER_VERSION,"formatVersion":FORMAT_VERSION,"plugins":plugins::descriptor(),"platform":std::env::consts::OS,"arch":std::env::consts::ARCH})
            );
            0
        }
        Some("--jobs") => match args.get(1) {
            Some(path) => match run_batch(path, cancellation) {
                Ok(code) => code,
                Err(message) => {
                    emit(
                        json!({"event":"error","status":"error","code":"INVALID_BATCH","message":message}),
                        "*",
                    );
                    println!(
                        "{}",
                        json!({"status":"error","code":"INVALID_BATCH","message":message})
                    );
                    2
                }
            },
            None => {
                eprintln!("Usage: web-geometry-compiler --jobs FILE|-");
                2
            }
        },
        _ => match parse_compiler_args(&args, cancellation.flag("job")) {
            Ok(options) => {
                listen_stdin(cancellation.clone());
                match run_job("job", &options) {
                    Ok(pointer) => {
                        println!("{pointer}");
                        0
                    }
                    Err(error) => {
                        println!("{}", error_value(&error));
                        2
                    }
                }
            }
            Err(usage) => {
                emit(
                    json!({"event":"error","status":"error","code":"INVALID_ARGS","message":usage}),
                    "job",
                );
                eprintln!("{usage}");
                2
            }
        },
    };
    std::process::exit(code);
}
