use super::*;
use std::path::Path;
#[test]
fn ldraw_reads_local_dependency_and_records_its_source_digest() {
    let file = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/fixtures/formats/ldraw/local/main.ldr");
    let scene = source::test_support::file(&LDRAW, &file, 1024 * 1024).unwrap();
    assert_eq!(scene.mesh_triangles, vec![1]);
    assert_eq!(scene.files.len(), 1);
    assert_eq!(scene.files[0]["file"], "panel.dat");
    let bytes = std::fs::read(file.with_file_name("panel.dat")).unwrap();
    assert_eq!(scene.files[0]["sha256"], crate::hash(&bytes));
}
#[test]
fn ldraw_noclip_is_inherited_and_colour_definitions_are_scoped_to_submodels() {
    let text=b"0 FILE main.ldr\n0 !COLOUR Warm CODE 100 VALUE #FF0000 EDGE #000000\n0 BFC NOCLIP\n1 100 0 0 0 1 0 0 0 1 0 0 0 1 a.dat\n1 100 0 0 0 1 0 0 0 1 0 0 0 1 b.dat\n0 FILE a.dat\n0 !COLOUR Cold CODE 100 VALUE #0000FF EDGE #000000\n0 BFC CERTIFY CCW\n3 100 0 0 0 10 0 0 0 10 0\n0 FILE b.dat\n0 BFC CERTIFY CCW\n3 100 0 0 0 10 0 0 0 10 0\n";
    let scene = source::test_support::read(&LDRAW, text, 1024 * 1024).unwrap();
    assert_eq!(scene.materials.len(), 2);
    for material in &scene.materials {
        assert_eq!(material["doubleSided"], json!(true));
    }
    let colors: Vec<_> = scene
        .materials
        .iter()
        .map(|m| m["pbrMetallicRoughness"]["baseColorFactor"].clone())
        .collect();
    assert_eq!(
        colors,
        vec![json!([0., 0., 1., 1.]), json!([1., 0., 0., 1.])]
    );
}
