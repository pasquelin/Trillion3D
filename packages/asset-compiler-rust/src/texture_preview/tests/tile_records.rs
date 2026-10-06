use super::*;

// A block level file holds its tile records — each the blocks of its tile
// and gutter, clipped at the level's edge —, tile rows then tiles, block rows in
// each. The offsets are pinned by the same numbers as the engine's reader
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
    let file = tile_records(&blocks, width, height);
    assert_eq!(file.len(), 259_120);
    let span = |t: u32, texels: u32| {
        let from = (t * 128).saturating_sub(4) as usize / 4;
        let to = ((t + 1) * 128 + 4).min(texels).div_ceil(4) as usize;
        from..to
    };
    let (mut at, mut starts) = (0, Vec::new());
    for ty in 0..3 {
        for tx in 0..7 {
            starts.push(at);
            for by in span(ty, height) {
                for bx in span(tx, width) {
                    let block = &blocks[(by * across + bx) * 16..][..16];
                    assert_eq!(&file[at..at + 16], block, "tile {tx},{ty} block {bx},{by}");
                    at += 16;
                }
            }
        }
    }
    assert_eq!(at, file.len());
    assert_eq!((starts[7 + 1], starts[14 + 6]), (126_192, 258_736));
    // A level of one tile is its row-major blocks, byte for byte.
    let small: Vec<u8> = (0..25 * 2 * 16).map(|i| i as u8).collect();
    assert_eq!(tile_records(&small, 100, 8), small);
}
