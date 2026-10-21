//! Where each entry's images land in the merged atlas, and the atlas made of them.
//!
//! - By default a grid: `⌈√n⌉` cells a side for `n` entries, each cell the atlas's side over that
//!   count, texels whole; an entry fills its cell less a gutter of `gutter` texels on every side,
//!   in the order the entries were made, row by row.
//! - Binned (`binByTextureSize`): each entry a square whose area is its share of the atlas — its
//!   material's largest texture against every entry's —, the squares placed largest first, each in
//!   the free rectangle it fits tightest, the free rest split in two, every square shrunk by a
//!   hundredth until all fit; the gutter inside each square.
//!
//! An entry's texture coordinates follow its cell: `uv · scale + offset`. Its images go into the
//! cell — an image of one texel fills it, a larger one is brought down to it (`resize.rs`) —, the
//! atlas starting as background, then filled outward from the cells (`smear.rs`): the gutters and
//! the empty cells take the colours of the cells beside them.
use super::resize::resized;
use super::smear::Image;
use crate::hlod::flatten::sort::unstable_sort;

/// An entry's place in the atlas: the texel its images start at and their size in texels — none
/// along an axis where the gutter leaves no room —, and the transform of its texture coordinates.
#[derive(Clone, Copy, Debug)]
pub(super) struct Cell {
    pub at: [i64; 2],
    pub size: [i64; 2],
    pub offset: [f64; 2],
    pub scale: [f64; 2],
}

/// The grid of `count` entries in an atlas `side` texels square, each cell's gutter `gutter`
/// texels.
pub(super) fn grid(count: usize, side: usize, gutter: usize) -> Vec<Cell> {
    let cells = (1..).find(|g: &usize| g * g >= count).unwrap_or(1);
    let (side, gutter) = (side as i64, gutter as i64);
    let entry = side / cells as i64;
    // None where the gutter leaves no room: never a negative size, whose scale would mirror the
    // entry's coordinates.
    let size = (entry - 2 * gutter).max(0);
    (0..count)
        .map(|k| {
            let (column, row) = ((k % cells) as i64, (k / cells) as i64);
            let at = [column * entry + gutter, row * entry + gutter];
            Cell {
                at,
                size: [size; 2],
                offset: at.map(|a| a as f64 / side as f64),
                scale: [size as f64 / side as f64; 2],
            }
        })
        .collect()
}

/// The binned squares of entries weighing `weights` (summing to one) in an atlas `side` texels
/// square, each square's gutter `gutter` texels.
pub(super) fn binned(weights: &[f64], side: usize, gutter: usize) -> Vec<Cell> {
    // Each square's side in the unit atlas, then the heaviest placed first.
    let mut sides: Vec<f64> = weights.iter().map(|w| w.sqrt()).collect();
    let mut order: Vec<usize> = (0..weights.len()).collect();
    // By the one unstable sort the HLOD steps share: squares of equal weight stand as it leaves
    // them.
    unstable_sort(&mut order, |&a, &b| weights[a] > weights[b]);
    let placed = loop {
        match placed_squares(&order, &sides) {
            Some(placed) => break placed,
            None => sides.iter_mut().for_each(|s| *s *= 0.99),
        }
    };
    let (texels, gutter) = (side as f64, gutter as f64);
    (0..weights.len())
        .map(|k| {
            let ([x, y], s) = (placed[k], sides[k]);
            Cell {
                at: [x, y].map(|v| (texels * v + gutter) as i64),
                size: [(texels * s - 2.0 * gutter).max(0.0) as i64; 2],
                offset: [x, y].map(|v| v + gutter / texels),
                scale: [(s - 2.0 * gutter / texels).max(0.0); 2],
            }
        })
        .collect()
}

/// The squares of `sides` placed in `order` in the unit square — each in the free rectangle whose
/// area it leaves least of, the rest of that rectangle split beside and below it —: each square's
/// corner, `None` when one finds no room.
fn placed_squares(order: &[usize], sides: &[f64]) -> Option<Vec<[f64; 2]>> {
    let mut free: Vec<([f64; 2], [f64; 2])> = vec![([0.0, 0.0], [1.0, 1.0])];
    let mut corners = vec![[0.0; 2]; sides.len()];
    for &k in order {
        let s = sides[k];
        let area = |(low, high): &([f64; 2], [f64; 2])| (high[0] - low[0]) * (high[1] - low[1]);
        let mut best: Option<(usize, f64)> = None;
        for (at, rect) in free.iter().enumerate() {
            let (low, high) = rect;
            if high[0] - low[0] >= s && high[1] - low[1] >= s {
                let left = area(rect) - s * s;
                if left >= 0.0 && best.is_none_or(|(_, least)| left < least) {
                    best = Some((at, left));
                }
            }
        }
        let (at, _) = best?;
        let (low, high) = free[at];
        corners[k] = low;
        // Below the square, its width; beside it, the rectangle's whole height from its top.
        let below = ([low[0], low[1] + s], [low[0] + s, high[1]]);
        let beside = ([low[0] + s, low[1]], [high[0], high[1] - low[1]]);
        match (area(&below) > 0.0, area(&beside) > 0.0) {
            (true, true) => {
                free[at] = below;
                free.push(beside);
            }
            (false, true) => free[at] = beside,
            (true, false) => free[at] = below,
            (false, false) => {
                free.swap_remove(at);
            }
        }
    }
    Some(corners)
}

/// An entry's image of one map placed in its `cell` of that map of the atlas `atlas`: an image of
/// one texel fills its cell, one of the cell's size goes in as it is, a larger one — an entry is
/// baked at the atlas's side, never below its cell — is brought down to the cell's size. Once
/// every entry is in, the atlas's background is filled outward from the cells (`smeared`).
pub(super) fn placed(atlas: &mut Image, image: &Image, cell: &Cell) {
    let [width, height] = cell.size.map(|s| s.max(0) as usize);
    if width == 0 || height == 0 {
        return;
    }
    let shrunk;
    let fits = image.width == width && image.height == height;
    let source = match image.constant() {
        Some(_) => image,
        None if fits => image,
        None => {
            shrunk = resized(image, (width, height));
            &shrunk
        }
    };
    let (columns, rows) = (atlas.width as i64, atlas.height as i64);
    for y in 0..height {
        for x in 0..width {
            let (tx, ty) = (cell.at[0] + x as i64, cell.at[1] + y as i64);
            if !((0..columns).contains(&tx) && (0..rows).contains(&ty)) {
                continue;
            }
            let value = match source.constant() {
                Some(value) => value,
                None => source.texels[y * width + x],
            };
            atlas.texels[(ty * columns + tx) as usize] = value;
        }
    }
}
