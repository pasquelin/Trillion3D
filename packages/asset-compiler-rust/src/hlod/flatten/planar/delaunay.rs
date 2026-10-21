//! The constrained Delaunay triangulation of a polygon with holes, filled by the positive winding
//! rule: what fills the approximated shell's cut where the ground plane meets it.
//!
//! The polygon's vertices are laid out as one array — the outer loop's vertices in their order,
//! then each hole's in the holes' order — and each loop gives its closing edge first, then the
//! others: from its last vertex to its first, from its first to its second, and so on. The outer
//! loop's edges are boundary edges, the holes' are hole edges; the loops' orientations are taken
//! as given, none reversed.
//!
//! 1. The Delaunay triangulation of all the vertices (`insert`), duplicates of a position merged
//!    into the vertex kept; no triangulation (fewer than three distinct positions, or all on one
//!    line) fills nothing.
//! 2. The boundary edges recovered (`constrain`), then the hole edges.
//! 3. Each edge, its ends merged as the duplicates were, that the triangulation holds is recorded
//!    with its direction (`DirectedEdges`): a later edge between the same two vertices replaces an
//!    earlier one's direction.
//! 4. The triangles, in the mesh's order, with their neighbours (`mesh`). Every triangle with a
//!    hull edge that is not a hole edge — the first such edge in the order `(0, 2)`, `(1, 0)`,
//!    `(2, 1)` of its corners (`SIDES`) — is queued with the winding of that edge
//!    (`−winding_step`), and kept when its winding is positive, dropped otherwise.
//! 5. The queue is walked, each time taking the entry after the one taken last (cyclically, from
//!    the second) and filling its place with the queue's last: across each edge of its triangle in
//!    the same order that is not a hole edge, a neighbour not yet reached is queued with the
//!    triangle's winding plus the edge's, and kept when that is positive, dropped otherwise.
//! 6. The kept triangles in the mesh's order, each turned clockwise — corners `0`, `2`, `1` — no
//!    vertex added (bowties are left as they are).
mod constrain;
mod insert;
mod mesh;
mod order;

use constrain::recover_edges;
use insert::insert_points;
use mesh::EdgeMesh;
use std::collections::HashMap;

/// The triangles filling the polygon of `outer` with `holes` (module doc): each corner an index in
/// the outer loop's vertices followed by each hole's, in order. Empty when the vertices make no
/// triangulation.
pub(crate) fn fill_polygon(outer: &[[f64; 2]], holes: &[Vec<[f64; 2]>]) -> Vec<[usize; 3]> {
    let mut points = Vec::new();
    let mut outer_edges = Vec::new();
    let mut inner_edges = Vec::new();
    append_loop(&mut points, &mut outer_edges, outer);
    for hole in holes {
        append_loop(&mut points, &mut inner_edges, hole);
    }
    let mut mesh = EdgeMesh::new();
    if !insert_points(&mut mesh, &points) {
        return Vec::new();
    }
    recover_edges(&mut mesh, &points, &outer_edges);
    recover_edges(&mut mesh, &points, &inner_edges);
    let boundary = DirectedEdges::held(&mesh, &outer_edges);
    let walls = DirectedEdges::held(&mesh, &inner_edges);
    let (triangles, neighbours) = mesh.triangles_with_neighbours();
    let verdict = flood(&triangles, &neighbours, &boundary, &walls);
    triangles
        .iter()
        .zip(&verdict)
        .filter(|&(_, &state)| state > 0)
        .map(|(&[a, b, c], _)| [a as usize, c as usize, b as usize])
        .collect()
}

/// `polygon`'s vertices appended to `points`, its edges to `edges`: the closing one first, from
/// the last vertex to the first, then each vertex to the next.
fn append_loop(points: &mut Vec<[f64; 2]>, edges: &mut Vec<[i32; 2]>, polygon: &[[f64; 2]]) {
    let start = points.len() as i32;
    let end = start + polygon.len() as i32;
    points.extend_from_slice(polygon);
    let mut previous = end - 1;
    for vertex in start..end {
        edges.push([previous, vertex]);
        previous = vertex;
    }
}

/// Directed edges by their two vertices, least first: whether each runs from its greater vertex.
struct DirectedEdges(HashMap<[i32; 2], bool>);

impl DirectedEdges {
    /// The edges of `sides`, their ends merged as the duplicates were, that `mesh` holds.
    fn held(mesh: &EdgeMesh, sides: &[[i32; 2]]) -> Self {
        let mut held = HashMap::new();
        for &edge in sides {
            let [a, b] = mesh.resolve(edge);
            if mesh.holds_edge([a, b]) {
                held.insert([a.min(b), a.max(b)], a > b);
            }
        }
        Self(held)
    }

    /// Whether an edge joins `a` and `b`, in either direction.
    fn joins(&self, a: i32, b: i32) -> bool {
        self.0.contains_key(&[a.min(b), a.max(b)])
    }

    /// The change of winding across the directed edge from `a` to `b`: `1` along an edge, `-1`
    /// against it, `0` when no edge joins them.
    fn winding_step(&self, a: i32, b: i32) -> i32 {
        match self.0.get(&[a.min(b), a.max(b)]) {
            Some(&reversed) if reversed == (a > b) => 1,
            Some(_) => -1,
            None => 0,
        }
    }
}

/// The sides of a triangle walked across, in order, as (corner, the corner before it): the
/// triangle across their edge is the neighbour of the corner before (`mesh`).
const SIDES: [(usize, usize); 3] = [(0, 2), (1, 0), (2, 1)];

/// For each triangle, `1` when kept, `-1` when reached and dropped, `0` when never reached
/// (module doc, steps 4 and 5).
fn flood(
    triangles: &[[i32; 3]],
    neighbours: &[[i32; 3]],
    boundary: &DirectedEdges,
    walls: &DirectedEdges,
) -> Vec<i8> {
    let verdict_of = |winding: i32| -> i8 {
        if winding > 0 {
            1
        } else {
            -1
        }
    };
    let mut verdict = vec![0; triangles.len()];
    let mut queue = Vec::new();
    for (index, (triangle, around)) in triangles.iter().zip(neighbours).enumerate() {
        for (corner, next) in SIDES {
            if around[next] >= 0 {
                continue;
            }
            let (a, b) = (triangle[corner], triangle[next]);
            if walls.joins(a, b) {
                continue;
            }
            let winding = -boundary.winding_step(a, b);
            queue.push((index, winding));
            verdict[index] = verdict_of(winding);
            break;
        }
    }
    let mut pick = 0;
    while !queue.is_empty() {
        pick = (pick + 1) % queue.len();
        let (index, winding) = queue.swap_remove(pick);
        for (corner, next) in SIDES {
            let (a, b) = (triangles[index][corner], triangles[index][next]);
            if walls.joins(a, b) {
                continue;
            }
            let beyond = neighbours[index][next];
            if beyond >= 0 && verdict[beyond as usize] == 0 {
                let across = winding + boundary.winding_step(a, b);
                queue.push((beyond as usize, across));
                verdict[beyond as usize] = verdict_of(across);
            }
        }
    }
    verdict
}
