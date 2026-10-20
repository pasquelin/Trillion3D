//! The adaptive mesher of a level set at an iso value and an adaptivity, with no mask, reference
//! grid or spatial adaptivity, disoriented triangles relaxed:
//!
//! 1. the voxels whose cell the surface crosses (`intersecting_cells`): every edge of the leaves
//!    whose ends straddle the iso value marks its four cells;
//! 2. each such cell's corner signs, edge flags and ambiguous face correction
//!    (`sign_flags`, `correct_signs`);
//! 3. the cells merged by 2×2×2, 4×4×4 then 8×8×8 blocks inside a leaf where the block is
//!    manifold and its gradients agree within the adaptivity (`merge_regions`);
//! 4. a point per edge group of each cell, or one per merged region at the mean of its cells'
//!    first points (`compute_point`);
//! 5. a quad around every crossed edge, collapsed to a triangle where two of its corners share a
//!    region;
//! 6. the points of triangles facing against the field's gradient moved to the mean of their
//!    polygons (`relax_disoriented`).
use super::super::marching::corner_offset;
use super::grid::{
    add, leaf_offset, leaf_origin, local_coord, normalize, Coord, Grid, Mask, DIM, SIZE,
};
use super::tables::{ADAPTABLE, AMBIGUOUS_FACE, EDGE_GROUP};
use rayon::prelude::*;
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{add as vadd, dot, sub};
use trillion3d_page_codec::hash::{WordMap, WordSet};

const SIGNS: i16 = 0xFF;
const EDGES: i16 = 0xE00;
const INSIDE: i16 = 0x100;
const XEDGE: i16 = 0x200;
const YEDGE: i16 = 0x400;
const ZEDGE: i16 = 0x800;
const SEAM: i16 = 0x1000;

/// The invalid point index: the point index tree's background.
const INVALID_POINT: u32 = u32::MAX;

/// The mesher's output: world points, quads, then triangles.
pub(super) struct Mixed {
    pub points: Vec<[f32; 3]>,
    pub quads: Vec<[u32; 4]>,
    pub triangles: Vec<[u32; 3]>,
}

/// Corner `k` of a cell `dim` voxels wide, in the marching order (`corner_offset`).
fn corner(k: usize, dim: i32) -> Coord {
    corner_offset(k).map(|c| c as i32 * dim)
}

fn cell_values(grid: &Grid, ijk: Coord) -> [f32; 8] {
    std::array::from_fn(|k| grid.value(add(ijk, corner(k, 1))))
}

/// A cell's corner signs: bit n set when corner n is inside.
fn sign_flags(values: &[f32; 8], iso: f32) -> u8 {
    values
        .iter()
        .enumerate()
        .fold(0u8, |s, (n, &v)| if v < iso { s | (1 << n) } else { s })
}

/// A cell sharing an ambiguous face with a neighbour that sees
/// the face the other way takes the complementary signs.
fn correct_signs(signs: u8, face: u8, grid: &Grid, ijk: Coord, iso: f32) -> u8 {
    let (offset, expected): (Coord, u8) = match face {
        1 => ([0, 0, -1], 3),
        2 => ([1, 0, 0], 4),
        3 => ([0, 0, 1], 1),
        4 => ([-1, 0, 0], 2),
        5 => ([0, -1, 0], 6),
        6 => ([0, 1, 0], 5),
        _ => return signs,
    };
    if AMBIGUOUS_FACE[sign_flags(&cell_values(grid, add(ijk, offset)), iso) as usize] == expected {
        !signs
    } else {
        signs
    }
}

/// Whether a block of side `dim` whose corner signs are not adaptable, or
/// whose edge midpoints, face centres or centre change the sign topology.
fn non_manifold(grid: &Grid, ijk: Coord, iso: f32, dim: i32) -> bool {
    let h = dim >> 1;
    let inside = |c: Coord| grid.value(c) < iso;
    let p: [bool; 8] = std::array::from_fn(|k| inside(add(ijk, corner(k, dim))));
    let signs = p
        .iter()
        .enumerate()
        .fold(0usize, |s, (n, &b)| if b { s | (1 << n) } else { s });
    if !ADAPTABLE[signs] {
        return true;
    }
    let [i, j, k] = ijk;
    let (ip, ipp, jp, jpp, kp, kpp) = (i + h, i + dim, j + h, j + dim, k + h, k + dim);
    let edges: [(Coord, usize, usize); 12] = [
        ([ip, j, k], 0, 1),
        ([ipp, j, kp], 1, 2),
        ([ip, j, kpp], 2, 3),
        ([i, j, kp], 0, 3),
        ([ip, jpp, k], 4, 5),
        ([ipp, jpp, kp], 5, 6),
        ([ip, jpp, kpp], 6, 7),
        ([i, jpp, kp], 7, 4),
        ([i, jp, k], 0, 4),
        ([ipp, jp, k], 1, 5),
        ([ipp, jp, kpp], 2, 6),
        ([i, jp, kpp], 3, 7),
    ];
    for (c, a, b) in edges {
        let m = inside(c);
        if p[a] != m && p[b] != m {
            return true;
        }
    }
    let faces: [(Coord, [usize; 4]); 6] = [
        ([ip, jp, k], [0, 1, 4, 5]),
        ([ipp, jp, kp], [1, 2, 5, 6]),
        ([ip, jp, kpp], [2, 3, 6, 7]),
        ([i, jp, kp], [0, 3, 4, 7]),
        ([ip, j, kp], [0, 1, 2, 3]),
        ([ip, jpp, kp], [4, 5, 6, 7]),
    ];
    for (c, corners) in faces {
        let m = inside(c);
        if corners.iter().all(|&n| p[n] != m) {
            return true;
        }
    }
    let m = inside([ip, jp, kp]);
    p.iter().all(|&b| b != m)
}

/// The field's gradient at voxel `ijk` by second order central differences, normalized.
fn gradient(grid: &Grid, ijk: Coord) -> [f32; 3] {
    let d =
        |o: Coord| (grid.value(add(ijk, o)) - grid.value(add(ijk, [-o[0], -o[1], -o[2]]))) * 0.5f32;
    normalize([d([1, 0, 0]), d([0, 1, 0]), d([0, 0, 1])], 1.0e-7)
}

/// Where along an edge from value `v0` to `v1` the field crosses `iso`, from 0 to 1.
fn zero_crossing(v0: f64, v1: f64, iso: f64) -> f64 {
    (iso - v0) / (v1 - v0)
}

/// The mean crossing of the cell's edges in this edge group.
fn compute_point(values: &[f64; 8], signs: u8, group: u8, iso: f64) -> [f64; 3] {
    let table = &EDGE_GROUP[signs as usize];
    let mut avg = [0.0f64; 3];
    let mut samples = 0;
    // (edge column, corner a, corner b, the varying axis, the two fixed coordinates).
    let edges: [(usize, usize, usize, usize, [f64; 3]); 12] = [
        (1, 0, 1, 0, [0.0, 0.0, 0.0]),
        (2, 1, 2, 2, [1.0, 0.0, 0.0]),
        (3, 3, 2, 0, [0.0, 0.0, 1.0]),
        (4, 0, 3, 2, [0.0, 0.0, 0.0]),
        (5, 4, 5, 0, [0.0, 1.0, 0.0]),
        (6, 5, 6, 2, [1.0, 1.0, 0.0]),
        (7, 7, 6, 0, [0.0, 1.0, 1.0]),
        (8, 4, 7, 2, [0.0, 1.0, 0.0]),
        (9, 0, 4, 1, [0.0, 0.0, 0.0]),
        (10, 1, 5, 1, [1.0, 0.0, 0.0]),
        (11, 2, 6, 1, [1.0, 0.0, 1.0]),
        (12, 3, 7, 1, [0.0, 0.0, 1.0]),
    ];
    for (column, a, b, axis, fixed) in edges {
        if table[column] == group {
            for k in 0..3 {
                if k == axis {
                    avg[k] += zero_crossing(values[a], values[b], iso);
                } else if fixed[k] != 0.0 {
                    avg[k] += fixed[k];
                }
            }
            samples += 1;
        }
    }
    if samples > 1 {
        let w = 1.0 / f64::from(samples);
        avg = avg.map(|v| v * w);
    }
    avg
}

/// The voxel offsets of a leaf per axis: its inner voxels and its far and near faces, the y faces
/// leaving out z = 7.
struct Offsets {
    internal: [Vec<usize>; 3],
    max_face: [Vec<usize>; 3],
    min_face: [Vec<usize>; 3],
}

impl Offsets {
    fn new() -> Offsets {
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
fn intersecting_cells(
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

/// The auxiliary trees on one leaf of the cells: sign flags (`Int16Tree`) and point indices
/// (`Index32Tree`), on the same topology.
struct Aux {
    origin: Coord,
    flags: Box<[i16; SIZE]>,
    on: Mask,
}

/// The regions merged in one leaf: the point index of every merged
/// block's voxels set to the block's region id.
fn merge_regions(
    grid: &Grid,
    aux: &Aux,
    point_index: &mut [u32; SIZE],
    active: &dyn Fn(Coord) -> bool,
    iso: f32,
    adaptivity: f32,
) {
    let mut mask = Mask::default();
    let block = |c: Coord| leaf_offset([c[0] & !1, c[1] & !1, c[2] & !1]);
    let origin = aux.origin;
    for pos in aux.on.ons() {
        let flags = aux.flags[pos];
        let signs = (SIGNS & flags) as usize;
        let ijk = add(origin, local_coord(pos));
        if (flags & SEAM) != 0 || !ADAPTABLE[signs] || EDGE_GROUP[signs][0] > 1 {
            mask.set_on(block(ijk));
        } else if (flags & EDGES) != 0 {
            let mut region = !active(ijk);
            let checks: [(i16, [Coord; 3]); 3] = [
                (XEDGE, [[0, -1, 0], [0, -1, -1], [0, 0, -1]]),
                (YEDGE, [[0, 0, -1], [-1, 0, -1], [-1, 0, 0]]),
                (ZEDGE, [[0, -1, 0], [-1, -1, 0], [-1, 0, 0]]),
            ];
            for (edge, around) in checks {
                if !region && (flags & edge) != 0 {
                    region = around.iter().any(|&o| !active(add(ijk, o)));
                }
            }
            if region {
                mask.set_on(block(ijk));
            }
        }
    }
    let end = add(origin, [DIM; 3]);
    let blocks = |dim: i32| {
        let mut out = Vec::new();
        let mut x = origin[0];
        while x < end[0] {
            let mut y = origin[1];
            while y < end[1] {
                let mut z = origin[2];
                while z < end[2] {
                    out.push([x, y, z]);
                    z += dim;
                }
                y += dim;
            }
            x += dim;
        }
        out
    };
    for ijk in blocks(2) {
        if !mask.is_on(leaf_offset(ijk)) && non_manifold(grid, ijk, iso, 2) {
            mask.set_on(leaf_offset(ijk));
        }
    }
    let use_gradients = adaptivity < 1.0f32;
    let mut gradients: [Option<[f32; 3]>; SIZE] = [None; SIZE];
    if use_gradients {
        for pos in aux.on.ons() {
            let ijk = add(origin, local_coord(pos));
            if !mask.is_on(block(ijk)) {
                gradients[pos] = Some(gradient(grid, ijk));
            }
        }
    }
    // Whether a block may merge into one region.
    let mergeable = |start: Coord, dim: i32| {
        if adaptivity < 1e-6 {
            return false;
        }
        let mut norms = Vec::new();
        for x in start[0]..start[0] + dim {
            for y in start[1]..start[1] + dim {
                for z in start[2]..start[2] + dim {
                    if let Some(n) = gradients[leaf_offset([x, y, z])] {
                        norms.push(n);
                    }
                }
            }
        }
        norms.iter().all(|a| {
            norms
                .iter()
                .all(|b| !((1.0 - f64::from(dot(*a, *b))) > f64::from(adaptivity)))
        })
    };
    let mut region_id = 1u32;
    let mut dim = 2;
    while dim <= DIM {
        let coord_mask = !((dim << 1) - 1);
        for ijk in blocks(dim) {
            if mask.is_on(leaf_offset(ijk))
                || non_manifold(grid, ijk, iso, dim)
                || (use_gradients && !mergeable(ijk, dim))
            {
                mask.set_on(leaf_offset([
                    ijk[0] & coord_mask,
                    ijk[1] & coord_mask,
                    ijk[2] & coord_mask,
                ]));
            } else {
                for x in ijk[0]..ijk[0] + dim {
                    for y in ijk[1]..ijk[1] + dim {
                        for z in ijk[2]..ijk[2] + dim {
                            point_index[leaf_offset([x, y, z])] = region_id;
                        }
                    }
                }
                region_id += 1;
            }
        }
        dim <<= 1;
    }
}

/// One primitive of the adaptive builder: a quad, a triangle where two neighbouring
/// corners coincide, nothing otherwise.
fn add_prim(quads: &mut Vec<[u32; 4]>, triangles: &mut Vec<[u32; 3]>, v: [u32; 4], reverse: bool) {
    let triangle = |triangles: &mut Vec<[u32; 3]>, v0: u32, v1: u32, v2: u32| {
        triangles.push(if reverse { [v2, v1, v0] } else { [v0, v1, v2] });
    };
    if v[0] != v[1] && v[0] != v[2] && v[0] != v[3] && v[1] != v[2] && v[1] != v[3] && v[2] != v[3]
    {
        quads.push(if reverse { [v[3], v[2], v[1], v[0]] } else { v });
    } else if v[0] == v[3] && v[1] != v[2] && v[1] != v[0] && v[2] != v[0] {
        triangle(triangles, v[0], v[1], v[2]);
    } else if v[1] == v[2] && v[0] != v[3] && v[0] != v[1] && v[3] != v[1] {
        triangle(triangles, v[0], v[1], v[3]);
    } else if v[0] == v[1] && v[2] != v[3] && v[2] != v[0] && v[3] != v[0] {
        triangle(triangles, v[0], v[2], v[3]);
    } else if v[2] == v[3] && v[0] != v[1] && v[0] != v[2] && v[1] != v[2] {
        triangle(triangles, v[0], v[1], v[2]);
    }
}

/// The adaptive mesh of the `iso` surface of `grid`, `voxel` its voxel size.
pub(super) fn volume_to_mesh(grid: &Grid, voxel: f64, iso: f64, adaptivity: f64) -> Mixed {
    let iso_value = iso as f32;
    let offsets = Offsets::new();
    let mut cells: WordMap<Coord, Mask> = WordMap::default();
    for index in 0..grid.leaves.len() {
        intersecting_cells(grid, index, &offsets, iso_value, &mut cells);
    }
    let empty = Mixed {
        points: Vec::new(),
        quads: Vec::new(),
        triangles: Vec::new(),
    };
    if cells.is_empty() {
        return empty;
    }

    // Each crossed cell's corner signs, edge flags and ambiguous face correction.
    let cells: Vec<(Coord, Mask)> = cells.into_iter().collect();
    let mut aux: Vec<Aux> = cells
        .par_iter()
        .filter_map(|&(origin, mask)| {
            let mut flags = Box::new([0i16; SIZE]);
            let mut on = Mask::default();
            for pos in mask.ons() {
                let ijk = add(origin, local_coord(pos));
                let mut signs = sign_flags(&cell_values(grid, ijk), iso_value);
                if signs == 0 || signs == 0xFF {
                    continue;
                }
                let inside = signs & 0x1 != 0;
                let mut edge_flags = if inside { INSIDE } else { 0 };
                if inside != ((signs & 0x02) != 0) {
                    edge_flags |= XEDGE;
                }
                if inside != ((signs & 0x10) != 0) {
                    edge_flags |= YEDGE;
                }
                if inside != ((signs & 0x08) != 0) {
                    edge_flags |= ZEDGE;
                }
                let face = AMBIGUOUS_FACE[signs as usize];
                if face != 0 {
                    signs = correct_signs(signs, face, grid, ijk, iso_value);
                }
                flags[pos] = edge_flags | i16::from(signs);
                on.set_on(pos);
            }
            (!on.is_empty()).then_some(Aux { origin, flags, on })
        })
        .collect();
    aux.sort_unstable_by_key(|a| super::grid::tree_order(a.origin));
    let find: WordMap<Coord, usize> = aux.iter().enumerate().map(|(i, a)| (a.origin, i)).collect();
    let active = |c: Coord| {
        find.get(&leaf_origin(c))
            .is_some_and(|&i| aux[i].on.is_on(leaf_offset(c)))
    };
    let mut point_index: Vec<Box<[u32; SIZE]>> = aux
        .iter()
        .map(|a| {
            let mut idx = Box::new([INVALID_POINT; SIZE]);
            for pos in a.on.ons() {
                idx[pos] = 0;
            }
            idx
        })
        .collect();

    // The regions merged, only when adaptive (`adaptivity > 1e-7`).
    if adaptivity > 1e-7 {
        point_index
            .par_iter_mut()
            .zip(aux.par_iter())
            .for_each(|(idx, a)| {
                merge_regions(grid, a, idx, &active, iso_value, adaptivity as f32)
            });
    }

    // The points each leaf makes, and the leaves' point offsets.
    let counts: Vec<u32> = aux
        .iter()
        .zip(&point_index)
        .map(|(a, idx)| {
            let mut count = 0u32;
            let mut regions: WordSet<u32> = WordSet::default();
            for pos in a.on.ons() {
                let id = idx[pos];
                if id == 0 {
                    count += u32::from(EDGE_GROUP[(SIGNS & a.flags[pos]) as usize][0]);
                } else if id != INVALID_POINT {
                    regions.insert(id);
                }
            }
            count + regions.len() as u32
        })
        .collect();
    let mut starts = Vec::with_capacity(counts.len());
    let mut total = 0u32;
    for &c in &counts {
        starts.push(total);
        total += c;
    }

    // The points.
    let per_leaf: Vec<Vec<[f32; 3]>> = point_index
        .par_iter_mut()
        .zip(aux.par_iter())
        .zip(starts.par_iter())
        .map(|((idx, a), &start)| {
            let mut points = Vec::new();
            let mut point_offset = start;
            let mut regions: std::collections::BTreeMap<u32, Vec<usize>> = Default::default();
            let values_at = |ijk: Coord| cell_values(grid, ijk).map(f64::from);
            for pos in a.on.ons() {
                let id = idx[pos];
                if id != 0 {
                    if id != INVALID_POINT {
                        regions.entry(id).or_default().push(pos);
                    }
                    continue;
                }
                idx[pos] = point_offset;
                let signs = (SIGNS & a.flags[pos]) as u8;
                let ijk = add(a.origin, local_coord(pos));
                let values = values_at(ijk);
                for group in 1..=EDGE_GROUP[signs as usize][0] {
                    let p = compute_point(&values, signs, group, iso);
                    points.push(std::array::from_fn(|k| {
                        ((p[k] + f64::from(ijk[k])) * voxel) as f32
                    }));
                    point_offset += 1;
                }
            }
            for voxels in regions.values() {
                let mut avg = [0.0f64; 3];
                for &pos in voxels {
                    let ijk = add(a.origin, local_coord(pos));
                    idx[pos] = point_offset;
                    let signs = (SIGNS & a.flags[pos]) as u8;
                    let p = compute_point(&values_at(ijk), signs, 1, iso);
                    for k in 0..3 {
                        avg[k] += f64::from(ijk[k]) + p[k];
                    }
                }
                if voxels.len() > 1 {
                    let w = 1.0 / voxels.len() as f64;
                    avg = avg.map(|v| v * w);
                }
                points.push(avg.map(|v| (v * voxel) as f32));
                point_offset += 1;
            }
            points
        })
        .collect();
    let mut points: Vec<[f32; 3]> = per_leaf.into_iter().flatten().collect();

    // The polygons, a quad collapsed to a triangle where two corners share a region.
    let probe = |c: Coord| match find.get(&leaf_origin(c)) {
        Some(&i) => (
            point_index[i][leaf_offset(c)],
            aux[i].on.is_on(leaf_offset(c)),
        ),
        None => (INVALID_POINT, false),
    };
    let sign_at = |c: Coord| match find.get(&leaf_origin(c)) {
        Some(&i) => (SIGNS & aux[i].flags[leaf_offset(c)]) as usize,
        None => 0,
    };
    let pools: Vec<(Vec<[u32; 4]>, Vec<[u32; 3]>)> = aux
        .par_iter()
        .map(|a| {
            let (mut quads, mut triangles) = (Vec::new(), Vec::new());
            for pos in a.on.ons() {
                let flags = a.flags[pos];
                if flags & 0xE00 == 0 {
                    continue;
                }
                let cell = (SIGNS & flags) as usize;
                let table = &EDGE_GROUP[cell];
                let offsets: [u32; 3] = if table[0] > 1 {
                    [table[1], table[9], table[4]].map(|g| u32::from(g).wrapping_sub(1))
                } else {
                    [0; 3]
                };
                let ijk = add(a.origin, local_coord(pos));
                // The polygon around this crossed edge.
                let (v0, on) = probe(ijk);
                if !on || v0 == INVALID_POINT {
                    continue;
                }
                let is_inside = flags & INSIDE != 0;
                // (edge flag, offset slot, the three neighbours and their edge group columns, reversed).
                let edges: [(i16, usize, [(Coord, usize); 3], bool); 3] = [
                    (
                        XEDGE,
                        0,
                        [([0, -1, 0], 5), ([0, -1, -1], 7), ([0, 0, -1], 3)],
                        is_inside,
                    ),
                    (
                        YEDGE,
                        1,
                        [([0, 0, -1], 12), ([-1, 0, -1], 11), ([-1, 0, 0], 10)],
                        is_inside,
                    ),
                    (
                        ZEDGE,
                        2,
                        [([0, -1, 0], 8), ([-1, -1, 0], 6), ([-1, 0, 0], 2)],
                        !is_inside,
                    ),
                ];
                for (edge, slot, around, reverse) in edges {
                    if flags & edge == 0 {
                        continue;
                    }
                    let mut quad = [v0.wrapping_add(offsets[slot]), 0, 0, 0];
                    let mut all = true;
                    for (n, (o, column)) in around.into_iter().enumerate() {
                        let c = add(ijk, o);
                        let (v, active_value) = probe(c);
                        all = all && active_value;
                        if !all {
                            break;
                        }
                        let cell = sign_at(c);
                        let extra = if EDGE_GROUP[cell][0] > 1 {
                            u32::from(EDGE_GROUP[cell][column]).wrapping_sub(1)
                        } else {
                            0
                        };
                        quad[n + 1] = v.wrapping_add(extra);
                    }
                    if all {
                        add_prim(&mut quads, &mut triangles, quad, reverse);
                    }
                }
            }
            (quads, triangles)
        })
        .collect();

    // The disoriented triangles relaxed.
    if adaptivity > 1e-7 {
        relax_disoriented(grid, voxel, &pools, &mut points);
    }
    let quads = pools.iter().flat_map(|p| p.0.iter().copied()).collect();
    let triangles = pools.iter().flat_map(|p| p.1.iter().copied()).collect();
    Mixed {
        points,
        quads,
        triangles,
    }
}

/// The points of triangles facing against the field's gradient marked, then moved to the mean of
/// their polygons.
fn relax_disoriented(
    grid: &Grid,
    voxel: f64,
    pools: &[(Vec<[u32; 4]>, Vec<[u32; 3]>)],
    points: &mut [[f32; 3]],
) {
    let inv = 1.0 / voxel;
    let masked: Vec<Vec<u32>> = pools
        .par_iter()
        .map(|(_, triangles)| {
            let mut out = Vec::new();
            for t in triangles {
                let [v0, v1, v2] = t.map(|v| points[v as usize]);
                let normal = normalize(cross(sub(v2, v0), sub(v1, v0)), 1.0e-7);
                let third = 1.0f32 / 3.0f32;
                let centroid = vadd(vadd(v0, v1), v2).map(|v| v * third);
                let ijk = centroid.map(|v| (f64::from(v) * inv + 0.5).floor() as i32);
                let dir = gradient(grid, ijk);
                if dot(dir, normal) < -0.5f32 {
                    out.extend_from_slice(t);
                }
            }
            out
        })
        .collect();
    let mut mask = vec![false; points.len()];
    for v in masked.into_iter().flatten() {
        mask[v as usize] = true;
    }
    let mut updates = vec![0u8; points.len()];
    let mut sums = vec![[0.0f32; 3]; points.len()];
    for (quads, triangles) in pools {
        for q in quads {
            for &v in q {
                if mask[v as usize] {
                    let s = vadd(
                        vadd(
                            vadd(points[q[0] as usize], points[q[1] as usize]),
                            points[q[2] as usize],
                        ),
                        points[q[3] as usize],
                    );
                    sums[v as usize] = vadd(sums[v as usize], s);
                    updates[v as usize] = updates[v as usize].wrapping_add(4);
                }
            }
        }
        for t in triangles {
            for &v in t {
                if mask[v as usize] {
                    let s = vadd(
                        vadd(points[t[0] as usize], points[t[1] as usize]),
                        points[t[2] as usize],
                    );
                    sums[v as usize] = vadd(sums[v as usize], s);
                    updates[v as usize] = updates[v as usize].wrapping_add(3);
                }
            }
        }
    }
    for n in 0..points.len() {
        if updates[n] > 0 {
            let weight = (1.0 / f64::from(updates[n])) as f32;
            points[n] = sums[n].map(|v| v * weight);
        }
    }
}
