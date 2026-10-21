//! The constraint edges recovered in the triangulation, one at a time in their given order (the
//! shuffle meant to randomize that order never runs — its loop starts from an end left unset —,
//! kept as it is).
//!
//! For each edge from `a` to `b`, its ends first replaced by the vertices their duplicates were
//! merged into:
//!
//! 1. Nothing to do when the edge is in the mesh. Otherwise the triangles around `a` are turned
//!    through, from the one the vertex ring gives, until one's far edge crosses the segment — its
//!    first end strictly right of the line from `a` to `b`, its second strictly left
//!    (`first_crossing`); a full turn without one leaves the edge out.
//! 2. The triangles the segment crosses are removed while walking along it (`dig`): from each
//!    crossed edge into the triangle beyond, the apex joins the chain on its side — right or left
//!    of the line — and the walk goes on through the edge on the far side; it ends at `b`, or
//!    early at an apex exactly on the line, the edge then joining `a` to that apex instead.
//! 3. Both chains run from `a` to the end reached; the left one, reversed, is triangulated back
//!    first, then the right one, each on its side of the new edge (`fill_chain`): a span of the
//!    chain takes the vertex after its start, replaced in turn by each later vertex of the span
//!    lying strictly inside the circle through the span's ends and the vertex taken so far; the
//!    triangle of the ends and that vertex is added, and the spans on its two sides (when they
//!    hold a vertex between their ends) are filled the same way, the one pushed last first.
use super::mesh::{EdgeMesh, ABSENT, GHOST};
use crate::hlod::flatten::planar::predicates::{in_circle, orient};

/// `constraints` recovered in `mesh` (module doc), the vertex ring started and kept.
pub(super) fn recover_edges(mesh: &mut EdgeMesh, points: &[[f64; 2]], constraints: &[[i32; 2]]) {
    mesh.start_ring(points.len());
    for &edge in constraints {
        let edge = mesh.resolve(edge);
        let (end, mut left, right) = dig(mesh, points, edge);
        if end != edge[0] {
            left.reverse();
            fill_chain(mesh, points, &left);
            fill_chain(mesh, points, &right);
        }
    }
}

/// The position of `vertex`.
fn at(points: &[[f64; 2]], vertex: i32) -> [f64; 2] {
    points[vertex as usize]
}

/// The sign of `value`: `1` above zero, `-1` below, `0` for zero and NaN.
fn sign(value: f64) -> i32 {
    if value > 0.0 {
        1
    } else if value < 0.0 {
        -1
    } else {
        0
    }
}

/// The far edge of the first triangle around `edge[0]` that the segment of `edge` crosses
/// (module doc, step 1), `None` when the edge is in the mesh, its start is not, or none crosses.
fn first_crossing(mesh: &mut EdgeMesh, points: &[[f64; 2]], edge: [i32; 2]) -> Option<[i32; 2]> {
    if mesh.holds_edge(edge) {
        return None;
    }
    let start = mesh.edge_around(edge[0]);
    if start[0] == ABSENT {
        return None;
    }
    let (from, to) = (at(points, edge[0]), at(points, edge[1]));
    // The turn of the far edge's second end is kept for the next edge's first; a ghost end keeps
    // the turn before it, read only on solid edges, whose first end is the last solid one seen.
    let mut second_turn = 0.0;
    let crosses = |far: [i32; 2], first_turn: f64, second_turn: &mut f64| {
        if far[1] >= 0 {
            *second_turn = orient(from, to, at(points, far[1]));
        }
        far[0] != GHOST && far[1] != GHOST && sign(first_turn) < 0 && sign(*second_turn) == 1
    };
    let mut far = start;
    let mut first_turn = if far[0] != GHOST {
        orient(from, to, at(points, far[0]))
    } else {
        0.0
    };
    while !crosses(far, first_turn, &mut second_turn) {
        let next = mesh.apex([edge[0], far[1]]);
        if next == ABSENT {
            // Only a broken triangulation leaves a hole around the vertex: the edge is left out
            // rather than turned through forever.
            return None;
        }
        far = [far[1], next];
        if far == start {
            return None;
        }
        first_turn = second_turn;
    }
    Some(far)
}

/// The triangles along the segment of `edge` removed (module doc, step 2): the vertex the walk
/// ended at — `edge[0]` when nothing was dug —, and the left and right chains from `edge[0]` to it.
fn dig(mesh: &mut EdgeMesh, points: &[[f64; 2]], edge: [i32; 2]) -> (i32, Vec<i32>, Vec<i32>) {
    let [a, b] = edge;
    let Some(first) = first_crossing(mesh, points, edge) else {
        return (a, Vec::new(), Vec::new());
    };
    mesh.remove_triangle([a, first[0], first[1]]);
    let mut right = vec![a, first[0]];
    let mut left = vec![a, first[1]];
    let (from, to) = (at(points, a), at(points, b));
    // Crossed from left to right.
    let mut crossed = [first[1], first[0]];
    loop {
        let apex = mesh.apex(crossed);
        if apex == ABSENT {
            // Walked off the mesh: only a broken triangulation gets here; nothing is refilled.
            return (a, left, right);
        }
        mesh.remove_triangle([crossed[0], crossed[1], apex]);
        if apex == b {
            right.push(b);
            left.push(b);
            return (b, left, right);
        }
        let turn = orient(from, to, at(points, apex));
        if turn == 0.0 {
            right.push(apex);
            left.push(apex);
            return (apex, left, right);
        } else if turn < 0.0 {
            crossed = [crossed[0], apex];
            right.push(apex);
        } else {
            crossed = [apex, crossed[1]];
            left.push(apex);
        }
    }
}

/// The polygon of `chain` — its vertices in order, closed by the new edge from its last vertex
/// back to its first — triangulated into `mesh` (module doc, step 3).
fn fill_chain(mesh: &mut EdgeMesh, points: &[[f64; 2]], chain: &[i32]) {
    let mut spans = vec![(0, chain.len() - 1)];
    while let Some((low, high)) = spans.pop() {
        let mut apex = low + 1;
        if low + 2 == high {
            mesh.place_triangle([chain[low], chain[apex], chain[high]]);
            continue;
        }
        for candidate in apex + 1..high {
            let (first, last) = (at(points, chain[low]), at(points, chain[high]));
            if 0.0
                < in_circle(
                    first,
                    at(points, chain[apex]),
                    last,
                    at(points, chain[candidate]),
                )
            {
                apex = candidate;
            }
        }
        mesh.place_triangle([chain[low], chain[apex], chain[high]]);
        if apex - low > 1 {
            spans.push((low, apex));
        }
        if high - apex > 1 {
            spans.push((apex, high));
        }
    }
}
