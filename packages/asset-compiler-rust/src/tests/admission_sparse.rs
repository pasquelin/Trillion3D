use super::*;

/// Un POSITION sans `bufferView`, décrit uniquement par un sparse d'un seul élément, mais annonçant
/// `count` éléments denses. Les octets stockés tiennent en 28 : trois indices, un index sparse, une
/// valeur sparse. L'expansion dense, elle, vaut `count × 3` flottants.
fn sparse_position_fixture(count: u64) -> (PathBuf, Options) {
    let (root, mut options) = fixture();
    let mut bin = Vec::new();
    for value in [0u32, 1, 2] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    bin.extend_from_slice(&0u32.to_le_bytes());
    for value in [0f32, 0., 0.] {
        bin.extend_from_slice(&value.to_le_bytes());
    }
    let gltf = json!({"asset":{"version":"2.0"},"buffers":[{"uri":"mesh.bin","byteLength":bin.len()}],
        "bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":12},{"buffer":0,"byteOffset":12,"byteLength":4},{"buffer":0,"byteOffset":16,"byteLength":12}],
        "accessors":[{"componentType":5126,"type":"VEC3","count":count,"sparse":{"count":1,"indices":{"bufferView":1,"componentType":5125},"values":{"bufferView":2}}},{"bufferView":0,"componentType":5125,"type":"SCALAR","count":3}],
        "meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0},{"mesh":0}],"materials":[],"images":[]});
    fs::write(options.source.join("mesh.bin"), &bin).expect("bin write");
    write_gltf(&options, &gltf, Some(&bin));
    options.scope = "full".into();
    options.triangle_budget = 150000;
    (root, options)
}

/// A01 : `count = 2^61` tient dans un `usize`, donc ni l'admission ni la validation ne le voient
/// passer ; seule la réservation dense de `count × 3` flottants s'en apercevait, en paniquant.
#[test]
fn a01_un_position_sparse_de_2_puissance_61_est_refuse_sans_panique() {
    let (root, options) = sparse_position_fixture(1u64 << 61);
    let error = compile(&options, |_| {}).expect_err("l'accessor hostile doit être refusé");
    assert!(
        error.code == "INVALID_GLTF" || error.code == "RAM_ADMISSION_BUDGET_EXCEEDED",
        "{error}"
    );
    fs::remove_dir_all(root).expect("cleanup");
}

/// A01 bis : un sparse réaliste, dont l'expansion dense dépasse le budget de 64 Mio sans dépasser
/// aucun entier, doit être refusé par l'admission et non alloué.
#[test]
fn a01_un_sparse_realiste_hors_budget_est_refuse_par_l_admission() {
    let (root, options) = sparse_position_fixture(8_000_000);
    let error = compile(&options, |_| {}).expect_err("l'expansion dense dépasse le budget");
    assert_eq!(error.code, "RAM_ADMISSION_BUDGET_EXCEEDED", "{error}");
    fs::remove_dir_all(root).expect("cleanup");
}
