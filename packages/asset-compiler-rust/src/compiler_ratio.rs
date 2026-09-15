//! L'estimation d'avancement d'un travail entier. Sortie de `lib.rs` pour tenir la limite de lignes
//! du dépôt, sans rien changer aux fractions annoncées.
use serde_json::{json, Value};

/// Whole-job completion estimate attached to every progress event, so a host draws one bar without
/// knowing the phases: source import (FBX/OBJ) up to 0.30, glTF import 0.35, clustering 0.35–0.95
/// spread over the primitives announced by the `import` event, root bundles 0.95–0.99, prune 0.99, pointer 1.
pub(crate) fn with_ratio(progress: impl Fn(Value) + Sync) -> impl Fn(Value) + Sync {
    let state = std::sync::Mutex::new((0usize, 0usize));
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
            Some("bootstrap") => 0.95 + 0.02 * frac(&event),
            Some("coplanar") => 0.97 + 0.02 * frac(&event),
            Some("prune") => 0.99,
            Some("complete") => 1.0,
            _ => 0.0,
        };
        if let Some(object) = event.as_object_mut() {
            object.insert("ratio".into(), json!((ratio * 1000.0).round() / 1000.0));
        }
        progress(event);
    }
}
