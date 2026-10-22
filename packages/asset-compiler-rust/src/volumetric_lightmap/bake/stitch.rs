//! The steps after the last pass, in the reference's order, each over every brick in rank order
//! (coarse bricks first):
//! 1. each level's padding: the row of texels past a brick's unique ones is copied from the
//!    neighbouring brick of the same level, where there is one;
//! 2. the texels no path lit well enough are filled with the mean of the trusted texels around
//!    them;
//! 3. the border where a fine brick meets a coarser one is replaced by the coarse brick's light,
//!    filtered, in as many passes as there are levels to cross.
use super::layout::{index, layout_position, Layout, PADDED};
use super::store::{accumulate, scaled, Store, Texel};

/// A texel of a padded brick, by the brick's rank and the texel's place in it (0..5 a side).
fn texel_at(store: &Store, rank: usize, inside: [u32; 3]) -> usize {
    let place = layout_position(rank as u32);
    store.index(std::array::from_fn(|a| {
        (place[a] * PADDED + inside[a]) as usize
    }))
}

fn each_texel(mut visit: impl FnMut([u32; 3])) {
    for z in 0..PADDED {
        for y in 0..PADDED {
            for x in 0..PADDED {
                visit([x, y, z]);
            }
        }
    }
}

/// Step 1, for the bricks of one level.
fn copy_padding(layout: &Layout, store: &mut Store, level: usize) {
    let span = super::settings::BRICK_SIZE.pow(level as u32);
    let volume = &layout.levels[level];
    for (rank, brick) in layout
        .bricks
        .iter()
        .enumerate()
        .filter(|(_, b)| b.span == span)
    {
        each_texel(|inside| {
            let cell: [u32; 3] = std::array::from_fn(|a| brick.position[a] * 4 + inside[a]);
            let neighbour = cell.map(|c| c / 4);
            if (0..3).any(|a| neighbour[a] >= volume.dims[a]) {
                return;
            }
            let held = volume.cells[index(volume.dims, neighbour)];
            if held == 0 {
                return;
            }
            let source = texel_at(store, held as usize - 1, cell.map(|c| c % 4));
            let target = texel_at(store, rank, inside);
            store.copy(source, target);
        });
    }
}

/// What lies at the point `uvw` of the indirection volume: the brick's place in the layout, its
/// span and the point's place in the brick as a float.
struct Lookup {
    place: [u32; 3],
    span: u32,
    unit: [f64; 3],
}

fn lookup(layout: &Layout, uvw: [f64; 3]) -> Option<Lookup> {
    let dims = layout.indirection_dims;
    let texel: [i64; 3] = uvw.map(|v| v.floor() as i64);
    if (0..3).any(|a| texel[a] < 0 || texel[a] >= i64::from(dims[a])) {
        return None;
    }
    let held = layout.indirection[index(dims, texel.map(|t| t as u32))];
    if held[3] == 0 {
        return None;
    }
    let span = f64::from(held[3]);
    Some(Lookup {
        place: [held[0], held[1], held[2]].map(u32::from),
        span: u32::from(held[3]),
        unit: uvw.map(|v| (v / span).fract()),
    })
}

/// The mean of the trusted texels around a texel, found through the indirection volume.
fn dilate(layout: &Layout, store: &Store, (cell, span): ([i64; 3], u32)) -> Texel {
    let uvw: [f64; 3] = cell.map(|c| (c * i64::from(span)) as f64 / 4.0);
    let step = lookup(layout, uvw).map_or(span, |l| l.span);
    let mut sum = [0.0f32; 28];
    let mut weight = 0.0f32;
    for k in 0..27 {
        let d = [k % 3, (k / 3) % 3, k / 9].map(|v| v as f64 - 1.0);
        let around: [f64; 3] = std::array::from_fn(|a| uvw[a] + d[a] / f64::from(step) / 4.0);
        let Some(found) = lookup(layout, around) else {
            continue;
        };
        let at = store.index(std::array::from_fn(|a| {
            (found.place[a] * PADDED) as usize + (found.unit[a] * 4.0) as usize
        }));
        if store.valid[at] == 1 {
            accumulate(&mut sum, &store.read(at), 1.0);
            weight += 1.0;
        }
    }
    scaled(&sum, 1.0 / weight.max(0.00001))
}

/// Step 2.
fn fill_invalid(layout: &Layout, store: &mut Store) {
    for (rank, brick) in layout.bricks.iter().enumerate() {
        each_texel(|inside| {
            let target = texel_at(store, rank, inside);
            if store.valid[target] == 0 {
                let cell = std::array::from_fn(|a| {
                    i64::from(brick.position[a]) * 4 + i64::from(inside[a])
                });
                let mean = dilate(layout, store, (cell, brick.span));
                store.write(target, &mean);
            }
        });
    }
}

/// The light at the point `uvw` of the atlas, filtered trilinearly.
fn trilinear(store: &Store, uvw: [f64; 3]) -> Texel {
    let base = uvw.map(|v| v as usize);
    let part = std::array::from_fn::<f64, 3, _>(|a| uvw[a].fract());
    let mut sum = [0.0f32; 28];
    for k in 0..8usize {
        let corner = [k & 1, (k >> 1) & 1, k >> 2];
        let weight: f64 = (0..3)
            .map(|a| {
                if corner[a] == 0 {
                    1.0 - part[a]
                } else {
                    part[a]
                }
            })
            .product();
        let place: [usize; 3] = std::array::from_fn(|a| base[a] + corner[a]);
        // A texel past the atlas reads as nothing, as on the GPU; its weight is zero in practice.
        if (0..3).all(|a| place[a] < store.dims[a]) {
            accumulate(&mut sum, &store.read(store.index(place)), weight as f32);
        }
    }
    sum
}

/// Step 3, one pass: the texels near a coarser brick take its filtered light.
fn stitch_border(layout: &Layout, store: &mut Store) {
    let dims = layout.indirection_dims;
    for (rank, brick) in layout.bricks.iter().enumerate() {
        each_texel(|inside| {
            let cell: [f64; 3] = std::array::from_fn(|a| {
                f64::from((brick.position[a] * 4 + inside[a]) * brick.span) / 4.0
            });
            let mut found = None;
            for k in 0..27 {
                let d = [k % 3, (k / 3) % 3, k / 9].map(|v| v as f64 - 1.0);
                let nudged: [f64; 3] = std::array::from_fn(|a| cell[a] + d[a] * 0.125);
                let texel = nudged.map(|v| v.floor() as i64);
                if (0..3).any(|a| texel[a] < 0 || texel[a] >= i64::from(dims[a])) {
                    continue;
                }
                let held = layout.indirection[index(dims, texel.map(|t| t as u32))];
                if u32::from(held[3]) > brick.span {
                    found = Some((held, texel));
                }
            }
            if let Some((held, texel)) = found {
                let span = f64::from(held[3]);
                let origin = texel.map(|t| (t as f64 / span).floor() * span);
                let uvw: [f64; 3] = std::array::from_fn(|a| {
                    f64::from(PADDED * u32::from(held[a]))
                        + ((cell[a] - origin[a]) / span).clamp(0.0, 1.0) * 4.0
                });
                let light = trilinear(store, uvw);
                let target = texel_at(store, rank, inside);
                store.write(target, &light);
            }
        });
    }
}

/// Every step after the last pass.
pub fn stitch(layout: &Layout, store: &mut Store) {
    for level in (0..layout.levels.len()).rev() {
        copy_padding(layout, store, level);
    }
    fill_invalid(layout, store);
    for _ in 1..layout.levels.len() {
        stitch_border(layout, store);
    }
}
