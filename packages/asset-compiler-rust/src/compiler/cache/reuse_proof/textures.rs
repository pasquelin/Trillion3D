//! The baked texture levels a cached folder names, proven by their presence.
use super::*;

/// Every baked level the sidecar names, by presence: the compile path trusts a
/// level file by its name too — the chain's key (`GateSheet::key`) and the atlas
/// say what it holds. A bake the compile could not finish — a level that failed to
/// write leaves `baked` under `first`, and the report says so — is not proven: the
/// compile path would bake it again, the reuse never would. Several textures
/// read one image, so a level file is counted once. Returns the files found.
pub(crate) fn check_textures(
    native: &Path,
    manifest: &Value,
    levels: &[manifest_binary::BakedLevels],
) -> Check<usize> {
    if !manifest["texturePreviews"]["notes"][crate::texture::LEVEL_WRITE_FAILED].is_null() {
        return Err("a texture level failed to write when the folder was compiled".into());
    }
    let mut files = BTreeSet::new();
    for entry in levels {
        let kind = crate::texture::AtlasKind::from_word(entry.kind)
            .ok_or(format!("sidecar names atlas {}", entry.kind))?;
        if entry.baked < entry.first {
            return Err(format!("texture {} was not fully baked", entry.sha256));
        }
        // A half-float chain's files are its own, half-float texels or the BC6H blocks that hold it.
        let mut formats = Vec::new();
        for (family, word) in crate::texture::BlockFormat::ALL.iter().zip(entry.layouts) {
            match crate::texture::Layout::from_word(word) {
                Some(Some(layout)) if family.holds(layout) => {
                    formats.push(family.file_name(layout))
                }
                Some(Some(_)) => return Err(format!("sidecar names layout {word} in {family:?}")),
                Some(None) => {}
                None => return Err(format!("sidecar names layout {word}")),
            }
        }
        if kind == crate::texture::AtlasKind::Hdr && formats.is_empty() {
            formats.push(crate::texture::hdr::HALF_FILE);
        }
        for level in 0..entry.baked {
            for format in &formats {
                files.insert(crate::texture::level_path(
                    &entry.sha256,
                    kind,
                    level,
                    format,
                ));
            }
        }
    }
    for file in &files {
        if !native.join(file).is_file() {
            return Err(format!("texture level {file} is missing"));
        }
    }
    Ok(files.len())
}
