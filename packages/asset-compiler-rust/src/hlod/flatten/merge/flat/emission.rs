//! The emission atlas of a merged layer (`maps.emissive`): each entry's emission image is held
//! over the entry's own strength, the largest channel of emission it holds (`tile::Baked`), so it
//! fills the unit interval; the atlas holds them over one strength, the largest of the entries',
//! as the flattened material carries it (`bake::Emission`) — each entry's cell, once every entry is
//! placed, brought onto it.
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
        let share = if strength > 0.0 { own / strength } else { 0.0 };
        if share == 1.0 {
            continue;
        }
        let [width, height] = cell.size.map(|s| s.max(0));
        for y in cell.at[1]..cell.at[1] + height {
            for x in cell.at[0]..cell.at[0] + width {
                if !((0..columns).contains(&x) && (0..rows).contains(&y)) {
                    continue;
                }
                let texel = &mut atlas.texels[(y * columns + x) as usize];
                for channel in texel.iter_mut().take(3) {
                    *channel = linear_to_srgb(table[*channel as usize] * share);
                }
            }
        }
    }
}
