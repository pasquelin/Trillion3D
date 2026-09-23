use super::*;
pub(in crate::tests) mod cancel_and_prune;
pub(in crate::tests) mod identity_import;
pub(in crate::tests) mod import_and_prune;
pub(in crate::tests) mod lock;
pub(in crate::tests) mod reuse;
pub(in crate::tests) mod reuse_proof;

/// Two one-triangle OBJ files in one folder, the folder compiled at full scope: the start of
/// every prune test, which then compiles another scope over the same cache.
fn two_mesh_folder() -> (PathBuf, Options, Value) {
    let (root, options) = obj_fixture("a.obj", false);
    let dir = options.source.parent().expect("dir").to_path_buf();
    fs::write(
        dir.join("b.obj"),
        "v 5 0 0\nv 7 0 0\nv 5 3 0\nvn 0 0 1\nf 1//1 2//1 3//1\n",
    )
    .expect("second mesh");
    let options = Options {
        source: dir,
        ..options
    };
    let full = compile(&options, |_| {}).expect("full");
    (root, options, full)
}

/// The steps the import phase published among these progress events.
fn import_steps(events: &std::sync::Mutex<Vec<Value>>) -> Vec<String> {
    events
        .lock()
        .unwrap()
        .iter()
        .filter(|e| e["phase"] == "import-source")
        .map(|e| e["step"].as_str().unwrap_or("").to_string())
        .collect()
}
