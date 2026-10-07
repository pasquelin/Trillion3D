//! Cutouts declared in blend: measure, propose, obey.
//!
//! Reference virtualized geometry accepts only opaque and masked. Foliage
//! declared in blend bypasses fast path — user opens material and checks "masked" before delivery.
//! We import other people's files: nobody ticked the box. The compiler takes that
//! role, but never guesses in silence.
//!
//! Two-stage mechanism. Compiler MEASURES alpha of candidate texture,
//! during preview decoding, and PROPOSES verdict; writes answer sheet
//! alongside compiled model, every compilation, whether items to decide or not.
//! Applies only what sheet answers, ordered by image fingerprint:
//! answer holds for any scene sharing texture. Without answer, nothing
//! changes, blend remains blend.
use super::*;

mod apply;
mod cache;
pub(crate) mod measure;
mod sheet;
#[cfg(test)]
mod tests;

pub(crate) use apply::{apply_decisions, CutoutApplied};
pub(crate) use cache::MeasureCache;
pub(crate) use measure::{measure, AlphaShape};
pub(crate) use sheet::{build_sheet, draw_weights, entries, write_sheet};

/// Answer sheet name, at compiled model root: stable path, compilation key
/// does not move and cache purge does not touch. Compiler renders
/// nothing — publishes pending textures, caller (terminal or app)
/// presents and collects answers.
pub const DECISIONS_FILE: &str = "decoupes.json";
/// Sheet contract version, published in compilation report: governs
/// ANSWERS reader writes, nothing else. Unknown version refused,
/// misread answer would alter image unrequested.
pub const SHEET_VERSION: u64 = 1;
/// Cutout threshold for reclassified material, glTF default.
pub(crate) const CUTOUT_ALPHA: f64 = 0.5;

/// Read answers, indexed by image fingerprint. Missing sheet, or sheet where no one
/// decided, is normal case: scene stays as declared.
pub(crate) struct Decisions {
    /// The sheet in the cache, the one the compiler writes, whichever held the answers read.
    sheet: PathBuf,
    by_image: BTreeMap<String, bool>,
    pub(crate) measurements: MeasureCache,
}

impl Decisions {
    /// Answer for this image, or `None` when undecided.
    pub fn verdict(&self, sha256: &str) -> Option<bool> {
        self.by_image.get(sha256).copied()
    }
    pub fn answers(&self) -> impl Iterator<Item = (&String, bool)> {
        self.by_image
            .iter()
            .map(|(sha256, cutout)| (sha256, *cutout))
    }
    /// The answers the scene was compiled with and the sheet that keeps them; whether a sheet was
    /// already there, and which one was read, is this run's history, not the product.
    pub fn report(&self) -> Value {
        json!({"file":self.sheet.to_string_lossy(),"answers":self.by_image.len()})
    }
}

/// Reads compiled model sheet. When missing — first compilation, cache
/// cleared —, sheet delivered with source seeds it: vendor can deliver
/// answers with model. Source never written.
pub(crate) fn load_decisions(cache: &Path, source: &Path) -> Result<Decisions> {
    let sheet = cache.join(DECISIONS_FILE);
    let seed = source_directory(source).join(DECISIONS_FILE);
    let (path, bytes) = match fs::read(&sheet) {
        Ok(bytes) => (sheet.clone(), Some(bytes)),
        Err(_) => match fs::read(&seed) {
            Ok(bytes) => (seed, Some(bytes)),
            Err(_) => (sheet.clone(), None),
        },
    };
    let Some(bytes) = bytes else {
        return Ok(Decisions {
            sheet,
            by_image: BTreeMap::new(),
            measurements: MeasureCache::default(),
        });
    };
    let parsed = parse_sheet(&path, &bytes)?;
    Ok(Decisions {
        sheet,
        by_image: read_answers(&path, &parsed)?,
        measurements: MeasureCache::read(&parsed),
    })
}

/// Folder where sheet delivered with source would lie: prepared scene folder or
/// file to import.
fn source_directory(source: &Path) -> PathBuf {
    if source.is_dir() {
        return source.to_path_buf();
    }
    source.parent().unwrap_or(Path::new(".")).to_path_buf()
}

fn refuse(message: String) -> CompilerError {
    CompilerError::new("INVALID_CUTOUT_DECISIONS", message)
}

/// The sheet, parsed. An unreadable sheet or an unknown version is an error.
fn parse_sheet(path: &Path, bytes: &[u8]) -> Result<Value> {
    let parsed: Value = serde_json::from_slice(bytes)
        .map_err(|error| refuse(format!("{} is not readable JSON: {error}", path.display())))?;
    if parsed.get("version").and_then(Value::as_u64) != Some(SHEET_VERSION) {
        return Err(refuse(format!(
            "{} declares an unknown version",
            path.display()
        )));
    }
    Ok(parsed)
}

/// Sheet answers. A non-boolean/non-null answer is an error: a user answer is never dropped in
/// silence.
fn read_answers(path: &Path, parsed: &Value) -> Result<BTreeMap<String, bool>> {
    let mut answers = BTreeMap::new();
    let textures = parsed.get("textures").and_then(Value::as_object);
    for (sha256, entry) in textures.into_iter().flatten() {
        match entry.get("cutout").unwrap_or(&Value::Null) {
            Value::Null => continue,
            Value::Bool(cutout) => answers.insert(sha256.clone(), *cutout),
            _ => {
                return Err(refuse(format!(
                    "{}: texture {sha256} answers neither true, false nor null",
                    path.display()
                )))
            }
        };
    }
    Ok(answers)
}
