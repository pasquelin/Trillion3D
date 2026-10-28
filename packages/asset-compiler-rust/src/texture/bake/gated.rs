//! The chain the quality gate decides: its RGBA8 levels encoded in every family the job asks for,
//! kept where they read back within the bars, the stored family's always (`gate.rs`).
use super::{Baked, Source};
use crate::texture::blocks::{BlockFormat, Layout, FAMILIES};
use crate::texture::collect::AtlasTexture;
use crate::texture::gate::{cook_chain, Cooked, GateSheet};
use crate::texture::reduce::{self, AtlasKind};
use rayon::prelude::*;

/// The chain of `readers` in the atlas of `kind`, its sheet from the textures that read it
/// (`GateSheet::of`, a `layout` their setting names winning over theirs).
pub(super) fn cook(
    source: &Source<'_>,
    kind: AtlasKind,
    readers: &[&AtlasTexture],
    layout: Option<Layout>,
) -> std::result::Result<Baked, &'static str> {
    let (o, size) = (source.o, source.size);
    let levels = source.chain(kind);
    let pixels = reduce::tail(&levels, source.first_level);
    let sheet = GateSheet::of(readers, layout);
    let key = sheet.key(source.sha256);
    let mut layouts: [Option<Layout>; FAMILIES] = [None; FAMILIES];
    let mut blocks: [Vec<u8>; FAMILIES] = Default::default();
    let mut baked = Baked {
        previews: Vec::with_capacity(readers.len()),
        ..Baked::default()
    };
    let cook = |format, files| cook_chain(o, (&key, kind), format, &sheet, &levels, size, files);
    // The stored family first, when the job cooks any — it keeps every chain it measures —: a
    // chain whose stored files did not write has no level file, in any family. The others then cook side by side, their
    // decisions gathered in the job's order.
    let (stored, others) = match o.texture_formats.split_first() {
        Some((&stored, others)) => (Some(stored), others),
        None => (None, &[][..]),
    };
    debug_assert!(stored.is_none_or(|format| format == BlockFormat::STORED));
    let first = stored.map(|format| cook(format, true));
    let files = matches!(first, Some((_, Cooked::Kept(_))));
    let others: Vec<_> = others
        .par_iter()
        .map(|&format| cook(format, files))
        .collect();
    for (gate, cooked) in first.into_iter().chain(others) {
        match cooked {
            Cooked::Kept(tail) => {
                layouts[gate.format.index()] = Some(sheet.layout);
                blocks[gate.format.index()] = tail;
            }
            Cooked::Refused => {}
            Cooked::Failed(failure) => baked.add_note(failure),
        }
        baked.gates.push(gate);
    }
    // The levels above the tail are the stored family's files: one that does not write —
    // full disk, forbidden folder — does not cost the tail, the entry comes out without a
    // baked level, the engine loads the source image, and the report says so.
    let baked_levels = if layouts[BlockFormat::STORED.index()].is_some() {
        source.first_level
    } else {
        0
    };
    for reader in readers {
        baked.previews.push(source.entry(
            reader.texture,
            (&key, kind),
            baked_levels,
            (&pixels, layouts, &blocks),
        )?);
    }
    Ok(baked)
}
