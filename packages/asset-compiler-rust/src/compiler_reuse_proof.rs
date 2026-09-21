//! Proof that a cached folder is whole before `compiler_reuse.rs` keeps it: every
//! product of the folder against the fingerprint the manifest recorded, the
//! sidecar against `binary.sha256`, every object it names against its
//! content-addressed name, every baked texture level it names by its presence.
use super::*;
use compiler_reuse::{Check, Reused};

/// The folder under `key`, checked head to objects. The first failed check names
/// the reason and stops the proof: the job then recompiles.
pub(super) fn prove(
    o: &Options,
    key: &str,
    directory: &Path,
    head: &[u8],
    pool: &rayon::ThreadPool,
) -> Check<Reused> {
    let manifest: Value = serde_json::from_slice(head).map_err(|e| format!("manifest: {e}"))?;
    check_head(&manifest, key, &o.scope)?;
    // The answer sheet is a product of every compilation, at the cache root: a
    // host reads "nothing to answer" in its absence, so a folder without it is not whole.
    if !o.cache.join(cutout::DECISIONS_FILE).is_file() {
        return Err("cutout answer sheet is missing".into());
    }
    let binary =
        fs::read(directory.join(MANIFEST_BINARY_FILE)).map_err(|e| format!("sidecar: {e}"))?;
    if manifest["binary"]["sha256"] != json!(hash(&binary)) {
        return Err("sidecar does not match binary.sha256".into());
    }
    let native = o.cache.join("native");
    let (files, file_bytes) =
        check_files(o, directory, &manifest[compiler_publish::FILES_FIELD], pool)?;
    // Objects live in the sidecar columns alone; the `sha256` fields of the head
    // name the sidecar, the proxy and the recorded files, checked above.
    let digests: BTreeSet<String> = manifest_binary::digests(&binary)
        .map_err(|e| e.message)?
        .into_iter()
        .collect();
    let object_bytes = check_objects(o, &native, &digests, pool)?;
    let levels = manifest_binary::texture_levels(&binary).map_err(|e| e.message)?;
    let texture_levels = check_textures(&native, &manifest, &levels)?;
    Ok(Reused {
        report: json!({"files":files,"fileBytes":file_bytes,"objects":digests.len(),"objectBytes":object_bytes,"textureLevels":texture_levels}),
        keep: Keep::named_by(&manifest, &binary).map_err(|e| e.message)?,
        manifest,
    })
}

/// The head of the manifest says whose product it is: this key, this scope, this
/// compiler, a format this compiler writes. Anything else under the key is a
/// folder written by hand or by another build, never reused.
fn check_head(manifest: &Value, key: &str, scope: &str) -> Check<()> {
    let expected = [
        ("status", json!("ready")),
        ("key", json!(key)),
        ("scope", json!(scope)),
        ("compilerVersion", json!(COMPILER_VERSION)),
    ];
    if let Some((field, _)) = expected
        .iter()
        .find(|(field, value)| manifest[*field] != *value)
    {
        return Err(format!("manifest {field} is not this job's"));
    }
    let format = manifest["formatVersion"].as_u64().unwrap_or(0) as u32;
    if ![FORMAT_VERSION, CLUSTERED_BLEND_FORMAT_VERSION].contains(&format) {
        return Err(format!(
            "manifest format {format} is not one this compiler writes"
        ));
    }
    Ok(())
}

/// Every product the manifest recorded, by fingerprint and size, hashed side by
/// side on the job's pool. A missing record is a folder written before records
/// existed, or by hand: not proven.
fn check_files(
    o: &Options,
    directory: &Path,
    record: &Value,
    pool: &rayon::ThreadPool,
) -> Check<(usize, u64)> {
    let files = record.as_object().ok_or("manifest records no files")?;
    let one = |(name, expected): (&String, &Value)| -> Check<u64> {
        check(o).map_err(|e| e.message)?;
        if !is_safe_source_name(name) {
            return Err(format!("file record names {name:?}"));
        }
        let (sha256, size) =
            hash_file_sized(&directory.join(name)).map_err(|e| format!("{name}: {e}"))?;
        if expected["bytes"] != json!(size) {
            return Err(format!(
                "{name} is {size} bytes, not what the manifest recorded"
            ));
        }
        if expected["sha256"] != json!(sha256) {
            return Err(format!("{name} does not match its recorded fingerprint"));
        }
        Ok(size)
    };
    let entries: Vec<(&String, &Value)> = files.iter().collect();
    let sizes: Vec<u64> =
        pool.install(|| entries.par_iter().copied().map(one).collect::<Check<_>>())?;
    Ok((files.len(), sizes.iter().sum()))
}

/// Every object the manifest names, against its content-addressed name: the same
/// check the compile path applies before it reuses an object
/// (`compiler_page_object.rs`), on the job's own pool. Returns the bytes proven.
fn check_objects(
    o: &Options,
    native: &Path,
    digests: &BTreeSet<String>,
    pool: &rayon::ThreadPool,
) -> Check<u64> {
    let objects = native.join("objects");
    let one = |digest: &String| -> Check<u64> {
        check(o).map_err(|e| e.message)?;
        if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("manifest names object {digest:?}"));
        }
        let path = objects.join(format!("{digest}.bin"));
        let (sha256, bytes) =
            hash_file_sized(&path).map_err(|e| format!("object {digest}: {e}"))?;
        if sha256 != *digest {
            return Err(format!("object {digest} does not match its name"));
        }
        Ok(bytes)
    };
    let sizes: Vec<u64> = pool.install(|| digests.par_iter().map(one).collect::<Check<_>>())?;
    Ok(sizes.iter().sum())
}

/// Every baked level the sidecar names, by presence: the compile path trusts a
/// level file by its name too — the source-image fingerprint and the atlas say
/// what it holds. A bake the compile could not finish — a level that failed to
/// write leaves `baked` under `first`, and the report says so — is not proven: the
/// compile path would bake it again, the reuse never would. Several textures
/// read one image, so a level file is counted once. Returns the files found.
pub(super) fn check_textures(
    native: &Path,
    manifest: &Value,
    levels: &[manifest_binary::BakedLevels],
) -> Check<usize> {
    if !manifest["texturePreviews"]["notes"][texture_preview::LEVEL_WRITE_FAILED].is_null() {
        return Err("a texture level failed to write when the folder was compiled".into());
    }
    let mut files = BTreeSet::new();
    for entry in levels {
        let kind = texture_preview::AtlasKind::from_word(entry.kind)
            .ok_or(format!("sidecar names atlas {}", entry.kind))?;
        if !is_safe_source_name(&entry.sha256) {
            return Err(format!("sidecar names texture {:?}", entry.sha256));
        }
        if entry.baked < entry.first {
            return Err(format!("texture {} was not fully baked", entry.sha256));
        }
        for level in 0..entry.baked {
            files.insert(texture_preview::level_path(&entry.sha256, kind, level));
        }
    }
    for file in &files {
        if !native.join(file).is_file() {
            return Err(format!("texture level {file} is missing"));
        }
    }
    Ok(files.len())
}
