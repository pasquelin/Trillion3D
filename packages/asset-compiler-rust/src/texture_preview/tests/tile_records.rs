use super::*;
use flate2::read::DeflateDecoder;
use std::io::Read;

/// A level file's records, inflated: its head of record ends read, each record undone alone.
fn records(file: &[u8], count: usize) -> Vec<Vec<u8>> {
    let end = |i: usize| u32::from_le_bytes(file[i * 4..i * 4 + 4].try_into().unwrap()) as usize;
    let body = &file[count * 4..];
    assert_eq!(end(count - 1), body.len(), "the last end closes the file");
    (0..count)
        .map(|i| {
            let start = if i == 0 { 0 } else { end(i - 1) };
            let mut record = Vec::new();
            DeflateDecoder::new(&body[start..end(i)])
                .read_to_end(&mut record)
                .unwrap();
            record
        })
        .collect()
}

// A block level file opens on one little-endian u32 per tile record — where
// its compressed bytes end, counted from the end of the head —, then the
// records, each the blocks of its tile and gutter, clipped at the level's edge,
// block rows top to bottom, raw DEFLATE alone: tile rows then tiles. The
// inflated sizes are pinned by the same numbers as the engine's reader
// (`packages/sdk-browser/src/texture/tileRecords.test.ts`).
#[test]
fn a_block_level_file_holds_its_tile_records_end_to_end() {
    let (width, height) = (769u32, 300u32);
    let (across, down) = (width.div_ceil(4) as usize, height.div_ceil(4) as usize);
    // Each block's sixteen bytes carry its column and row: a misplaced block shows.
    let blocks: Vec<u8> = (0..down)
        .flat_map(|by| (0..across).flat_map(move |bx| [bx as u32, by as u32, 0, 0]))
        .flat_map(u32::to_le_bytes)
        .collect();
    let tiles = records(&tile_records(&blocks, width, height), 21);
    let span = |t: u32, texels: u32| {
        let from = (t * 128).saturating_sub(4) as usize / 4;
        let to = ((t + 1) * 128 + 4).min(texels).div_ceil(4) as usize;
        from..to
    };
    let (mut at, mut starts) = (0, Vec::new());
    for ty in 0..3 {
        for tx in 0..7 {
            starts.push(at);
            let record = &tiles[(ty * 7 + tx) as usize];
            let mut expected = Vec::new();
            for by in span(ty, height) {
                for bx in span(tx, width) {
                    expected.extend_from_slice(&blocks[(by * across + bx) * 16..][..16]);
                }
            }
            assert_eq!(record, &expected, "tile {tx},{ty}");
            at += record.len();
        }
    }
    assert_eq!(at, 259_120);
    assert_eq!((starts[7 + 1], starts[14 + 6]), (126_192, 258_736));
    // A level of one tile is one record: its row-major blocks, byte for byte.
    let small: Vec<u8> = (0..25 * 2 * 16).map(|i| i as u8).collect();
    assert_eq!(records(&tile_records(&small, 100, 8), 1), [small]);
}
