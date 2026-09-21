//! What the quality gate decides for one chain and what the stage report says
//! of every decision: the bar, how many chains each family holds in each
//! layout, and — one line each, with their figures — the chains it left
//! lossless. A gate is per (image, atlas, family): every texture that reads the
//! chain follows its verdict.
use super::bake_write::{write_levels, LEVEL_WRITE_FAILED};
use super::blocks::quality::{encode_chain, Channels, Measure, GATE_DB, GATE_MAX_DELTA};
use super::blocks::{BlockFormat, Layout};
use super::collect::AtlasTexture;
use super::reduce::AtlasKind;
use super::*;

/// What a chain's readers, together, ask of the gate.
pub(super) struct GateSheet {
    pub layout: Layout,
    pub channels: Channels,
    pub cutoffs: Vec<f32>,
}

impl GateSheet {
    /// Two channels only when every reader is a normal map; the union of the
    /// channels read and of the cutoffs otherwise.
    pub fn of(readers: &[&AtlasTexture]) -> Self {
        let mut channels = [false; 4];
        let mut cutoffs = Vec::new();
        for reader in readers {
            for (mine, theirs) in channels.iter_mut().zip(reader.channels) {
                *mine |= theirs;
            }
            for &cutoff in &reader.cutoffs {
                if !cutoffs.contains(&cutoff) {
                    cutoffs.push(cutoff);
                }
            }
        }
        cutoffs.sort_by(f32::total_cmp);
        let layout = if readers.iter().all(|r| r.normal_only) {
            Layout::TwoChannel
        } else {
            Layout::Rgba
        };
        Self {
            layout,
            channels,
            cutoffs,
        }
    }
}

/// One gate decision, as the report lists it.
pub(super) struct Gate {
    pub sha256: String,
    pub kind: AtlasKind,
    pub format: BlockFormat,
    /// The layout the chain was tried in.
    pub layout: Layout,
    pub measure: Measure,
}

/// Encodes a chain in one family under its sheet, reads it back and decides:
/// the family's tail bytes when the chain passes — its levels above the tail
/// written as files, when missing —, nothing when it stays lossless. A level
/// file that cannot be written leaves the family lossless too, under the note.
pub(super) fn cook_chain(
    o: &Options,
    sha256: &str,
    kind: AtlasKind,
    format: BlockFormat,
    sheet: &GateSheet,
    levels: &[Vec<u8>],
    (width, height): (u32, u32),
) -> (Gate, Option<Vec<u8>>, Option<&'static str>) {
    let sizes: Vec<(u32, u32)> = (0..levels.len())
        .map(|level| preview_level_size(width, height, level as u32))
        .collect();
    let gate = |measure| Gate {
        sha256: sha256.to_string(),
        kind,
        format,
        layout: sheet.layout,
        measure,
    };
    let (blocks, measure) = {
        let _t = perf::Timer::new(perf::Phase::TextureBake);
        match encode_chain(
            levels,
            &sizes,
            format,
            sheet.layout,
            sheet.channels,
            &sheet.cutoffs,
        ) {
            Ok(cooked) => cooked,
            Err(note) => return (gate(Measure::default()), None, Some(note)),
        }
    };
    if !measure.passes() {
        return (gate(measure), None, None);
    }
    let first = preview_first_level(width, height) as usize;
    let written = write_levels(
        o,
        sha256,
        kind,
        (width, height),
        format.file_name(sheet.layout),
        |level, _| Ok(blocks[level].clone()),
    );
    if written.is_err() {
        return (gate(measure), None, Some(LEVEL_WRITE_FAILED));
    }
    (gate(measure), Some(blocks[first..].concat()), None)
}

/// Decibels as the report prints them: two decimals, `null` when infinite (an
/// exact chain). Few digits, so a reader parses back exactly what was written.
fn db_json(db: f64) -> Value {
    db.is_finite().then(|| (db * 100.0).round() / 100.0).into()
}

impl Gate {
    fn json(&self) -> Value {
        json!({"sha256":self.sha256,"atlas":self.kind.name(),"format":self.format.name(),
            "layout":self.layout.name(),"psnrDb":db_json(self.measure.psnr_db()),
            "maxDelta":self.measure.max_delta,"maskFlips":self.measure.flips})
    }
}

/// Decibel quantiles of the chains a family kept: `null` when it kept none.
fn kept_db(gates: &[&Gate]) -> Value {
    let mut values: Vec<f64> = gates.iter().map(|g| g.measure.psnr_db()).collect();
    if values.is_empty() {
        return Value::Null;
    }
    values.sort_by(f64::total_cmp);
    let at = |q: f64| db_json(values[((values.len() - 1) as f64 * q).round() as usize]);
    json!({"min":at(0.0),"p10":at(0.1),"median":at(0.5)})
}

/// Stage report, which counts what it baked, what the gate decided and what it refused.
pub(super) fn report(
    o: &Options,
    wanted: &[AtlasTexture],
    previews: &[TexturePreview],
    gates: &[Gate],
    skipped: &BTreeMap<&'static str, usize>,
    notes: &BTreeMap<&'static str, usize>,
) -> Value {
    let pixel_bytes: usize = previews.iter().map(|entry| entry.pixels.len()).sum();
    let block_bytes: usize = previews
        .iter()
        .map(|entry| entry.blocks.iter().map(Vec::len).sum::<usize>())
        .sum();
    let baked: u32 = previews.iter().map(|entry| entry.baked_levels).sum();
    let mut encoded = serde_json::Map::new();
    for format in &o.texture_formats {
        let of = |layout: Layout| {
            gates
                .iter()
                .filter(|g| g.format == *format && g.measure.passes() && g.layout == layout)
                .count()
        };
        let kept: Vec<&Gate> = gates
            .iter()
            .filter(|g| g.format == *format && g.measure.passes())
            .collect();
        let lossless = gates
            .iter()
            .filter(|g| g.format == *format && !g.measure.passes())
            .count();
        encoded.insert(
            format.name().to_string(),
            json!({"rgba":of(Layout::Rgba),"twoChannel":of(Layout::TwoChannel),
                "lossless":lossless,"keptPsnrDb":kept_db(&kept)}),
        );
    }
    let lossless: Vec<Value> = gates
        .iter()
        .filter(|g| !g.measure.passes())
        .map(Gate::json)
        .collect();
    json!({"version":TEXTURE_PREVIEW_VERSION,"base":PREVIEW_BASE,"maxLevels":PREVIEW_MAX_LEVELS,
        "colorTextures":wanted.iter().filter(|w| w.kind == AtlasKind::Color).count(),
        "dataTextures":wanted.iter().filter(|w| w.kind == AtlasKind::Data).count(),
        "previews":previews.len(),"pixelBytes":pixel_bytes,"blockBytes":block_bytes,
        "blockFormats":o.texture_formats.iter().map(|f| f.name()).collect::<Vec<_>>(),
        "qualityGate":{"psnrDb":GATE_DB,"maxDelta":GATE_MAX_DELTA,"maskFlips":0,"decoder":"texture2ddecoder"},
        "encoded":encoded,"lossless":lossless,
        "bakedLevels":baked,"skipped":skipped,"notes":notes})
}
