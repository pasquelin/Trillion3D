use super::*;
use crate::dag::{DagCluster, DagGroup};

fn cluster(
    level: usize,
    indices: usize,
    group: Option<usize>,
    source: Option<usize>,
) -> DagCluster {
    DagCluster {
        indices: vec![0; indices],
        level,
        lod_error: level as f64,
        parent_error: if group.is_some() {
            level as f64 + 1.0
        } else {
            f64::INFINITY
        },
        sphere: [0.0; 4],
        parent_sphere: [0.0; 4],
        replacement: None,
        source_rank: 0,
        group,
        source,
    }
}

fn group(level: usize, children: Vec<usize>, outputs: Vec<usize>) -> DagGroup {
    DagGroup {
        level,
        error: level as f64,
        sphere: [0.0; 4],
        children,
        outputs,
    }
}

#[test]
fn a_dependency_cycle_is_refused_with_the_bundle_named() {
    let error = close_dependencies(&[vec![], vec![2], vec![1]]).expect_err("refused");
    assert_eq!(error.code, "INVALID_PAGE_DEPENDENCIES");
    assert!(error.message.contains("bundle 1"), "{error}");
}

#[test]
fn a_page_whose_parent_bundle_is_not_listed_is_refused_with_the_page_named() {
    // Slot 0 is the root, slot 1 its child: bundle 1 must list bundle 0.
    let dag = vec![cluster(1, 3, None, Some(0)), cluster(0, 3, Some(0), None)];
    let groups = vec![group(1, vec![1], vec![0])];
    let error = verify_dependencies(&dag, &groups, &[0, 1], &[0, 1], &[vec![], vec![]], 1)
        .expect_err("refused");
    assert!(
        error.message.contains("Page 1") && error.message.contains("bundle 0"),
        "{error}"
    );
    assert!(verify_dependencies(&dag, &groups, &[0, 1], &[0, 1], &[vec![], vec![0]], 1).is_ok());
}

#[test]
fn siblings_are_packed_together_so_a_bundle_depends_on_one_bundle_per_level() {
    // One root; sixteen 64 KiB clusters under it, two per bundle; sixty-four 16 KiB clusters, four
    // per level-1 parent, eight per bundle. The culling order interleaves the families, so packing
    // by rank alone would spread each fine bundle's parents over eight level-1 clusters.
    let mut dag = vec![cluster(2, 3, None, Some(0))];
    let mut groups = vec![group(2, (1..17).collect(), vec![0])];
    for parent in 0..16 {
        dag.push(cluster(1, 16 * 1024, Some(0), Some(1 + parent)));
        groups.push(group(
            1,
            (0..4).map(|k| 17 + parent * 4 + k).collect(),
            vec![1 + parent],
        ));
    }
    for child in 0..64 {
        dag.push(cluster(0, 4 * 1024, Some(1 + child / 4), None));
    }
    let mut order: Vec<usize> = (0..17).collect();
    order.extend((0..64).map(|rank| 17 + (rank % 16) * 4 + rank / 16));
    let bound = dependency_bound(&dag, &groups);
    let (bundles, pinned, bundle_of) = pack_bundles(&dag, &groups, &order, bound).expect("packed");
    assert_eq!((bundles.len(), pinned), (17, 1));
    let direct = direct_dependencies(&dag, &groups, &bundle_of, bundles.len());
    let closed = close_dependencies(&direct).expect("acyclic");
    verify_dependencies(&dag, &groups, &order, &bundle_of, &closed, pinned).expect("listed");
    for bundle in 9..17 {
        assert_eq!(
            direct[bundle].len(),
            1,
            "fine bundle {bundle} has one parent bundle"
        );
        assert_eq!(closed[bundle].len(), 2, "and the root cover above it");
    }
}

/// One root over four 48 KiB clusters, two per bundle, each over four 8 KiB children: the sixteen
/// children fill one 128 KiB bundle exactly, whose parents would then span both level-1 bundles.
fn straddling_family() -> (Vec<DagCluster>, Vec<DagGroup>, Vec<usize>) {
    let mut dag = vec![cluster(2, 3, None, Some(0))];
    let mut groups = vec![group(2, (1..5).collect(), vec![0])];
    for parent in 0..4 {
        dag.push(cluster(1, 12 * 1024, Some(0), Some(1 + parent)));
        groups.push(group(
            1,
            (0..4).map(|k| 5 + parent * 4 + k).collect(),
            vec![1 + parent],
        ));
    }
    for child in 0..16 {
        dag.push(cluster(0, 2 * 1024, Some(1 + child / 4), None));
    }
    let order = (0..dag.len()).collect();
    (dag, groups, order)
}

#[test]
fn a_bundle_that_would_exceed_the_bound_is_split_before_packing_ends() {
    let (dag, groups, order) = straddling_family();
    let bound = dependency_bound(&dag, &groups);
    assert_eq!(bound, 1, "every cluster has one parent");
    let fine = |bound: usize| {
        let (bundles, _, bundle_of) = pack_bundles(&dag, &groups, &order, bound).expect("packed");
        let direct = direct_dependencies(&dag, &groups, &bundle_of, bundles.len());
        direct[bundle_of[5]..]
            .iter()
            .map(Vec::len)
            .collect::<Vec<_>>()
    };
    assert_eq!(
        fine(usize::MAX),
        vec![2],
        "by size alone, one bundle needs two"
    );
    assert_eq!(
        fine(bound),
        vec![1, 1],
        "held to the bound, it is split in two"
    );
}

#[test]
fn a_cluster_whose_parents_exceed_a_forced_bound_is_refused_with_the_page_named() {
    // Two 96 KiB level-1 clusters cannot share a bundle; the one fine cluster has both as parents.
    let dag = vec![
        cluster(2, 3, None, Some(0)),
        cluster(1, 24 * 1024, Some(0), Some(1)),
        cluster(1, 24 * 1024, Some(0), Some(1)),
        cluster(0, 3, Some(1), None),
    ];
    let groups = vec![group(2, vec![1, 2], vec![0]), group(1, vec![3], vec![1, 2])];
    assert_eq!(dependency_bound(&dag, &groups), 2);
    assert!(pack_bundles(&dag, &groups, &[0, 1, 2, 3], 2).is_ok());
    let error = pack_bundles(&dag, &groups, &[0, 1, 2, 3], 1).expect_err("refused");
    assert_eq!(error.code, "PAGE_DEPENDENCY_BOUND");
    assert!(error.message.contains("Page 3"), "{error}");
}

#[test]
fn a_refusal_in_the_second_primitive_of_a_cook_names_its_mesh_and_primitive() {
    // Page ids restart at 0 in every primitive: "Page 3" alone would name a page of each of them.
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    let push = |list: &mut Value, item: Value| list.as_array_mut().expect("array").push(item);
    push(
        &mut gltf["accessors"],
        json!({"bufferView":1,"componentType":5126,"type":"SCALAR","count":3}),
    );
    push(
        &mut gltf["meshes"][0]["primitives"],
        json!({"attributes":{"POSITION":0},"indices":2}),
    );
    write_gltf(&options, &gltf, None);
    let error = compile(&options, |_| {}).expect_err("refused");
    assert_eq!(error.code, "INVALID_GLTF");
    assert!(
        error.message.starts_with("glTF mesh 0 primitive 1: "),
        "{error}"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
