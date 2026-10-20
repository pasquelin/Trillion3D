//! The neighbour offsets and the cells a crossed edge marks.
use super::super::grid::{add, leaf_offset, leaf_origin, local_coord, Coord, Grid, Mask, DIM};
use trillion3d_page_codec::hash::WordMap;

/// The voxel offsets of a leaf per axis: its inner voxels and its far and near faces, the y faces
/// leaving out z = 7.
pub(super) struct Offsets {
    pub(super) internal: [Vec<usize>; 3],
    pub(super) max_face: [Vec<usize>; 3],
    pub(super) min_face: [Vec<usize>; 3],
}

impl Offsets {
    pub(super) fn new() -> Offsets {
        let mut internal: [Vec<usize>; 3] = Default::default();
        for x in 0..8usize {
            for y in 0..8usize {
                for z in 0..8usize {
                    let pos = (x << 6) + (y << 3) + z;
                    if x < 7 {
                        internal[0].push(pos);
                    }
                    if y < 7 {
                        internal[1].push(pos);
                    }
                    if z < 7 {
                        internal[2].push(pos);
                    }
                }
            }
        }
        let mut max_face: [Vec<usize>; 3] = Default::default();
        let mut min_face: [Vec<usize>; 3] = Default::default();
        for y in 0..8usize {
            for z in 0..8usize {
                min_face[0].push((y << 3) + z);
                max_face[0].push((7 << 6) + (y << 3) + z);
            }
        }
        for x in 0..8usize {
            for z in 0..7usize {
                min_face[1].push((x << 6) + z);
                max_face[1].push((x << 6) + (7 << 3) + z);
            }
        }
        for x in 0..8usize {
            for y in 0..8usize {
                min_face[2].push((x << 6) + (y << 3));
                max_face[2].push((x << 6) + (y << 3) + 7);
            }
        }
        Offsets {
            internal,
            max_face,
            min_face,
        }
    }
}

const STEP: [usize; 3] = [64, 8, 1];

/// The four cells around an edge marked.
fn mark_edge(cells: &mut WordMap<Coord, Mask>, axis: usize, ijk: Coord) {
    let around: [Coord; 4] = match axis {
        0 => [[0, 0, 0], [0, -1, 0], [0, -1, -1], [0, 0, -1]],
        1 => [[0, 0, 0], [0, 0, -1], [-1, 0, -1], [-1, 0, 0]],
        _ => [[0, 0, 0], [0, -1, 0], [-1, -1, 0], [-1, 0, 0]],
    };
    for o in around {
        let c = add(ijk, o);
        cells
            .entry(leaf_origin(c))
            .or_default()
            .set_on(leaf_offset(c));
    }
}

/// The cells the surface crosses in one leaf.
pub(super) fn intersecting_cells(
    grid: &Grid,
    index: usize,
    offsets: &Offsets,
    iso: f32,
    cells: &mut WordMap<Coord, Mask>,
) {
    let leaf = &grid.leaves[index];
    let inside = |v: f32| v < iso;
    let global = |pos: usize| add(leaf.origin, local_coord(pos));
    for axis in 0..3 {
        // The edges inside the leaf.
        let nvo = STEP[axis];
        for &pos in &offsets.internal[axis] {
            let active = leaf.on.is_on(pos) || leaf.on.is_on(pos + nvo);
            if active && inside(leaf.dist[pos]) != inside(leaf.dist[pos + nvo]) {
                mark_edge(cells, axis, global(pos));
            }
        }
        // The edges across the back, top or right face.
        let mut ijk = leaf.origin;
        ijk[axis] += DIM;
        match grid.leaf(ijk) {
            Some(rhs) => {
                for (&pos, &rpos) in offsets.max_face[axis].iter().zip(&offsets.min_face[axis]) {
                    let active = leaf.on.is_on(pos) || rhs.on.is_on(rpos);
                    if active && inside(leaf.dist[pos]) != inside(rhs.dist[rpos]) {
                        mark_edge(cells, axis, global(pos));
                    }
                }
            }
            None => {
                let tile = inside(grid.value(ijk));
                for &pos in &offsets.max_face[axis] {
                    if leaf.on.is_on(pos) && tile != inside(leaf.dist[pos]) {
                        mark_edge(cells, axis, global(pos));
                    }
                }
            }
        }
        // The edges across the front, bottom or left face, against a tile only.
        let mut ijk = leaf.origin;
        ijk[axis] -= 1;
        if grid.leaf(leaf_origin(ijk)).is_none() {
            let tile = inside(grid.value(ijk));
            for &pos in &offsets.internal[axis] {
                if leaf.on.is_on(pos) && tile != inside(leaf.dist[pos]) {
                    let mut c = global(pos);
                    c[axis] -= 1;
                    mark_edge(cells, axis, c);
                }
            }
        }
    }
}
