//! A topology unwrapped by the spectral charts, as the mesh parameterization drives them:
//!
//! 1. the mesh made of the topology as a mesh holds one (`Base`), its points in centimetres, and
//!    turned over — each triangle's first two corners exchanged, so that the second and third of
//!    its sides exchange too — with the triangles across its sides read from it, as the charts
//!    face the other way round; a mesh of one triangle that has no area is refused;
//! 2. the charts cut (`spectral::chart`): as many as keep their stretch within the bound, every
//!    face's metric the identity, the faces' links as the mesh gives them — the mesh is not
//!    cleaned, so a vertex shared by two fans of triangles, which the charts cannot cut, fails;
//! 3. the charts found again as the groups of faces joined across the cut mesh, breadth first from
//!    each face not yet reached, each given its own copy of every vertex it names
//!    (`repartitioned`);
//! 4. those packed into an atlas of 512 texels a side with 2.5 texels between charts
//!    (`spectral::pack`);
//! 5. each triangle's corners given the coordinates of the turned triangle's second, first and
//!    third corners, so that the coordinates face the triangle as it was.
//!
//! The charts that fail give no unwrap: the caller takes the coordinates its mesh has (a merged
//! mesh) or projects them from a box (an approximated shell, `boxed`).
use super::base::Base;
use super::{Topology, Unwrapped};
use crate::hlod::flatten::mesh::NONE;
use crate::hlod::flatten::uv::charts::{islands, TURN};
use crate::hlod::flatten::uv::spectral::{chart, pack, ChartQuality, Charted, IDENTITY_METRIC};
use trillion3d_math::geometry::triangle::triangle_area;

/// The side of the atlas, texels, and the gutter between its charts, texels.
const ATLAS_SIDE: usize = 512;
const GUTTER: f32 = 2.5;

/// The mesh's triangles turned over, and per turned triangle the triangle across each of its
/// sides, `u32::MAX` for none.
fn turned_over(base: &Base) -> (Vec<u32>, Vec<u32>) {
    let faces = base.triangle_count();
    let mut indices = Vec::with_capacity(3 * faces);
    let mut adjacency = Vec::with_capacity(3 * faces);
    for t in 0..faces {
        let tri = base.mesh.triangles[t];
        indices.extend(TURN.map(|k| tri[k] as u32));
        let across = base.mesh.neighbour_triangles(t);
        adjacency.extend([across[0], across[2], across[1]].map(|n| match n {
            NONE => u32::MAX,
            n => n as u32,
        }));
    }
    (indices, adjacency)
}

/// `partition`'s charts found again and each given its own vertices (module doc): its vertices
/// copied, in the order the faces of each chart first name them, with their coordinates; its faces
/// kept in their order.
fn repartitioned(partition: Charted) -> Charted {
    let faces = partition.indices.len() / 3;
    let mut reached = vec![false; faces];
    let mut indices = vec![0u32; 3 * faces];
    let (mut uvs, mut remap) = (Vec::new(), Vec::new());
    // Per vertex, the chart that copied it last — named by its first face — and its copy.
    let mut copy_of = vec![(u32::MAX, 0u32); partition.uvs.len()];
    let mut group = Vec::new();
    for first in 0..faces {
        if reached[first] {
            continue;
        }
        reached[first] = true;
        group.clear();
        group.push(first);
        let mut at = 0;
        while at < group.len() {
            for edge in 0..3 {
                let across = partition.cut_adjacency[3 * group[at] + edge];
                if across != u32::MAX && !reached[across as usize] {
                    reached[across as usize] = true;
                    group.push(across as usize);
                }
            }
            at += 1;
        }
        for &face in &group {
            for k in 0..3 {
                let vertex = partition.indices[3 * face + k] as usize;
                if copy_of[vertex].0 != first as u32 {
                    copy_of[vertex] = (first as u32, uvs.len() as u32);
                    uvs.push(partition.uvs[vertex]);
                    remap.push(partition.remap[vertex]);
                }
                indices[3 * face + k] = copy_of[vertex].1;
            }
        }
    }
    Charted {
        uvs,
        indices,
        remap,
        cut_adjacency: partition.cut_adjacency,
        draw: partition.draw,
    }
}

/// `charted`'s coordinates given to the corners of `topology`'s triangles that `base` holds
/// (module doc), the islands those triangles form: the groups joined across the edges whose two
/// texture vertices they share.
fn unwrapped(topology: &Topology, base: &Base, charted: &Charted) -> Unwrapped {
    // The coordinates of the turned triangle's corner `k` of mesh triangle `b`.
    let turned = |b: usize, k: usize| charted.uvs[charted.indices[3 * b + k] as usize];
    let uv = |b: usize, k: usize| turned(b, TURN[k]).map(f64::from);
    let vertex_of: Vec<usize> = charted.indices.iter().map(|&v| v as usize).collect();
    let groups = islands(base.triangle_count(), &vertex_of, |_| false);
    base.unwrapped(topology.triangles.len(), uv, groups)
}

/// `topology` unwrapped by the spectral charts, their stretch within `stretch` (module doc); none
/// where the charts fail.
pub(crate) fn atlas(topology: &Topology, stretch: f32) -> Option<Unwrapped> {
    let base = Base::in_centimetres(topology);
    let faces = base.triangle_count();
    if faces == 1 {
        let [a, b, c] = base.corners(0);
        let area = triangle_area(a, b, c).abs();
        if area.is_nan() || area <= 1.0e-5 {
            return None;
        }
    }
    let points: Vec<[f32; 3]> = base.points.iter().map(|p| p.map(|x| x as f32)).collect();
    let (indices, adjacency) = turned_over(&base);
    let signal = IDENTITY_METRIC.repeat(faces);
    let partition = chart(
        &points,
        &indices,
        &adjacency,
        None,
        Some(signal.as_slice()),
        (0, stretch),
        ChartQuality::ByFaceCount,
    );
    let mut charted = repartitioned(partition.ok()?);
    pack(&mut charted, (ATLAS_SIDE, ATLAS_SIDE), GUTTER).ok()?;
    Some(unwrapped(topology, &base, &charted))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A partition of the square over vertices 0 to 3 into the faces 0, 1, 2 and 0, 2, 3, `across`
    /// the faces across their sides.
    fn partition(across: [u32; 6]) -> Charted {
        Charted {
            uvs: vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
            indices: vec![0, 1, 2, 0, 2, 3],
            remap: vec![0, 1, 2, 3],
            cut_adjacency: across.to_vec(),
            draw: 7,
        }
    }

    #[test]
    fn charts_that_share_a_vertex_each_get_a_copy_of_it() {
        // Cut apart: no face across any side.
        let split = repartitioned(partition([u32::MAX; 6]));
        assert_eq!(split.indices, [0, 1, 2, 3, 4, 5]);
        assert_eq!(split.remap, [0, 1, 2, 0, 2, 3]);
        assert_eq!(split.uvs.len(), 6);
        assert_eq!(split.uvs[3], [0.0, 0.0]);
        assert_eq!(split.draw, 7);
    }

    #[test]
    fn faces_joined_across_a_side_keep_their_vertices() {
        let max = u32::MAX;
        let split = repartitioned(partition([max, max, 1, 0, max, max]));
        assert_eq!(split.indices, [0, 1, 2, 0, 2, 3]);
        assert_eq!(split.uvs.len(), 4);
    }

    #[test]
    fn a_single_triangle_of_no_area_is_not_charted() {
        let points = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]];
        let triangles = [[0, 1, 2]];
        let topology = Topology {
            points: &points,
            triangles: &triangles,
        };
        assert!(atlas(&topology, 0.1).is_none());
    }
}
