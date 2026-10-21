//! Cancellation of the jobs in flight: a flag per job, and the stdin listener that raises them.
use serde_json::Value;
use std::{
    collections::HashMap,
    io::BufRead,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

pub(crate) struct Cancellation {
    pub(crate) all: AtomicBool,
    pub(crate) jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
impl Cancellation {
    pub(crate) fn flag(&self, job: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(self.all.load(Ordering::Relaxed)));
        self.jobs
            .lock()
            .unwrap()
            .insert(job.to_string(), flag.clone());
        flag
    }
    pub(crate) fn cancel(&self, target: &str) {
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
pub(crate) fn listen_stdin(cancellation: Arc<Cancellation>) {
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
