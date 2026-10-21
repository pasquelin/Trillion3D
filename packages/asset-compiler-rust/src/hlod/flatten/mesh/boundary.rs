//! A mesh's boundary walked into loops and open spans (`boundary_loops`), a walk started at each
//! standing boundary edge not walked yet, by ascending id, among those a filter keeps — an edge it
//! drops is marked walked —, each edge walked as its triangle winds it:
//!
//! - at a vertex of two boundary edges, both kept, the walk takes the other one; at one of fewer,
//!   or of two with one dropped, it has met an end;
//! - at a bowtie — a vertex of more than two boundary edges, however few of them the filter keeps
//!   — it closes when the vertex is where it started, else takes the unwalked kept edge leaving the
//!   vertex that turns left the most from the edge coming in, angles laid on the vertex's plane
//!   (`left_turn`), and is an open span when none leaves it;
//! - a walk that meets an end goes back from its start the other way, and one that meets an end
//!   again, or an edge walked before, is an open span: its edges, end to end, give its vertices
//!   (`span_vertices`);
//! - a closed walk that passed a bowtie is split into simple loops (`subloops.rs`); one that cannot
//!   be split gives its vertices as one span, no loop.
use super::subloops::split;
use super::{Mesh, NONE};
use trillion3d_math::geometry::triangle::triangle_cross;
use trillion3d_math::vector::vec3::{cross, unit_or_itself, unit_where};
use trillion3d_math::vector::vecn::{add, dot, scale, squared_length, sub};

/// The squared length under which two directions are parallel.
const PARALLEL: f64 = 1e-8;

/// What a walk does next at an edge's far end.
enum Next {
    Close,
    Edge(usize),
}

/// A boundary walked: each loop's vertices in walking order and each open span's from end to end,
/// both in the order found.
pub(crate) struct Boundaries {
    pub(crate) loops: Vec<Vec<usize>>,
    pub(crate) spans: Vec<Vec<usize>>,
}

/// `mesh`'s boundary walked among the edges `keep` accepts, the vertices at `point` (module doc).
pub(crate) fn boundary_loops(
    mesh: &Mesh,
    keep: impl Fn(usize) -> bool,
    point: impl Fn(usize) -> [f64; 3],
) -> Boundaries {
    let mut found = Boundaries {
        loops: Vec::new(),
        spans: Vec::new(),
    };
    let mut walked = vec![false; mesh.edges.len()];
    for start in 0..mesh.edges.len() {
        if !mesh.is_edge(start) || walked[start] || !mesh.is_boundary(start) {
            continue;
        }
        walked[start] = true;
        if !keep(start) {
            continue;
        }
        let mut path = vec![start];
        let (mut vertices, mut bowties) = (Vec::new(), Vec::new());
        let (mut current, mut closed, mut open) = (start, false, false);
        while !closed {
            let [mut from, mut to] = mesh.oriented(current);
            if open {
                std::mem::swap(&mut from, &mut to);
            } else {
                vertices.push(from);
            }
            let out: Vec<usize> = mesh.edges_at(to).filter(|&e| mesh.is_boundary(e)).collect();
            if out.len() <= 2 && out.iter().filter(|&&e| keep(e)).count() < 2 {
                if open {
                    closed = true;
                } else {
                    open = true;
                    current = path[0];
                    path.reverse();
                }
                continue;
            }
            let next = if out.len() > 2 {
                let next = if to == vertices[0] {
                    Next::Close
                } else {
                    let kept: Vec<usize> = out.into_iter().filter(|&e| keep(e)).collect();
                    match left_turn(mesh, &point, (current, to), &kept, &walked) {
                        Some(e) => Next::Edge(e),
                        None => {
                            (open, closed) = (true, true);
                            continue;
                        }
                    }
                };
                if !bowties.contains(&to) {
                    bowties.push(to);
                }
                next
            } else {
                Next::Edge(if out[0] == current { out[1] } else { out[0] })
            };
            match next {
                Next::Close => closed = true,
                Next::Edge(e) if e == start => closed = true,
                Next::Edge(e) if walked[e] => (open, closed) = (true, true),
                Next::Edge(e) => {
                    path.push(e);
                    walked[e] = true;
                    current = e;
                }
            }
        }
        if open {
            path.reverse();
            found.spans.push(span_vertices(mesh, &path));
        } else if bowties.is_empty() {
            found.loops.push(vertices);
        } else {
            match split(vertices, &bowties) {
                Ok(loops) => found.loops.extend(loops),
                Err(rest) => found.spans.push(rest),
            }
        }
    }
    found
}

/// The unwalked edge of `out` leaving bowtie `at` that turns left the most from edge `incoming`,
/// the angles laid on the plane of the bowtie's normal — its triangles' unit normals, as a `z`-up
/// mesh winds them, `(c − a) × (b − a)`, summed in the order `Mesh::triangles_at` visits them and
/// made unit, a vector of no length left zero —, the first of equals; the first edge leaving it is
/// taken whatever its angle, so a turn of no number is never replaced.
fn left_turn(
    mesh: &Mesh,
    point: &impl Fn(usize) -> [f64; 3],
    (incoming, at): (usize, usize),
    out: &[usize],
    walked: &[bool],
) -> Option<usize> {
    let unit = |v: [f64; 3]| unit_where(v, |length| length > 0.0).unwrap_or([0.0; 3]);
    let sum = (mesh.triangles_at(at))
        .map(|t| {
            let [a, b, c] = mesh.triangles[t].map(point);
            unit(triangle_cross(a, c, b))
        })
        .fold([0.0; 3], add);
    let normal = unit(sum);
    let back = sub(point(at), point(mesh.other(incoming, at)));
    let mut best = (NONE, f64::MAX);
    for &e in out {
        let [from, to] = mesh.oriented(e);
        if walked[e] || from != at {
            continue;
        }
        let angle = -plane_angle(back, sub(point(to), point(at)), normal);
        if best.1 == f64::MAX || angle < best.1 {
            best = (e, angle);
        }
    }
    (best.0 != NONE).then_some(best.0)
}

/// The signed angle, degrees, from `from` to `to` laid on the plane of unit `normal`: positive
/// turning about the normal, `0` or `180` where they lie parallel.
pub(crate) fn plane_angle(from: [f64; 3], to: [f64; 3], normal: [f64; 3]) -> f64 {
    let laid = |v: [f64; 3]| unit_or_itself(sub(v, scale(normal, dot(v, normal))));
    let (from, to) = (laid(from), laid(to));
    let across = cross(from, to);
    if squared_length(across) < PARALLEL {
        return if dot(from, to) < 0.0 { 180.0 } else { 0.0 };
    }
    let sign = if dot(across, normal) < 0.0 { -1.0 } else { 1.0 };
    sign * dot(from, to).clamp(-1.0, 1.0).acos().to_degrees()
}

/// An open span's vertices from its edges end to end: each pair of consecutive edges gives the
/// end they share — the first edge's lower end when it is shared, else its higher —, the span's
/// two ends the first and last edges' other ends; a span of one edge its two ends, lower first.
fn span_vertices(mesh: &Mesh, edges: &[usize]) -> Vec<usize> {
    let ends = |e: usize| mesh.edges[e].ends;
    let first = ends(edges[0]);
    if edges.len() == 1 {
        return first.to_vec();
    }
    let shared = |[a0, a1]: [usize; 2], [b0, b1]: [usize; 2]| {
        if a0 == b0 || a0 == b1 {
            a0
        } else if a1 == b0 || a1 == b1 {
            a1
        } else {
            NONE
        }
    };
    let other = |[a, b]: [usize; 2], v: usize| {
        if a == v {
            b
        } else if b == v {
            a
        } else {
            NONE
        }
    };
    let mut vertices = vec![NONE; edges.len() + 1];
    let mut previous = first;
    for (i, &e) in edges.iter().enumerate().skip(1) {
        vertices[i] = shared(previous, ends(e));
        previous = ends(e);
    }
    let last = vertices.len() - 1;
    vertices[0] = other(first, vertices[1]);
    vertices[last] = other(previous, vertices[last - 1]);
    vertices
}
