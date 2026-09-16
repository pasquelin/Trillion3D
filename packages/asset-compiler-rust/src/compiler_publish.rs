//! La publication d'un travail compilé : le sidecar binaire de colonnes, le proxy résident, le
//! manifeste allégé, puis le pointeur du scope. Sorti de `compiler_build.rs` pour tenir la limite de
//! lignes du dépôt, sans rien changer à ce qui est écrit ni à l'ordre des écritures.
use super::*;
use crate::texture_preview::TexturePreview;

/// Où un résultat se dépose, et ce qu'il emporte avec lui.
pub(super) struct Publication<'a> {
    pub o: &'a Options,
    pub key: &'a str,
    pub directory: &'a Path,
    pub cache_format: u32,
    pub proxy_bytes: &'a [u8],
    pub previews: &'a [TexturePreview],
}

/// The manifest travels as a small JSON plus a binary of typed-array columns: a reader maps the
/// columns instead of tokenizing tens of megabytes before its first frame. Le pointeur du scope
/// vient en dernier : c'est la seule entrée stable d'un cache, et il ne doit jamais nommer une clé
/// dont le manifeste ne serait pas encore écrit.
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
