//! The stage report: the bar, how many chains each family holds in each
//! layout, the kept chains' decibels, and — one line each, with their figures —
//! the chains that stay lossless in the family, refused by the gate or not
//! delivered by the cook (the notes say which).
use super::blocks::quality::{GATE_DB, GATE_MAX_DELTA};
use super::blocks::Layout;
use super::collect::AtlasTexture;
use super::gate::Gate;
use super::reduce::AtlasKind;
use super::*;

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
        let (kept, lossless): (Vec<&Gate>, Vec<&Gate>) = gates
            .iter()
            .filter(|g| g.format == *format)
            .partition(|g| g.kept);
        let of = |layout: Layout| kept.iter().filter(|g| g.layout == layout).count();
        encoded.insert(
            format.name().to_string(),
            json!({"rgba":of(Layout::Rgba),"twoChannel":of(Layout::TwoChannel),
                "lossless":lossless.len(),"keptPsnrDb":kept_db(&kept)}),
        );
    }
    let lossless: Vec<Value> = gates.iter().filter(|g| !g.kept).map(Gate::json).collect();
    json!({"version":TEXTURE_PREVIEW_VERSION,"base":PREVIEW_BASE,"maxLevels":PREVIEW_MAX_LEVELS,
        "colorTextures":wanted.iter().filter(|w| w.kind.atlas() == AtlasKind::Color).count(),
        "dataTextures":wanted.iter().filter(|w| w.kind == AtlasKind::Data).count(),
        "previews":previews.len(),"pixelBytes":pixel_bytes,"blockBytes":block_bytes,
        "blockFormats":o.texture_formats.iter().map(|f| f.name()).collect::<Vec<_>>(),
        "qualityGate":{"psnrDb":GATE_DB,"maxDelta":GATE_MAX_DELTA,"maskFlips":0,"decoder":"texture2ddecoder"},
        "encoded":encoded,"lossless":lossless,
        "bakedLevels":baked,"skipped":skipped,"notes":notes})
}
