use super::*;

pub(super) fn referenced_objects(
    json: &Value,
    binary: Option<&[u8]>,
    into: &mut BTreeSet<String>,
) -> Result<()> {
    fn walk(value: &Value, into: &mut BTreeSet<String>) {
        match value {
            Value::Object(map) => {
                for (k, v) in map {
                    if k == "sha256" {
                        if let Some(s) = v.as_str() {
                            if s.len() == 64 {
                                into.insert(s.to_string());
                            }
                        }
                    } else {
                        walk(v, into);
                    }
                }
            }
            Value::Array(items) => {
                for v in items {
                    walk(v, into);
                }
            }
            _ => {}
        }
    }
    walk(json, into);
    if let Some(bytes) = binary {
        // Un sidecar d'une autre version range ses colonnes autrement : le lire comme « aucun objet
        // référencé » ferait supprimer des pages encore utilisées, donc le format inconnu est refusé.
        into.extend(manifest_binary::digests(bytes).map_err(|e| {
            CompilerError::new(
                "UNSUPPORTED_FORMAT",
                format!("Cached manifest binary is not readable by this compiler: {e}"),
            )
        })?);
    }
    Ok(())
}
/// Les objets qu'un scope qu'on ne recompile pas nomme. Ses pages ne vivent que dans les colonnes de
/// son sidecar : sans sidecar lisible, aucune purge ne peut décider quoi garder, donc elle échoue
/// et ne supprime rien plutôt que de compter ce scope pour zéro objet.
fn other_scope_objects(dir: &Path, into: &mut BTreeSet<String>) -> Result<()> {
    let Ok(text) = fs::read(dir.join("clusters.json")) else {
        return Ok(());
    };
    let binary = fs::read(dir.join(MANIFEST_BINARY_FILE)).map_err(|e| {
        CompilerError::new(
            "UNSUPPORTED_FORMAT",
            format!(
                "Cached manifest of {} has no readable sidecar: {e}",
                dir.display()
            ),
        )
    })?;
    referenced_objects(&serde_json::from_slice(&text)?, Some(&binary), into)
}
/// After a successful compile, remove the other keys of this scope and every object no surviving
/// manifest references. Objects are shared across scopes, so the other scope's manifest is read too.
/// Hosts therefore never need to wipe a cache before recompiling: the cache converges on its own.
pub(super) fn prune_cache(
    o: &Options,
    key: &str,
    result: &Value,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Value> {
    let native = o.cache.join("native");
    let mut keep = BTreeSet::new();
    referenced_objects(result, None, &mut keep)?;
    let mut removed_keys = 0usize;
    for scope in ["slice", "full"] {
        let dir = native.join(scope);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        // Each scope keeps exactly the key its pointer names; for this scope that is the key just written.
        let current = if scope == o.scope {
            Some(key.to_string())
        } else {
            fs::read(dir.join("manifest.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|p| p["key"].as_str().map(str::to_owned))
        };
        // L'autre scope est lu avant la moindre suppression : un sidecar absent ou d'une autre
        // version arrête la purge, cache intact, au lieu d'effacer les pages qu'il utilise encore.
        if scope != o.scope {
            if let Some(name) = current.as_deref() {
                other_scope_objects(&dir.join(name), &mut keep)?;
            }
        }
        for entry in entries {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if current.as_deref() != Some(name) {
                fs::remove_dir_all(entry.path())?;
                removed_keys += 1;
            }
        }
    }
    // Stale FBX/OBJ imports: keep the one this compile read, drop the others.
    let imports = native.join("imports");
    if o.source.starts_with(&imports) {
        if let Ok(entries) = fs::read_dir(&imports) {
            for entry in entries {
                let entry = entry?;
                if entry.file_type()?.is_dir() && entry.path() != o.source {
                    fs::remove_dir_all(entry.path())?;
                    removed_keys += 1;
                }
            }
        }
    }
    let mut removed_objects = 0usize;
    let mut removed_bytes = 0u64;
    let mut kept_objects = 0usize;
    if let Ok(entries) = fs::read_dir(native.join("objects")) {
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let digest = name.trim_end_matches(".bin");
            if keep.contains(digest) {
                kept_objects += 1;
            } else {
                removed_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                fs::remove_file(entry.path())?;
                removed_objects += 1;
            }
        }
    }
    let summary = json!({"removedKeys":removed_keys,"removedObjects":removed_objects,"removedBytes":removed_bytes,"keptObjects":kept_objects});
    if removed_keys > 0 || removed_objects > 0 {
        progress(
            json!({"phase":"prune","completed":1,"total":1,"removedKeys":removed_keys,"removedObjects":removed_objects,"removedBytes":removed_bytes}),
        );
    }
    Ok(summary)
}
