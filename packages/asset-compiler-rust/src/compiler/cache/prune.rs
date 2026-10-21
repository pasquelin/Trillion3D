use crate::compiler::pages::manifest::Paged;
use crate::*;

mod scratch;
use scratch::remove_scratch;

/// Every object descriptor `json` holds — a manifest, or the physics document whose shapes it
/// lists: each `{url, sha256}` `store_descriptor` wrote, known by its object URL (the geometry
/// containers, the physics shapes), and each shape the manifest's `physics`
/// lists by digest. The one rule of what a manifest keeps, for prune and the reuse proof alike: a
/// bundle's digest in `streams`, the proxy's and a sidecar's name no object.
pub(crate) fn object_descriptors(json: &Value) -> Vec<&Value> {
    fn walk<'a>(value: &'a Value, into: &mut Vec<&'a Value>) {
        match value {
            Value::Object(map) => {
                let named = |key| map.get(key).and_then(Value::as_str);
                let object = named("sha256").zip(named("url"));
                if object.is_some_and(|(sha256, url)| url == object_url(sha256)) {
                    return into.push(value);
                }
                map.values().for_each(|v| walk(v, into));
            }
            Value::Array(items) => items.iter().for_each(|v| walk(v, into)),
            _ => {}
        }
    }
    let mut into = Vec::new();
    walk(json, &mut into);
    into.extend(json["physics"]["objects"].as_array().into_iter().flatten());
    into
}

/// The digests of every object `json` names (`object_descriptors`).
pub(crate) fn referenced_objects(json: &Value, into: &mut BTreeSet<String>) {
    let digests = object_descriptors(json).into_iter();
    into.extend(
        digests
            .filter_map(|d| d["sha256"].as_str())
            .map(str::to_owned),
    );
}
/// Every chain of the textures' storage a published manifest reads: a texture's, by its
/// sidecar columns. The one rule of which chains a manifest keeps, for prune and the reuse proof
/// alike.
pub(crate) fn baked_chains(paged: &Paged) -> Result<Vec<crate::manifest_binary::BakedLevels>> {
    let mut chains = Vec::new();
    for sidecar in &paged.sidecars {
        chains.extend(crate::manifest_binary::texture_levels(sidecar)?);
    }
    Ok(chains)
}
/// A sidecar this compiler cannot read: prune stops on it, cache intact.
fn unreadable(e: impl Display) -> CompilerError {
    CompilerError::new(
        "UNSUPPORTED_FORMAT",
        format!("Cached manifest binary is not readable by this compiler: {e}"),
    )
}
/// What the key just published or proved still needs: its objects and the chains whose baked
/// levels it reads — their keys (`GateSheet::key`). Everything else of the cache may go.
pub(crate) struct Keep {
    pub objects: BTreeSet<String>,
    pub textures: BTreeSet<String>,
}
impl Keep {
    /// What a result just published names: its objects and the chain keys of its previews.
    pub fn of_result(result: &Value, previews: &[crate::texture::TexturePreview]) -> Self {
        let mut objects = BTreeSet::new();
        referenced_objects(result, &mut objects);
        let textures = previews.iter().map(|p| p.sha256.clone()).collect();
        Self { objects, textures }
    }
    /// What a published manifest and its sidecars name, for a scope this job does
    /// not touch: the objects in the manifest and the chains in the sidecar columns
    /// (`baked_chains`).
    pub fn named_by(paged: &Paged) -> Result<Self> {
        let mut objects = BTreeSet::new();
        referenced_objects(&paged.manifest, &mut objects);
        let chains = baked_chains(paged).map_err(unreadable)?;
        let textures = chains.into_iter().map(|level| level.sha256).collect();
        Ok(Self { objects, textures })
    }
}
/// Objects and image fingerprints named by a scope that is not recompiled. Without
/// a readable manifest, prune cannot decide what to keep, so it fails and deletes
/// nothing rather than counting that scope as zero objects.
fn other_scope(dir: &Path, keep: &mut Keep) -> Result<()> {
    if !dir.join(MANIFEST_FILE).is_file() {
        return Ok(());
    }
    let paged = crate::compiler::pages::manifest::read_manifest_at(dir)
        .map_err(|e| unreadable(format!("{}: {e}", dir.display())))?;
    let named = Keep::named_by(&paged)?;
    keep.objects.extend(named.objects);
    keep.textures.extend(named.textures);
    Ok(())
}

/// After a successful compile, remove the other keys of this scope and every object no surviving
/// manifest references. Objects are shared across scopes, so the other scope's manifest is read too.
/// Hosts therefore never need to wipe a cache before recompiling: the cache converges on its own.
pub(crate) fn prune_cache(
    o: &Options,
    key: &str,
    mut keep: Keep,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Value> {
    let native = native_dir(&o.cache);
    let mut removed_keys = 0usize;
    for scope in crate::shared_math::abi::SCOPES {
        let dir = native.join(scope);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        // Each scope keeps exactly the key its pointer names; for this scope that is the key just written.
        let current = if scope == o.scope {
            Some(key.to_string())
        } else {
            fs::read(dir.join(crate::MANIFEST_POINTER))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|p| p["key"].as_str().map(str::to_owned))
        };
        // The other scope is read before any deletion: a missing sidecar or one of
        // another version stops prune, cache intact, instead of erasing the objects
        // and texture levels it still uses.
        if scope != o.scope {
            if let Some(name) = current.as_deref() {
                other_scope(&dir.join(name), &mut keep)?;
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
    let imports = imports_dir(&o.cache);
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
    remove_scratch(&o.cache)?;
    let mut removed_objects = 0usize;
    let mut removed_bytes = 0u64;
    let mut kept_objects = 0usize;
    if let Ok(entries) = fs::read_dir(objects_dir(&o.cache)) {
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let digest = name.trim_end_matches(".bin");
            if keep.objects.contains(digest) {
                kept_objects += 1;
            } else {
                removed_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
                fs::remove_file(entry.path())?;
                removed_objects += 1;
            }
        }
    }
    let (removed_textures, texture_bytes) =
        super::prune_textures::prune_textures(&native, &keep.textures)?;
    let summary = json!({"removedKeys":removed_keys,"removedObjects":removed_objects,"removedBytes":removed_bytes,"keptObjects":kept_objects,
        "removedTextures":removed_textures,"removedTextureBytes":texture_bytes});
    if removed_keys > 0 || removed_objects > 0 || removed_textures > 0 {
        progress(
            json!({"phase":"prune","completed":1,"total":1,"removedKeys":removed_keys,"removedObjects":removed_objects,"removedBytes":removed_bytes,
            "removedTextures":removed_textures,"removedTextureBytes":texture_bytes}),
        );
    }
    Ok(summary)
}
