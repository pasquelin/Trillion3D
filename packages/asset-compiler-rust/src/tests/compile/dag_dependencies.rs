use super::*;
use crate::dag::{DagCluster, DagGroup};

pub(super) fn cluster(
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
        source_rank: 0,
        group,
        source,
    }
}

pub(super) fn group(level: usize, children: Vec<usize>, outputs: Vec<usize>) -> DagGroup {
    DagGroup {
        level,
        error: level as f64,
        sphere: [0.0; 4],
        children,
        outputs,
    }
}

/// The bundles of `dag` packed by weight of indices alone, every root pinned, on a DAG without cells.
pub(super) fn pack(
    dag: &[DagCluster],
    groups: &[DagGroup],
    order: &[usize],
    bound: usize,
) -> Result<(Vec<Vec<usize>>, usize, Vec<usize>)> {
    let size = |rank: usize| dag[order[rank]].indices.len() * 4;
    crate::compiler_page_bundles::pack_bundles(dag, groups, order, bound, (&size, &|_| None))
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
    // One root; sixteen 64 KiB clusters under it, one group, packed whole in one bundle past the
    // budget; sixty-four 16 KiB clusters, four per level-1 parent — a group of 64 KiB —, two groups
    // per bundle. The culling order interleaves the families, so packing by rank alone would
    // spread each fine bundle's parents over eight level-1 clusters.
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
    let (bundles, pinned, bundle_of) = pack(&dag, &groups, &order, bound).expect("packed");
    assert_eq!((bundles.len(), pinned), (10, 1));
    assert_eq!(bundles[1].len(), 16, "the level-1 group, never cut");
    let direct = direct_dependencies(&dag, &groups, &bundle_of, bundles.len());
    let closed = close_dependencies(&direct).expect("acyclic");
    verify_dependencies(&dag, &groups, &order, &bundle_of, &closed, pinned).expect("listed");
    for bundle in 2..10 {
        assert_eq!(
            direct[bundle].len(),
            1,
            "fine bundle {bundle} has one parent bundle"
        );
        assert_eq!(closed[bundle].len(), 2, "and the root cover above it");
    }
}

#[test]
fn a_refusal_in_the_second_primitive_of_a_cook_names_its_mesh_and_primitive() {
    // Page ids restart at 0 in every primitive, so a refusal names its primitive; a float index
    // accessor makes the second primitive of the cook fail.
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    let accessors = gltf["accessors"].as_array_mut().expect("accessors");
    let float_indices = accessors.len();
    accessors.push(json!({"bufferView":1,"componentType":5126,"type":"SCALAR","count":3}));
    gltf["meshes"][0]["primitives"]
        .as_array_mut()
        .expect("primitives")
        .push(json!({"attributes":{"POSITION":0},"indices":float_indices}));
    write_gltf(&options, &gltf, None);
    let error = compile(&options, |_| {}).expect_err("refused");
    assert_eq!(error.code, "INVALID_GLTF");
    assert!(error.message.starts_with("Mesh 0 primitive 1: "), "{error}");
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: a primitive the buffer plan refuses is named, like one the cook refuses.
#[test]
fn a_primitive_the_buffer_plan_refuses_names_its_mesh_and_primitive() {
    let (root, options) = fixture();
    let mut gltf = read_gltf(&options);
    gltf["meshes"][0]["primitives"]
        .as_array_mut()
        .expect("primitives")
        .push(json!({"attributes":{"POSITION":0},"targets":[{"POSITION":"zero"}]}));
    write_gltf(&options, &gltf, None);
    let error = compile(&options, |_| {}).expect_err("refused");
    let expected = "Mesh 0 primitive 1: primitive target attribute must be an unsigned integer";
    assert_eq!(error.message, expected);
    fs::remove_dir_all(root).expect("cleanup");
}

#[test]
fn a_cancellation_met_inside_a_primitive_keeps_its_message() {
    let cancelled = CompilerError::new(crate::CANCELLED, "Compilation cancelled").within(0, 1);
    assert_eq!(cancelled.message, "Compilation cancelled");
}

#[test]
fn a_bundle_is_banded_in_metres_whatever_its_mesh_scale() {
    // One root, pinned and unbanded, and its child replaced at an error of 1 object unit: placed at
    // a scale of 1024, that unit is 1024 m, ten bands coarser, so containers order across meshes.
    let dag = vec![cluster(1, 3, None, Some(0)), cluster(0, 3, Some(0), None)];
    let groups = vec![group(1, vec![1], vec![0])];
    let band = |scale: f64| {
        let pages = vec![Some([7u8; 12]), Some([9u8; 12])];
        let laid = crate::compiler_page_bundles::lay_bundles(
            (&dag, &groups),
            &[0, 1],
            pages,
            &|_| None,
            scale,
        )
        .expect("laid");
        assert_eq!(laid.at, [Some((0, 0)), Some((1, 0))]);
        assert_eq!(laid.payload, [[7u8; 12], [9u8; 12]].concat());
        laid.bundles
            .iter()
            .map(|bundle| bundle.band)
            .collect::<Vec<_>>()
    };
    assert_eq!(band(1.0), [None, Some(0)]);
    assert_eq!(band(1024.0), [None, Some(10)]);
}
