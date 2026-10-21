use crate::texture::BlockFormat;

/// `--textures-format=` values: the families cooked beside the stored one (`BlockFormat::STORED`,
/// BC), which the levels are written in — BC alone by default, a device that samples none of its
/// blocks decoding it —, one more family when a cook targets one platform's, or every family
/// (`all`), each device then streaming the blocks it samples.
pub(super) const TEXTURE_FORMAT_OPTION: &str = "--textures-format=";

/// The `--textures-format=` value that cooks every family.
const ALL_TEXTURE_FORMATS: &str = "all";

/// The default `--textures-format=` value: the stored family alone.
pub(super) const DEFAULT_TEXTURE_FORMAT: &str = BlockFormat::STORED.name();

/// The values `--textures-format=` takes: `all`, each family's name (`BlockFormat::ALL`).
pub(super) fn texture_format_choices() -> Vec<&'static str> {
    let families = BlockFormat::ALL.map(BlockFormat::name);
    [&[ALL_TEXTURE_FORMATS][..], &families].concat()
}

/// The families a value cooks, the stored one first.
pub(super) fn texture_formats(value: &str) -> std::result::Result<Vec<BlockFormat>, String> {
    match value {
        ALL_TEXTURE_FORMATS => Ok(BlockFormat::ALL.to_vec()),
        name => BlockFormat::named(name)
            .map(|format| {
                let mut formats = vec![BlockFormat::STORED];
                formats.extend((format != BlockFormat::STORED).then_some(format));
                formats
            })
            .ok_or_else(|| {
                let choices = texture_format_choices().join(" or ");
                format!("textures-format must be {choices}")
            }),
    }
}

/// Batch file field of `--textures-format=`, read by the same job reader.
pub(super) const TEXTURES_FORMAT_FIELD: &str = "texturesFormat";
