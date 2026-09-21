//! What the quality gate decides for one chain: the sheet its readers hand it,
//! the encode and read-back under `quality.rs`, the verdict kept for the next
//! cook. A gate is per (image, atlas, family): every texture that reads the
//! chain follows its verdict; `report.rs` says what the stage decided.
use super::bake_write::{write_levels, LEVEL_WRITE_FAILED};
use super::blocks::quality::{encode_chain, Channels, Measure};
use super::blocks::{encode_level, BlockFormat, Layout};
use super::collect::AtlasTexture;
use super::reduce::AtlasKind;
use super::{verdict, *};

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
/// written as files, when missing —, nothing when it stays lossless. A verdict
/// a previous cook left for the same chain and sheet is taken as read, only
/// the tail is encoded again (`verdict.rs`). A level file that cannot be
/// written leaves the family lossless too, under the note.
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
    let file = format.file_name(sheet.layout);
    let first = preview_first_level(width, height) as usize;
    // A chain that fits in its tail is encoded whole either way: no verdict for it.
    let known = (first > 0)
        .then(|| verdict::read(o, sha256, kind, file, sheet, first as u32))
        .flatten();
    let from = if known.is_some() { first } else { 0 };
    let _t = perf::Timer::new(perf::Phase::TextureBake);
    let (blocks, measured) = match encode_chain(
        &levels[from..],
        &sizes[from..],
        format,
        sheet.layout,
        sheet.channels,
        &sheet.cutoffs,
    ) {
        Ok(cooked) => cooked,
        Err(note) => return (gate(Measure::default()), None, Some(note)),
    };
    let measure = known.unwrap_or_else(|| {
        if first > 0 {
            verdict::write(o, sha256, kind, file, sheet, &measured);
        }
        measured
    });
    if !measure.passes() {
        return (gate(measure), None, None);
    }
    // A level the verdict vouched for and that vanished meanwhile is encoded on the spot.
    let written = write_levels(o, sha256, kind, (width, height), file, |level, (w, h)| {
        Ok(match level.checked_sub(from) {
            Some(index) => blocks[index].clone(),
            None => encode_level(&levels[level], w, h, format, sheet.layout),
        })
    });
    if written.is_err() {
        return (gate(measure), None, Some(LEVEL_WRITE_FAILED));
    }
    (gate(measure), Some(blocks[first - from..].concat()), None)
}
