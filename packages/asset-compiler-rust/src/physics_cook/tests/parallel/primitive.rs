//! The physics cook in parallel is the serial cook, byte for byte: a whole primitive's collider
//! and pages, computed on one thread and on many, on an empty primitive, one triangle, a random
//! surface and a mesh of many tiles.
use super::{on, surface};
use crate::compiler::primitive::climb::Assembly;
use crate::compiler::primitive::dag::{build_dag_primitive, DagInputs, DagResult};
use crate::tests::fixtures::files;
use crate::tests::random::Xorshift;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// A primitive built on one thread or many into its own store: its result and every object stored,
/// by name.
fn primitive(
    parallel: bool,
    pos: &[f32],
    triangles: &[u32],
    root: &Path,
) -> (Value, Vec<(PathBuf, Vec<u8>)>) {
    let mut o = crate::tests::fixtures::options_in(root);
    o.simplification = "qem-endpoints".into();
    let demand = crate::proxy::cut::cut_demand(None, 4096, triangles.len() / 3, 0);
    let encode = |slice: &[u32], pos: &[f32], carried: &[&_], _: &[u32], grid| {
        let none = Default::default();
        crate::compiler::pages::record::encode_page(slice, (pos, carried), (&none, &[]), grid)
    };
    let built = on(parallel, || {
        build_dag_primitive(
            &o,
            (pos, &[], triangles),
            DagInputs {
                proxy_demand: demand,
                taken: None,
                shaping: crate::dag::MeshShaping::default(),
                root_pages: 1,
                precision: Default::default(),
                scale: None,
            },
            Assembly::default(),
            &encode,
        )
    });
    let result = match built {
        Ok(DagResult {
            pages,
            collision,
            page_run,
            ..
        }) => {
            // A run is scratch, named per process: its bytes and bundles are the cook's, not its name.
            let run = page_run.map(|run| {
                let bytes = crate::hex_of(crate::digest_bytes(&std::fs::read(&run.path).unwrap()));
                let bundles = run.bundles.iter().map(|b| crate::hex_of(b.sha256));
                (bytes, bundles.collect::<Vec<_>>())
            });
            serde_json::json!([pages, collision, run])
        }
        Err(e) => serde_json::json!({"error": e.code, "message": e.message}),
    };
    let runs = crate::compiler::cache::storage::runs_dir(&o.cache);
    let mut stored: Vec<_> = files(&o.cache)
        .into_iter()
        .filter(|p| !p.starts_with(&runs))
        .collect();
    stored.sort();
    let object = |p: &PathBuf| {
        (
            p.strip_prefix(&o.cache).unwrap().to_path_buf(),
            std::fs::read(p).unwrap(),
        )
    };
    (result, stored.iter().map(object).collect())
}

fn assert_same_primitive(name: &str, pos: &[f32], triangles: &[u32]) {
    let root = crate::tests::directories::scratch("texture-preview", name);
    let serial = primitive(false, pos, triangles, &root.join("serial"));
    let parallel = primitive(true, pos, triangles, &root.join("parallel"));
    std::fs::remove_dir_all(&root).ok();
    assert_eq!(parallel.0, serial.0, "{name}: result");
    assert!(parallel.1 == serial.1, "{name}: stored objects differ");
}

// Behaviour: a primitive's collider and pages, cooked side by side on the pool, are the serial
// cook's, in the same order and with the same stored bytes: an empty primitive, one triangle, a
// random surface and a surface of several collision tiles.
#[test]
fn a_primitive_cooks_the_serial_bytes_on_many_threads() {
    assert_same_primitive("empty", &[], &[]);
    assert_same_primitive("one", &[0., 0., 0., 1., 0., 0., 0., 0., 1.], &[0, 1, 2]);
    let mut random = Xorshift::new(27);
    let (pos, triangles) = surface(24, &mut random);
    assert_same_primitive("random", &pos, &triangles);
    let (pos, triangles) = surface(129, &mut random);
    assert_same_primitive("tiled", &pos, &triangles);
}
