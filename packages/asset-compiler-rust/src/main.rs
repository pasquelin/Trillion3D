//! Command line front of the compiler. Hosts talk to it with three streams only:
//! - arguments (one job) or `--jobs FILE|-` (a JSON batch) tell it what to prepare;
//! - stderr carries one JSON event per line: queued, accepted, progress, stall, complete, error, done;
//! - stdout carries the final pointer(s), about a kilobyte each, never the compiled manifest.
//!
//! A JSON line `{"cancel":"*"}` or `{"cancel":"<job>"}` on stdin cancels; killing the process is also safe
//! because every output file is written atomically.
mod cli_batch;
mod cli_cancel;
mod cli_spec;
mod cli_stalls;
mod messages;
use cli_batch::run_batch;
use cli_cancel::{listen_stdin, Cancellation};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Write,
    path::Path,
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::Instant,
};
use trillion3d_compiler::{
    compile, parse_compiler_args, plugins, shared_math::elapsed_ms, CompilerError, Options,
    COMPILER_VERSION, FORMAT_VERSION,
};
/// Per-thread heaps for the Rayon workers (`Cargo.toml`, `mimalloc`).
#[global_allocator]
static ALLOCATOR: mimalloc::MiMalloc = mimalloc::MiMalloc;

fn emit(mut event: Value, job: &str) {
    messages::decorate(&mut event);
    if let Some(object) = event.as_object_mut() {
        object.insert("job".into(), json!(job));
    }
    let _ = writeln!(std::io::stderr().lock(), "{event}");
}
/// A failure as hosts read it: its code, message and, from the catalogue, its public id.
fn error_value(error: &CompilerError) -> Value {
    let mut value = json!({"status":"error","code":error.code,"message":error.message});
    messages::decorate(&mut value);
    value
}

/// What a host needs after a job: where the pointer lives and the run's own report — its metrics,
/// times and memory peak, which the manifest on disk never carries, and `reusedPages`, the
/// pages it found already built (`null` on a kept folder). `reused` says the folder was proven and
/// kept rather than written (`null` otherwise): the manifest on disk describes the product, not
/// this run. `textureSkipped` and `textureNotes` count the texture stage's reasons by catalogue
/// code, so a host summarises them without reading the manifest.
fn pointer(result: &Value, cache: &Path) -> Value {
    let scope = result["scope"].as_str().unwrap_or("");
    let key = result["key"].as_str().unwrap_or("");
    json!({"status":"ready","key":key,"scope":scope,"url":format!("{key}/clusters.json"),"pointer":cache.join("native").join(scope).join("manifest.json").to_string_lossy(),"cache":cache.to_string_lossy(),
  "formatVersion":result["formatVersion"],"compilerVersion":result["compilerVersion"],"selectedTriangles":result["selectedTriangles"],"sourceTriangles":result["sourceTriangles"],"selectedNodes":result["selectedNodes"],"totalNodes":result["totalNodes"],"primitives":result["primitives"].as_array().map(|a|a.len()).unwrap_or(0),"simplification":result["simplification"],
  "metrics":result["metrics"],"reusedPages":result["reused"].is_null().then(||result["primitives"].as_array().map(|a|a.iter().filter_map(|p|p["reusedPages"].as_u64()).sum::<u64>())),
  "unsupported":result["unsupported"],"textureSkipped":result["texturePreviews"]["skipped"],"textureNotes":result["texturePreviews"]["notes"],"reused":result["reused"]})
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
            cli_stalls::emit_worst(&result, id);
            let pointer = pointer(&result, &options.cache);
            emit(
                json!({"event":"complete","ratio":1.0,"pointer":pointer,"ms":elapsed_ms(started)}),
                id,
            );
            Ok(pointer)
        }
        Err(error) => {
            let mut event = error_value(&error);
            event["event"] = json!(if error.code == trillion3d_compiler::CANCELLED {
                "cancelled"
            } else {
                "error"
            });
            event["ms"] = json!(elapsed_ms(started));
            emit(event, id);
            Err(error)
        }
    }
}

/// Returns its code rather than calling `process::exit`, which on Windows skips the exit handlers
/// that write the profile of a build trained for profile guidance.
fn main() -> std::process::ExitCode {
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
        // The crate folders the build read, each ending in `/`, then the files it hashed into the
        // implementation hash, one per line (`build_inputs.rs`): what a host compares with the
        // sources to call this binary stale.
        Some("--build-inputs") => {
            print!(
                "{}",
                include_str!(concat!(env!("OUT_DIR"), "/implementation_crates.txt"))
            );
            println!(
                "{}",
                include_str!(concat!(env!("OUT_DIR"), "/implementation_inputs.txt"))
            );
            0
        }
        Some("--jobs") => match args.get(1) {
            Some(path) => match run_batch(path, cancellation) {
                Ok(code) => code,
                Err(message) => {
                    let code = "INVALID_BATCH";
                    let refusal = error_value(&CompilerError { code, message });
                    let mut event = refusal.clone();
                    event["event"] = json!("error");
                    emit(event, "*");
                    println!("{refusal}");
                    2
                }
            },
            None => {
                eprintln!("Usage: trillion3d-compiler --jobs FILE|-");
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
    std::process::ExitCode::from(code as u8)
}
