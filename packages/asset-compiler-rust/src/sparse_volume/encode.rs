//! The bytes of one frame of a sparse volume (`abi.rs`).
use super::abi::*;
use super::derived::{CompressedTiles, Derived};
use super::format::IVec3;

/// Appends the words `values` to `out`.
fn words(out: &mut Vec<u8>, values: impl IntoIterator<Item = u32>) {
    for value in values {
        out.extend_from_slice(&value.to_le_bytes());
    }
}

fn ints(vector: IVec3) -> impl Iterator<Item = u32> {
    vector.into_iter().map(|x| x as u32)
}

/// The frame of `derived` with its `compressed` tiles.
pub(crate) fn frame(derived: &Derived, compressed: &CompressedTiles) -> Vec<u8> {
    let header = &derived.header;
    let root = derived.mips.last().map_or(0, |mip| mip.offset + mip.count);
    let mut out = Vec::new();
    words(
        &mut out,
        [
            FRAME_MAGIC,
            FRAME_VERSION,
            root,
            derived.mips.len() as u32,
            derived.coords.len() as u32,
            derived.tile_count,
        ],
    );
    words(&mut out, ints(header.virtual_resolution));
    words(&mut out, ints(header.virtual_min));
    words(&mut out, ints(header.virtual_max));
    words(&mut out, ints(header.page_table_resolution));
    words(&mut out, ints(header.page_table_min));
    words(&mut out, ints(header.page_table_max));
    words(&mut out, header.formats.map(|format| format as u32));
    for fallback in header.fallback {
        words(&mut out, fallback.map(f32::to_bits));
    }
    words(&mut out, [compressed.data.len() as u32, 0]);
    debug_assert_eq!(out.len(), FRAME_HEAD_WORDS * 4);
    for mip in &derived.mips {
        words(&mut out, [mip.offset, mip.count]);
    }
    words(&mut out, derived.coords.iter().copied());
    words(&mut out, derived.tile_indices.iter().copied());
    words(&mut out, derived.parents.iter().copied());
    words(&mut out, compressed.offsets.iter().copied());
    for count in &compressed.voxels_a {
        out.extend_from_slice(&count.to_le_bytes());
    }
    if compressed.voxels_a.len() % 2 == 1 {
        out.extend_from_slice(&[0, 0]);
    }
    out.extend_from_slice(&compressed.data);
    out.resize(out.len().next_multiple_of(4), 0);
    out
}
