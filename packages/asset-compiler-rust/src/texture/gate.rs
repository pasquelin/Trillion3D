//! What the quality gate decides for one chain: the sheet its readers hand it,
//! the encode and read-back under `quality.rs`, the verdict kept for the next
//! cook. A gate is per (image, atlas, family): every texture that reads the
//! chain follows its verdict; `report.rs` says what the stage decided. The
//! stored family (`BlockFormat::STORED`) is measured the same way and always
//! kept: a device that samples no other family decodes it.
use super::bake::write::{write_levels, LEVEL_WRITE_FAILED};
use super::blocks::quality::{encode_chain, fast_chain, slow_chain, Channels, Measure};
use super::blocks::{BlockFormat, Effort, Ladder, Layout};
use super::collect::{absorb, AtlasTexture};
use super::cut::Cut;
use super::reduce::AtlasKind;
use super::{verdict, *};
use std::borrow::Cow;

/// What a chain's readers, together, ask of the gate, and the ladder its image climbs (`Ladder`).
pub(super) struct GateSheet {
    pub layout: Layout,
    pub channels: Channels,
    pub cutoffs: Vec<Cut>,
    pub ladder: Ladder,
}

impl GateSheet {
    /// Two channels only when every reader is a normal map, unless the readers' setting names
    /// `layout` (`setting.rs`); the union of the channels read and of the cutoffs otherwise, the
    /// cutoffs in one order so the verdict file has one name; `ladder` the image's.
    pub fn of(readers: &[&AtlasTexture], ladder: Ladder, layout: Option<Layout>) -> Self {
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
        cutoffs.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        let layout = layout.unwrap_or(if readers.iter().all(|r| r.normal_only) {
            Layout::TwoChannel
        } else {
            Layout::Rgba
        });
        Self {
            layout,
            channels,
            cutoffs,
            ladder,
        }
    }
    /// The key a chain's level files and verdicts live under — the `{sha}` of the level template
    /// —: the digest of its source's fingerprint `source`, of this sheet, whose channels and cuts
    /// decide the bytes (the blocks searched again across a cut, `quality::encode_chain`), and of
    /// every family's ladder in the sheet's layout and ladder with its encoder settings
    /// (`Effort::spelling`): an HLOD atlas's chain never shares a source texture's file. Two
    /// readings of one image under other sheets never share a file, nor two encodings; the atlas
    /// and the layout are in its name.
    pub fn key(&self, source: &str) -> String {
        let channels: String = self
            .channels
            .iter()
            .zip(['r', 'g', 'b', 'a'])
            .filter_map(|(&read, name)| read.then_some(name))
            .collect();
        let cutoffs: String = self
            .cutoffs
            .iter()
            .map(|&(c, f)| format!("-{c}x{f}"))
            .collect();
        let encodings: Vec<String> = BlockFormat::ALL
            .iter()
            .map(|&format| Effort::spelling(format, self.layout, self.ladder))
            .collect();
        let spelled = format!("{source}-{channels}{cutoffs}-{}", encodings.join(";"));
        crate::hash(spelled.as_bytes())
    }
}

/// What a chain came out of the gate as: kept, with the family's tail bytes;
/// refused, not in the family; or not cooked at all, under a note.
pub(super) enum Cooked {
    Kept(Vec<u8>),
    Refused,
    Failed(&'static str),
}

/// One gate decision, as the report lists it.
pub(crate) struct Gate {
    /// The chain's key (`GateSheet::key`).
    pub sha256: String,
    pub kind: AtlasKind,
    pub format: BlockFormat,
    /// The layout the chain was tried in.
    pub layout: Layout,
    pub measure: Measure,
    /// Whether the chain came out in the family's blocks: false when the gate
    /// refused it, and false too when the cook could not deliver it — a level
    /// file that would not write — since the sidecar then names no layout.
    pub kept: bool,
}

/// Encodes a chain in one family under its sheet, reads it back and decides:
/// the family's tail bytes when the chain passes, its levels above the tail
/// written as files when missing; nothing when it is refused — never in the
/// stored family, kept whatever it measures. A chain is encoded fast; one that fails the gate is
/// encoded again at its ladder's upper rung while the family has one (`Effort::ladder`), on top of
/// its fast blocks (`quality::slow_chain`), and that chain is kept and measured. A verdict a
/// previous cook left for the same chain and sheet is taken as read, only the tail of a kept chain
/// is encoded again, at the verdict's effort (`verdict.rs`). A level file that
/// cannot be written leaves the chain out of the family too, under the note.
/// `files` false writes no level above the tail: the stored family kept no
/// file, and the levels are the source image's.
pub(super) fn cook_chain(
    o: &Options,
    (key, kind): (&str, AtlasKind),
    format: BlockFormat,
    sheet: &GateSheet,
    levels: &[Cow<'_, [u8]>],
    (width, height): (u32, u32),
    files: bool,
) -> (Gate, Cooked) {
    let sizes: Vec<(u32, u32)> = preview_level_sizes(width, height).collect();
    let gate = |measure, cooked: Cooked| {
        let gate = Gate {
            sha256: key.to_string(),
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
    let written_levels = if files { first as u32 } else { 0 };
    // A chain that fits in its tail is encoded whole either way: no verdict for it.
    // The stored family is kept whatever it measures: a device that samples no other family
    // decodes it, and its measure is reported. Any other family is kept only when it passes.
    let refused = |measure: &Measure| format != BlockFormat::STORED && !measure.passes();
    let known = (first > 0)
        .then(|| verdict::read(o, key, kind, file, written_levels, refused))
        .flatten();
    if let Some((measure, _)) = known.filter(|(measure, _)| refused(measure)) {
        return gate(measure, Cooked::Refused);
    }
    let from = if known.is_some() { first } else { 0 };
    let codec = (format, sheet.layout);
    let (levels, sizes) = (&levels[from..], &sizes[from..]);
    // The encode alone is the bake's: the verdict and the level files are `TextureWrite`'s.
    let bake = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureBake);
    let (blocks, measure, settled) = match known {
        Some((measure, effort)) => {
            let (blocks, _) =
                encode_chain(levels, sizes, codec, effort, sheet.channels, &sheet.cutoffs);
            (blocks, measure, None)
        }
        None => {
            let (mut blocks, mut measure) =
                fast_chain(levels, sizes, codec, sheet.channels, &sheet.cutoffs);
            let mut effort = Effort::Fast;
            let upper = Effort::ladder(format, sheet.layout, sheet.ladder).get(1);
            if let Some(&upper) = upper.filter(|_| !measure.passes()) {
                // The fast chain is dropped once the upper one, built on it, is measured.
                (blocks, measure) = slow_chain(
                    levels,
                    sizes,
                    codec,
                    (&blocks, upper),
                    sheet.channels,
                    &sheet.cutoffs,
                );
                effort = upper;
            }
            (blocks, measure, Some(effort))
        }
    };
    drop(bake);
    if let Some(effort) = settled.filter(|_| first > 0) {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::TextureWrite);
        verdict::write(o, key, kind, file, (&measure, effort));
    }
    if refused(&measure) {
        return gate(measure, Cooked::Refused);
    }
    // A verdict read back has just seen every level file (`verdict::read`): none is looked for
    // again. Otherwise each missing level is written from the chain just encoded; its file holds
    // its tile records.
    let written = known.is_some()
        || write_levels(
            o,
            key,
            kind,
            (width, height),
            file,
            written_levels,
            |level, (w, h)| Ok(tile_records(&blocks[level], w, h, BLOCK_CELL)),
        )
        .is_ok();
    if !written {
        return gate(measure, Cooked::Failed(LEVEL_WRITE_FAILED));
    }
    gate(measure, Cooked::Kept(blocks[first - from..].concat()))
}
