//! What the quality gate decides for one chain: the sheet its readers hand it,
//! the encode and read-back under `quality.rs`, the verdict kept for the next
//! cook. A gate is per (image, atlas, family): every texture that reads the
//! chain follows its verdict; `report.rs` says what the stage decided.
use super::bake_write::{write_levels, LEVEL_WRITE_FAILED};
use super::blocks::quality::{encode_chain, Channels, Measure};
use super::blocks::{encode_level, BlockFormat, Layout};
use super::collect::{absorb, AtlasTexture};
use super::reduce::AtlasKind;
use super::{verdict, *};
use std::borrow::Cow;

/// What a chain's readers, together, ask of the gate.
pub(super) struct GateSheet {
    pub layout: Layout,
    pub channels: Channels,
    pub cutoffs: Vec<f32>,
}

impl GateSheet {
    /// Two channels only when every reader is a normal map; the union of the
    /// channels read and of the cutoffs otherwise, the cutoffs in one order so
    /// the verdict file has one name.
    pub fn of(readers: &[&AtlasTexture]) -> Self {
        let mut channels = [false; 4];
        let mut cutoffs = Vec::new();
        for reader in readers {
            absorb(
                &mut channels,
                &mut cutoffs,
                reader.channels,
                &reader.cutoffs,
            );
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

/// What a chain came out of the gate as: kept, with the family's tail bytes;
/// lossless; or not cooked at all, under a note.
pub(super) enum Cooked {
    Kept(Vec<u8>),
    Lossless,
    Failed(&'static str),
}

/// One gate decision, as the report lists it.
pub(super) struct Gate {
    pub sha256: String,
    pub kind: AtlasKind,
    pub format: BlockFormat,
    /// The layout the chain was tried in.
    pub layout: Layout,
    pub measure: Measure,
    /// Whether the chain came out in the family's blocks: false when the gate
    /// refused it, and false too when the cook could not deliver it — a level
    /// file that would not write — since the sidecar then says lossless.
    pub kept: bool,
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
) -> (Gate, Cooked) {
    let sizes: Vec<(u32, u32)> = preview_level_sizes(width, height).collect();
    let gate = |measure, cooked: Cooked| {
        let gate = Gate {
            sha256: sha256.to_string(),
            kind,
            format,
            layout: sheet.layout,
            measure,
            kept: matches!(cooked, Cooked::Kept(_)),
        };
        (gate, cooked)
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
        Err(note) => return gate(Measure::default(), Cooked::Failed(note)),
    };
    let measure = known.unwrap_or_else(|| {
        if first > 0 {
            verdict::write(o, sha256, kind, file, sheet, &measured);
        }
        measured
    });
    if !measure.passes() {
        return gate(measure, Cooked::Lossless);
    }
    // A level the verdict vouched for and that vanished meanwhile is encoded on the spot.
    let written = write_levels(o, sha256, kind, (width, height), file, |level, (w, h)| {
        Ok(match level.checked_sub(from) {
            Some(index) => Cow::Borrowed(blocks[index].as_slice()),
            None => Cow::Owned(encode_level(&levels[level], w, h, format, sheet.layout)),
        })
    });
    if written.is_err() {
        return gate(measure, Cooked::Failed(LEVEL_WRITE_FAILED));
    }
    gate(measure, Cooked::Kept(blocks[first - from..].concat()))
}
