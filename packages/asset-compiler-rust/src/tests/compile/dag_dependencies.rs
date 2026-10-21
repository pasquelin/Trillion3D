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
        whole_box: None,
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
    let root = [true, false];
    let error = verify_dependencies(&dag, &groups, (&[0, 1], &root), &[vec![], vec![]])
        .expect_err("refused");
    assert!(
        error.message.contains("Cluster 1") && error.message.contains("bundle 0"),
        "{error}"
    );
    let listed = [vec![], vec![0]];
    assert!(verify_dependencies(&dag, &groups, (&[0, 1], &root), &listed).is_ok());
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
    // One root, pinned and unbanded, and its child — too large for the root page — replaced at an
    // error of 1 object unit: placed at a scale of 1024, that unit is 1024 m, ten bands coarser, so
    // containers order across meshes.
    let dag = vec![cluster(1, 3, None, Some(0)), cluster(0, 3, Some(0), None)];
    let groups = vec![group(1, vec![1], vec![0])];
    let child = crate::compiler::pages::bundles::ROOT_PAGE_BYTES;
    let band = |scale: f64| {
        let pages = vec![vec![7u8; 12], vec![9u8; child]];
        let laying = crate::compiler::pages::bundles::Laying {
            positions: &[0.0; 3],
            held: &|_| None,
            root_pages: &|_| 1,
            scale,
        };
        use crate::compiler::pages::bundles::{assign_pages, lay_bundles};
        let size = |slot: usize| pages[slot].len();
        let assigned = assign_pages((&dag, &groups), &laying, &size).expect("assigned");
        let laid = lay_bundles((&dag, &groups), pages, (assigned, &laying)).expect("laid");
        assert_eq!(laid.at, [(0, 0), (1, 0)]);
        assert_eq!(laid.payload, [vec![7u8; 12], vec![9u8; child]].concat());
        laid.bundles
            .iter()
            .map(|bundle| bundle.band)
            .collect::<Vec<_>>()
    };
    assert_eq!(band(1.0), [None, Some(0)]);
    assert_eq!(band(1024.0), [None, Some(10)]);
}
