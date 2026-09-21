//! Publication of a compiled job: the binary column sidecar, the resident proxy,
//! the slim manifest, then the scope pointer. Split out of `compiler_build.rs` to
//! keep the repository line limit, without changing what is written or the write
//! order.
use super::*;
use crate::texture_preview::TexturePreview;

/// Where a result is stored, and what it takes with it.
pub(super) struct Publication<'a> {
    pub o: &'a Options,
    pub key: &'a str,
    pub directory: &'a Path,
    pub cache_format: u32,
    pub proxy_bytes: &'a [u8],
    pub previews: &'a [TexturePreview],
}

/// Name under which the manifest records the other products of its folder.
pub(super) const FILES_FIELD: &str = "files";

/// The manifest travels as a small JSON plus a binary of typed-array columns: a reader maps the
/// columns instead of tokenizing tens of megabytes before its first frame. The
/// scope pointer comes last: it is the only stable entry of a cache, and it must
/// never name a key whose manifest would not yet be written.
pub(super) fn publish(inputs: &Publication<'_>, result: &Value) -> Result<()> {
    let _t = perf::Timer::new(perf::Phase::Manifest);
    let templates = manifest_binary::Templates {
        binary: MANIFEST_BINARY_FILE,
        page: "../../objects/{sha}.bin",
        geometry: "../../objects/{sha}.bin",
        bundle: "../../objects/{sha}.bin",
    };
    let (mut slim, binary) = manifest_binary::split(result, &templates, inputs.previews)?;
    slim["binary"]["sha256"] = json!(hash(&binary));
    // Baked-level template: `{sha}` is the source-bytes fingerprint, `{kind}` the
    // atlas (`srgb` or `linear`), `{level}` the level rank. One truth, as for pages.
    slim["textures"] = json!({"url":format!("../../{}", texture_preview::level_template())});
    let directory = inputs.directory;
    atomic(&directory.join(MANIFEST_BINARY_FILE), &binary)?;
    atomic(&directory.join(proxy::SCENE_PROXY_FILE), inputs.proxy_bytes)?;
    // Every other product of the folder is on disk by now: the manifest records
    // each one's fingerprint, so a later job can prove the folder whole before
    // reusing it instead of rebuilding it (`compiler_reuse.rs`).
    slim[FILES_FIELD] = folder_files(directory)?;
    atomic(
        &directory.join("clusters.json"),
        &serde_json::to_vec(&slim)?,
    )?;
    write_pointer(inputs.o, inputs.key, inputs.cache_format)
}

/// Fingerprint and size of every product file in the key folder, by name: what a
/// stage writes there enters the record without being named here. The manifest
/// itself and its sidecar stay out — the sidecar is named by `binary.sha256`, and
/// the manifest cannot carry its own fingerprint. A temporary of an atomic write
/// is not a product either.
fn folder_files(directory: &Path) -> Result<Value> {
    let mut files = serde_json::Map::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let transient =
            name == "clusters.json" || name == MANIFEST_BINARY_FILE || name.contains(".tmp");
        if transient || !entry.file_type()?.is_file() {
            continue;
        }
        let (sha256, bytes) = hash_file_sized(&entry.path())?;
        files.insert(name.to_string(), json!({"sha256":sha256,"bytes":bytes}));
    }
    Ok(Value::Object(files))
}

/// The scope pointer: the only stable entry of a cache, written once the key
/// folder it names is complete — whether this job wrote it or proved it.
pub(super) fn write_pointer(o: &Options, key: &str, cache_format: u32) -> Result<()> {
    let pointer = json!({"status":"ready","formatVersion":cache_format,"compiler":"native-rust","key":key,"scope":o.scope,"url":format!("{key}/clusters.json")});
    atomic(
        &o.cache.join("native").join(&o.scope).join("manifest.json"),
        &serde_json::to_vec(&pointer)?,
    )
}
