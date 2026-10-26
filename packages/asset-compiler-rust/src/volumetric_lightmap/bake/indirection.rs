//! The indirection volume of a layout, from its levels and bricks.
use super::layout::{index, layout_position, Brick, Level};
use super::settings::BRICK_SIZE;

/// The indirection volume: each texel names the finest brick over it, coarse levels first so a
/// finer one overwrites.
pub(super) fn splat(dims: [u32; 3], levels: &[Level], bricks: &[Brick]) -> Vec<[u8; 4]> {
    let mut texels = vec![[0u8; 4]; dims.iter().map(|&d| d as usize).product()];
    for (level, volume) in levels.iter().enumerate().rev() {
        let span = BRICK_SIZE.pow(level as u32);
        for z in 0..dims[2] {
            for y in 0..dims[1] {
                for x in 0..dims[0] {
                    let cell = [x / span, y / span, z / span];
                    let rank = volume.cells[index(volume.dims, cell)];
                    if rank != 0 {
                        let at = layout_position(rank - 1);
                        texels[index(dims, [x, y, z])] = [
                            at[0] as u8,
                            at[1] as u8,
                            at[2] as u8,
                            bricks[rank as usize - 1].span as u8,
                        ];
                    }
                }
            }
        }
    }
    texels
}
