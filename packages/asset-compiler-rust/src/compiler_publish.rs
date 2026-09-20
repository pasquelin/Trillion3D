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
    atomic(
        &directory.join("clusters.json"),
        &serde_json::to_vec(&slim)?,
    )?;
    let (o, key) = (inputs.o, inputs.key);
    let pointer = json!({"status":"ready","formatVersion":inputs.cache_format,"compiler":"native-rust","key":key,"scope":o.scope,"url":format!("{key}/clusters.json")});
    atomic(
        &o.cache.join("native").join(&o.scope).join("manifest.json"),
        &serde_json::to_vec(&pointer)?,
    )
}

/// Builds the resident proxy and encodes it. The proxy is a cache object under its own name,
/// not a sidecar column: a manifest without it stays readable word for word, and its tens of
/// megabytes do not delay the first frame of a scene that declares no light. Returns the
/// object's bytes and the descriptor the manifest carries.
pub(super) fn stage_proxy_object(
    inputs: &proxy::ProxyInputs<'_>,
    progress: &(dyn Fn(Value) + Sync),
) -> Result<(Vec<u8>, Value)> {
    let scene_proxy = {
        let _t = perf::Timer::new(perf::Phase::Manifest);
        proxy::stage_proxy(inputs)?
    };
    progress(
        json!({"phase":"proxy","completed":1,"total":1,"triangles":scene_proxy.triangle_count(),"nodes":scene_proxy.node_count(),"errorMetres":scene_proxy.error_metres}),
    );
    let proxy_bytes = scene_proxy.encode();
    let proxy_sha = hash(&proxy_bytes);
    let descriptor = scene_proxy.descriptor(proxy::SCENE_PROXY_FILE, &proxy_sha, proxy_bytes.len());
    Ok((proxy_bytes, descriptor))
}
