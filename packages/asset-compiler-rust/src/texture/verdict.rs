//! The gate's verdict on a chain, kept beside its level files so a scene that
//! shares the image does not encode it again: `{kind}-{format}.gate.json` under
//! the chain's folder, whose key holds the sheet — the channels read and the
//! cutoffs — the verdict is theirs (`GateSheet::key`), and every family's
//! ladder, its efforts with it (`Effort::spelling`). The file holds the
//! measure the gate took and the effort the chain settled on, the tail of a kept chain encoded
//! again at it; it is read back only whole and only when every
//! block file it vouches for is there, and it lives under the reduction-rule
//! version like the levels, so a codec or a bar that changes never reads an
//! old verdict.
use super::bake::write::{image_dir, level_path};
use super::blocks::quality::Measure;
use super::blocks::Effort;
use super::reduce::AtlasKind;
use super::*;

/// Path of the verdict file, relative to `native/`: in the folder of the chain's key.
fn verdict_path(key: &str, kind: AtlasKind, file: &str) -> String {
    format!("{}/{}-{file}.gate.json", image_dir(key), kind.name())
}

/// The measure and the effort a previous cook left for the chain of `key` in the family's level
/// `file`, when
/// `refused` says the gate refuses it or its `levels` files above the tail are all there for a kept
/// chain; `None` otherwise. A kept verdict read here has seen every level file: the cook writes
/// none.
pub(super) fn read(
    o: &Options,
    key: &str,
    kind: AtlasKind,
    file: &str,
    levels: u32,
    refused: impl Fn(&Measure) -> bool,
) -> Option<(Measure, Effort)> {
    let native = native_dir(&o.cache);
    let value: Value =
        serde_json::from_slice(&fs::read(native.join(verdict_path(key, kind, file))).ok()?).ok()?;
    let measure = Measure {
        squared: value.get("squared")?.as_f64()?,
        samples: value.get("samples")?.as_u64()?,
        max_delta: u8::try_from(value.get("maxDelta")?.as_u64()?).ok()?,
        flips: value.get("maskFlips")?.as_u64()?,
    };
    let effort = Effort::named(value.get("effort")?.as_str()?)?;
    let files = (0..levels).all(|level| native.join(level_path(key, kind, level, file)).is_file());
    (refused(&measure) || files).then_some((measure, effort))
}

/// Writes the verdict; a write that fails costs nothing but the next cook's encode.
pub(super) fn write(
    o: &Options,
    key: &str,
    kind: AtlasKind,
    file: &str,
    (measure, effort): (&Measure, Effort),
) {
    let path = native_dir(&o.cache).join(verdict_path(key, kind, file));
    let value = json!({"squared":measure.squared,"samples":measure.samples,
        "maxDelta":measure.max_delta,"maskFlips":measure.flips,"effort":effort.name()});
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = atomic(&path, &serde_json::to_vec(&value).expect("json"));
}
