use super::*;
use crate::dag::tests::{build, grid};
use trillion3d_page_codec::FLAG_COLOR;

/// A matrix of column-major sixteen: `scale` on every axis, `at` for its translation.
fn placed(scale: f64, at: [f64; 3]) -> Mat4 {
    #[rustfmt::skip]
    let matrix = [
        scale, 0.0, 0.0, 0.0,
        0.0, scale, 0.0, 0.0,
        0.0, 0.0, scale, 0.0,
        at[0], at[1], at[2], 1.0,
    ];
    matrix
}

/// The roots of a grid's DAG and the grid's own arrays.
fn part() -> (RootCover, Vec<f32>, Vec<u32>) {
    let (drawn, _, dag) = build(24);
    let cover = RootCover::of(&dag, &drawn, &[]).expect("a DAG has roots");
    let (positions, indices) = grid(24);
    (cover, positions, indices)
}

/// The assembly of twelve instances of `part`'s roots, doubled in size and far apart, climbed over
/// the grid's own triangles: its DAG and, for each instance, the group above its root.
fn twelve_instances() -> (Climbed, RootCover, (Vec<f32>, Vec<u32>)) {
    let (cover, positions, indices) = part();
    let matrices: Vec<Mat4> = (0..12)
        .map(|k| placed(2.0, [60.0 + 80.0 * f64::from(k), 0.0, 0.0]))
        .collect();
    let instances: Vec<Instance> = (matrices.iter())
        .map(|&matrix| Instance {
            cover: &cover,
            matrix,
        })
        .collect();
    let climbed = build_with_instances(
        (&positions, DagAttributes::default(), &indices),
        &instances,
        DagStrategy::QemEndpoints.into(),
        &|| Ok(()),
    )
    .expect("climbs");
    (climbed, cover, (positions, indices))
}

// Behaviour: the instances of an assembly climb with its own clusters into levels above them: each
// instance carries the error and ball of the group that replaces its root, never below its root's
// own error carried by its transform; the DAG that comes back holds the mesh's own level 0 and the
// clusters the levels made — none of an instance's —, every link in range.
#[test]
fn instances_climb_with_the_assemblys_own_clusters_and_leave_no_cluster_of_theirs() {
    let (climbed, cover, (positions, indices)) = twelve_instances();
    assert_eq!(climbed.parents.len(), 12);
    for parent in &climbed.parents {
        let parent = parent.expect("every instance has a group above it");
        assert!(parent.error >= cover.lod_error * 2.0, "{parent:?}");
        assert!(parent.sphere[3] > 0.0);
    }
    let DagBuild {
        clusters,
        groups,
        grown,
        ..
    } = climbed.build;
    let own: usize = (clusters.iter().filter(|c| c.level == 0))
        .map(|c| c.triangles())
        .sum();
    assert_eq!(own, indices.len() / 3, "no cluster of an instance's");
    assert!(
        clusters.iter().any(|c| c.level >= 1),
        "levels above were made"
    );
    let vertices = grown
        .expect("the arrays the clusters index")
        .positions
        .len()
        / 3;
    assert!(
        vertices > positions.len() / 3,
        "the roots' vertices were laid"
    );
    for cluster in &clusters {
        assert!(cluster.indices.iter().all(|&v| (v as usize) < vertices));
    }
    for (slot, cluster) in clusters.iter().enumerate() {
        if let Some(group) = cluster.group {
            assert!(
                groups[group].children.contains(&slot),
                "a child of its group"
            );
        }
    }
    for group in &groups {
        let links = group.children.iter().chain(&group.outputs);
        assert!(links.into_iter().all(|&c| c < clusters.len()));
    }
}

// Behaviour: a mesh with no triangle and one instance has no cluster at all and is refused as a
// mesh with none is; a mesh of one cluster and no instance has nothing to climb over and is built as
// any mesh is, no group invented.
#[test]
fn a_mesh_with_nothing_to_climb_over_is_built_as_any_is() {
    let (cover, ..) = part();
    let instance = Instance {
        cover: &cover,
        matrix: placed(1.0, [0.0; 3]),
    };
    let refused = build_with_instances(
        (&[], DagAttributes::default(), &[]),
        &[instance],
        DagStrategy::QemEndpoints.into(),
        &|| Ok(()),
    );
    assert_eq!(refused.err().expect("refused").code, "INVALID_TRIANGLES");
    let (positions, indices) = grid(8);
    let alone = build_with_instances(
        (&positions, DagAttributes::default(), &indices),
        &[],
        DagStrategy::QemEndpoints.into(),
        &|| Ok(()),
    )
    .expect("one cluster");
    assert!(alone.parents.is_empty());
    assert_eq!(alone.build.clusters.len(), 1);
    assert!(alone.build.groups.is_empty());
}

// Behaviour: a parent's error and ball go back into the part's space through the instance's
// transform: the error over its shortest axis, the ball's centre brought back, its radius over its
// longest axis; a matrix with no inverse has none.
#[test]
fn a_parent_goes_back_into_the_parts_space() {
    let matrix = placed(2.0, [10.0, 0.0, 0.0]);
    let back = part_space(&matrix, 6.0, [14.0, 4.0, 2.0, 8.0]).expect("invertible");
    assert_eq!(back, [3.0, 2.0, 2.0, 1.0, 4.0]);
    assert!(part_space(&placed(0.0, [0.0; 3]), 1.0, [0.0; 4]).is_none());
    // Stretched unevenly, the error follows the shortest axis, the radius the longest.
    let mut stretched = placed(1.0, [0.0; 3]);
    stretched[0] = 4.0;
    let back = part_space(&stretched, 8.0, [4.0, 0.0, 0.0, 8.0]).expect("invertible");
    assert_eq!(back, [8.0, 1.0, 0.0, 0.0, 2.0]);
}

// Behaviour: an instance's root carried by a mirroring transform has its triangles turned over, its
// normals reflected and its tangents' sign reversed; its error scales by the shortest axis, its
// ball's radius by the longest.
#[test]
fn a_mirrored_instance_turns_its_triangles_and_its_tangents_over() {
    let attribute = |flag, width, values: Vec<f32>| Attribute {
        flag,
        width,
        values,
    };
    let cover = RootCover {
        positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        carried: vec![
            attribute(
                trillion3d_page_codec::FLAG_NORMAL,
                3,
                [0.0, 0.0, 1.0].repeat(3),
            ),
            attribute(
                trillion3d_page_codec::FLAG_TANGENT,
                4,
                [1.0, 0.0, 0.0, 1.0].repeat(3),
            ),
        ],
        indices: vec![0, 1, 2],
        lod_error: 0.5,
        sphere: [0.0, 0.0, 0.0, 2.0],
    };
    let mut mirror = placed(1.0, [0.0; 3]);
    mirror[0] = -2.0;
    let carried = cover.carried_by(&mirror);
    assert_eq!(carried.indices, [0, 2, 1]);
    assert_eq!(carried.positions[3..6], [-2.0, 0.0, 0.0]);
    assert_eq!(carried.carried[0].values[..3], [0.0, 0.0, 1.0]);
    assert_eq!(carried.carried[1].values[..4], [-1.0, 0.0, 0.0, -1.0]);
    assert_eq!(carried.lod_error, 0.5);
    assert_eq!(carried.sphere, [0.0, 0.0, 0.0, 4.0]);
}

// Behaviour: a colour is the one attribute either side may lack, a build dropping a colour white at
// every vertex: a cover joins a primitive that lacks its colour or carries it as wide, never one
// whose other attributes or colour width differ; the colour it brings is white over the vertices
// laid before it.
#[test]
fn a_colour_one_side_lacks_is_white_there() {
    let (plain, positions, indices) = part();
    let vertices = plain.positions.len() / 3;
    let colour = Attribute {
        flag: FLAG_COLOR,
        width: 4,
        values: vec![0.5; vertices * 4],
    };
    let tinted = RootCover {
        carried: vec![colour],
        ..plain.clone()
    };
    assert!(tinted.joins(&[]) && tinted.joins(&[(FLAG_COLOR, 4)]));
    assert!(plain.joins(&[(FLAG_COLOR, 4)]));
    assert!(!tinted.joins(&[(FLAG_COLOR, 3)]));
    assert!(!tinted.joins(&[(trillion3d_page_codec::FLAG_NORMAL, 3)]));
    let matrices: Vec<Mat4> = (0..4)
        .map(|k| placed(1.0, [60.0 * f64::from(k), 0.0, 0.0]))
        .collect();
    let instances: Vec<Instance> = (matrices.iter())
        .map(|&matrix| Instance {
            cover: &tinted,
            matrix,
        })
        .collect();
    let climbed = build_with_instances(
        (&positions, DagAttributes::default(), &indices),
        &instances,
        DagStrategy::QemEndpoints.into(),
        &|| Ok(()),
    )
    .expect("a colour one side lacks does not refuse");
    let grown = climbed.build.grown.expect("the arrays the clusters index");
    let colour = (grown.carried.iter().find(|a| a.flag == FLAG_COLOR))
        .expect("the colour the instances bring");
    assert_eq!(colour.values.len(), grown.positions.len() / 3 * 4);
    assert_eq!(
        colour.values[..4],
        [1.0; 4],
        "white where the mesh has none"
    );
    let brought = (colour.values.as_chunks::<4>().0.iter()).filter(|c| c.iter().all(|&v| v == 0.5));
    assert!(brought.count() >= instances.len() * vertices);
}
