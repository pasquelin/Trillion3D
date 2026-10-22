//! The texture-coordinate density of a displaced material: how many units of the object's space one
//! unit of each of its texture-coordinate sets covers, which the run-time tessellation reads the
//! height map at the level of (`visibility/tessellation/domainWgsl.ts`, `uvDerivative`). One
//! number a set and a material, never one a triangle: the micro-triangles of a surface meet along
//! the same coordinate derivative whichever triangle of it they were cut from, so they read the same
//! level of the map and no crack opens between two triangles of different stretch.
//!
//! Measured over every triangle that wears the material, in the object's own space: a triangle
//! with a surface area and an area in the coordinate both above `SMALL_AREA` says `sqrt(area /
//! coordinate area)`, weighed by `sqrt(area)`; the tenth of a primitive's triangles that say the
//! least and the tenth that say the most are left out; the density is the weighted mean of the rest,
//! the weights and the weighted sums of every primitive that wears the material added before
//! they are divided. A set no triangle measures, or measures under `MIN_WEIGHT`, has density 0:
//! the runtime reads 1 where it finds none.
//!
//! Only a displaced material is measured (`displacement`): a scene with none reads no triangle
//! here, and its tables are the ones they were.
use super::*;
use crate::compiler::accessor::create::accessor;
use crate::compiler::primitive::triangles::{mesh_primitives, read};
use crate::compiler::validate::required_index;
use std::collections::{BTreeMap, BTreeSet};

/// The texture-coordinate sets measured: the first four, the ones a material reads.
pub(crate) const UV_SETS: usize = 4;
/// The least area, in the object's squared units and in the coordinate's, a triangle measures at.
const SMALL_AREA: f32 = 1e-8;
/// The weight under which a set's density is not measured.
const MIN_WEIGHT: f64 = 1e-4;
/// The share of a primitive's measured triangles, from the least and from the most dense, that the
/// mean leaves out: a tenth each.
const DISCARD: f32 = 0.1;

/// The texture coordinates of each set a primitive has: its `TEXCOORD_n` accessor, none where it
/// has no such set or the set is not two wide.
type Sets = [Option<Vec<f32>>; UV_SETS];

/// What the triangles measured so far of one material say: for each set the sum of `density *
/// weight` and the sum of the weights.
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub(crate) struct Density {
    weighted: [f64; UV_SETS],
    weight: [f64; UV_SETS],
}

/// The length of the cross product of the edges `ab` and `ac`: twice the area of the triangle.
fn surface_area(a: [f32; 3], b: [f32; 3], c: [f32; 3]) -> f32 {
    let (u, v) = (
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    );
    let x = u[1] * v[2] - u[2] * v[1];
    let y = u[2] * v[0] - u[0] * v[2];
    let z = u[0] * v[1] - u[1] * v[0];
    (x * x + y * y + z * z).sqrt()
}

/// The absolute cross product of the edges `ab` and `ac` in the coordinate: twice its area.
fn coordinate_area(a: [f32; 2], b: [f32; 2], c: [f32; 2]) -> f32 {
    ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs()
}

impl Density {
    /// Adds the triangles `indices` (three vertices each, all named by `positions`, flat) of one
    /// primitive, whose coordinates are `sets`: each set's triangles sorted by what they say, the
    /// tenth at either end left out, the rest summed in.
    pub(crate) fn add(&mut self, positions: &[f32], indices: &[u32], sets: &Sets) {
        let vertex = |i: u32| {
            let at = i as usize * 3;
            [positions[at], positions[at + 1], positions[at + 2]]
        };
        // For each set, the (density, weight) of every triangle it measures.
        let mut measured: [Vec<(f32, f32)>; UV_SETS] = Default::default();
        for triangle in indices.chunks_exact(3) {
            let area = surface_area(
                vertex(triangle[0]),
                vertex(triangle[1]),
                vertex(triangle[2]),
            );
            if area <= SMALL_AREA {
                continue;
            }
            for (set, uv) in sets.iter().enumerate() {
                let Some(uv) = uv else { continue };
                let at = |i: u32| [uv[i as usize * 2], uv[i as usize * 2 + 1]];
                let covered = coordinate_area(at(triangle[0]), at(triangle[1]), at(triangle[2]));
                if covered > SMALL_AREA {
                    measured[set].push(((area / covered).sqrt(), area.sqrt()));
                }
            }
        }
        for (set, list) in measured.iter_mut().enumerate() {
            list.sort_by(|a, b| a.0.total_cmp(&b.0));
            let left_out = (DISCARD * list.len() as f32).floor() as usize;
            for &(density, weight) in &list[left_out..list.len() - left_out] {
                self.weighted[set] += f64::from(density) * f64::from(weight);
                self.weight[set] += f64::from(weight);
            }
        }
    }

    /// The density of each set — its weighted mean, 0 where its weight is under `MIN_WEIGHT` —, none
    /// when no set was measured.
    pub(crate) fn per_set(&self) -> Option<[f64; UV_SETS]> {
        let mut out = [0.0; UV_SETS];
        for (set, density) in out.iter_mut().enumerate() {
            if self.weight[set] > MIN_WEIGHT {
                *density = self.weighted[set] / self.weight[set];
            }
        }
        out.iter().any(|d| *d > 0.0).then_some(out)
    }
}

/// The coordinates of every set primitive `p` has. A set that does not read is left out: a density
/// is a measure, never a reason to refuse a scene.
fn sets_of(g: &Value, bin: &[u8], p: &Value, vertices: usize) -> Sets {
    let mut sets: Sets = Default::default();
    for (set, slot) in sets.iter_mut().enumerate() {
        let Some(id) = p.pointer(&format!("/attributes/TEXCOORD_{set}")) else {
            continue;
        };
        let read = required_index(Some(id), "primitive.attributes.TEXCOORD")
            .and_then(|id| accessor(g, bin, id, None))
            .and_then(|a| {
                if a.width == 2 {
                    a.collect_f32()
                } else {
                    Ok(Vec::new())
                }
            });
        *slot = read.ok().filter(|uv| uv.len() == vertices * 2);
    }
    sets
}

/// The materials of `g` that are displaced (`displacement`), by glTF rank.
fn displaced(g: &Value) -> Result<BTreeSet<usize>> {
    let mut ranks = BTreeSet::new();
    for (rank, m) in g
        .get("materials")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        if super::displacement::displacement(m)?.is_some() {
            ranks.insert(rank);
        }
    }
    Ok(ranks)
}

/// The UV density of every displaced material of `g`, by glTF rank, measured over the triangles of
/// the primitives of `meshes` — the ones the job keeps — that wear it; a material no triangle
/// measures is left out. Nothing is read for a scene with no displaced material.
pub(crate) fn by_material(
    g: &Value,
    bin: &[u8],
    meshes: impl Iterator<Item = usize>,
) -> Result<BTreeMap<usize, [f64; UV_SETS]>> {
    let wanted = displaced(g)?;
    let mut sums: BTreeMap<usize, Density> = BTreeMap::new();
    if wanted.is_empty() {
        return Ok(BTreeMap::new());
    }
    for mesh in meshes {
        for (_, p) in mesh_primitives(g, mesh)? {
            let Some(rank) = p.get("material").and_then(Value::as_u64) else {
                continue;
            };
            let rank = rank as usize;
            if !wanted.contains(&rank) {
                continue;
            }
            let Ok((positions, indices, _)) = read(g, bin, p, None) else {
                continue;
            };
            let vertices = positions.count;
            let Ok(positions) = positions.collect_f32() else {
                continue;
            };
            let sets = sets_of(g, bin, p, vertices);
            sums.entry(rank)
                .or_default()
                .add(&positions, &indices, &sets);
        }
    }
    Ok(sums
        .into_iter()
        .filter_map(|(rank, sum)| Some((rank, sum.per_set()?)))
        .collect())
}
