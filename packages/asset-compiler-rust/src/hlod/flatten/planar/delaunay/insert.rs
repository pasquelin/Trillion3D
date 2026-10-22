//! The Delaunay triangulation of the points, one point at a time.
//!
//! 1. The points are ordered (`order::insertion_order`). The first triangle takes the last point
//!    of that order, the last one before it at another position, and the last one before that
//!    off their line (`orient` not zero), turned counter-clockwise; the three leave the order,
//!    and ghost triangles close its hull. Fewer than three points, all at one position or all on
//!    one line: no triangulation.
//! 2. Each point left, in order, is located by walking from the triangle last made (`locate`): a
//!    triangle is left across its first edge, in corner order, that has the point strictly on its
//!    right — on a ghost triangle, only its solid edge counts, and a point on that edge's line
//!    also crosses it. A point at the position of a corner of the triangle it stops in is a
//!    duplicate, marked for that corner and left out; past a hundred steps per triangle the walk
//!    gives up and the point is left out.
//! 3. A point located is inserted as Bowyer and Watson do (`fan_in`): the triangle it lies in is
//!    removed, then each triangle across an edge of the removed ones, latest first, removed too
//!    when the point lies in its circle — for a ghost triangle, strictly left of its solid edge
//!    or on that edge itself (`in_circumcircle`) — and the edges of the triangles kept bound a
//!    cavity the point is fanned to, edge by edge in the order they were met.
use super::constrain::at;
use super::mesh::{EdgeMesh, ABSENT, GHOST};
use super::order::insertion_order;
use crate::hlod::flatten::planar::predicates::{in_circle, orient};

/// The corner after each corner of a triangle.
const NEXT: [usize; 3] = [1, 2, 0];

/// `points` triangulated into `mesh` (module doc), `false` when they make no triangle.
pub(super) fn insert_points(mesh: &mut EdgeMesh, points: &[[f64; 2]]) -> bool {
    if points.len() < 3 {
        return false;
    }
    let mut sequence = insertion_order(points);
    let position = |rank: usize| points[sequence[rank] as usize];
    let last = sequence.len() - 1;
    let Some(second) = (0..last)
        .rev()
        .find(|&rank| position(rank) != position(last))
    else {
        return false;
    };
    let Some((third, turn)) = (0..second).rev().find_map(|rank| {
        let turn = orient(position(last), position(second), position(rank));
        (turn != 0.0).then_some((rank, turn))
    }) else {
        return false;
    };
    let mut first = [sequence[last], sequence[second], sequence[third]];
    if turn < 0.0 {
        first.swap(1, 2);
    }
    mesh.start_with_ghosts(first);
    sequence.remove(last);
    sequence.remove(second);
    sequence.remove(third);
    let mut start = first;
    for &vertex in &sequence {
        let (found, duplicate_of) = locate(mesh, points, start, vertex);
        if duplicate_of >= 0 {
            mesh.mark_duplicate(duplicate_of, vertex);
            continue;
        }
        if found[0] == ABSENT {
            continue;
        }
        start = fan_in(mesh, points, found, vertex);
    }
    true
}

/// The edge of `triangle` the walk to `vertex` leaves it by, `None` when `vertex` lies in it; the
/// first edge skipped when `skip_first` (the one just crossed).
fn crossed_edge(
    points: &[[f64; 2]],
    triangle: [i32; 3],
    vertex: i32,
    skip_first: bool,
) -> Option<usize> {
    let ghost = triangle.contains(&GHOST);
    (usize::from(skip_first)..3).find(|&corner| {
        let (a, b) = (triangle[corner], triangle[NEXT[corner]]);
        if ghost && (a == GHOST || b == GHOST) {
            return false;
        }
        let turn = orient(at(points, a), at(points, b), at(points, vertex));
        turn < 0.0 || (ghost && turn == 0.0)
    })
}

/// The triangle `vertex` lies in, walked to from `start` (module doc), and the corner it is a
/// duplicate of (`ABSENT` when none); the triangle `[ABSENT; 3]` when the walk gives up.
fn locate(mesh: &EdgeMesh, points: &[[f64; 2]], start: [i32; 3], vertex: i32) -> ([i32; 3], i32) {
    let mut triangle = start;
    let mut cross = crossed_edge(points, triangle, vertex, false);
    let mut steps = 0;
    while let Some(corner) = cross {
        if steps >= mesh.triangle_count() * 100 {
            return ([ABSENT; 3], ABSENT);
        }
        steps += 1;
        let edge = [triangle[NEXT[corner]], triangle[corner]];
        triangle = [edge[0], edge[1], mesh.apex(edge)];
        cross = crossed_edge(points, triangle, vertex, true);
    }
    let duplicate_of = triangle
        .into_iter()
        .find(|&corner| corner >= 0 && at(points, vertex) == at(points, corner))
        .unwrap_or(ABSENT);
    (triangle, duplicate_of)
}

/// Whether `vertex` lies strictly in the circle of solid `triangle`, or for a ghost triangle
/// strictly left of its solid edge or on that edge between its ends (by `x`, or by `y` when the
/// edge is vertical).
fn in_circumcircle(points: &[[f64; 2]], triangle: [i32; 3], vertex: i32) -> bool {
    let [a, b, c] = triangle;
    let point = at(points, vertex);
    if !triangle.contains(&GHOST) {
        return in_circle(at(points, a), at(points, b), at(points, c), point) > 0.0;
    }
    let [from, to] = match triangle.iter().position(|&corner| corner == GHOST) {
        Some(1) => [c, a],
        Some(2) => [a, b],
        _ => [b, c],
    }
    .map(|corner| at(points, corner));
    let turn = orient(from, to, point);
    if turn > 0.0 {
        return true;
    }
    if turn < 0.0 {
        return false;
    }
    let axis = if from[0] != to[0] { 0 } else { 1 };
    let (low, high) = if from[axis] > to[axis] {
        (to[axis], from[axis])
    } else {
        (from[axis], to[axis])
    };
    point[axis] >= low && point[axis] <= high
}

/// `triangle` removed from `mesh`, and each of its edges' reverses still in the mesh — `ba`, `cb`,
/// `ac` — queued in `pending`.
fn remove_and_queue(mesh: &mut EdgeMesh, [a, b, c]: [i32; 3], pending: &mut Vec<[i32; 2]>) {
    mesh.remove_triangle([a, b, c]);
    for edge in [[b, a], [c, b], [a, c]] {
        if mesh.holds_edge(edge) {
            pending.push(edge);
        }
    }
}

/// `vertex` inserted in `mesh` from `triangle`, the one it lies in (module doc); the first
/// triangle of its fan returned, `[-1; 3]` when the fan is empty.
fn fan_in(mesh: &mut EdgeMesh, points: &[[f64; 2]], triangle: [i32; 3], vertex: i32) -> [i32; 3] {
    let mut pending = Vec::new();
    remove_and_queue(mesh, triangle, &mut pending);
    let mut rim = Vec::new();
    while let Some(edge) = pending.pop() {
        let apex = mesh.apex(edge);
        if apex == ABSENT {
            continue;
        }
        let beyond = [edge[0], edge[1], apex];
        if in_circumcircle(points, beyond, vertex) {
            remove_and_queue(mesh, beyond, &mut pending);
        } else {
            rim.push(edge);
        }
    }
    for &[a, b] in &rim {
        mesh.place_triangle([b, a, vertex]);
    }
    rim.first().map_or([-1; 3], |&[a, b]| [b, a, vertex])
}
