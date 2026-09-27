//! The collision cooks beside the pages (#931, CMP-13): on any number of threads a primitive's
//! collision is the bytes the serial cook of its DAG makes, and its pages and reports are the
//! bytes a single thread makes.
use super::mesh_share_compile::bumpy_grid;
use super::*;
use crate::compiler_page_object::store_page;

/// What a primitive compiled on `threads` threads writes: its result and its cache objects, and
/// the collision the serial cook makes from the same DAG.
fn cooked(threads: usize) -> (Value, Vec<String>, Value) {
    let (root, o) = cube_fixture();
    let objects = o.cache.join("native/objects");
    fs::create_dir_all(&objects).expect("objects folder");
    let (pos, indices) = bumpy_grid();
    let triangles = indices.len() / 3;
    let demand = crate::proxy::cut::cut_demand(Some(1.0), 300_000, triangles, triangles);
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build();
    let store = |slice: &[u32], exponent| store_page(&o, slice, &pos, &[], exponent);
    let (result, serial) = pool.expect("pool").install(|| {
        let result = build_dag_primitive(&o, &pos, &[], &indices, demand, &store).expect("dag");
        let strategy = crate::dag::DagStrategy::named(&o.simplification);
        let attributes = crate::dag::DagAttributes { carried: &[] };
        let build = crate::dag::build_dag_tallied(&pos, attributes, &indices, strategy, &|| Ok(()));
        let dag = build.expect("dag").0;
        let (order, culling) = crate::dag::build_culling_bvh(&pos, &dag);
        let serial =
            crate::physics_cook::cook_primitive(&o, &dag, &order, &culling, &pos, &indices);
        (result, serial.expect("serial collision"))
    });
    let written = json!([
        result.pages,
        result.collision,
        result.culling_report,
        result.structure_report,
        result.stream_report,
        result.dag_report,
        result.proxy_cut,
        result.position_exponent,
    ]);
    let mut names: Vec<String> = fs::read_dir(objects)
        .expect("objects")
        .map(|entry| {
            entry
                .expect("entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    fs::remove_dir_all(root).expect("cleanup");
    (written, names, serial)
}

#[test]
fn the_collision_cooked_beside_the_pages_is_the_serial_cook() {
    let (alone, alone_objects, serial) = cooked(1);
    let (beside, beside_objects, _) = cooked(4);
    assert_eq!(beside[1], serial, "the serial cook's collision");
    assert_eq!(
        beside[1]["kind"], "mesh",
        "a triangle mesh, not a height field"
    );
    assert!(beside[1]["tiles"].as_array().is_some_and(|t| !t.is_empty()));
    assert_eq!(beside, alone, "the pages and reports of one thread");
    assert_eq!(beside_objects, alone_objects, "the same objects");
}
