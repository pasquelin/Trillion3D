use super::cli_spec::parse_batch;
use super::{emit, error_value, listen_stdin, run_job, Cancellation};
use serde_json::json;
use serde_json::Value;
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Instant,
};
use web_geometry_compiler::shared_math::elapsed_ms;

pub(super) fn run_batch(spec_path: &str, cancellation: Arc<Cancellation>) -> Result<i32, String> {
    let started = Instant::now();
    let text = if spec_path == "-" {
        let mut s = String::new();
        std::io::Read::read_to_string(&mut std::io::stdin().lock(), &mut s)
            .map_err(|e| e.to_string())?;
        s
    } else {
        std::fs::read_to_string(spec_path).map_err(|e| format!("{spec_path}: {e}"))?
    };
    let spec: Value = serde_json::from_str(&text).map_err(|e| format!("batch JSON: {e}"))?;
    let (workers, jobs) = parse_batch(&spec, &cancellation)?;
    if spec_path != "-" {
        listen_stdin(cancellation.clone());
    }
    emit(
        json!({"event":"batch","jobs":jobs.len(),"workers":workers}),
        "*",
    );
    for (id, options) in &jobs {
        emit(
            json!({"event":"queued","source":options.source.to_string_lossy()}),
            id,
        );
    }
    let queue = Mutex::new(jobs.into_iter().collect::<VecDeque<_>>());
    let outcomes: Mutex<Vec<Value>> = Mutex::new(Vec::new());
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| loop {
                let next = queue.lock().unwrap().pop_front();
                let Some((id, options)) = next else { break };
                let outcome = match run_job(&id, &options) {
                    Ok(pointer) => json!({"job":id,"status":"ready","pointer":pointer}),
                    Err(error) => {
                        let mut v = error_value(&error);
                        v["job"] = json!(id);
                        v
                    }
                };
                outcomes.lock().unwrap().push(outcome);
            });
        }
    });
    let mut outcomes = outcomes.into_inner().unwrap();
    outcomes.sort_by(|a, b| a["job"].as_str().cmp(&b["job"].as_str()));
    let ready = outcomes.iter().filter(|o| o["status"] == "ready").count();
    let cancelled = outcomes.iter().filter(|o| o["code"] == "CANCELLED").count();
    let failed = outcomes.len() - ready - cancelled;
    emit(
        json!({"event":"done","completed":ready,"failed":failed,"cancelled":cancelled,"ms":elapsed_ms(started)}),
        "*",
    );
    let status = if failed == 0 && cancelled == 0 {
        "ready"
    } else if ready > 0 {
        "partial"
    } else {
        "failed"
    };
    println!(
        "{}",
        json!({"status":status,"completed":ready,"failed":failed,"cancelled":cancelled,"jobs":outcomes})
    );
    Ok(if failed == 0 && cancelled == 0 { 0 } else { 2 })
}
