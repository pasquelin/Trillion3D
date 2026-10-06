//! The public message catalogue (`packages/sdk-node/src/messages/messages.json`), the one source of
//! truth the compiler, the Node adapter and the documentation read. Each entry gives a code its stable public
//! id (`T3D-Exxx` error, `T3D-Wxxx` warning, `T3D-Ixxx` info) and its documentation page. The
//! compiler keeps writing its symbolic codes (`DAG_FLAT`, `blend-truncated`) in the cache; only the
//! events it prints on stderr and stdout are decorated, so no cache byte depends on the catalogue.
use serde_json::{json, Value};
use std::{collections::HashMap, sync::OnceLock};

const CATALOGUE: &str = include_str!("../../sdk-node/src/messages/messages.json");

struct Catalogue {
    docs: String,
    by_code: HashMap<String, Value>,
}

fn catalogue() -> &'static Catalogue {
    static PARSED: OnceLock<Catalogue> = OnceLock::new();
    PARSED.get_or_init(|| {
        let root: Value = serde_json::from_str(CATALOGUE).expect("messages.json is valid JSON");
        let docs = root["docs"].as_str().unwrap_or_default().to_string();
        let by_code = root["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|m| Some((m["code"].as_str()?.to_string(), m.clone())))
            .collect();
        Catalogue { docs, by_code }
    })
}

/// The catalogue entry of a symbolic code; a code carrying a detail after `:`
/// (`ma-command-ignored:python`) is the entry of its name.
fn entry(code: &str) -> Option<&'static Value> {
    let name = code.split_once(':').map_or(code, |(name, _)| name);
    catalogue().by_code.get(name)
}

/// Adds `id`, `level`, `action` and `docs` beside a `code` the catalogue knows; a code it does not
/// know is left as it is.
fn describe(object: &mut Value) {
    let Some(entry) = object["code"].as_str().and_then(entry) else {
        return;
    };
    let id = entry["id"].as_str().unwrap_or_default();
    object["id"] = json!(id);
    object["level"] = entry["level"].clone();
    object["action"] = entry["action"].clone();
    object["docs"] = json!(format!("{}#{}", catalogue().docs, id.to_lowercase()));
}

/// Decorates an event before it is printed: its own `code` (an error) and each of its `warnings`.
pub(crate) fn decorate(event: &mut Value) {
    if event.get("code").is_some() {
        describe(event);
    }
    if let Some(warnings) = event.get_mut("warnings").and_then(Value::as_array_mut) {
        warnings.iter_mut().for_each(describe);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: an error event and a primitive's DAG warnings leave with their public id, level,
    // action and documentation page; a detailed code is found by its name, an unknown one is kept.
    #[test]
    fn events_carry_the_public_id_of_their_codes() {
        let mut error = json!({"event":"error","code":"CACHE_LOCKED","message":"busy"});
        decorate(&mut error);
        assert!(error["id"]
            .as_str()
            .is_some_and(|id| id.starts_with("T3D-E")));
        assert_eq!(error["level"], "error");
        assert!(error["docs"]
            .as_str()
            .is_some_and(|d| d.contains("COMPILER_ERRORS.md#t3d-")));
        let mut primitive = json!({"phase":"primitive","warnings":[{"code":"DAG_FLAT"}]});
        decorate(&mut primitive);
        assert_eq!(primitive["warnings"][0]["level"], "warn");
        assert!(entry("ma-command-ignored:python").is_some());
        let mut unknown = json!({"code":"NOT_A_CODE"});
        decorate(&mut unknown);
        assert_eq!(unknown, json!({"code":"NOT_A_CODE"}));
    }
}
