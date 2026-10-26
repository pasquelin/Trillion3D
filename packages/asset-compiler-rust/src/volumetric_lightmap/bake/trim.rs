//! The finest bricks a bake drops before it stitches, in the reference's order: first those the
//! brick over them interpolates well enough (`minBrickError`), then, where the volume is one piece,
//! as many as the memory limit asks (`maximumBrickMemory`), the ones furthest from the geometry
//! first. A dropped brick leaves its place to the coarser brick over it; the atlas is laid out
//! again with the bricks that stay.
use super::indirection::splat;
use super::layout::{
    brick_origin, each_texel, index, layout_dimensions, texel_in, texel_index, unflatten, Brick,
    Layout, PADDED,
};
use super::settings::{BakeSettings, BRICK_SIZE};
use super::store::{unpack_ambient, Store};
use rayon::prelude::*;

/// The fraction past which a coordinate reads its next texel too: the reference's point filter.
const POINT_FILTER: f64 = 0.001;
/// The bytes of a texel of every layer but the sky's bent normal: the ambient, six coefficient
/// layers of four bytes, the sun's shadowing.
const VOXEL_BYTES: u64 = 4 + 6 * 4 + 1;

/// The ambient light of the unique texels of the brick `rank` read at `coordinate`, filtered
/// trilinearly where the coordinate leaves a texel's centre, clamped to the brick.
fn filtered_ambient(store: &Store, rank: usize, coordinate: [f64; 3]) -> [f32; 3] {
    let near = coordinate.map(|c| if c.fract() > POINT_FILTER { 2 } else { 1 });
    let mut sum = [0.0f32; 3];
    for k in 0..(near[0] * near[1] * near[2]) {
        let step = [k % near[0], (k / near[0]) % near[1], k / near[0] / near[1]];
        let mut weight = 1.0;
        let mut inside = [0u32; 3];
        for a in 0..3 {
            if near[a] > 1 {
                weight *= if step[a] == 0 {
                    1.0 - coordinate[a].fract()
                } else {
                    coordinate[a].fract()
                };
            }
            inside[a] = (coordinate[a] as usize + step[a]).min(BRICK_SIZE as usize - 1) as u32;
        }
        let ambient = unpack_ambient(store.ambient[texel_index(store, rank, inside)]);
        for c in 0..3 {
            sum[c] += ambient[c] * weight as f32;
        }
    }
    sum
}

/// Whether the finest brick of rank `rank` is interpolated by its parent within `limit`.
fn interpolated(layout: &Layout, store: &Store, rank: usize, limit: f64) -> bool {
    let brick = layout.bricks[rank];
    let parents = &layout.levels[1];
    let parent_cell = brick.position.map(|p| p / BRICK_SIZE);
    let held = parents.cells[index(parents.dims, parent_cell)];
    if held == 0 {
        return false;
    }
    let offset: [f64; 3] = std::array::from_fn(|a| f64::from(brick.position[a] % BRICK_SIZE));
    let mut error = [0.0f64; 3];
    let origin = brick_origin(rank);
    for k in 0..BRICK_SIZE.pow(3) {
        let inside = unflatten(k, BRICK_SIZE);
        let own = unpack_ambient(store.ambient[texel_in(store, origin, inside)]);
        let at: [f64; 3] =
            std::array::from_fn(|a| f64::from(inside[a]) / f64::from(BRICK_SIZE) + offset[a]);
        let parent = filtered_ambient(store, held as usize - 1, at);
        for c in 0..3 {
            error[c] += f64::from(own[c] - parent[c]).powi(2);
        }
    }
    let mean = error.iter().fold(0.0f64, |m, e| m.max(*e)) / f64::from(BRICK_SIZE.pow(3));
    mean.sqrt() < limit
}

/// The layout and atlas without the bricks `dropped` (ranks of the finest level), laid out again.
pub(super) fn without(layout: &Layout, store: &Store, dropped: &[bool]) -> (Layout, Store) {
    let kept: Vec<usize> = (0..layout.bricks.len()).filter(|&r| !dropped[r]).collect();
    let bricks: Vec<Brick> = kept.iter().map(|&r| layout.bricks[r]).collect();
    let mut levels = layout.levels.clone();
    let mut new_rank = vec![0u32; dropped.len()];
    for (rank, &old) in kept.iter().enumerate() {
        new_rank[old] = rank as u32 + 1;
    }
    for level in &mut levels {
        for cell in &mut level.cells {
            if *cell != 0 {
                *cell = new_rank[*cell as usize - 1];
            }
        }
    }
    let layout_dims = layout_dimensions(bricks.len() as u32);
    let mut packed = Store::new(
        std::array::from_fn(|a| (layout_dims[a] * PADDED) as usize),
        !store.bent.is_empty(),
    );
    for (rank, &old) in kept.iter().enumerate() {
        let (from, to) = (brick_origin(old), brick_origin(rank));
        each_texel(|inside| {
            let (from, to) = (texel_in(store, from, inside), texel_in(&packed, to, inside));
            store.copy_texel(from, &mut packed, to);
        });
    }
    let indirection = splat(layout.indirection_dims, &levels, &bricks);
    let trimmed = Layout {
        volume_min: layout.volume_min,
        volume_size: layout.volume_size,
        indirection_dims: layout.indirection_dims,
        levels,
        bricks,
        layout_dims,
        indirection,
    };
    (trimmed, packed)
}

/// Drops the finest bricks the settings ask to drop; the layout and atlas it leaves.
pub fn trim(layout: Layout, store: Store, settings: &BakeSettings) -> (Layout, Store) {
    let finest = layout.finest();
    let mut dropped = vec![false; layout.bricks.len()];
    if layout.levels.len() > 1 {
        let flags: Vec<bool> = finest
            .par_iter()
            .map(|&rank| interpolated(&layout, &store, rank, settings.min_brick_error))
            .collect();
        for (&rank, flag) in finest.iter().zip(flags) {
            dropped[rank] = flag;
        }
    }
    if settings.cell_texels().is_none() {
        let total = dropped.iter().filter(|d| !**d).count() as u64;
        let bytes = VOXEL_BYTES * u64::from(PADDED.pow(3));
        let budget = ((settings.maximum_brick_memory * 1024.0 * 1024.0) as u64).div_ceil(bytes);
        let mut kept: Vec<usize> = finest.iter().copied().filter(|&r| !dropped[r]).collect();
        let remove = total.saturating_sub(budget).min(kept.len() as u64) as usize;
        if remove > 0 {
            // The farthest `remove` bricks, ties broken by rank as a stable sort would.
            let order = |&a: &usize, &b: &usize| {
                store.distance[a]
                    .total_cmp(&store.distance[b])
                    .then(a.cmp(&b))
            };
            let split = kept.len() - remove;
            kept.select_nth_unstable_by(split, order);
            for &rank in &kept[split..] {
                dropped[rank] = true;
            }
        }
    }
    if dropped.iter().any(|d| *d) {
        without(&layout, &store, &dropped)
    } else {
        (layout, store)
    }
}
