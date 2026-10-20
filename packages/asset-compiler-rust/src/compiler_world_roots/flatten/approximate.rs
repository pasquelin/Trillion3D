//! The approximated shell of HLOD 1 to 3, at fixed settings and the accuracy the layer is seen
//! at:
//!
//! 1. the scene's parts: each connected component of each placed mesh, welded, a thin one —
//!    planar within the desired thickness, 1.5 times the accuracy — thickened by a shell of half
//!    the thickness it lacks, a tiny thin one dropped, the others read by their generalized
//!    winding number (Jacobson et al. 2013, `winding.rs`);
//! 2. the solid, closed by marching cubes (Lorensen & Cline 1987) on cells of the bounds' largest
//!    side over the voxel count the accuracy asks — the bounds' diagonal over the accuracy, at
//!    least 64, at most 1024 —, followed from the scene's seed points so only the cells near the
//!    surface are visited, each crossing found by four bisection steps;
//! 3. the gaps closed by a morphological closing at the gap distance (`morphology.rs`), skipped
//!    when twice the distance is under the grid's cell;
//! 4. simplified to the geometric tolerance, volume kept (`simplify.rs`): down to 50000
//!    triangles, then to the tolerance;
//! 5. the triangles no ray from outside reaches removed, a floor under the shell counting as an
//!    occluder: nobody sees an HLOD from inside it or from under the ground;
//! 6. hard normals past 60°.
use super::first_seen::first_seen;
use super::grid_key::{self, edge_ends, key, unkey};
use super::marching::{corner_offset, triangles, EDGES};
use super::tree::{soup, triangle_of, Tree};
use super::winding::{Shells, Winding};
use crate::join::Join;
use rayon::prelude::*;
use trillion3d_math::aabb::{aabb_of, centre, extend_aabb, longest_side, merge_aabb};
use trillion3d_math::random::splitmix_draw;
use trillion3d_math::triangle::{edge_key, face_normal};
use trillion3d_math::vec3::{cross, normalized_or};
use trillion3d_math::vecn::{dot, length, sub};
use trillion3d_page_codec::hash::{WordMap, WordSet};

/// The voxel count across the bounds' diagonal: at least 64, so a small cluster is still shaped,
/// at most 1024, so the grid's memory and time stay bounded on a large one.
const VOXEL_DIMENSION: (usize, usize) = (64, 1024);
/// The least thickness a part keeps, in voxels: a thinner one is thickened by a shell, so it does
/// not fall between the grid's corners and vanish.
const MIN_THICKNESS: f64 = 1.5;
/// A thin part's size, over the accuracy, under which it is a speck and dropped (see `scene`).
const TINY_PART: f64 = 0.05;
/// The winding number past which a point is inside: halfway between outside (0) and inside (1).
const WINDING_THRESHOLD: f64 = 0.5;
/// The gaps the closing fills, metres: a crack or an alley narrower than this is not seen far off.
const GAP_DISTANCE: f64 = 0.1;
/// The angle, degrees, past which two faces get separate normals: a crease, not a curve.
const HARD_NORMAL_ANGLE: f64 = 60.0;
/// The bisection steps a crossing is found by: a sixteenth of a cell, finer than the simplifier
/// keeps.
const SEARCH_STEPS: usize = 4;
/// The first simplification's triangle count: a cheap pass that brings the solid's dense grid
/// mesh down before the tolerance's careful one.
const FIRST_PASS_TRIANGLES: usize = 50000;
/// The occlusion test's added rays and triangle samples: enough directions and points that a
/// triangle seen from outside is rarely taken for hidden.
const ADDED_RAYS: usize = 50;
const TRIANGLE_SAMPLES: usize = 50;

/// The approximated shell: its welded positions, its triangles, its hard normals, one per corner,
/// the closed simplified mesh before the occlusion filter — the input the layer above reads —,
/// its triangles after each step (`Stages`) and the milliseconds of its steps (`StageMs`).
pub(crate) struct Shell {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub normals: Vec<[f32; 3]>,
    pub closed: Placed,
    pub stages: Stages,
    pub ms: StageMs,
}

/// A shell's triangles after each step: the solid, the closing, the fast pre-pass, the first
/// simplification and the tolerance's.
pub(crate) type Stages = [usize; STAGE_COUNT];

/// The steps a shell's triangles are counted after (`Stages`).
pub(crate) const STAGE_COUNT: usize = 5;

/// The milliseconds an actor's making spent in each step, by the ranks of `step`.
pub(crate) type StageMs = [u64; step::COUNT];

/// The ranks of `StageMs`: the field (the winding parts, the proxy's distance field), the
/// marching, the closing, the simplification, the unwrap and pack, the bake.
pub(crate) mod step {
    pub const FIELD: usize = 0;
    pub const MARCH: usize = 1;
    pub const CLOSE: usize = 2;
    pub const SIMPLIFY: usize = 3;
    pub const UNWRAP: usize = 4;
    pub const BAKE: usize = 5;
    pub const COUNT: usize = 6;
}

/// A mesh placed in world space: its positions and triangles.
pub(crate) type Placed = (Vec<f32>, Vec<u32>);

/// A placed mesh borrowed: its positions and triangles.
pub(crate) type Mesh<'a> = (&'a [f32], &'a [u32]);

/// The field the solid is closed on, its bounds and the seed points the surface is followed from.
struct Scene {
    winding: Winding,
    shells: Shells,
    bounds: ([f64; 3], [f64; 3]),
    seeds: Vec<[f64; 3]>,
}

/// The points the surface is followed from: ten times the logarithm of the vertex count, at most
/// 500, every `skip`th vertex, pushed out along a triangle's normal by `offset`.
fn seed_points(vertices: &[[f64; 3]], normals: &[[f64; 3]], offset: f64, out: &mut Vec<[f64; 3]>) {
    let n = vertices.len();
    if n == 0 {
        return;
    }
    let log = ((n as f64).ln().ceil() as usize).max(1);
    let count = (10 * log).min(500);
    let skip = (n / count).max(2);
    for k in (0..n).step_by(skip) {
        out.push(std::array::from_fn(|a| {
            vertices[k][a] + normals[k][a] * offset
        }));
    }
}

/// Whether `triangles` of `points` are a thin planar patch within `tolerance` — their box's least
/// side, else their spread along the largest triangle's normal —, and their thickness across it.
fn thin(points: &[[f64; 3]], triangles: &[[usize; 3]], tolerance: f64) -> Option<f64> {
    let (low, high) = aabb_of(triangles.iter().flatten().map(|&v| points[v]));
    let (mut largest, mut normal) = (0.0f64, [0.0f64, 1.0, 0.0]);
    for t in triangles {
        let [a, b, c] = t.map(|v| points[v]);
        let n = cross(sub(b, a), sub(c, a));
        let area = length(n);
        if area > largest {
            largest = area;
            normal = n.map(|x| x / area);
        }
    }
    let dims: [f64; 3] = std::array::from_fn(|k| high[k] - low[k]);
    let least = dims.iter().copied().fold(f64::MAX, f64::min);
    if least < tolerance {
        return Some(least);
    }
    let (mut near, mut far) = (f64::MAX, f64::MIN);
    for p in triangles.iter().flatten().map(|&v| points[v]) {
        let d = dot(p, normal);
        near = near.min(d);
        far = far.max(d);
        if far - near > tolerance {
            return None;
        }
    }
    Some(far - near)
}

/// The parts of `meshes`: solids into the winding field, thin parts into shells, tiny thin parts
/// dropped, and the seed points of each.
fn scene(meshes: &[Mesh], accuracy: f64) -> Option<Scene> {
    let thickness = MIN_THICKNESS * accuracy;
    // A speck: a hundredth of `TINY_PART` voxels. Only dust far under a voxel is dropped; any
    // part large enough to show at the accuracy is kept, however thin.
    let tiny = TINY_PART * accuracy / 100.0;
    // Each mesh's parts side by side, gathered in mesh order: the same field as one after the
    // other, the bounds a minimum and a maximum.
    let each: Vec<Parts> = meshes
        .par_iter()
        .filter(|(_, corners)| !corners.is_empty())
        .map(|&(positions, corners)| mesh_parts((positions, corners), thickness, tiny))
        .collect();
    let (mut solid, mut shell, mut radius, mut seeds) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut parts: Vec<Vec<f32>> = Vec::new();
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for mesh in each {
        solid.extend(mesh.solid);
        shell.extend(mesh.shell);
        radius.extend(mesh.radius);
        seeds.extend(mesh.seeds);
        parts.extend(mesh.parts);
        merge_aabb(&mut low, &mut high, mesh.bounds.0, mesh.bounds.1);
    }
    if low[0] > high[0] {
        return None;
    }
    // The closed parts' fields, the open solids' and the shells side by side.
    let (winding, shells) =
        rayon::join(|| Winding::new(solid, parts), || Shells::new(shell, radius));
    Some(Scene {
        winding,
        shells,
        bounds: (low, high),
        seeds,
    })
}

/// One mesh's share of the scene (`scene`): its open solids, its thin parts' triangles and
/// radii, its closed parts, its seed points and its bounds.
struct Parts {
    solid: Vec<f32>,
    shell: Vec<f32>,
    radius: Vec<f64>,
    parts: Vec<Vec<f32>>,
    seeds: Vec<[f64; 3]>,
    bounds: ([f64; 3], [f64; 3]),
}

/// The parts of one placed mesh (`scene`) at the desired `thickness`, a thin one smaller than
/// `tiny` dropped.
fn mesh_parts((positions, corners): Mesh, thickness: f64, tiny: f64) -> Parts {
    let (mut solid, mut shell, mut radius, mut seeds) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut parts: Vec<Vec<f32>> = Vec::new();
    let (mut low, mut high) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    let mut grow = |p: [f64; 3], r: f64| {
        extend_aabb(&mut low, &mut high, p.map(|x| x - r));
        extend_aabb(&mut low, &mut high, p.map(|x| x + r));
    };
    let (welded, indices, _) = crate::qem::welded_region(positions, corners);
    let points: Vec<[f64; 3]> = (welded.as_chunks::<3>().0.iter())
        .map(|p| p.map(f64::from))
        .collect();
    let tris: Vec<[usize; 3]> = (indices.as_chunks::<3>().0.iter())
        .map(|t| t.map(|v| v as usize))
        .collect();
    // Connected components, by shared vertices.
    let mut join = Join::new(points.len());
    for t in &tris {
        join.unite(t[0] as u32, t[1] as u32);
        join.unite(t[0] as u32, t[2] as u32);
    }
    // Each component numbered by its first triangle, its triangles in order.
    let mut rank_of_root = vec![u32::MAX; points.len()];
    let mut components: Vec<Vec<usize>> = Vec::new();
    for (at, t) in tris.iter().enumerate() {
        let root = join.root(t[0] as u32) as usize;
        if rank_of_root[root] == u32::MAX {
            rank_of_root[root] = components.len() as u32;
            components.push(Vec::new());
        }
        components[rank_of_root[root] as usize].push(at);
    }
    drop(rank_of_root);
    // Vertex normals of the welded mesh, for the shells' seeds.
    let vertex_normal =
        super::mesh_merge::vertex_normals(points.len(), |v| points[v], tris.iter().copied());
    let mut solid_vertices: Vec<usize> = Vec::new();
    let mut edges: Vec<u64> = Vec::new();
    for component in components {
        let own: Vec<[usize; 3]> = component.iter().map(|&t| tris[t]).collect();
        // Closed when every edge is named at least twice.
        edges.clear();
        edges.extend(
            own.iter()
                .flat_map(|t| [0, 1, 2].map(|k| edge_key(t[k] as u32, t[(k + 1) % 3] as u32))),
        );
        edges.sort_unstable();
        let closed = edges.chunk_by(|a, b| a == b).all(|run| run.len() >= 2);
        let push = |into: &mut Vec<f32>, t: &[usize; 3]| {
            for &v in t {
                into.extend(points[v].map(|x| x as f32));
            }
        };
        // A closed part also counts inside by its winding number.
        let mut part = Vec::new();
        match thin(&points, &own, thickness) {
            Some(depth) => {
                // A tiny thin part is dropped.
                let (lo, hi) = aabb_of(own.iter().flatten().map(|&v| points[v]));
                if longest_side(lo, hi) < tiny {
                    continue;
                }
                // Open, it has no thickness; closed, its own up to the desired one.
                let own_thickness = if closed { depth.min(thickness) } else { 0.0 };
                let r = 0.5 * (thickness - own_thickness);
                for t in &own {
                    push(&mut shell, t);
                    radius.push(r);
                    if closed {
                        push(&mut part, t);
                    }
                    for &v in t {
                        grow(points[v], r);
                    }
                }
                let vertices: Vec<usize> = {
                    let mut seen: Vec<usize> = own.iter().flatten().copied().collect();
                    seen.sort_unstable();
                    seen.dedup();
                    seen
                };
                let at: Vec<[f64; 3]> = vertices.iter().map(|&v| points[v]).collect();
                let normals: Vec<[f64; 3]> = vertices.iter().map(|&v| vertex_normal[v]).collect();
                seed_points(&at, &normals, r, &mut seeds);
            }
            None => {
                for t in &own {
                    push(if closed { &mut part } else { &mut solid }, t);
                    for &v in t {
                        grow(points[v], 0.0);
                        solid_vertices.push(v);
                    }
                }
            }
        }
        if closed {
            parts.push(part);
        }
    }
    solid_vertices.sort_unstable();
    solid_vertices.dedup();
    let at: Vec<[f64; 3]> = solid_vertices.iter().map(|&v| points[v]).collect();
    seed_points(&at, &vec![[0.0; 3]; at.len()], 0.0, &mut seeds);
    Parts {
        solid,
        shell,
        radius,
        parts,
        seeds,
        bounds: (low, high),
    }
}

/// The marching cubes grid: its least corner, its cell side and its cell counts.
struct Grid {
    origin: [f64; 3],
    cell: f64,
    cells: [i64; 3],
}
impl Grid {
    fn corner(&self, c: [i64; 3]) -> [f64; 3] {
        std::array::from_fn(|k| self.origin[k] + c[k] as f64 * self.cell)
    }
    /// Corner `k` of `cell` (`corner_offset`).
    fn corner_at(cell: [i64; 3], k: usize) -> [i64; 3] {
        let o = corner_offset(k);
        [
            cell[0] + o[0] as i64,
            cell[1] + o[1] as i64,
            cell[2] + o[2] as i64,
        ]
    }
    fn holds(&self, c: [i64; 3]) -> bool {
        (0..3).all(|k| c[k] >= 0 && c[k] < self.cells[k])
    }
}

/// The surface `field` crosses `WINDING_THRESHOLD` on, followed from the cells holding `seeds`
/// (marching cubes by continuation): front after front, each front's
/// corner values computed side by side, every crossed cell's neighbours across its faces the next
/// front. `refine` finds the crossing between two corners. Each step runs side by side and keeps
/// the order one pass over the cells would give (`first_seen`): the cells, the vertices and the
/// triangles come out the same whatever the threads.
fn march(
    grid: &Grid,
    seeds: &[[f64; 3]],
    field: &(dyn Fn([i64; 3]) -> f64 + Sync),
    refine: &(dyn Fn([f64; 3], f64, [f64; 3], f64) -> [f64; 3] + Sync),
) -> (Vec<f32>, Vec<u32>) {
    // Corners and cells keyed by their packed coordinates (`grid_key::key`).
    let mut values: WordMap<u64, f32> = WordMap::default();
    let mut done: WordSet<u64> = WordSet::default();
    let mut front: Vec<[i64; 3]> = Vec::new();
    for seed in seeds {
        let cell: [i64; 3] =
            std::array::from_fn(|k| ((seed[k] - grid.origin[k]) / grid.cell).floor() as i64);
        if grid.holds(cell) && done.insert(key(cell)) {
            front.push(cell);
        }
    }
    let inside = |v: f32| f64::from(v) >= WINDING_THRESHOLD;
    // Each crossed cell by its key and its corners' mask.
    let mut crossed: Vec<(u64, u8)> = Vec::new();
    while !front.is_empty() {
        let mut needed: Vec<u64> = (front.par_iter())
            .flat_map_iter(|&c| (0..8).map(move |k| key(Grid::corner_at(c, k))))
            .filter(|c| !values.contains_key(c))
            .collect();
        needed.par_sort_unstable();
        needed.dedup();
        let computed: Vec<f32> = needed.par_iter().map(|&c| field(unkey(c)) as f32).collect();
        values.extend(needed.into_iter().zip(computed));
        let masks: Vec<u8> = (front.par_iter())
            .map(|&cell| {
                (0..8).fold(0u8, |mask, k| {
                    let value = values[&key(Grid::corner_at(cell, k))];
                    mask | u8::from(inside(value)) << k
                })
            })
            .collect();
        let crossing = |mask: u8| mask != 0 && mask != 255;
        // The crossed cells' neighbours not met before, in the order the cells and their faces
        // name them, each at its first naming.
        let met = &done;
        let named: Vec<u64> = (front.par_iter().zip(masks.par_iter()))
            .filter(|&(_, &mask)| crossing(mask))
            .flat_map_iter(move |(&cell, _)| {
                (0..3)
                    .flat_map(move |axis| {
                        [-1i64, 1].map(move |step| {
                            let mut n = cell;
                            n[axis] += step;
                            n
                        })
                    })
                    .filter(move |&n| grid.holds(n))
                    .map(key)
                    .filter(move |n| !met.contains(n))
            })
            .collect();
        crossed.par_extend(
            (front.par_iter().zip(masks.par_iter()))
                .filter(|&(_, &mask)| crossing(mask))
                .map(|(&cell, &mask)| (key(cell), mask)),
        );
        let (next, _) = first_seen(named);
        done.extend(next.iter().copied());
        front = next.into_par_iter().map(|cell| unkey(cell)).collect();
    }
    drop(done);
    // One vertex per crossed grid edge, shared by the cells around it: an edge keyed by its lower
    // corner and its axis, numbered in the order the crossed cells' triangles first name it.
    let named: Vec<u64> = (crossed.par_iter())
        .flat_map_iter(|&(cell, mask)| {
            let cell: [i64; 3] = unkey(cell);
            triangles(usize::from(mask))
                .iter()
                .flatten()
                .map(move |&e| {
                    let (a, b) = EDGES[e as usize];
                    grid_key::edge_key(Grid::corner_at(cell, a), Grid::corner_at(cell, b))
                })
        })
        .collect();
    drop(crossed);
    let (edges, indices) = first_seen(named);
    // Each edge with its ends' values, kept so the corners' values go before the crossings are
    // refined.
    let ends: Vec<(f32, f32)> = (edges.par_iter())
        .map(|&edge| {
            let (low, high) = edge_ends(edge);
            (values[&key(low)], values[&key(high)])
        })
        .collect();
    drop(values);
    let positions: Vec<f32> = (edges.par_iter().zip(ends.par_iter()))
        .flat_map_iter(|(&edge, &(fa, fb))| {
            let (a, b) = edge_ends(edge);
            let (pa, pb) = (grid.corner(a), grid.corner(b));
            refine(pa, f64::from(fa), pb, f64::from(fb)).map(|x| x as f32)
        })
        .collect();
    (positions, indices)
}

/// The crossing of `WINDING_THRESHOLD` between `p1` (value `v1`) and `p2` (value `v2`), found by
/// bisection — the winding number jumps rather than varies linearly, so interpolating the two
/// values would misplace it: the middle when both values match, an end nudged towards the other
/// when its value is the threshold, else `SEARCH_STEPS` bisections of `implicit` from the lower
/// value and the last bracket's middle.
fn bisect(
    implicit: &dyn Fn([f64; 3]) -> f64,
    (p1, v1): ([f64; 3], f64),
    (p2, v2): ([f64; 3], f64),
) -> [f64; 3] {
    const DT: f64 = 0.999999;
    if (v1 - v2).abs() < 0.00001 {
        return std::array::from_fn(|k| (p1[k] + p2[k]) * 0.5);
    }
    if (WINDING_THRESHOLD - v1).abs() < 0.00001 {
        return std::array::from_fn(|k| DT * p1[k] + (1.0 - DT) * p2[k]);
    }
    if (WINDING_THRESHOLD - v2).abs() < 0.00001 {
        return std::array::from_fn(|k| DT * p2[k] + (1.0 - DT) * p1[k]);
    }
    let (mut a, mut b) = if v2 < v1 { (p2, p1) } else { (p1, p2) };
    for _ in 0..SEARCH_STEPS {
        let m: [f64; 3] = std::array::from_fn(|k| (a[k] + b[k]) * 0.5);
        if implicit(m) < WINDING_THRESHOLD {
            a = m;
        } else {
            b = m;
        }
    }
    std::array::from_fn(|k| (a[k] + b[k]) * 0.5)
}

/// The voxel count across `bounds` for `accuracy`: the diagonal over the accuracy, within
/// `VOXEL_DIMENSION` — an endless diagonal (empty bounds) held at its top, never past `usize`.
fn voxel_target((low, high): ([f64; 3], [f64; 3]), accuracy: f64) -> usize {
    let across = length(sub(high, low)) / accuracy;
    let cells = if across > VOXEL_DIMENSION.1 as f64 {
        VOXEL_DIMENSION.1
    } else {
        across as usize
    };
    (cells + 1).clamp(VOXEL_DIMENSION.0, VOXEL_DIMENSION.1)
}

/// The accuracy of a voxel `voxel` for sources within `bounds`: never finer than the solid's cell
/// on the grid it targets (`voxel_target`, capped by `VOXEL_DIMENSION`), the grid the solid is
/// sampled on.
pub(super) fn accuracy(bounds: ([f64; 3], [f64; 3]), voxel: f64) -> f64 {
    voxel.max(solid_cell(bounds, voxel, voxel_target(bounds, voxel)))
}

/// The solid's cell for `bounds` over `target` cells: the largest side, extended by twice the
/// accuracy on each end, so the surface never touches the grid's border.
fn solid_cell((low, high): ([f64; 3], [f64; 3]), accuracy: f64, target: usize) -> f64 {
    (longest_side(low, high) + 4.0 * accuracy) / target as f64
}

/// The bytes a cell of the surface holds at the widest of the steps, which follow one another and
/// let go of what they read (`approximate`): the simplifier's, its mesh at the closing's full
/// resolution, about one vertex, two triangles and three edges a cell (`simplify.rs`):
/// - per vertex: its position (24), its edges held in place (40), its quadric (112), two flags (2);
/// - per triangle, twice: its corners (12), its quadric (112), its area (8), a flag (1);
/// - per edge, three times: its ends and triangles (16), its collapse point (24), its mark (4),
///   its heap entry and slot (12), a flag (1);
///
/// 178 + 266 + 171 = 615 bytes, rounded up. The marching (`march`: a corner's value, a crossed
/// cell, an edge and its ends' values, its vertex, two triangles — about 150 bytes) and each pass
/// of the closing (`morphology.rs`: a block of 512 nodes over some 64 surface cells, both its
/// meshes — about 200 bytes) hold less. Checked against `hlodEstimateOverPeak`.
const SURFACE_CELL_BYTES: usize = 640;

/// The bytes the surface `approximate` makes holds, estimated before it runs, for a solid whose
/// skin shows the grid's axes `skin` square metres (`world.rs`) within `bounds`, at `accuracy`:
/// every grid is sparse, kept near the surface, so the cells it holds are those its surface
/// crosses on the solid's grid — a face crosses as many cells of a unit grid as the area it shows
/// the three axes, `|nx| + |ny| + |nz|` times its own —, at the voxel count `voxel_target` gives.
pub(super) fn surface_bytes(skin: f64, bounds: ([f64; 3], [f64; 3]), accuracy: f64) -> usize {
    let (low, high) = bounds;
    if !(0..3).all(|k| low[k] <= high[k]) {
        return 0;
    }
    let cell = solid_cell(bounds, accuracy, voxel_target(bounds, accuracy));
    let cells = (skin / (cell * cell)).max(1.0);
    (cells as usize).saturating_mul(SURFACE_CELL_BYTES)
}

/// The solid of `scene` — where its winding number passes `WINDING_THRESHOLD` or a shell holds the
/// point — meshed by marching cubes over `target` cells.
fn solidify(scene: &Scene, accuracy: f64, target: usize) -> (Vec<f32>, Vec<u32>) {
    let (low, high) = scene.bounds;
    let extend = 2.0 * accuracy;
    let cell = solid_cell(scene.bounds, accuracy, target);
    let inner_low: [f64; 3] = std::array::from_fn(|k| low[k] - extend);
    let inner_high: [f64; 3] = std::array::from_fn(|k| high[k] + extend);
    // Solid at the boundaries: the grid a tenth of a cell past the bounds, outside there.
    let origin: [f64; 3] = std::array::from_fn(|k| inner_low[k] - 0.1 * cell);
    let cells: [i64; 3] =
        std::array::from_fn(|k| ((inner_high[k] + 0.1 * cell - origin[k]) / cell).ceil() as i64);
    let grid = Grid {
        origin,
        cell,
        cells,
    };
    let implicit = |p: [f64; 3]| -> f64 {
        if (0..3).all(|k| p[k] >= inner_low[k] && p[k] <= inner_high[k]) {
            // Inside a shell, the point is inside whatever the solids add: one, the field past
            // the threshold.
            if scene.shells.inside(p) {
                1.0
            } else {
                scene.winding.at(p)
            }
        } else {
            -(WINDING_THRESHOLD + 1.0)
        }
    };
    let field = |c: [i64; 3]| implicit(grid.corner(c));
    let refine = |a: [f64; 3], fa: f64, b: [f64; 3], fb: f64| bisect(&implicit, (a, fa), (b, fb));
    march(&grid, &scene.seeds, &field, &refine)
}

/// The triangles of `positions` and `indices` but those no point of which sees out: a point is
/// hidden when every ray of the six axes and of `ADDED_RAYS` random directions meets the shell or
/// the plane under it; a triangle is removed when its corners, centroid and `TRIANGLE_SAMPLES`
/// random points are all hidden. The selection is grown by one ring and shrunk by two before the
/// removal, so isolated hidden specks stay and the cut runs clear of the visible border.
fn remove_occluded(positions: &[f32], indices: &[u32]) -> Vec<u32> {
    let tree = Tree::from_soup(soup(positions, indices));
    let points: Vec<[f64; 3]> = (positions.as_chunks::<3>().0.iter())
        .map(|p| p.map(f64::from))
        .collect();
    let (low, high) = aabb_of(points.iter().copied());
    // The occluder under the shell, the ground nobody looks up through: a square ten times its
    // largest side,
    // a centimetre under it, glTF's up `+Y`.
    let floor = low[1] - 0.01;
    let half = 5.0 * longest_side(low, high);
    let centre = centre(low, high);
    let under = |origin: [f64; 3], ray: [f64; 3]| {
        if ray[1].abs() < 1e-12 {
            return false;
        }
        let t = (floor - origin[1]) / ray[1];
        t > 0.0 && {
            let p: [f64; 3] = std::array::from_fn(|k| origin[k] + ray[k] * t);
            (p[0] - centre[0]).abs() <= half && (p[2] - centre[2]).abs() <= half
        }
    };
    let mut rays: Vec<[f64; 3]> = vec![
        [1.0, 0.0, 0.0],
        [-1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, -1.0],
    ];
    let mut state = 2123123u64;
    while rays.len() < 6 + ADDED_RAYS {
        let v: [f64; 3] = std::array::from_fn(|_| splitmix_draw(&mut state) * 2.0 - 1.0);
        let l = length(v);
        if l > 1e-3 && l <= 1.0 {
            rays.push(v.map(|x| x / l));
        }
    }
    let mut state = 124233u64;
    let mut samples: Vec<[f64; 3]> = (0..TRIANGLE_SAMPLES)
        .map(|_| {
            let b: [f64; 3] = std::array::from_fn(|_| splitmix_draw(&mut state) * 0.999 + 0.001);
            let s = b[0] + b[1] + b[2];
            b.map(|x| x / s)
        })
        .collect();
    samples.push([1.0 / 3.0; 3]);
    let offset = 1e-8;
    let hidden = |p: [f64; 3], normal: [f64; 3]| {
        let origin: [f64; 3] = std::array::from_fn(|k| p[k] + normal[k] * offset);
        rays.iter()
            .all(|&ray| under(origin, ray) || tree.blocked((origin, ray)))
    };
    let count = indices.len() / 3;
    let face: Vec<[f64; 3]> = (0..count)
        .map(|t| {
            let [a, b, c] = triangle_of(positions, indices, t);
            face_normal(a, b, c)
        })
        .collect();
    let mut vertex_normal = vec![[0.0f64; 3]; points.len()];
    for t in 0..count {
        for k in 0..3 {
            let v = indices[t * 3 + k] as usize;
            for a in 0..3 {
                vertex_normal[v][a] += face[t][a];
            }
        }
    }
    let vertex_hidden: Vec<bool> = (0..points.len())
        .into_par_iter()
        .map(|v| hidden(points[v], normalized_or(vertex_normal[v], [0.0, 1.0, 0.0])))
        .collect();
    let removed: Vec<bool> = (0..count)
        .into_par_iter()
        .map(|t| {
            let corners = [0, 1, 2].map(|k| indices[t * 3 + k] as usize);
            corners.iter().all(|&v| vertex_hidden[v]) && {
                let [a, b, c] = corners.map(|v| points[v]);
                samples.iter().all(|w| {
                    let p = std::array::from_fn(|k| a[k] * w[0] + b[k] * w[1] + c[k] * w[2]);
                    hidden(p, face[t])
                })
            }
        })
        .collect();
    // Grown by one ring of neighbours, then its border shrunk twice.
    let mut by_vertex: Vec<Vec<usize>> = vec![Vec::new(); points.len()];
    for t in 0..count {
        for k in 0..3 {
            by_vertex[indices[t * 3 + k] as usize].push(t);
        }
    }
    let ring = |t: usize| -> Vec<usize> {
        (0..3)
            .flat_map(|k| by_vertex[indices[t * 3 + k] as usize].iter().copied())
            .collect()
    };
    let mut selected = removed.clone();
    for t in (0..count).filter(|&t| removed[t]) {
        for n in ring(t) {
            selected[n] = true;
        }
    }
    for _ in 0..2 {
        let before = selected.clone();
        for t in (0..count).filter(|&t| before[t]) {
            if ring(t).iter().any(|&n| !before[n]) {
                selected[t] = false;
            }
        }
    }
    (0..count)
        .filter(|&t| !selected[t])
        .flat_map(|t| [0, 1, 2].map(|k| indices[t * 3 + k]))
        .collect()
}

/// Hard normals: around each vertex, the triangles joined across edges whose
/// faces turn by less than `HARD_NORMAL_ANGLE` share one normal, their area-weighted mean; one per
/// corner.
fn hard_normals(positions: &[f32], indices: &[u32]) -> Vec<[f32; 3]> {
    let count = indices.len() / 3;
    let faces: Vec<[f64; 3]> = (0..count)
        .map(|t| {
            let [a, b, c] = triangle_of(positions, indices, t);
            cross(sub(b, a), sub(c, a))
        })
        .collect();
    let unit: Vec<[f64; 3]> = faces
        .iter()
        .map(|&n| normalized_or(n, [0.0, 1.0, 0.0]))
        .collect();
    // Corner `t·3 + k` joins the corners of its vertex on triangles across smooth edges.
    let mut join = Join::new(count * 3);
    let limit = HARD_NORMAL_ANGLE.to_radians().cos();
    // Each edge's triangles in order, by sorting: the union-find unites under the least id, so
    // the groups do not depend on the order the edges are walked in.
    let mut by_edge: Vec<(u64, u32)> = (0..count)
        .into_par_iter()
        .flat_map_iter(|t| {
            [0, 1, 2].map(|k| {
                let (a, b) = (indices[t * 3 + k], indices[t * 3 + (k + 1) % 3]);
                (edge_key(a, b), t as u32)
            })
        })
        .collect();
    by_edge.par_sort_unstable();
    let corner_of = |t: usize, v: u32| (0..3).find(|&k| indices[t * 3 + k] == v).map(|k| t * 3 + k);
    for run in by_edge.chunk_by(|x, y| x.0 == y.0) {
        let key = run[0].0;
        let (a, b) = ((key >> 32) as u32, key as u32);
        for i in 0..run.len() {
            for j in i + 1..run.len() {
                let (s, t) = (run[i].1 as usize, run[j].1 as usize);
                if dot(unit[s], unit[t]) <= limit {
                    continue;
                }
                for v in [a, b] {
                    if let (Some(x), Some(y)) = (corner_of(s, v), corner_of(t, v)) {
                        join.unite(x as u32, y as u32);
                    }
                }
            }
        }
    }
    // Each triangle's unit normal weighted by its area and the corner's interior angle: a large
    // face counts more, and a vertex's normal does not depend on how its fan is split.
    let mut sums = vec![[0.0f64; 3]; count * 3];
    for corner in 0..count * 3 {
        let root = join.root(corner as u32) as usize;
        let t = corner / 3;
        let area = 0.5 * length(faces[t]);
        let corners = triangle_of(positions, indices, t);
        let k = corner % 3;
        let angle = {
            let (e1, e2) = (
                sub(corners[(k + 1) % 3], corners[k]),
                sub(corners[(k + 2) % 3], corners[k]),
            );
            let (l1, l2) = (length(e1), length(e2));
            if l1 > 0.0 && l2 > 0.0 {
                (dot(e1, e2) / (l1 * l2)).clamp(-1.0, 1.0).acos()
            } else {
                0.0
            }
        };
        let sum = &mut sums[root];
        for a in 0..3 {
            sum[a] += unit[t][a] * area * angle;
        }
    }
    (0..count * 3)
        .map(|corner| {
            let root = join.root(corner as u32) as usize;
            normalized_or(sums[root], unit[corner / 3]).map(|x| x as f32)
        })
        .collect()
}

/// The approximated shell of `meshes` at the voxel `accuracy`, simplified within `deviation`, in
/// metres; `Err` with the reason it gives up — a step left no triangle — and the triangles of the
/// steps done.
pub(super) fn approximate(
    meshes: &[Mesh],
    accuracy: f64,
    deviation: f64,
) -> Result<Shell, (&'static str, Stages)> {
    let mut stages: Stages = [0; STAGE_COUNT];
    let mut ms: StageMs = [0; step::COUNT];
    let started = std::time::Instant::now();
    let scene = scene(meshes, accuracy).ok_or(("no part in the scene", stages))?;
    ms[step::FIELD] = super::millis(started);
    let started = std::time::Instant::now();
    let target = voxel_target(scene.bounds, accuracy);
    let (positions, indices) = solidify(&scene, accuracy, target);
    drop(scene);
    ms[step::MARCH] = super::millis(started);
    stages[0] = indices.len() / 3;
    if indices.is_empty() {
        return Err(("the solid has no triangle", stages));
    }
    // The gaps closed by the gap distance on the solid's own grid, `target` cells across.
    let started = std::time::Instant::now();
    let (positions, indices) = super::morphology::close((positions, indices), GAP_DISTANCE, target);
    ms[step::CLOSE] = super::millis(started);
    stages[1] = indices.len() / 3;
    if indices.is_empty() {
        return Err(("the morphology mesh has no triangle", stages));
    }
    // The simplification's share holds the occlusion filter and the hard normals after it.
    let started = std::time::Instant::now();
    let ((positions, indices), simplified) = super::simplify::simplify(
        (positions, indices),
        FIRST_PASS_TRIANGLES,
        (accuracy, deviation),
    );
    stages[2..].copy_from_slice(&simplified);
    let visible = remove_occluded(&positions, &indices);
    if visible.is_empty() {
        return Err(("the occlusion filter removed every triangle", stages));
    }
    let (kept, kept_indices, _) = crate::qem::compact_region(&positions, &visible);
    let normals = hard_normals(&kept, &kept_indices);
    ms[step::SIMPLIFY] = super::millis(started);
    Ok(Shell {
        positions: kept,
        indices: kept_indices,
        normals,
        closed: (positions, indices),
        stages,
        ms,
    })
}
