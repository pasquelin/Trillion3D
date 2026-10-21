//! The final charts exported over the input's vertices.
//!
//! The charts' vertices are laid one chart after another, then every input vertex no chart uses
//! (at plane position (1, 1)); each face, in the input's order, names its chart's vertices
//! offset by the vertices of the charts before it, and the face across each of its edges (none
//! across a cut, where a false edge may never lie). The input's corners are then remapped: an
//! input vertex keeps its own number for the first output vertex its corners name, and each other
//! output vertex they name becomes a new vertex after the input's, found again through a ring of
//! the copies of each input vertex. A vertex takes the plane position of the output vertex it maps
//! to (none, for an unused one: the origin).
use crate::hlod::flatten::uv::spectral::fail::failed;
use crate::hlod::flatten::uv::spectral::mesh::{Chart, NONE};
use crate::hlod::flatten::uv::spectral::source::Source;
use crate::hlod::flatten::uv::spectral::Charted;

/// The output of `charts` over the input's `indices`.
pub(super) fn export(source: &Source, indices: &[u32], charts: &[Chart]) -> crate::Result<Charted> {
    let faces = source.face_count;
    let mut used = vec![false; source.vertex_count];
    let mut uvs = Vec::new();
    for chart in charts {
        for v in &chart.verts {
            used[v.root as usize] = true;
            uvs.push(v.uv);
        }
    }
    uvs.extend(used.iter().filter(|&&u| !u).map(|_| [1.0, 1.0]));
    let mut corners = vec![0u32; 3 * faces];
    let mut cut_adjacency = vec![0u32; 3 * faces];
    let mut offset = 0;
    for chart in charts {
        for (j, face) in chart.faces.iter().enumerate() {
            let root = face.root as usize;
            for k in 0..3 {
                corners[3 * root + k] = face.verts[k] + offset;
                let edge = &chart.edges[face.edges[k] as usize];
                cut_adjacency[3 * root + k] = if edge.boundary {
                    if !edge.splittable {
                        return Err(failed("a false edge became a cut"));
                    }
                    NONE
                } else if edge.faces[0] == j as u32 {
                    chart.faces[edge.faces[1] as usize].root
                } else {
                    chart.faces[edge.faces[0] as usize].root
                };
            }
        }
        offset += chart.verts.len() as u32;
    }
    let (indices, remap, forward) = remap_corners(indices, &corners, source.vertex_count);
    Ok(Charted {
        uvs: forward
            .iter()
            .map(|&f| {
                if f == NONE {
                    [0.0, 0.0]
                } else {
                    uvs[f as usize]
                }
            })
            .collect(),
        indices,
        remap,
        cut_adjacency,
        draw: source.draw.get(),
    })
}

/// The input corners `input` remapped against the output corners `output`: the new corners, each
/// new vertex's input vertex, and each new vertex's output vertex (`NONE` when unused).
fn remap_corners(
    input: &[u32],
    output: &[u32],
    vertex_count: usize,
) -> (Vec<u32>, Vec<u32>, Vec<u32>) {
    let size = input.len() + vertex_count;
    let mut forward = vec![NONE; size];
    let mut reverse = vec![NONE; size];
    let mut ring: Vec<u32> = (0..size as u32).collect();
    let mut corners = vec![0u32; input.len()];
    let mut count = vertex_count;
    for (i, (&a, &b)) in input.iter().zip(output).enumerate() {
        let a_at = a as usize;
        if reverse[a_at] == NONE {
            reverse[a_at] = a;
            forward[a_at] = b;
            corners[i] = a;
            continue;
        }
        if forward[a_at] == b {
            corners[i] = a;
            continue;
        }
        let mut v = ring[a_at];
        while v != a && forward[v as usize] != b {
            v = ring[v as usize];
        }
        if v != a {
            corners[i] = v;
            continue;
        }
        reverse[count] = a;
        forward[count] = b;
        ring[count] = ring[a_at];
        ring[a_at] = count as u32;
        corners[i] = count as u32;
        count += 1;
    }
    for (i, r) in reverse.iter_mut().enumerate().take(vertex_count) {
        if *r == NONE {
            *r = i as u32;
        }
    }
    reverse.truncate(count);
    forward.truncate(count);
    (corners, reverse, forward)
}
