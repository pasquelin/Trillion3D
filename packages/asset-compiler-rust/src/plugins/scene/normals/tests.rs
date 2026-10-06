//! An edge that more than two faces share has no fan to read. A helper that united from the
//! second encounter, before knowing a third face existed, would smooth the first two faces of
//! the file together, leave the third alone, and make the output depend on face order.
use super::*;

/// Five vertices: the shared edge, then one free vertex per face.
const POINTS: [f32; 15] = [0., 0., 0., 1., 0., 0., 0., 1., 0., 0., -1., 0., 0., 0., 1.];
/// Three triangles that all share edge `0–1`, each in its own plane.
const FAN: [[u32; 3]; 3] = [[0, 1, 2], [1, 0, 3], [0, 1, 4]];

/// Normal of each face of `FAN`, the one its three corners carry when nothing smoothes them.
const PLANES: [[f32; 3]; 3] = [[0., 0., 1.], [0., 0., 1.], [0., -1., 0.]];

/// Normals and groups of the corners, faces placed in this order, with these marks.
fn shade(order: &[usize], sharp_faces: &[bool], sharp_corners: &[bool]) -> Shaded {
    let mut corners_of: Vec<u32> = Vec::new();
    let mut offsets: Vec<u32> = vec![0];
    for face in order {
        corners_of.extend(FAN[*face]);
        offsets.push(corners_of.len() as u32);
    }
    corners(
        &Surface {
            positions: &POINTS,
            corners: &corners_of,
            offsets: &offsets,
            sharp_faces,
            sharp_corners,
        },
        &std::sync::atomic::AtomicBool::new(false),
    )
    .expect("normal computation")
}

/// Smoothing groups of the corners, faces placed in this order and all smooth.
fn groups(order: &[usize]) -> Vec<u32> {
    shade(order, &[], &[]).groups
}

/// No corner united, and each on the normal of its only face: the unreadable fan yielded as-is.
fn assert_aucun_lissage(shaded: &Shaded, order: &[usize], case: &str) {
    assert_eq!(
        shaded.groups,
        (0..9).collect::<Vec<u32>>(),
        "groups, {case}"
    );
    for (rank, face) in order.iter().enumerate() {
        for corner in 0..3 {
            let at = (rank * 3 + corner) * 3;
            assert_eq!(
                &shaded.normals[at..at + 3],
                &PLANES[*face][..],
                "normal of corner {corner} of face {face}, {case}"
            );
        }
    }
}

// Three faces on an edge, and no corner is united — whatever order the file writes
// them in. Guessing a fan where there is none would yield a corner at random.
#[test]
fn an_edge_with_three_faces_unites_no_corner_whatever_the_order() {
    let alone: Vec<u32> = (0..9).collect();
    for order in [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
    ] {
        assert_eq!(groups(&order), alone, "order {order:?}");
    }
}

// The other end, which the fix must not take away: an edge that two faces share does unite their
// corners of the same vertex, and that is the ordinary smoothing rule.
#[test]
fn an_edge_with_two_faces_always_unites_its_corners() {
    assert_eq!(groups(&[0, 1]), vec![0, 1, 2, 1, 0, 5]);
    // A border edge, that nobody shares, unites nothing either.
    assert_eq!(groups(&[0]), vec![0, 1, 2]);
}

// Finding V01, first variant: only one of the three faces carries the “sharp face” mark.
// Topology still counts three faces on the edge, and a smoothing mark removes none of them: it
// only decides unions. Before the fix, the count skipped the sharp face, saw only two and
// welded the other two — groups `[0,1,2,1,0,5,6,7,8]`, averaged normals.
#[test]
fn v01_a_sharp_face_does_not_weld_the_other_two_faces_of_the_edge() {
    let order = [0, 1, 2];
    for nette in 0..3 {
        let mut sharp_faces = [false; 3];
        sharp_faces[nette] = true;
        let shaded = shade(&order, &sharp_faces, &[]);
        assert_aucun_lissage(&shaded, &order, &format!("sharp face {nette}"));
    }
}

// Second variant of the same finding: the shared edge is hard on only one of the three faces.
// The corner that carries it is the first of each face of `FAN`. Same contract, same defect
// before the fix: two remaining incidences, two faces welded.
#[test]
fn v01_a_hard_edge_does_not_weld_the_other_two_faces_of_the_edge() {
    let order = [0, 1, 2];
    for dure in 0..3 {
        let mut sharp_corners = [false; 9];
        sharp_corners[dure * 3] = true;
        let shaded = shade(&order, &[], &sharp_corners);
        assert_aucun_lissage(&shaded, &order, &format!("hard edge on face {dure}"));
    }
}

#[test]
fn a_pre_cancelled_mesh_returns_no_normals() {
    let surface = Surface {
        positions: &POINTS,
        corners: &FAN[0],
        offsets: &[0, 3],
        sharp_faces: &[],
        sharp_corners: &[],
    };
    assert!(corners(&surface, &AtomicBool::new(true)).is_none());
}

#[test]
fn cancellation_inside_one_large_polygon_discards_every_partial_stage() {
    use std::sync::atomic::Ordering;
    // One polygon exceeds a cancellation slice: face-only checks would finish each stage.
    let count = 8192usize;
    let positions: Vec<f32> = (0..count)
        .flat_map(|rank| {
            let angle = rank as f32 * std::f32::consts::TAU / count as f32;
            [angle.cos(), angle.sin(), 0.0]
        })
        .collect();
    let ring: Vec<u32> = (0..count as u32).collect();
    let surface = Surface {
        positions: &positions,
        corners: &ring,
        offsets: &[0, count as u32],
        sharp_faces: &[],
        sharp_corners: &[],
    };
    // Newell, all edges, smooth edges, sums, then output. Raise the real token just before
    // its next slice read, without threads, sleeps, or any mutable production hook.
    for stage in 1..=5 {
        let cancelled = AtomicBool::new(false);
        let mut reached = 0;
        let mut stopped_at = None;
        let result = corners_with(&surface, &mut |done| {
            if done == 4095 {
                reached += 1;
                if reached == stage {
                    cancelled.store(true, Ordering::Relaxed);
                }
            }
            if cancel::stopped(&cancelled, done) {
                stopped_at = Some(done);
                return None;
            }
            Some(())
        });
        assert!(result.is_none(), "partial stage {stage} must not escape");
        assert_eq!(reached, stage);
        assert_eq!(stopped_at, Some(4096));
    }
}
