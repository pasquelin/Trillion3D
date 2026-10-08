use super::*;

const A: [f64; 3] = [0.0, 0.0, 0.0];
const B: [f64; 3] = [2.0, 0.0, 0.0];
const C: [f64; 3] = [0.0, 2.0, 0.0];

#[test]
fn triangle_cross_points_by_the_winding_twice_the_area_long() {
    assert_eq!(triangle_cross(A, B, C), [0.0, 0.0, 4.0]);
    assert_eq!(triangle_cross(A, C, B), [0.0, 0.0, -4.0]);
    let (a, b, c) = ([0.1, 0.7, -0.3], [1.9, 0.2, 0.45], [-0.6, 0.33, 1.1]);
    assert_eq!(triangle_cross(a, b, c), cross(sub(b, a), sub(c, a)));
}

#[test]
fn triangle_area_is_half_the_cross_length() {
    assert_eq!(triangle_area(A, B, C), 2.0);
    let (a, b, c) = ([0.1, 0.7, -0.3], [1.9, 0.2, 0.45], [-0.6, 0.33, 1.1]);
    let by_hand = length(cross(sub(b, a), sub(c, a))) / 2.0;
    assert_eq!(triangle_area(a, b, c).to_bits(), by_hand.to_bits());
    assert_eq!(
        triangle_area(a, b, c).to_bits(),
        (length(triangle_cross(a, b, c)) * 0.5).to_bits()
    );
}

#[test]
fn barycentric_weights_complete_to_one() {
    assert_eq!(barycentric_weights(0.25, 0.5), [0.25, 0.25, 0.5]);
    assert_eq!(barycentric_weights(0.0, 0.0), [1.0, 0.0, 0.0]);
    let (v, w) = (0.1, 0.7);
    assert_eq!(
        barycentric_weights(v, w)[0].to_bits(),
        (1.0 - v - w).to_bits()
    );
}

#[test]
fn closest_point_finds_the_corner_the_edge_or_the_face() {
    assert_eq!(closest_point([-1.0, -1.0, 3.0], A, B, C), A);
    assert_eq!(closest_point([5.0, -1.0, 0.0], A, B, C), B);
    assert_eq!(closest_point([-1.0, 5.0, 0.0], A, B, C), C);
    assert_eq!(closest_point([1.0, -3.0, 1.0], A, B, C), [1.0, 0.0, 0.0]);
    assert_eq!(closest_point([-3.0, 1.0, -1.0], A, B, C), [0.0, 1.0, 0.0]);
    assert_eq!(closest_point([2.0, 2.0, 0.0], A, B, C), [1.0, 1.0, 0.0]);
    assert_eq!(closest_point([0.5, 0.5, 7.0], A, B, C), [0.5, 0.5, 0.0]);
}

#[test]
fn closest_point_on_the_face_runs_its_written_order() {
    let (a, b, c) = ([0.1, 0.7, -0.3], [1.9, 0.2, 0.45], [-0.6, 1.33, 1.1]);
    // Off the face along its normal, above a point inside it.
    let normal = triangle_cross(a, b, c);
    let p = [0, 1, 2].map(|k| (a[k] + b[k] + c[k]) / 3.0 + normal[k] * 0.3);
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let (bp, cp) = (sub(p, b), sub(p, c));
    let (d1, d2, d3, d4, d5, d6) = (
        dot(ab, ap),
        dot(ac, ap),
        dot(ab, bp),
        dot(ac, bp),
        dot(ab, cp),
        dot(ac, cp),
    );
    let (vc, vb, va) = (d1 * d4 - d3 * d2, d5 * d2 - d1 * d6, d3 * d6 - d5 * d4);
    assert!(va > 0.0 && vb > 0.0 && vc > 0.0, "the face region");
    let denom = 1.0 / (va + vb + vc);
    let (v, w) = (vb * denom, vc * denom);
    let face = [0, 1, 2].map(|k| a[k] + ab[k] * v + ac[k] * w);
    assert_eq!(closest_point(p, a, b, c), face);
}

#[test]
fn ray_triangle_hits_either_face_within_its_range() {
    let corners = [A, B, C];
    let down = ray_triangle([0.5, 0.5, 3.0], [0.0, 0.0, -1.0], corners, (1e-4, 10.0));
    assert_eq!(down, Some((3.0, [0.25, 0.25])));
    let up = ray_triangle([0.5, 0.5, -3.0], [0.0, 0.0, 1.0], corners, (1e-4, 10.0));
    assert_eq!(up, Some((3.0, [0.25, 0.25])));
    // Beyond `far`, behind the origin, outside the triangle, parallel to it: a miss each.
    let short = ray_triangle([0.5, 0.5, 3.0], [0.0, 0.0, -1.0], corners, (1e-4, 3.0));
    assert_eq!(short, None);
    let behind = ray_triangle([0.5, 0.5, 3.0], [0.0, 0.0, 1.0], corners, (1e-4, 10.0));
    assert_eq!(behind, None);
    let outside = ray_triangle([1.5, 1.5, 3.0], [0.0, 0.0, -1.0], corners, (1e-4, 10.0));
    assert_eq!(outside, None);
    let parallel = ray_triangle([0.5, 0.5, 3.0], [1.0, 0.0, 0.0], corners, (1e-4, 10.0));
    assert_eq!(parallel, None);
}

#[test]
fn newell_is_twice_the_area_along_the_normal() {
    let square = [
        [0.0f64, 0.0, 0.0],
        [3.0, 0.0, 0.0],
        [3.0, 2.0, 0.0],
        [0.0, 2.0, 0.0],
    ];
    assert_eq!(newell(&square), [0.0, 0.0, 12.0]);
    let reversed: Vec<[f64; 3]> = square.iter().rev().copied().collect();
    assert_eq!(newell(&reversed), [0.0, 0.0, -12.0]);
    assert_eq!(newell::<f64>(&[]), [0.0; 3]);
}

#[test]
fn newell_step_in_single_precision_runs_the_written_out_sums() {
    let ring = [
        [0.1f32, 0.7, -0.3],
        [1.9, 0.2, 0.45],
        [-0.6, 1.33, 1.1],
        [0.2, 0.9, 0.8],
    ];
    let mut by_hand = [0.0f32; 3];
    for (corner, here) in ring.iter().enumerate() {
        let there = ring[(corner + 1) % ring.len()];
        by_hand[0] += (here[1] - there[1]) * (here[2] + there[2]);
        by_hand[1] += (here[2] - there[2]) * (here[0] + there[0]);
        by_hand[2] += (here[0] - there[0]) * (here[1] + there[1]);
    }
    let mut stepped = [0.0f32; 3];
    for (corner, &here) in ring.iter().enumerate() {
        newell_step(&mut stepped, here, ring[(corner + 1) % ring.len()]);
    }
    assert_eq!(stepped.map(f32::to_bits), by_hand.map(f32::to_bits));
    assert_eq!(newell(&ring).map(f32::to_bits), by_hand.map(f32::to_bits));
}
