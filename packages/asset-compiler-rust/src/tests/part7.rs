use super::*;

#[test]
fn cancelled_import_reports_cancelled() {
    let (root, options) = obj_fixture("quad.obj", false);
    options.cancelled.store(true, Ordering::Relaxed);
    assert_eq!(
        compile(&options, |_| {}).expect_err("cancelled").code,
        "CANCELLED"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

fn objects_on_disk(cache: &Path) -> BTreeSet<String> {
    fs::read_dir(cache.join("native/objects"))
        .expect("objects")
        .map(|e| e.expect("entry").file_name().to_string_lossy().into_owned())
        .collect()
}
/// Le scope qu'on ne recompile pas nomme ses pages dans les colonnes de son sidecar. Si ce sidecar
/// porte une autre version binaire, la purge ne doit ni le lire comme « aucun objet référencé » ni
/// supprimer quoi que ce soit : elle échoue et laisse le cache intact.
#[test]
fn a_sidecar_of_another_version_stops_the_prune_without_removing_anything() {
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
    let sidecar = options
        .cache
        .join("native/full")
        .join(full["key"].as_str().expect("key"))
        .join(MANIFEST_BINARY_FILE);
    let mut bytes = fs::read(&sidecar).expect("sidecar");
    bytes[4..8].copy_from_slice(&(manifest_binary::MANIFEST_BINARY_VERSION - 1).to_le_bytes());
    fs::write(&sidecar, &bytes).expect("older version");
    let before = objects_on_disk(&options.cache);
    let slice = Options {
        scope: "slice".into(),
        triangle_budget: 1,
        ..options.clone()
    };
    let error = compile(&slice, |_| {}).expect_err("the prune refuses an unreadable sidecar");
    assert_eq!(error.code, "UNSUPPORTED_FORMAT", "{error}");
    assert_eq!(
        objects_on_disk(&options.cache),
        before,
        "an incompatible sidecar removes nothing"
    );
    fs::remove_dir_all(root).expect("cleanup");
}
