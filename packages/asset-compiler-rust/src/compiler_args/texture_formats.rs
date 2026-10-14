use crate::texture_preview::BlockFormat;

/// `--textures-format=` values: every family by default — each device then streams the blocks it
/// samples, and PNG is the last fallback —, one family when a cook targets one platform, or none.
pub(super) const TEXTURE_FORMAT_OPTION: &str = "--textures-format=";

/// The default `--textures-format=` value: every family.
pub(super) const ALL_TEXTURE_FORMATS: &str = "all";
/// The `--textures-format=` value that writes no block family.
const NO_TEXTURE_FORMAT: &str = "none";

/// The values `--textures-format=` takes: `all`, each family's name (`BlockFormat::ALL`), `none`.
pub(super) fn texture_format_choices() -> Vec<&'static str> {
    let families = BlockFormat::ALL.map(BlockFormat::name);
    [&[ALL_TEXTURE_FORMATS][..], &families, &[NO_TEXTURE_FORMAT]].concat()
}

pub(super) fn texture_formats(value: &str) -> std::result::Result<Vec<BlockFormat>, String> {
    match value {
        ALL_TEXTURE_FORMATS => Ok(BlockFormat::ALL.to_vec()),
        NO_TEXTURE_FORMAT => Ok(Vec::new()),
        name => BlockFormat::named(name)
            .map(|format| vec![format])
            .ok_or_else(|| {
                let choices = texture_format_choices().join(" or ");
                format!("textures-format must be {choices}")
            }),
    }
}

/// Batch file field of `--textures-format=`, read by the same job reader.
pub(super) const TEXTURES_FORMAT_FIELD: &str = "texturesFormat";
