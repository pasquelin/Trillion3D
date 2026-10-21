//! The approximated shell's tangents, once it has its normals and its atlas coordinates: per
//! corner, averaged over the corners about its vertex that share its normal and its coordinates,
//! as MikkTSpace groups them (Mikkelsen 2008). The frame the shell's normal map is baked in
//! (`bake/gpu/capture.wgsl`) and the engine bends it with: the pages store them (`FLAG_TANGENT`).
//! 1. Each triangle's tangent and bitangent: its edges weighed by its texture deltas, each made
//!    unit, both turned back when its texture area is negative; a triangle of texture area under
//!    `FLAT_TEXTURE_AREA` degenerate.
//! 2. About each vertex, its triangles in the order the shell's mesh visits them — the triangles
//!    appended in order (`mesh::Mesh`, `Mesh::triangles_at`) —, each corner's two projected on the
//!    plane of its normal, made unit, weighed by the corner's angle and summed into the group of
//!    the corners sharing its wedge — its vertex, normal and coordinates —, a corner whose tangent
//!    or bitangent turns back against its group's (`SPLIT_DOT`) starting a group of its own. A
//!    triangle the mesh refuses — naming a vertex twice, on a side two triangles hold already,
//!    repeating a held one — has each corner a group of its own.
//! 3. Each group made unit: a corner's tangent its group's, its bitangent's sign the side its
//!    group's bitangent lies on of the normal crossed with the tangent.
//! 4. A degenerate held triangle's corners given, pass after pass, those of the first triangle
//!    across one of its sides that is not degenerate (`Mesh::neighbour_triangles`) — the side's
//!    ends their own, its third corner the lower end's —, until a pass gives none.
use crate::hlod::flatten::mesh::{Mesh, NONE};
use trillion3d_math::geometry::triangle::corner_angle;
use trillion3d_math::vector::vec3::{cross, unit_or_itself};
use trillion3d_math::vector::vecn::{dot, scale, sub};

/// The texture area under which a triangle is degenerate.
const FLAT_TEXTURE_AREA: f64 = 1e-8;
/// The cosine at or under which a corner's tangent or bitangent leaves its group for its own.
const SPLIT_DOT: f64 = -0.99;

/// `v` projected on the plane of unit `normal`, made unit (zero when it has no length).
fn projected(v: [f64; 3], normal: [f64; 3]) -> [f64; 3] {
    unit_or_itself(sub(v, scale(normal, dot(v, normal))))
}

/// Triangle `corners`' unit tangent and bitangent over its texture coordinates `uv`, and whether
/// its texture area is degenerate.
fn face_tangents(corners: [[f64; 3]; 3], uv: [[f64; 2]; 3]) -> ([[f64; 3]; 2], bool) {
    let (d1, d2) = (sub(uv[1], uv[0]), sub(uv[2], uv[0]));
    let (e1, e2) = (sub(corners[1], corners[0]), sub(corners[2], corners[0]));
    let tangent = sub(scale(e1, d2[1]), scale(e2, d1[1]));
    let bitangent = sub(scale(e2, d1[0]), scale(e1, d2[0]));
    let area = d1[0] * d2[1] - d1[1] * d2[0];
    let turn = if area >= 0.0 { 1.0 } else { -1.0 };
    let frame = [tangent, bitangent].map(|v| scale(unit_or_itself(v), turn));
    (frame, area.abs() < FLAT_TEXTURE_AREA)
}

/// Per corner of `triangles` over `points`, its tangent and its bitangent's sign: `wedges` per
/// corner its wedge, `normals` and `uvs` per wedge its normal and its coordinates (the module's
/// steps).
pub(in crate::hlod::flatten) fn tangents(
    (points, triangles): (&[[f64; 3]], &[[usize; 3]]),
    wedges: &[u32],
    (normals, uvs): (&[[f64; 3]], &[[f64; 2]]),
) -> Vec<[f64; 4]> {
    let corners = |t: usize| triangles[t].map(|v| points[v]);
    let normal = |c: usize| normals[wedges[c] as usize];
    let faces: Vec<([[f64; 3]; 2], bool)> = (0..triangles.len())
        .map(|t| {
            face_tangents(
                corners(t),
                [0, 1, 2].map(|k| uvs[wedges[t * 3 + k] as usize]),
            )
        })
        .collect();
    let mut mesh = Mesh::with_vertices(points.len());
    // Per held triangle, its rank among `triangles`; per triangle, whether it is held.
    let mut held = Vec::with_capacity(triangles.len());
    let mut is_held = vec![false; triangles.len()];
    for (t, &triangle) in triangles.iter().enumerate() {
        if mesh.append(triangle).is_ok() {
            held.push(t);
            is_held[t] = true;
        }
    }
    // Each vertex's corners as the mesh visits its triangles, then each refused triangle's
    // corners, one a vertex.
    let mut around: Vec<Vec<usize>> = (0..points.len())
        .map(|v| {
            (mesh.triangles_at(v).map(|m| held[m]))
                .filter_map(|t| (0..3).find(|&k| triangles[t][k] == v).map(|k| t * 3 + k))
                .collect()
        })
        .collect();
    around.extend(
        (0..triangles.len())
            .filter(|&t| !is_held[t])
            .flat_map(|t| [0, 1, 2].map(|k| vec![t * 3 + k])),
    );
    let mut out = vec![[0.0f64; 4]; triangles.len() * 3];
    for corners_of in &around {
        // Each group: its wedge, its tangent and bitangent sums, its corners.
        let mut groups: Vec<(u32, [[f64; 3]; 2], Vec<usize>)> = Vec::new();
        for &c in corners_of {
            let (t, k) = (c / 3, c % 3);
            let weight = corner_angle(corners(t), k);
            let [tangent, bitangent] = faces[t].0.map(|v| scale(projected(v, normal(c)), weight));
            // The wedge's first group, unless the corner turns back against it.
            let first = groups.iter().position(|(wedge, ..)| *wedge == wedges[c]);
            let same = first.filter(|&g| {
                let sums = &groups[g].1;
                dot(unit_or_itself(sums[0]), tangent) > SPLIT_DOT
                    && dot(unit_or_itself(sums[1]), bitangent) > SPLIT_DOT
            });
            match same {
                Some(g) => {
                    let (_, sums, members) = &mut groups[g];
                    sums[0] = [0, 1, 2].map(|a| sums[0][a] + tangent[a]);
                    sums[1] = [0, 1, 2].map(|a| sums[1][a] + bitangent[a]);
                    members.push(c);
                }
                None => groups.push((wedges[c], [tangent, bitangent], vec![c])),
            }
        }
        for (_, [tangent, bitangent], members) in groups {
            let tangent = unit_or_itself(tangent);
            for c in members {
                let side = dot(cross(normal(c), tangent), bitangent);
                let sign = if side < 0.0 { -1.0 } else { 1.0 };
                out[c] = [tangent[0], tangent[1], tangent[2], sign];
            }
        }
    }
    spread_to_degenerate((triangles, &normal), (&mesh, &held), &faces, &mut out);
    out
}

/// Each degenerate held triangle's corners given those of the first triangle across one of its
/// sides that is not degenerate, the side's two ends by their own and the third corner the lower
/// end's, pass after pass, until a pass gives none (step 4): the tangent as it is, the bitangent's
/// sign the side the given bitangent lies on of the corner's own normal crossed with the tangent.
/// `held` names each of `mesh`'s triangles by its rank among `triangles`; `normal` gives a corner's.
fn spread_to_degenerate(
    (triangles, normal): (&[[usize; 3]], &impl Fn(usize) -> [f64; 3]),
    (mesh, held): (&Mesh, &[usize]),
    faces: &[([[f64; 3]; 2], bool)],
    out: &mut [[f64; 4]],
) {
    let mut degenerate: Vec<bool> = faces.iter().map(|&(_, flat)| flat).collect();
    // The held degenerate triangles, by their ids in the mesh.
    let mut pending: Vec<usize> = (0..held.len()).filter(|&m| degenerate[held[m]]).collect();
    while !pending.is_empty() {
        let before = pending.len();
        pending.retain(|&m| {
            let t = held[m];
            let Some((k, other)) = (0..3)
                .map(|k| (k, mesh.neighbour_triangles(m)[k]))
                .filter(|&(_, n)| n != NONE)
                .map(|(k, n)| (k, held[n]))
                .find(|&(_, other)| !degenerate[other])
            else {
                return true;
            };
            let (a, b) = (triangles[t][k], triangles[t][(k + 1) % 3]);
            let (low, high) = (a.min(b), a.max(b));
            // The corner of triangle `s` at vertex `v`.
            let at =
                |s: usize, v: usize| s * 3 + (0..3).position(|j| triangles[s][j] == v).unwrap_or(0);
            // Corner `from`'s tangent and bitangent given to corner `to`.
            let given = |from: usize, to: usize| {
                let [x, y, z, w] = out[from];
                let bitangent = scale(cross(normal(from), [x, y, z]), w);
                let side = dot(cross(normal(to), [x, y, z]), bitangent);
                [x, y, z, if side < 0.0 { -1.0 } else { 1.0 }]
            };
            let (from_low, from_high) = (at(other, low), at(other, high));
            let third = t * 3 + (k + 2) % 3;
            let values = [
                (at(t, low), given(from_low, at(t, low))),
                (at(t, high), given(from_high, at(t, high))),
                (third, given(from_low, third)),
            ];
            for (corner, value) in values {
                out[corner] = value;
            }
            degenerate[t] = false;
            false
        });
        if pending.len() == before {
            break;
        }
    }
}
