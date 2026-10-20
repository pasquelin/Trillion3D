//! Publication of a compiled job: the resident proxy, the manifest's pages and
//! their sidecars, its root, then the scope pointer.
use super::*;
use crate::compiler_manifest_pages::{write_manifest, MeshPages};
use crate::texture_preview::TexturePreview;

/// Where a result is stored, and what it takes with it.
pub(super) struct Publication<'a> {
    pub o: &'a Options,
    pub key: &'a str,
    pub directory: &'a Path,
    pub cache_format: u32,
    pub proxy_bytes: &'a [u8],
    pub proxy_sha: &'a str,
    /// Every product already on disk in the folder, as its writer recorded it.
    pub products: &'a [Product],
    pub previews: &'a [TexturePreview],
    /// The mesh pages, written before the tables that name them.
    pub mesh_pages: &'a MeshPages,
}

/// Name under which the manifest records the other products of its folder.
pub(super) const FILES_FIELD: &str = "files";

/// The manifest travels as a small JSON plus a binary of typed-array columns: a reader maps the
/// columns instead of tokenizing tens of megabytes before its first frame. The
/// scope pointer comes last: it is the only stable entry of a cache, and it must
/// never name a key whose manifest would not yet be written.
pub(super) fn publish(inputs: &Publication<'_>, result: &Value) -> Result<()> {
    let _t = perf::Timer::new(perf::Phase::Manifest);
    let mut slim = json!({});
    // Baked-level template: `{sha}` is the source-bytes fingerprint, `{kind}` the
    // atlas (`srgb` or `linear`), `{level}` the level rank. One truth, as for pages.
    slim["textures"] = json!({
        "url": format!("../../{}", texture_preview::level_template()),
        "version": texture_preview::TEXTURE_PREVIEW_VERSION,
    });
    let directory = inputs.directory;
    let proxy = product_of(
        directory,
        proxy::SCENE_PROXY_FILE,
        inputs.proxy_bytes,
        inputs.proxy_sha,
    )?;
    slim[FILES_FIELD] = files_record(inputs.products.iter().chain([&proxy]));
    // The scene's temporal anti-aliasing level, only when the job names it: the runtime's
    // `'scene'` setting, below the quality, the page and the editor.
    if let Some(level) = inputs
        .o
        .materials
        .as_ref()
        .ok()
        .and_then(MaterialOptions::level)
    {
        slim[TEMPORAL_AA_FIELD] = json!(level);
    }
    write_manifest(result, slim, inputs.previews, inputs.mesh_pages, directory)?;
    write_pointer(inputs.o, inputs.key, inputs.cache_format)
}

/// The `files` record: fingerprint and size, by name, of every product of the
/// key folder other than the manifest's pages and sidecars — proven through its
/// root, which cannot carry its own fingerprint. `proxy.bin`
/// is in it under the digest `proxy.sha256` already carries, so that a later job
/// proves the folder whole from this one record before reusing it
/// (`compiler_reuse_proof.rs`). Each entry is what its writer had in hand: no
/// product is read back from disk to record it.
fn files_record<'a>(products: impl Iterator<Item = &'a Product>) -> Value {
    Value::Object(
        products
            .map(|p| (p.name.clone(), json!({"sha256":p.sha256,"bytes":p.bytes})))
            .collect(),
    )
}

/// The scope pointer: the only stable entry of a cache, written once the key
/// folder it names is complete — whether this job wrote it or proved it.
pub(super) fn write_pointer(o: &Options, key: &str, cache_format: u32) -> Result<()> {
    let pointer = scope_pointer(key, &o.scope, cache_format);
    atomic(&o.pointer_path(), &serde_json::to_vec(&pointer)?)
}

/// The document of the scope pointer naming `key`, the one `write_pointer` writes and the one a
/// host is handed when the job ends (`main.rs`), which adds the run's own report to it.
pub fn scope_pointer(key: &str, scope: &str, cache_format: u32) -> Value {
    json!({"status":"ready","formatVersion":cache_format,"compiler":"native-rust","key":key,"scope":scope,"url":format!("{key}/{MANIFEST_FILE}")})
}
