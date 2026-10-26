//! The emission atlas of a merged layer (`maps.emissive`): each entry's emission image is held
//! over the entry's own strength, the largest channel of emission it holds (`tile::Baked`), so it
//! fills the unit interval; the atlas holds them over one strength, the largest of the entries',
//! as the flattened material carries it (`bake::Emission`) — each entry's cell, or the texels it
//! wrote where the entries share the atlas, once every entry is placed, brought onto it.
use crate::hlod::flatten::merge::grid::Cell;
use crate::hlod::flatten::merge::smear::Image;
use crate::texture::{linear_to_srgb, srgb_table};

/// `atlas`, whose cells `cells` hold each entry's emission over its own of `strengths`, held over
/// `strength`, the largest, instead: every texel of a cell scaled in linear by the share of the two
/// — black where nothing emits —, the gutters and the empty cells left for the filling that
/// follows (`smear.rs`).
pub(super) fn rescaled(atlas: &mut Image, (cells, strengths): (&[Cell], &[f32]), strength: f32) {
    let table = srgb_table();
    let (columns, rows) = (atlas.width as i64, atlas.height as i64);
    for (cell, &own) in cells.iter().zip(strengths) {
        let share = share_of(own, strength);
        if share == 1.0 {
            continue;
        }
        let [width, height] = cell.size.map(|s| s.max(0));
        for y in cell.at[1]..cell.at[1] + height {
            for x in cell.at[0]..cell.at[0] + width {
                if !((0..columns).contains(&x) && (0..rows).contains(&y)) {
                    continue;
                }
                held_over(&mut atlas.texels[(y * columns + x) as usize], share, table);
            }
        }
    }
}

/// `atlas`, each of whose texels `owners` gives the entry that wrote it (`NO_OWNER` for none), the
/// entries' emission held over their own of `strengths`, held over `strength`, the largest,
/// instead: every texel an entry wrote scaled in linear by the share of the two.
pub(super) fn rescaled_by_owner(
    atlas: &mut Image,
    (owners, strengths): (&[u32], &[f32]),
    strength: f32,
) {
    let table = srgb_table();
    for (texel, &owner) in atlas.texels.iter_mut().zip(owners) {
        if owner == NO_OWNER {
            continue;
        }
        let share = share_of(strengths[owner as usize], strength);
        if share != 1.0 {
            held_over(texel, share, table);
        }
    }
}

/// No entry wrote the texel.
pub(super) const NO_OWNER: u32 = u32::MAX;

/// The share of the largest strength `strength` an entry's own strength `own` is: zero where
/// nothing emits.
fn share_of(own: f32, strength: f32) -> f32 {
    if strength > 0.0 {
        own / strength
    } else {
        0.0
    }
}

/// `texel`'s colour scaled in linear by `share`.
fn held_over(texel: &mut [u8; 4], share: f32, table: &[f32; 256]) {
    for channel in texel.iter_mut().take(3) {
        *channel = linear_to_srgb(table[*channel as usize] * share);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texels_are_scaled_by_the_share_of_the_entry_that_wrote_them() {
        let mut atlas = Image {
            width: 3,
            height: 1,
            texels: vec![[255, 255, 255, 255]; 3],
        };
        // The first texel written by the entry of half the strength, the second by the strongest,
        // the third by none.
        let owners = [0, 1, NO_OWNER];
        rescaled_by_owner(&mut atlas, (&owners, &[1.0, 2.0]), 2.0);
        assert!(atlas.texels[0][0] < 255, "{:?}", atlas.texels[0]);
        assert_eq!(atlas.texels[0][3], 255);
        assert_eq!(atlas.texels[1], [255, 255, 255, 255]);
        assert_eq!(atlas.texels[2], [255, 255, 255, 255]);
    }
}
