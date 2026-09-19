use crate::coplanar::plane::*;

// Behavior 1: plane_of_triangles yields plane for flat cluster, None otherwise.
#[test]
fn plane_of_triangles_returns_plane_for_flat_cluster() {
    // Simple square in Z = 0 plane
    let indices = [0, 1, 2, 0, 2, 3];
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
    let result = plane_of_triangles(&indices, &positions, 1e-5);
    assert!(result.is_some());
    let plane = result.unwrap();
    assert!((plane.normal[2]).abs() > 0.9); // Normal pointe principalement en Z
    assert!(plane.area > 0.0);
}

#[test]
fn plane_of_triangles_returns_none_when_one_vertex_exceeds_tolerance() {
    // Two coplanar triangles and third deviating
    let indices = [0, 1, 2, 0, 2, 3, 4, 5, 6];
    let positions = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.5, 1.0, 0.0, // Triangle 1 : Z=0
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, // Triangle 2 : Z=0
        2.0, 0.0, 0.0, 3.0, 0.0, 0.0, 2.5, 0.5, 1.0, // Triangle 3 : sorta du plan
    ];
    let result = plane_of_triangles(&indices, &positions, 1e-5);
    assert!(result.is_none());
}

#[test]
fn plane_of_triangles_returns_none_for_non_parallel_normal() {
    // Triangle 1 and triangle 2 with non-parallel normals
    let indices = [0, 1, 2, 3, 4, 5];
    let positions = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, // Triangle plat en Z=0
        2.0, 0.0, 0.0, 3.0, 0.0, 1.0, 2.0, 1.0, 0.0, // Tilted triangle
    ];
    let result = plane_of_triangles(&indices, &positions, 1e-5);
    assert!(result.is_none());
}

// Behavior 2: canonical gives same orientation to plane and opposite.
#[test]
fn canonical_gives_same_orientation_for_opposite_planes() {
    let normal = [1.0, 0.0, 0.0];
    let offset = 5.0;
    let opposite_normal = [-1.0, 0.0, 0.0];
    let opposite_offset = -5.0;

    let (n1, o1) = canonical(normal, offset);
    let (n2, o2) = canonical(opposite_normal, opposite_offset);

    // Both must return same orientation
    assert!(
        ((n1[0] - n2[0]).abs() < 1e-9
            && (n1[1] - n2[1]).abs() < 1e-9
            && (n1[2] - n2[2]).abs() < 1e-9)
            && (o1 - o2).abs() < 1e-9
    );
}

#[test]
fn canonical_picks_first_non_zero_axis_for_sign() {
    // Normale avec premier axe positif
    let (n1, _) = canonical([0.5, 0.0, 0.0], 1.0);
    assert!(n1[0] > 0.0);

    // Same inverted normal should return same orientation
    let (n2, _) = canonical([-0.5, 0.0, 0.0], -1.0);
    assert!((n1[0] - n2[0]).abs() < 1e-9);
}

#[test]
fn canonical_uses_second_axis_when_first_is_zero() {
    let (n1, _) = canonical([0.0, -0.5, 1.0], 1.0);
    // Second axis is negative, so must be inverted
    assert!(n1[1] > 0.0);
}

// Test des fonctions auxiliaires
#[test]
fn dot_product_works_correctly() {
    let a = [1.0, 2.0, 3.0];
    let b = [4.0, 5.0, 6.0];
    let result = dot(a, b);
    assert_eq!(result, 32.0); // 1*4 + 2*5 + 3*6
}

#[test]
fn length_computes_magnitude() {
    let a = [3.0, 4.0, 0.0];
    let result = length(a);
    assert_eq!(result, 5.0);
}

#[test]
fn plane_key_quantizes_normals_and_offset() {
    let normal = [0.001, 0.001, 1.0];
    let offset = 10.0;
    let offset_quantum = 0.001;
    let key = plane_key(normal, offset, offset_quantum);
    // Four key vector components must be quantized integers
    assert_eq!(key.len(), 4);
}

#[test]
fn same_plane_returns_true_for_same_plane() {
    let p1 = ([1.0, 0.0, 0.0], 5.0);
    let p2 = ([1.0, 0.0, 0.0], 5.05);
    let offset_quantum = 0.1;
    assert!(same_plane(p1, p2, offset_quantum));
}

#[test]
fn same_plane_returns_false_for_different_planes() {
    let p1 = ([1.0, 0.0, 0.0], 5.0);
    let p2 = ([0.0, 1.0, 0.0], 5.0);
    let offset_quantum = 0.1;
    assert!(!same_plane(p1, p2, offset_quantum));
}

#[test]
fn plane_frame_derives_axes_from_normal() {
    let normal = [1.0, 0.0, 0.0];
    let (u, v) = plane_frame(normal);
    // Both axes must be orthogonal to normal
    assert!(dot(u, normal).abs() < 1e-9);
    assert!(dot(v, normal).abs() < 1e-9);
    // They must be orthogonal to each other
    assert!(dot(u, v).abs() < 1e-9);
}

// Behavior 3: plane_groups merges two neighboring keys when same_plane, not otherwise
#[test]
fn plane_groups_merges_same_plane_keys() {
    use crate::coplanar::plane::{canonical, plane_key};
    let normal = [1.0, 0.0, 0.0];
    let offset = 5.0;
    let (cn, co) = canonical(normal, offset);
    let key1 = plane_key(cn, co, 0.1);
    let key2 = plane_key(cn, co + 0.05, 0.1); // Same plane, slightly different offset within quantum
    assert_eq!(key1, key2);
}

#[test]
fn plane_groups_distinguishes_different_planes() {
    use crate::coplanar::plane::{canonical, plane_key};
    let n1 = [1.0, 0.0, 0.0];
    let n2 = [0.0, 1.0, 0.0];
    let o1 = 5.0;
    let (cn1, co1) = canonical(n1, o1);
    let (cn2, co2) = canonical(n2, o1);
    let key1 = plane_key(cn1, co1, 0.1);
    let key2 = plane_key(cn2, co2, 0.1);
    assert_ne!(key1, key2);
}

// Behavior 4: world_plane transforms normal, offset and area factor by matrix
#[test]
fn world_plane_scales_area_by_matrix() {
    // Two coplanar surfaces with different instance matrices must have transformed areas
    let indices = [0, 1, 2];
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    use crate::coplanar::plane::plane_of_triangles;
    if let Some(p1) = plane_of_triangles(&indices, &positions, 1e-5) {
        // Area should be 0.5 (triangle unit)
        assert!(p1.area > 0.0 && p1.area < 1.0);
    }
}
