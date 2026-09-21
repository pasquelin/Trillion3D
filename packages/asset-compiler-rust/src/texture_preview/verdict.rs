//! The gate's verdict on a chain, kept beside its level files so a scene that
//! shares the image does not encode it again: `{kind}-{format}-{sheet}.gate.json`
//! under the image's texture folder, the sheet — the channels read and the
//! cutoffs — in the name, since the verdict is theirs. The file holds the
//! measure the gate took; it is read back only whole and only when every
//! block file it vouches for is there, and it lives under the reduction-rule
//! version like the levels, so a codec or a bar that changes never reads an
//! old verdict.
use super::bake_write::{level_path, texture_version_dir};
use super::blocks::quality::Measure;
use super::gate::GateSheet;
use super::reduce::AtlasKind;
use super::*;

/// Path of the verdict file, relative to `native/`.
fn verdict_path(sha256: &str, kind: AtlasKind, file: &str, sheet: &GateSheet) -> String {
    let channels: String = sheet
        .channels
        .iter()
        .zip(['r', 'g', 'b', 'a'])
        .filter_map(|(&read, name)| read.then_some(name))
        .collect();
    let cutoffs: Vec<String> = sheet.cutoffs.iter().map(|c| format!("-{c}")).collect();
    format!(
        "{}/{sha256}/{}-{file}-{channels}{}.gate.json",
        texture_version_dir(),
        kind.name(),
        cutoffs.concat()
    )
}

/// The verdict a previous cook left for this chain and sheet, when its levels
/// above the tail are all there for a kept chain; `None` otherwise.
pub(super) fn read(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    file: &str,
    sheet: &GateSheet,
    first: u32,
) -> Option<Measure> {
    let native = o.cache.join("native");
    let value: Value = serde_json::from_slice(
        &fs::read(native.join(verdict_path(sha256, kind, file, sheet))).ok()?,
    )
    .ok()?;
    let measure = Measure {
        squared: value.get("squared")?.as_f64()?,
        samples: value.get("samples")?.as_u64()?,
        max_delta: u8::try_from(value.get("maxDelta")?.as_u64()?).ok()?,
        flips: value.get("maskFlips")?.as_u64()?,
    };
    let files =
        (0..first).all(|level| native.join(level_path(sha256, kind, level, file)).is_file());
    (!measure.passes() || files).then_some(measure)
}

/// Writes the verdict; a write that fails costs nothing but the next cook's encode.
pub(super) fn write(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    file: &str,
    sheet: &GateSheet,
    measure: &Measure,
) {
    let path = o
        .cache
        .join("native")
        .join(verdict_path(sha256, kind, file, sheet));
    let value = json!({"squared":measure.squared,"samples":measure.samples,
        "maxDelta":measure.max_delta,"maskFlips":measure.flips});
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = atomic(&path, &serde_json::to_vec(&value).expect("json"));
}
