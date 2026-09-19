//! A `mesh` node into a glTF mesh: the written tables, faces resolved by the edges, and one
//! primitive per bound material.
//!
//! Polygons are triangulated by ears in the plane of their normal, which keeps the area and
//! silhouette of a concave face as of a convex one. A face that declares a hole is left: the
//! cut would fill it, and a silhouette is not guessed. Where normals come from, `.n` or the
//! edges, is what `shade` says.
use super::*;

mod corner;
mod part;
mod shade;

/// Tables of a surface, read once for all its parts.
pub(super) struct Surface {
    positions: Vec<[f64; 3]>,
    /// Vertex loops of each face, already resolved from the edges.
    loops: Vec<Vec<u32>>,
    /// UV ranks of each corner, in loop order; empty when the face carries none.
    uv_slots: Vec<Vec<i64>>,
    uvs: Vec<[f64; 2]>,
    normals: Vec<[f64; 3]>,
    /// Smoothing group of each corner, when this driver computed the normals: two corners of the
    /// same group carry the same normal, so they are one vertex. Empty when `.n` gives them.
    groups: Vec<u32>,
    /// Rank of the first corner of each face in the whole mesh, as `.fc` wrote it.
    bases: Vec<usize>,
    /// Where to read a corner's normal: per vertex, or per mesh corner.
    shading: Shading,
}

/// Provenance of this surface's normals.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shading {
    Vertex,
    Corner,
}

/// Builds this node's mesh, or finds it again when a `parent -add` already asked for it.
pub(super) fn build(world: &mut World<'_>, node: usize) -> Option<usize> {
    if let Some(known) = world.meshes.get(&node) {
        return *known;
    }
    let built = read(world, node).and_then(|surface| part::emit(world, node, &surface));
    world.meshes.insert(node, built);
    built
}

/// Reads the node's tables and resolves its faces. Nothing is built while they contradict each
/// other.
fn read(world: &mut World<'_>, node: usize) -> Option<Surface> {
    let document = world.document;
    let mesh = &document.nodes[node];
    let Some(written) = mesh.attr(&["vt", "vrts"]) else {
        world.refuse(report::MESH_INVALID);
        return None;
    };
    let positions: Vec<[f64; 3]> = value::elements(written.numbers()).collect();
    let edges: Vec<[f64; 3]> =
        value::elements(mesh.attr(&["ed", "edge"]).map_or(&[][..], Attr::numbers)).collect();
    let polygons = mesh.attr(&["fc", "face"]).map_or(&[][..], Attr::faces);
    let uvs = value::elements(
        mesh.attr(&["uvst[0].uvsp", "uvSet[0].uvSetPoints"])
            .map_or(&[][..], Attr::numbers),
    )
    .collect();
    let bases: Vec<usize> = polygons
        .iter()
        .scan(0usize, |at, face| {
            let base = *at;
            *at = at.saturating_add(face.edges.len());
            Some(base)
        })
        .collect();
    let corners: usize = polygons.iter().map(|face| face.edges.len()).sum();
    if positions.is_empty() || polygons.is_empty() || corners > MAX_ELEMENTS {
        world.refuse(report::MESH_INVALID);
        return None;
    }
    let (loops, uv_slots) = resolve(world, polygons, &edges, positions.len());
    let mut surface = Surface {
        positions,
        loops,
        uv_slots,
        uvs,
        normals: Vec::new(),
        groups: Vec::new(),
        bases,
        shading: Shading::Corner,
    };
    shade::fill(world, &mut surface, mesh, polygons, &edges);
    Some(surface)
}

/// Vertex loop of each face, and the UV ranks of its corners. A face whose edge leaves the
/// table, or whose vertex leaves the position table, yields no loop: it is counted and left,
/// rather than yielding a triangle picked at random.
fn resolve(
    world: &mut World<'_>,
    polygons: &[faces::Face],
    edges: &[[f64; 3]],
    vertices: usize,
) -> (Vec<Vec<u32>>, Vec<Vec<i64>>) {
    let mut loops = Vec::with_capacity(polygons.len());
    let mut slots = Vec::with_capacity(polygons.len());
    for face in polygons {
        let ring: Option<Vec<u32>> = face
            .edges
            .iter()
            .map(|edge| corner(edges, *edge, vertices))
            .collect();
        match (ring, face.hole) {
            (_, true) => {
                world.refuse(report::FACE_HOLE);
                loops.push(Vec::new());
            }
            (None, _) => {
                world.refuse(report::MESH_INVALID);
                loops.push(Vec::new());
            }
            (Some(ring), _) if ring.len() < 3 => {
                world.refuse(report::DEGENERATE_FACE);
                loops.push(Vec::new());
            }
            (Some(ring), _) => loops.push(ring),
        }
        let carried = face.uv_set == 0 && face.uvs.len() == face.edges.len();
        if !carried && !face.uvs.is_empty() {
            world.refuse(report::UV_DROPPED);
        }
        slots.push(if carried {
            face.uvs.clone()
        } else {
            Vec::new()
        });
    }
    (loops, slots)
}

/// Rank of a Maya signed edge and the end it names: `-(i + 1)` walks edge `i` backwards, and its
/// corner is then the second vertex of the edge. The lowest value of a signed integer has no
/// opposite: it names no edge, instead of overflowing the negation, and the caller counts the
/// face under `ma-mesh-invalid`.
pub(super) fn edge_rank(signed: i64) -> Option<(usize, usize)> {
    match signed < 0 {
        true => Some((
            usize::try_from(signed.checked_neg()?.checked_sub(1)?).ok()?,
            1,
        )),
        false => Some((usize::try_from(signed).ok()?, 0)),
    }
}

/// Start vertex of a signed edge. Maya writes `-(i + 1)` for an edge walked backwards: the
/// corner is then the second vertex of edge `i`. The lowest value of a signed integer has no
/// opposite: it therefore yields no rank, and the caller counts it under `ma-mesh-invalid`,
/// instead of overflowing the negation.
pub(super) fn corner(edges: &[[f64; 3]], signed: i64, vertices: usize) -> Option<u32> {
    let (rank, end) = edge_rank(signed)?;
    let vertex = usize::try_from(*edges.get(rank)?.get(end)? as i64).ok()?;
    (vertex < vertices)
        .then(|| u32::try_from(vertex).ok())
        .flatten()
}
