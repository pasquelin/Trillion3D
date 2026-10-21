//! The files of a baked chain: every level above the sidecar tail, once in each
//! family the chain is kept in — the stored BC one always —, under one folder
//! per source fingerprint — the one storage of chains. A file already there is left as-is — the
//! fingerprint, the atlas, the level and the format say its content is the
//! right one, and rewriting it would cost encoding a 2048² on every compilation
//! of a scene that shares the image. The reduction-rule version in the path
//! keeps that promise honest.
use crate::texture::reduce::AtlasKind;
use crate::texture::*;

/// Where an image's levels live in the cache, relative to `native/`: one folder
/// per reduction-rule version, then one per fingerprint, one file per atlas, per
/// level and per format. The version is in the path because a file already
/// there is never rewritten: without it, a rule that changes would keep serving
/// levels computed by another one.
pub const TEXTURE_DIR: &str = "textures";
pub fn texture_version_dir() -> String {
    format!("{TEXTURE_DIR}/v{TEXTURE_PREVIEW_VERSION}")
}
/// The folder of one image's files, relative to `native/`: its levels (`level_template`) and the
/// gate's verdicts (`../verdict.rs`) all live there.
pub(crate) fn image_dir(sha256: &str) -> String {
    format!("{}/{sha256}", texture_version_dir())
}
/// Report note of a level file that could not be written; the entry then
/// carries no baked level, or no blocks of the family that failed.
pub const LEVEL_WRITE_FAILED: &str = "texture-level-write-failed";

/// File of a level, relative to `native/`: the template published in the
/// manifest, filled. One truth, the same the engine applies on its side.
pub fn level_path(sha256: &str, kind: AtlasKind, level: u32, format: &str) -> String {
    level_template()
        .replace("{sha}", sha256)
        .replace("{kind}", &kind.name())
        .replace("{level}", &level.to_string())
        .replace("{format}", format)
}

/// Writes the files of levels `0..count` of a chain — a texture's above its sidecar tail —,
/// `encode` giving each level's file bytes only when it is missing;
/// returns `count`. The path is the level's, in `format`.
pub(crate) fn write_levels(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    (width, height): (u32, u32),
    format: &str,
    count: u32,
    encode: impl Fn(usize, (u32, u32)) -> Result<Vec<u8>>,
) -> Result<u32> {
    let native = native_dir(&o.cache);
    for level in 0..count as usize {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureWrite);
        let path = native.join(level_path(sha256, kind, level as u32, format));
        if !path.exists() {
            let bytes = encode(level, preview_level_size(width, height, level as u32))?;
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            atomic(&path, &bytes)?;
        }
    }
    Ok(count)
}
