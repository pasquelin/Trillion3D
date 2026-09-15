//! Doré du pilote `usd`. Deux fixtures, deux questions distinctes.
//!
//! `minuscule/` est une couche écrite à la main pour ce test : elle tient une hiérarchie `Xform`,
//! un `Mesh` à deux polygones, un `GeomSubset` qui donne un second matériau à l'une des deux faces,
//! et un matériau texturé. Elle fixe ce que le pilote produit, jusqu'aux octets du sidecar.
//!
//! `corpus/` est la **même scène** livrée dans les deux sérialisations de USD, texte et binaire. Le
//! doré compile les deux et compare leurs scènes intermédiaires : `usda` et `usdc` ne sont que deux
//! écritures d'un même document, et le pilote ne doit pas savoir laquelle il a lue.
use super::*;

const CASE: &str = "Une couche usda : un Xform translaté, un Mesh de deux quadrilatères, un GeomSubset materialBind qui lie la seconde face à un second matériau, un UsdPreviewSurface opaque et un autre translucide à texture UsdUVTexture en sous-dossier.";
const RULE: &str = "Le pilote rend la scène composée et rien d'autre : polygones triangulés en éventail, une primitive par partie de matériau, normales et primvars:st résolues par leur interpolation, UsdPreviewSurface vers pbrMetallicRoughness, et l'unité comme l'axe haut de la couche portés par la racine de la scène.";

// Comportement 27 : la fixture usda minuscule passe par le compilateur et sa scène intermédiaire
// comme sa sortie compilée sont comparées à expected.json.
#[test]
fn the_usd_fixture_compiles_to_its_golden_expected_json() {
    let dir = golden_dir("usd");
    let run = compile_golden_source(&layer(&dir), "usd-minuscule");
    assert_eq!(
        digest(&run),
        golden_expected(&dir),
        "fixture usd : la sortie compilée diverge de expected.json"
    );
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_usd() {
    let dir = golden_dir("usd");
    let run = compile_golden_source(&layer(&dir), "usd-minuscule");
    write_expected(&dir, digest(&run), CASE, RULE);
}

// Comportement 28 : la même scène écrite en texte et en binaire donne la même scène intermédiaire,
// au nœud et à l'octet près. C'est la seule preuve qui vaille que le pilote lit un document et non
// une sérialisation.
#[test]
fn the_text_and_binary_serialisations_of_one_scene_give_the_same_intermediate_scene() {
    let corpus = golden_dir("usd").join("corpus");
    let text = compile_golden_source(&corpus.join("usda").join("scene.usda"), "usd-corpus-usda");
    let binary = compile_golden_source(&corpus.join("usdc").join("scene.usdc"), "usd-corpus-usdc");
    let (_, text_gltf) = text.prepared("usd");
    let (_, binary_gltf) = binary.prepared("usd");
    assert_eq!(
        text_gltf, binary_gltf,
        "la couche binaire ne donne pas la même scène intermédiaire que la couche texte"
    );
    assert_eq!(
        hash(&text.binary),
        hash(&binary.binary),
        "les deux sérialisations ne compilent pas le même sidecar"
    );
    assert_eq!(
        corpus_counts(&text_gltf),
        json!({"meshes":3,"materials":3,"triangles":36}),
        "les chiffres du corpus ont bougé"
    );
}

/// La couche de la fixture minuscule.
fn layer(dir: &Path) -> PathBuf {
    dir.join("minuscule").join("scene.usda")
}

/// Ce que le corpus met sous surveillance : trois cubes aux mêmes trois matériaux, six quads
/// chacun, donc trente-six triangles en tout.
fn corpus_counts(gltf: &Value) -> Value {
    let meshes = gltf["meshes"].as_array().expect("meshes");
    let triangles: usize = meshes
        .iter()
        .flat_map(|mesh| mesh["primitives"].as_array().expect("primitives"))
        .map(|primitive| {
            let accessor = primitive["indices"].as_u64().expect("indices") as usize;
            gltf["accessors"][accessor]["count"]
                .as_u64()
                .expect("count") as usize
                / 3
        })
        .sum();
    json!({
        "meshes": meshes.len(),
        "materials": gltf["materials"].as_array().expect("materials").len(),
        "triangles": triangles,
    })
}

/// Ce que la dorée fixe : le pilote retenu, la scène intermédiaire qu'il a écrite — nœuds,
/// maillages, matériaux, images, rapport — et la scène compilée qui en sort.
fn digest(run: &GoldenRun) -> Value {
    let (manifest, gltf) = run.prepared("usd");
    json!({
      "scenePlugin": run.result["scenePlugin"],
      "plugin": manifest["source"]["plugin"],
      "counts": manifest["source"]["counts"],
      "unsupported": manifest["unsupported"],
      "notes": manifest["notes"],
      "nodes": gltf["nodes"],
      "meshes": gltf["meshes"],
      "materials": gltf["materials"],
      "images": gltf["images"],
      "samplers": gltf["samplers"],
      "textures": gltf["textures"],
      "accessors": gltf["accessors"],
      "formatVersion": run.result["formatVersion"],
      "manifestBinaryVersion": run.slim["binary"]["version"],
      "sidecarSha256": hash(&run.binary),
      "primitives": run.result["primitives"].as_array().expect("primitives").len(),
      "selectedNodes": run.result["selectedNodes"],
      "totalNodes": run.result["totalNodes"],
      "selectedTriangles": run.result["selectedTriangles"],
      "sourceTriangles": run.result["sourceTriangles"],
    })
}
