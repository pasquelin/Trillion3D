//! Whole-job progress estimate. Split out of `lib.rs` to keep the repository line
//! limit, without changing the announced fractions.
use serde_json::{json, Value};

/// Whole-job completion estimate attached to every progress event, so a host draws one bar without
/// knowing the phases: source import (FBX/OBJ) up to 0.30, glTF import 0.35, clustering 0.35–0.95
/// spread over the primitives announced by the `import` event, root bundles 0.95–0.96, coplanar cuts
/// 0.96–0.97, resident proxy 0.97, lights 0.98, reused folder 0.98, prune 0.99, pointer 1.
///
/// This estimate never goes backwards: a phase the table does not know keeps the
/// last progress reached, and a job that imports several files does not restart
/// its bar.
pub(crate) fn with_ratio(progress: impl Fn(Value) + Sync) -> impl Fn(Value) + Sync {
    let state = std::sync::Mutex::new((0usize, 0usize, 0.0f64));
    move |mut event: Value| {
        let frac = |e: &Value| {
            let total = e["total"].as_f64().unwrap_or(0.0);
            if total > 0.0 {
                (e["completed"].as_f64().unwrap_or(0.0) / total).clamp(0.0, 1.0)
            } else {
                0.0
            }
        };
        // Events come from several threads: counting and forwarding under one lock keeps ratios monotone.
        let mut guard = state.lock().unwrap();
        let ratio = match event["phase"].as_str() {
            Some("import-source") => match event["step"].as_str() {
                Some("parse") => {
                    let files = event["files"].as_f64().unwrap_or(1.0).max(1.0);
                    0.20 * ((event["index"].as_f64().unwrap_or(0.0) + frac(&event)) / files)
                }
                Some("meshes") => 0.20 + 0.08 * frac(&event),
                Some("write") => 0.29,
                _ => 0.30,
            },
            Some("import") => {
                guard.0 = event["primitives"].as_u64().unwrap_or(0) as usize;
                0.35
            }
            Some("primitive") => {
                guard.1 += 1;
                if guard.0 > 0 {
                    0.35 + 0.60 * (guard.1 as f64 / guard.0 as f64).min(1.0)
                } else {
                    0.35
                }
            }
            Some("bootstrap") => 0.95 + 0.01 * frac(&event),
            Some("coplanar") => 0.96 + 0.005 * frac(&event),
            // Textures bake between coplanar layers and the proxy: one image per step.
            Some("textures") => 0.965 + 0.005 * frac(&event),
            Some("proxy") => 0.97,
            Some("lights") => 0.98,
            // A proven folder skips clustering to the pointer: the bar jumps there, and
            // a folder refused (`completed` 0) leaves it where it was.
            Some("reuse") => 0.98 * frac(&event),
            Some("prune") => 0.99,
            Some("complete") => 1.0,
            _ => guard.2,
        };
        // A host bar never goes down: a phase slower than expected, or unknown to
        // this table, keeps the progress already announced rather than restarting
        // from zero.
        let ratio = ratio.max(guard.2);
        guard.2 = ratio;
        if let Some(object) = event.as_object_mut() {
            object.insert("ratio".into(), json!((ratio * 1000.0).round() / 1000.0));
        }
        progress(event);
    }
}
