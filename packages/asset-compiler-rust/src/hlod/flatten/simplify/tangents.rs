//! The simplified mesh's tangent frames (`vertex_tangents`): per vertex, the unit tangent along the
//! texture's `u` and the sign of its bitangent, as a per-vertex tangent frame is made from a mesh's
//! normals and texture coordinates. Each triangle's tangent — its edges weighed by the texture
//! deltas across them — and bitangent, over its texture area (one where that is a ten-thousandth
//! or less), are summed into its three vertices. Each vertex's normal is made unit; its tangent sum
//! is made orthogonal to the normal and unit, its bitangent sum orthogonal to both and unit. A
//! vector left no longer than a ten-thousandth is rebuilt: the bitangent from the normal across
//! the tangent where the tangent holds (past a half), else the tangent from the bitangent across
//! the normal, else both from the normal and the axis it lies least along. The sign is the one of
//! the determinant of the tangent, the bitangent and the normal.
//!
//! The frame the transfer writes the normal map in (`transfer::gather`) and the pages store
//! (`FLAG_TANGENT`), computed on the mesh as it is laid out in our frame. The routines follow
//! DirectXMesh (MIT, `THIRD_PARTY_NOTICES.md`), single precision.
use super::normals::unit;
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{add, dot, length, scale, sub};

type V = [f32; 3];

/// The length at or under which a frame's vector is lost, and the texture area at or under which
/// a triangle's mapping is.
const LOST: f32 = 0.0001;

/// The frame of a vertex of `normal` whose triangles' tangents sum to `along` and bitangents to
/// `across`: the unit tangent and the sign of its bitangent (module doc).
fn frame(normal: V, along: V, across: V) -> [f32; 4] {
    let n = unit(normal);
    let mut tangent = unit(sub(along, scale(n, dot(n, along))));
    let flat = sub(across, scale(n, dot(n, across)));
    let mut bitangent = unit(sub(flat, scale(tangent, dot(tangent, across))));
    let (first, second) = (length(tangent), length(bitangent));
    if first <= LOST || second <= LOST {
        if first > 0.5 {
            bitangent = cross(n, tangent);
        } else if second > 0.5 {
            tangent = cross(bitangent, n);
        } else {
            let reach = n.map(f32::abs);
            let axis = match (
                reach[0] < reach[1],
                reach[0] < reach[2],
                reach[1] < reach[2],
            ) {
                (true, true, _) => 0,
                (true, false, _) => 2,
                (false, _, true) => 1,
                (false, _, false) => 2,
            };
            let mut edge = [0.0; 3];
            edge[axis] = 1.0;
            tangent = cross(n, edge);
            bitangent = cross(n, tangent);
        }
    }
    let sign = match dot(tangent, cross(bitangent, normal)) < 0.0 {
        true => -1.0,
        false => 1.0,
    };
    [tangent[0], tangent[1], tangent[2], sign]
}

/// Per vertex of the mesh `points`, `normals` and `uvs` per vertex, over the triangles `indices`,
/// its tangent frame: the tangent's three components, then its bitangent's sign (module doc).
pub(super) fn vertex_tangents(
    (points, normals, uvs): (&[V], &[V], &[[f32; 2]]),
    indices: &[u32],
) -> Vec<[f32; 4]> {
    let mut along = vec![[0.0f32; 3]; points.len()];
    let mut across = vec![[0.0f32; 3]; points.len()];
    for triangle in indices.as_chunks::<3>().0 {
        let [a, b, c] = triangle.map(|v| v as usize);
        let (d1, d2) = (sub(uvs[b], uvs[a]), sub(uvs[c], uvs[a]));
        let area = d1[0] * d2[1] - d1[1] * d2[0];
        let inverse = if area.abs() <= LOST { 1.0 } else { 1.0 / area };
        let (e1, e2) = (sub(points[b], points[a]), sub(points[c], points[a]));
        let u = add(scale(e1, d2[1] * inverse), scale(e2, -d1[1] * inverse));
        let v = add(scale(e1, -d2[0] * inverse), scale(e2, d1[0] * inverse));
        for k in [a, b, c] {
            along[k] = add(along[k], u);
            across[k] = add(across[k], v);
        }
    }
    (0..points.len())
        .map(|k| frame(normals[k], along[k], across[k]))
        .collect()
}
