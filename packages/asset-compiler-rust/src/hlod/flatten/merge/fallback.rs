//! The fallback of a source: the mesh a merged layer takes of it at its coarsest LOD
//! (`LodSelection::Lowest`) — the source simplified once, over its whole surface, to an error of
//! `RELATIVE_ERROR` percent of its size.
//!
//! 1. The size (`dag::relative_size`) is read from the area of the DAG's level 0 — its clusters'
//!    areas summed — and the box holding every cluster of every level; the error asked is
//!    `RELATIVE_ERROR` percent of it, the triangles every one of the source's (`TRIANGLES`), at
//!    least `AT_LEAST`.
//! 2. The DAG is cut from its roots at that error and those triangles, the cut going on past them
//!    by `OVERSHOOT` triangles (`dag::find_cut`), and the cut's clusters are merged: their
//!    vertices equal in every float are one vertex, their triangles one region, their areas
//!    summed. Every edge of the region is shared with another cluster of the cut or is the
//!    mesh's own border, so no position of it is locked.
//! 3. The region is simplified (`Region::solve_to`), its attributes weighed as a group's are
//!    (`dag::attributes::group_weighted`) and every rule of the build kept (`SolveRules`): the
//!    collapses go on past the triangles until one costs the error, and stop at `LIMIT` triangles,
//!    or at the triangles the cut asks when they are fewer.
//! 4. What remains is the fallback: its vertices compacted, each carrying every attribute the
//!    source carries, those the simplifier weighs as it solved them.
use super::Geometry;
use crate::dag::attributes::{group_weighted, key, row_offset};
use crate::dag::{clusters_area, find_cut, relative_size, DagAttributes, DagCluster, DagGroup};
use crate::simplify::region::Region;
use crate::simplify::{compact_region, push_vertex, SolveRules};
use crate::Result;
use trillion3d_math::geometry::aabb::aabb_of_f32;
use trillion3d_math::vector::vec3::point_checked_f32;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::hash::{word_map, WordMap};

/// The error a fallback is simplified to, in percent of the source's size.
const RELATIVE_ERROR: f32 = 1.0;
/// The share of the source's triangles a fallback aims at: every one.
const TRIANGLES: f32 = 1.0;
/// The fewest triangles a fallback aims at.
const AT_LEAST: usize = 64;
/// The triangles the cut goes on past the target by (`dag::find_cut`).
const OVERSHOOT: usize = 4096;
/// The triangles a fallback's simplification stops at whatever its error, the lesser of this and
/// the triangles it aims at.
const LIMIT: usize = 256;

/// The fallback of the source whose clusters are `dag`, made by `groups`, over `pos` and the
/// attributes `carried` (one value set per vertex of `pos`), simplified under `rules`: its
/// vertices, the attributes it carries on them, in the order of `carried`, and its triangles.
pub(super) fn of(
    (dag, groups): (&[DagCluster], &[DagGroup]),
    (pos, carried): (&[f32], &[&Attribute]),
    rules: SolveRules,
) -> Result<Geometry> {
    let level0 = || dag.iter().filter(|c| c.level == 0);
    let area = clusters_area(pos, level0());
    let corners = (dag.iter().flat_map(|c| c.indices.iter()))
        .filter_map(|&v| point_checked_f32(pos, v as usize));
    let size = relative_size(area, aabb_of_f32(corners));
    let source_triangles: usize = level0().map(DagCluster::triangles).sum();
    let triangles = ((source_triangles as f32 * TRIANGLES) as usize).max(AT_LEAST);
    let error = RELATIVE_ERROR * 0.01 * size;

    let found = find_cut(dag, groups, (triangles, f64::from(error)), OVERSHOOT);
    let cut: Vec<&DagCluster> = found.cut.iter().map(|&slot| &dag[slot]).collect();
    let area = clusters_area(pos, cut.iter().copied());
    let held = || carried.iter().map(|a| (&a.values[..], a.width));
    let mut first: WordMap<_, u32> = word_map(0);
    let welded: Vec<u32> = (cut.iter().flat_map(|c| c.indices.iter()))
        .map(|&v| *first.entry(key(pos, v as usize, held())).or_insert(v))
        .collect();

    let weighted = DagAttributes { carried }.weighted();
    let weighted = group_weighted(&weighted, &welded, rules);
    let region = Region::of(pos, &weighted, &|_| false, &welded, area, rules)?;
    let solved = region.solve_to((triangles, error), triangles.min(LIMIT));

    let (positions, indices, used) = compact_region(&solved.positions, &solved.indices);
    let stride = solved.stride();
    let attributes = carried
        .iter()
        .map(|&a| {
            let row = row_offset(&weighted, a);
            let mut values = Vec::with_capacity(used.len() * a.width);
            for &local in &used {
                let local = local as usize;
                match row {
                    Some(at) => {
                        let from = local * stride + at;
                        values.extend_from_slice(&solved.values[from..from + a.width]);
                    }
                    None => push_vertex(&mut values, &a.values, a.width, region.remap[local]),
                }
            }
            Attribute {
                flag: a.flag,
                width: a.width,
                values,
            }
        })
        .collect();
    Ok((positions, attributes, indices))
}
