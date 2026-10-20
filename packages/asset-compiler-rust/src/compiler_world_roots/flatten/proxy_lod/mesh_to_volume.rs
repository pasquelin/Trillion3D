//! The source as a level set (Museth 2013), two voxels of narrow band each side, its closest
//! polygon kept per voxel — a signed field, self intersecting voxels removed, renormalized, the
//! narrow band trimmed — and the closest polygon grid beside it:
//!
//! 1. every triangle voxelized (`voxelize`): a flood from its first corner's
//!    voxel through the voxels it crosses (squared index distance at most 0.75) and their 26
//!    neighbours, each keeping its smallest squared distance and, on a tie, the smallest polygon;
//! 2. the outside traced (`trace_exterior`): every voxel line of every
//!    leaf column swept from both ends until it meets a crossed voxel, then flooded leaf by leaf
//!    through the voxels that cross nothing; the crossed voxels that see an outside neighbour in
//!    front of its closest polygon turn outside (`intersecting_signs`);
//! 3. the crossed voxels without an outside neighbour pushed past the boundary and the inside
//!    voxels without a boundary neighbour removed;
//! 4. distances to world units, inside negative, the signs flooded into the tiles, the field
//!    renormalized by one Godunov step around a 0.8 voxel offset
//!    and the voxels beyond the two voxel band deactivated and pruned.
//!
//! The band is two voxels on both sides, exactly the minimum: a wider band would need an
//! expansion pass, never run here.
use super::grid::{
    add, leaf_offset, leaf_origin, local_coord, normalize, Coord, Grid, Leaf, Mask, COORD_OFFSETS,
    DIM, INVALID, SIZE,
};
use rayon::prelude::*;
use trillion3d_math::vecn::{dot, squared_length, sub};
use trillion3d_page_codec::hash::{WordMap, WordSet};

/// The source triangles in index space: world centimetres times the
/// inverse voxel size.
pub(super) struct IndexMesh<'a> {
    pub points: &'a [[f64; 3]],
    pub tris: &'a [[u32; 3]],
}

impl IndexMesh<'_> {
    fn corners(&self, n: usize) -> [[f64; 3]; 3] {
        self.tris[n].map(|v| self.points[v as usize])
    }

    /// The point of polygon `poly` nearest `center`, its corners read in the order the sign test
    /// reads them.
    fn closest_point(&self, center: [f64; 3], poly: i32) -> [f64; 3] {
        let [a, b, c] = self.corners(poly as usize);
        closest_point_on_triangle(a, c, b, center)
    }
}

/// The closest polygon grid, 32-bit indices, the field leaves behind, read to find each
/// shell vertex's closest source polygon (`super::closest_poly`).
pub(super) struct PolyGrid {
    leaves: WordMap<Coord, Box<([i32; SIZE], Mask)>>,
}

impl PolyGrid {
    /// The polygon of voxel `c`, `None` when the voxel is not active.
    pub(super) fn probe(&self, c: Coord) -> Option<i32> {
        let (idx, on) = &**self.leaves.get(&leaf_origin(c))?;
        on.is_on(leaf_offset(c)).then(|| idx[leaf_offset(c)])
    }
}

/// Whether `a` and `b` agree within `tol`, absolute or relative to the larger.
fn rel_or_approx_equal(a: f64, b: f64, tol: f64) -> bool {
    if !((a - b).abs() > tol) {
        return true;
    }
    let rel = if b.abs() > a.abs() {
        ((a - b) / b).abs()
    } else {
        ((a - b) / a).abs()
    };
    rel <= tol
}

/// Whether `a` and `b` agree axis by axis within the default relative or absolute 1e-7.
fn approx_equal(a: [f64; 3], b: [f64; 3]) -> bool {
    (0..3).all(|k| rel_or_approx_equal(a[k], b[k], 1.0e-7))
}

/// The point of segment `a`–`b` nearest `p`.
fn closest_point_on_segment(a: [f64; 3], b: [f64; 3], p: [f64; 3]) -> [f64; 3] {
    let ab = sub(b, a);
    let t = dot(sub(p, a), ab);
    if t <= 0.0 {
        return a;
    }
    let denom = dot(ab, ab);
    if t >= denom {
        return b;
    }
    let t = t / denom;
    [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
}

/// The point of triangle `a`, `b`, `c` nearest `p` (Ericson's Voronoi region walk),
/// with its degenerate triangle and edge cases.
fn closest_point_on_triangle(a: [f64; 3], b: [f64; 3], c: [f64; 3], p: [f64; 3]) -> [f64; 3] {
    if approx_equal(a, b) && approx_equal(a, c) {
        return a;
    }
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ap = sub(p, a);
    let d1 = dot(ab, ap);
    let d2 = dot(ac, ap);
    if approx_equal(a, b) {
        return closest_point_on_segment(a, c, p);
    } else if approx_equal(a, c) || approx_equal(b, c) {
        return closest_point_on_segment(a, b, p);
    }
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = sub(p, b);
    let d3 = dot(ab, bp);
    let d4 = dot(ac, bp);
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let v = d1 / (d1 - d3);
        return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
    }
    let cp = sub(p, c);
    let d5 = dot(ab, cp);
    let d6 = dot(ac, cp);
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let w = d2 / (d2 - d6);
        return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        let bc = sub(c, b);
        return [b[0] + bc[0] * w, b[1] + bc[1] * w, b[2] + bc[2] * w];
    }
    let denom = 1.0 / (va + vb + vc);
    let w = vc * denom;
    let v = vb * denom;
    [
        a[0] + ab[0] * v + ac[0] * w,
        a[1] + ab[1] * v + ac[1] * w,
        a[2] + ab[2] * v + ac[2] * w,
    ]
}

/// One thread's flood state: the voxels a triangle reaches and their squared distances.
#[derive(Default)]
struct Flood {
    seen: WordSet<Coord>,
    stack: Vec<Coord>,
    hits: Vec<(Coord, f32)>,
}

impl Flood {
    /// The squared index distance from voxel `ijk` to the triangle, without the store: the
    /// squared index distance is kept for the merge, and whether the triangle crosses the voxel
    /// decides the flood.
    fn update(&mut self, ijk: Coord, [a, b, c]: [[f64; 3]; 3]) -> bool {
        let center = ijk.map(f64::from);
        let dist = squared_length(sub(center, closest_point_on_triangle(a, c, b, center))) as f32;
        if dist.is_nan() {
            return false;
        }
        self.hits.push((ijk, dist));
        !(f64::from(dist) > 0.75)
    }

    /// One triangle voxelized: a flood from the first corner's voxel.
    fn triangle(&mut self, prim: [[f64; 3]; 3]) {
        let start = prim[0].map(|x| x.floor() as i32);
        self.seen.clear();
        self.stack.clear();
        self.stack.push(start);
        self.update(start, prim);
        self.seen.insert(start);
        while let Some(ijk) = self.stack.pop() {
            for offset in COORD_OFFSETS {
                let n = add(ijk, offset);
                if self.seen.insert(n) && self.update(n, prim) {
                    self.stack.push(n);
                }
            }
        }
    }

    /// One polygon voxelized, split as it goes: with fewer than 1000
    /// polygons, a triangle wider than two leaves is split in four, recursively, until the count
    /// of pieces reaches 1000.
    fn polygon(&mut self, prim: [[f64; 3]; 3], subdivisions: i32, polygons: usize) {
        if subdivisions <= 0 || polygons >= 1000 {
            self.triangle(prim);
            return;
        }
        let [a, b, c] = prim;
        let mid = |p: [f64; 3], q: [f64; 3]| {
            [
                (p[0] + q[0]) * 0.5,
                (p[1] + q[1]) * 0.5,
                (p[2] + q[2]) * 0.5,
            ]
        };
        let (ac, bc, ab) = (mid(a, c), mid(b, c), mid(a, b));
        for piece in [[a, ab, ac], [ab, bc, ac], [ab, b, bc], [ac, bc, c]] {
            self.polygon(piece, subdivisions - 1, polygons * 4);
        }
    }
}

/// The rule a voxel's value is stored by (`Flood::update`), within a leaf and across leaves: the
/// smaller distance, the smaller polygon on a tie. It is the same whatever order the triangles
/// come in, so one shared tree replaces per thread trees and their merge.
fn store(leaves: &mut WordMap<Coord, Box<Leaf>>, ijk: Coord, dist: f32, index: i32) {
    let offset = leaf_offset(ijk);
    match leaves.get_mut(&leaf_origin(ijk)) {
        Some(leaf) => {
            let old = leaf.dist[offset];
            if dist < old {
                leaf.dist[offset] = dist;
                leaf.idx[offset] = index;
                leaf.on.set_on(offset);
            } else if dist == old {
                leaf.idx[offset] = index.min(leaf.idx[offset]);
            }
        }
        None if dist < f32::MAX => {
            let mut leaf = Leaf::new(leaf_origin(ijk));
            leaf.dist[offset] = dist;
            leaf.idx[offset] = index;
            leaf.on.set_on(offset);
            leaves.insert(leaf.origin, leaf);
        }
        None => {}
    }
}

const SHARDS: usize = 256;

fn shard(origin: Coord) -> usize {
    let h = (origin[0] as u32).wrapping_mul(0x9E37_79B1)
        ^ (origin[1] as u32).wrapping_mul(0x85EB_CA77)
        ^ (origin[2] as u32).wrapping_mul(0xC2B2_AE3D);
    (h >> 24) as usize % SHARDS
}

/// Every triangle voxelized into one shared tree.
fn voxelize(mesh: &IndexMesh) -> Vec<Box<Leaf>> {
    let polygons = mesh.tris.len();
    let shards: Vec<std::sync::Mutex<WordMap<Coord, Box<Leaf>>>> =
        (0..SHARDS).map(|_| Default::default()).collect();
    (0..polygons)
        .into_par_iter()
        .for_each_init(Flood::default, |flood, n| {
            let prim = mesh.corners(n);
            let subdivisions = if polygons < 1000 {
                subdivision_count(prim)
            } else {
                0
            };
            flood.hits.clear();
            flood.polygon(prim, subdivisions, polygons);
            flood.hits.sort_unstable_by_key(|h| shard(leaf_origin(h.0)));
            for group in flood
                .hits
                .chunk_by(|a, b| shard(leaf_origin(a.0)) == shard(leaf_origin(b.0)))
            {
                let mut leaves = shards[shard(leaf_origin(group[0].0))]
                    .lock()
                    .expect("a voxel shard");
                for &(ijk, dist) in group {
                    store(&mut leaves, ijk, dist, n as i32);
                }
            }
        });
    shards
        .into_iter()
        .flat_map(|s| s.into_inner().expect("a voxel shard").into_values())
        .collect()
}

/// How often a triangle splits: its largest extent over two leaves.
fn subdivision_count([a, b, c]: [[f64; 3]; 3]) -> i32 {
    let extent = |k: usize| a[k].max(b[k].max(c[k])) - a[k].min(b[k].min(c[k]));
    (extent(0).max(extent(1).max(extent(2))) / f64::from(DIM * 2)) as i32
}

/// The six axis neighbours of every leaf: the nearest
/// leaf along the axis in either direction, however far.
struct Connectivity {
    next: [Vec<u32>; 3],
    prev: [Vec<u32>; 3],
}

const NONE: u32 = u32::MAX;

impl Connectivity {
    fn new(leaves: &[Box<Leaf>]) -> Connectivity {
        let n = leaves.len();
        let mut next = [vec![NONE; n], vec![NONE; n], vec![NONE; n]];
        let mut prev = [vec![NONE; n], vec![NONE; n], vec![NONE; n]];
        for axis in 0..3 {
            let (p, q) = ((axis + 1) % 3, (axis + 2) % 3);
            let mut columns: WordMap<(i32, i32), Vec<(i32, u32)>> = WordMap::default();
            for (i, leaf) in leaves.iter().enumerate() {
                columns
                    .entry((leaf.origin[p], leaf.origin[q]))
                    .or_default()
                    .push((leaf.origin[axis], i as u32));
            }
            for column in columns.values_mut() {
                column.sort_unstable();
                for pair in column.windows(2) {
                    next[axis][pair[0].1 as usize] = pair[1].1;
                    prev[axis][pair[1].1 as usize] = pair[0].1;
                }
            }
        }
        Connectivity { next, prev }
    }
}

/// One voxel line swept: voxels before the first crossed one turn
/// outside (negative); true when the line ends outside.
fn trace_line(data: &mut [f32; SIZE], mut pos: i32, step: i32) -> bool {
    let mut outside = true;
    for _ in 0..DIM {
        let dist = &mut data[pos as usize];
        if *dist < 0.0 {
            outside = true;
        } else {
            if !(*dist > 0.75) {
                outside = false;
            }
            if outside {
                *dist = -*dist;
            }
        }
        pos += step;
    }
    outside
}

/// Within a leaf, a voxel that crosses nothing turns outside when a
/// face neighbour is outside, until nothing changes.
fn scan_fill(data: &mut [f32; SIZE]) {
    loop {
        let mut updated = false;
        for pos in 0..SIZE {
            let dist = data[pos];
            if !(dist < 0.0) && dist > 0.75 {
                let [x, y, z] = local_coord(pos);
                let outside = (z != 0 && data[pos - 1] < 0.0)
                    || (z != DIM - 1 && data[pos + 1] < 0.0)
                    || (y != 0 && data[pos - 8] < 0.0)
                    || (y != DIM - 1 && data[pos + 8] < 0.0)
                    || (x != 0 && data[pos - 64] < 0.0)
                    || (x != DIM - 1 && data[pos + 64] < 0.0);
                if outside {
                    updated = true;
                    data[pos] = -dist;
                }
            }
        }
        if !updated {
            return;
        }
    }
}

/// The outside traced: every voxel line of every leaf column swept from both ends, then the
/// outside flooded across the leaves.
fn trace_exterior(leaves: &mut [Box<Leaf>]) {
    let links = Connectivity::new(leaves);
    // Z, then Y, then X: (the two in-leaf axes, the voxel step).
    for (axis, step) in [(2usize, 1i32), (1, 8), (0, 64)] {
        for start in 0..leaves.len() {
            if links.prev[axis][start] != NONE {
                continue;
            }
            let mut last = start as u32;
            for a in 0..DIM {
                for b in 0..DIM {
                    let pos = match axis {
                        2 => (a << 6) | (b << 3),
                        1 => (a << 6) | b,
                        _ => (a << 3) | b,
                    };
                    let mut offset = start as u32;
                    while offset != NONE && trace_line(&mut leaves[offset as usize].dist, pos, step)
                    {
                        last = offset;
                        offset = links.next[axis][offset as usize];
                    }
                    offset = last;
                    while offset != NONE {
                        last = offset;
                        offset = links.next[axis][offset as usize];
                    }
                    offset = last;
                    let back = pos + step * (DIM - 1);
                    while offset != NONE
                        && trace_line(&mut leaves[offset as usize].dist, back, -step)
                    {
                        offset = links.prev[axis][offset as usize];
                    }
                }
            }
        }
    }
    // The outside flooded
    // within the leaves that changed, then across their faces into the neighbouring leaves.
    let n = leaves.len();
    let mut changed = vec![true; n];
    let mut absorbing = vec![false; n];
    let mut masks = vec![Mask::default(); n];
    loop {
        for (i, leaf) in leaves.iter_mut().enumerate() {
            if changed[i] {
                scan_fill(&mut leaf.dist);
            }
        }
        absorbing.iter_mut().for_each(|b| *b = false);
        let mut candidates: Vec<usize> = Vec::new();
        for i in 0..n {
            if !changed[i] {
                continue;
            }
            for axis in 0..3 {
                for j in [links.next[axis][i], links.prev[axis][i]] {
                    if j != NONE {
                        candidates.push(j as usize);
                    }
                }
            }
        }
        candidates.sort_unstable();
        candidates.dedup();
        for &i in &candidates {
            let mut any = false;
            // (axis, first face): Z, Y, X, each its first then its last face.
            for (axis, face_step) in [(2usize, 1usize), (1, 8), (0, 64)] {
                for first in [true, false] {
                    let j = if first {
                        links.prev[axis][i]
                    } else {
                        links.next[axis][i]
                    };
                    if j == NONE || !changed[j as usize] {
                        continue;
                    }
                    let last = face_step * 7;
                    let (lhs_offset, rhs_offset) = if first { (0, last) } else { (last, 0) };
                    let rhs = &leaves[j as usize].dist;
                    let lhs = &leaves[i].dist;
                    for u in 0..8usize {
                        for v in 0..8usize {
                            let pos = match axis {
                                2 => (u << 6) + (v << 3),
                                1 => (u << 6) + v,
                                _ => (u << 3) + v,
                            };
                            if lhs[pos + lhs_offset] > 0.75 && rhs[pos + rhs_offset] < 0.0 {
                                any = true;
                                masks[i].set_on(pos + lhs_offset);
                            }
                        }
                    }
                }
            }
            absorbing[i] = any;
        }
        std::mem::swap(&mut changed, &mut absorbing);
        if !changed.iter().any(|&c| c) {
            return;
        }
        for (i, leaf) in leaves.iter_mut().enumerate() {
            if changed[i] {
                for pos in masks[i].ons().collect::<Vec<_>>() {
                    leaf.dist[pos] = -leaf.dist[pos];
                }
                masks[i] = Mask::default();
            }
        }
    }
}

/// Which of the 26 neighbours of voxel `pos` lie in its leaf.
fn internal_neighbours(pos: usize) -> [bool; 26] {
    let [x, y, z] = local_coord(pos);
    let mut m = [false; 26];
    m[0] = x != DIM - 1;
    m[1] = x != 0;
    m[2] = y != DIM - 1;
    m[3] = y != 0;
    m[4] = z != DIM - 1;
    m[5] = z != 0;
    m[6] = m[0] && m[5];
    m[7] = m[1] && m[5];
    m[8] = m[0] && m[4];
    m[9] = m[1] && m[4];
    m[10] = m[0] && m[2];
    m[11] = m[1] && m[2];
    m[12] = m[0] && m[3];
    m[13] = m[1] && m[3];
    m[14] = m[3] && m[4];
    m[15] = m[3] && m[5];
    m[16] = m[2] && m[4];
    m[17] = m[2] && m[5];
    m[18] = m[1] && m[3] && m[5];
    m[19] = m[1] && m[3] && m[4];
    m[20] = m[0] && m[3] && m[4];
    m[21] = m[0] && m[3] && m[5];
    m[22] = m[1] && m[2] && m[5];
    m[23] = m[1] && m[2] && m[4];
    m[24] = m[0] && m[2] && m[4];
    m[25] = m[0] && m[2] && m[5];
    m
}

/// The in-leaf offset read for each neighbour (`any_neighbour`), its sixth entry (i+1, j, k-1)
/// reading i+1, j, k: the field depends on that reading, kept as is.
const INTERNAL_OFFSETS: [isize; 26] = [
    64,
    -64,
    8,
    -8,
    1,
    -1,
    64,
    -64 - 1,
    64 + 1,
    -64 + 1,
    64 + 8,
    -64 + 8,
    64 - 8,
    -64 - 8,
    -8 + 1,
    -8 - 1,
    8 + 1,
    8 - 1,
    -64 - 8 - 1,
    -64 - 8 + 1,
    64 - 8 + 1,
    64 - 8 - 1,
    -64 + 8 - 1,
    -64 + 8 + 1,
    64 + 8 + 1,
    64 + 8 - 1,
];

/// The order `any_neighbour` visits the in-leaf neighbours in.
const INTERNAL_ORDER: [usize; 26] = [
    5, 4, 3, 2, 1, 0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
];

/// Whether a neighbour of voxel `pos` passes `check`: in the leaf, then across it through the
/// tree.
fn any_neighbour(grid: &Grid, leaf: &Leaf, pos: usize, check: impl Fn(f32) -> bool) -> bool {
    let mask = internal_neighbours(pos);
    for m in INTERNAL_ORDER {
        if mask[m] && check(leaf.dist[(pos as isize + INTERNAL_OFFSETS[m]) as usize]) {
            return true;
        }
    }
    let ijk = add(leaf.origin, local_coord(pos));
    (0..26).any(|m| !mask[m] && check(grid.value(add(ijk, COORD_OFFSETS[m]))))
}

/// The crossed inside voxels that an outside
/// neighbour sees in front of its closest polygon.
fn intersecting_signs(grid: &Grid, mesh: &IndexMesh, leaf: &Leaf) -> Vec<usize> {
    let mut flips = Vec::new();
    let mut cache: WordMap<usize, ([f64; 3], [f64; 3])> = WordMap::default();
    let node_max = add(leaf.origin, [DIM - 1; 3]);
    for pos in leaf.on.ons() {
        let dist = leaf.dist[pos];
        if dist < 0.0 || dist > 0.75 {
            continue;
        }
        let ijk = add(leaf.origin, local_coord(pos));
        let xyz = ijk.map(f64::from);
        let lo: Coord = std::array::from_fn(|k| (ijk[k] - 1).max(leaf.origin[k]));
        let hi: Coord = std::array::from_fn(|k| (ijk[k] + 1).min(node_max[k]));
        let mut flip = false;
        'search: for nx in lo[0]..=hi[0] {
            for ny in lo[1]..=hi[1] {
                for nz in lo[2]..=hi[2] {
                    let npos = leaf_offset([nx, ny, nz]);
                    let poly = leaf.idx[npos];
                    if poly == INVALID || !(leaf.dist[npos] < -0.75) {
                        continue;
                    }
                    let (point, direction) = *cache.entry(npos).or_insert_with(|| {
                        let nxyz = [f64::from(nx), f64::from(ny), f64::from(nz)];
                        let point = mesh.closest_point(nxyz, poly);
                        (point, normalize(sub(nxyz, point), 1.0e-7))
                    });
                    if dot(direction, normalize(sub(xyz, point), 1.0e-7)) > 0.0 {
                        flip = true;
                        break 'search;
                    }
                }
            }
        }
        if !flip {
            let inside = |c: Coord| {
                (lo[0]..=hi[0]).contains(&c[0])
                    && (lo[1]..=hi[1]).contains(&c[1])
                    && (lo[2]..=hi[2]).contains(&c[2])
            };
            for offset in COORD_OFFSETS {
                let nijk = add(ijk, offset);
                if inside(nijk) {
                    continue;
                }
                let Some(neighbour) = grid.leaf(leaf_origin(nijk)) else {
                    continue;
                };
                let npos = leaf_offset(nijk);
                if !(neighbour.on.is_on(npos) && neighbour.dist[npos] < -0.75) {
                    continue;
                }
                let nxyz = nijk.map(f64::from);
                let cp = mesh.closest_point(nxyz, neighbour.idx[npos]);
                if dot(
                    normalize(sub(nxyz, cp), 1.0e-7),
                    normalize(sub(xyz, cp), 1.0e-7),
                ) > 0.0
                {
                    flip = true;
                    break;
                }
            }
        }
        if flip {
            flips.push(pos);
        }
    }
    flips
}

/// The signed distance field and the closest polygon grid, `None` when no
/// voxel survives.
pub(super) fn mesh_to_volume(mesh: &IndexMesh, voxel: f64) -> Option<(Grid, PolyGrid)> {
    let mut grid = Grid::new(voxelize(mesh), f32::MAX);
    trace_exterior(&mut grid.leaves);

    let flips: Vec<Vec<usize>> = grid
        .leaves
        .par_iter()
        .map(|leaf| intersecting_signs(&grid, mesh, leaf))
        .collect();
    for (leaf, flips) in grid.leaves.iter_mut().zip(flips) {
        for pos in flips {
            leaf.dist[pos] = -leaf.dist[pos];
        }
    }
    // A crossed voxel without an outside neighbour is pushed over
    // the boundary distance.
    let pushed: Vec<Vec<usize>> = grid
        .leaves
        .par_iter()
        .map(|leaf| {
            leaf.on
                .ons()
                .filter(|&pos| {
                    let dist = leaf.dist[pos];
                    !(dist < 0.0 || dist > 0.75) && !any_neighbour(&grid, leaf, pos, |v| v < 0.0)
                })
                .collect()
        })
        .collect();
    for (leaf, pushed) in grid.leaves.iter_mut().zip(pushed) {
        for pos in pushed {
            leaf.dist[pos] = 0.75f32 + 1e-7f32;
        }
    }
    // An inside voxel without a boundary neighbour is removed.
    let removed: Vec<Vec<usize>> = grid
        .leaves
        .par_iter()
        .map(|leaf| {
            leaf.on
                .ons()
                .filter(|&pos| {
                    leaf.dist[pos] > 0.75 && !any_neighbour(&grid, leaf, pos, |v| !(v > 0.75))
                })
                .collect()
        })
        .collect();
    for (leaf, removed) in grid.leaves.iter_mut().zip(removed) {
        for pos in removed {
            leaf.on.set_off(pos);
        }
    }
    grid.prune_inactive();
    if grid.leaves.is_empty() {
        return None;
    }
    let poly = PolyGrid {
        leaves: grid
            .leaves
            .iter()
            .map(|l| (l.origin, Box::new((l.idx, l.on))))
            .collect(),
    };

    // World units, the outside positive.
    let voxel_size = voxel as f32;
    for leaf in &mut grid.leaves {
        for pos in leaf.on.ons().collect::<Vec<_>>() {
            let v = leaf.dist[pos];
            let w = if v < 0.0 { voxel_size } else { -voxel_size };
            leaf.dist[pos] = w * v.abs().sqrt();
        }
    }
    let exterior = 2.0f32 * voxel_size;
    let interior = 2.0f32 * voxel_size;
    grid.background = exterior;
    grid.signed_flood_fill(exterior, -interior);

    // Offset, renormalized by one Godunov step, then the smaller of the two kept.
    let offset = (0.8 * f64::from(voxel_size)) as f32;
    for leaf in &mut grid.leaves {
        for pos in leaf.on.ons().collect::<Vec<_>>() {
            leaf.dist[pos] += -offset;
        }
    }
    let dx = voxel_size;
    let inv_dx = 1.0f32 / dx;
    let renormalized: Vec<Vec<(u16, f32)>> = grid
        .leaves
        .par_iter()
        .map(|leaf| {
            leaf.on
                .ons()
                .map(|pos| {
                    let phi0 = leaf.dist[pos];
                    let ijk = add(leaf.origin, local_coord(pos));
                    let at = |o: Coord| grid.value(add(ijk, o));
                    let up = [
                        at([1, 0, 0]) - phi0,
                        at([0, 1, 0]) - phi0,
                        at([0, 0, 1]) - phi0,
                    ];
                    let down = [
                        phi0 - at([-1, 0, 0]),
                        phi0 - at([0, -1, 0]),
                        phi0 - at([0, 0, -1]),
                    ];
                    let norm = godunov_norm_sqrd(phi0 > 0.0, down, up);
                    let diff = norm.sqrt() * inv_dx - 1.0f32;
                    let s = phi0 / (phi0 * phi0 + norm).sqrt();
                    (pos as u16, phi0 - dx * s * diff)
                })
                .collect()
        })
        .collect();
    let back = offset - 1e-7f32;
    for (leaf, values) in grid.leaves.iter_mut().zip(renormalized) {
        for (pos, v) in values {
            leaf.dist[pos as usize] = leaf.dist[pos as usize].min(v);
        }
        for pos in leaf.on.ons().collect::<Vec<_>>() {
            leaf.dist[pos] += back;
        }
    }

    // The band trimmed to two voxels: the voxels beyond it deactivated and pruned.
    for leaf in &mut grid.leaves {
        for pos in leaf.on.ons().collect::<Vec<_>>() {
            let v = leaf.dist[pos];
            let inside = v < 0.0;
            if inside && !(v > -interior) {
                leaf.dist[pos] = -interior;
                leaf.on.set_off(pos);
            } else if !inside && !(v < exterior) {
                leaf.dist[pos] = exterior;
                leaf.on.set_off(pos);
            }
        }
    }
    grid.prune_level_set(exterior, -interior);
    Some((grid, poly))
}

/// The squared gradient norm by Godunov's upwind scheme, `m` and `p` the backward and forward
/// differences, `outside` the side the value lies on.
fn godunov_norm_sqrd(outside: bool, m: [f32; 3], p: [f32; 3]) -> f32 {
    let mut len = 0.0f32;
    for k in 0..3 {
        len += if outside {
            (m[k].max(0.0).powi(2)).max(p[k].min(0.0).powi(2))
        } else {
            (m[k].min(0.0).powi(2)).max(p[k].max(0.0).powi(2))
        };
    }
    len
}
