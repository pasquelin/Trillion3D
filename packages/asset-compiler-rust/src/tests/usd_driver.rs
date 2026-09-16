//! Ce que le pilote `usd` reconnaît, triangule et compose. Les refus, eux, sont dans
//! `usd_refus.rs` ; la scène dorée est dans `usd_golden.rs`.
//!
//! Chaque cas est une couche `.usda` minuscule écrite ici même : c'est la seule façon d'isoler un
//! comportement — une fixture réelle en mêlerait dix.
use super::*;

/// Le pilote de scène de ce nom dans le registre.
pub(super) fn plugin(name: &str) -> &'static dyn plugins::scene::ScenePlugin {
    plugins::scene::PLUGINS
        .iter()
        .copied()
        .find(|plugin| plugin.name() == name)
        .unwrap_or_else(|| panic!("le registre ne porte pas le pilote {name}"))
}

/// Un dossier jetable, nommé par le cas qui l'utilise.
pub(super) fn temp_dir(tag: &str) -> PathBuf {
    scratch("usd", tag)
}

/// Écrit une couche jetable et la compile par le harnais commun. Le dossier source s'efface une
/// fois la compilation faite : tout ce que la dorée relit est déjà dans son cache.
pub(super) fn compile_layer(tag: &str, body: &str) -> GoldenRun {
    let dir = temp_dir(tag);
    let source = dir.join("scene.usda");
    fs::write(&source, body).expect("couche");
    let run = compile_golden_source(&source, tag);
    fs::remove_dir_all(&dir).ok();
    run
}

/// Une couche qui porte `body` entre les accolades de son prim racine.
pub(super) fn wrap(header: &str, body: &str) -> String {
    format!("#usda 1.0\n(\n    defaultPrim = \"Root\"\n{header})\n\ndef Xform \"Root\"\n{{\n{body}\n}}\n")
}

/// Un maillage carré, deux triangles, sans matériau : de quoi qu'une scène ne soit pas vide.
pub(super) const QUAD: &str = r#"
    def Mesh "Quad"
    {
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)]
        uniform token subdivisionScheme = "none"
    }
"#;

// Comportement 29 : les deux sérialisations se reconnaissent à leur entête, et un ZIP n'est pas une
// couche USD — c'est le conteneur `usdz` qui le revendique.
#[test]
fn the_usd_plugin_recognises_both_serialisations_by_their_head() {
    let usd = plugin("usd");
    assert!(usd.accepts_head(b"#usda 1.0\n"), "la couche texte");
    assert!(usd.accepts_head(b"PXR-USDC\0\x08\0\0"), "la couche binaire");
    assert!(
        !usd.accepts_head(b"PK\x03\x04"),
        "un ZIP n'est pas une couche"
    );
    assert_eq!(usd.extensions(), ["usd", "usda", "usdc"]);
    assert!(
        plugin("usdz").accepts_head(b"PK\x03\x04"),
        "un paquet USDZ est un ZIP"
    );
}

// Comportement 30 : un polygone à n côtés devient n − 2 triangles, en éventail depuis son premier
// coin ; un maillage à sept coins ne perd donc aucune surface.
#[test]
fn a_polygon_becomes_a_fan_of_triangles() {
    let mesh = r#"
    def Mesh "Heptagone"
    {
        int[] faceVertexCounts = [7]
        int[] faceVertexIndices = [0, 1, 2, 3, 4, 5, 6]
        point3f[] points = [(0,0,0), (1,0,0), (2,1,0), (2,2,0), (1,3,0), (0,3,0), (-1,2,0)]
        uniform token subdivisionScheme = "none"
    }
"#;
    let run = compile_layer("fan", &wrap("", mesh));
    assert_eq!(
        run.result["sourceTriangles"], 5,
        "sept coins font cinq triangles"
    );
}

// Comportement 31 : un `GeomSubset` de la famille `materialBind` devient une primitive à part, et
// les faces qu'aucun sous-ensemble ne réclame reviennent à la liaison du maillage.
#[test]
fn a_geom_subset_becomes_its_own_primitive_with_its_own_material() {
    let dir = golden_dir("usd");
    let run = compile_golden_source(&dir.join("minuscule").join("scene.usda"), "usd-subset");
    let (_, gltf) = run.prepared("usd");
    let primitives = gltf["meshes"][0]["primitives"]
        .as_array()
        .expect("primitives");
    assert_eq!(primitives.len(), 2, "une partie par matériau");
    let materials: Vec<u64> = primitives
        .iter()
        .map(|primitive| primitive["material"].as_u64().expect("material"))
        .collect();
    assert_eq!(
        materials,
        [0, 1],
        "le sous-ensemble d'abord, le reste ensuite"
    );
    assert_eq!(gltf["materials"][1]["alphaMode"], "OPAQUE");
    assert_eq!(gltf["materials"][0]["alphaMode"], "BLEND", "opacité 0,5");
}

// Comportement 32 : deux prims `instanceable` qui référencent la même définition partagent un seul
// maillage glTF, chacun sous son propre nœud.
#[test]
fn two_instances_of_one_prototype_share_a_single_mesh() {
    let body = format!(
        r#"    class Xform "_Modele"
    {{
{QUAD}    }}

    def Xform "A" (
        instanceable = true
        prepend references = </Root/_Modele>
    )
    {{
    }}

    def Xform "B" (
        instanceable = true
        prepend references = </Root/_Modele>
    )
    {{
        double3 xformOp:translate = (5, 0, 0)
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }}"#
    );
    let run = compile_layer("instances", &wrap("", &body));
    let (_, gltf) = run.prepared("usd");
    assert_eq!(
        gltf["meshes"].as_array().map(Vec::len),
        Some(1),
        "les deux instances citent le même maillage"
    );
    let cited: Vec<u64> = gltf["nodes"]
        .as_array()
        .expect("nodes")
        .iter()
        .filter_map(|node| node["mesh"].as_u64())
        .collect();
    assert_eq!(
        cited,
        [0, 0],
        "les deux instances, le gabarit n'étant pas une scène"
    );
}

// Comportement 33 : l'unité et l'axe haut de la couche vivent sur la racine de la scène, jamais
// dans les sommets : une couche en centimètres et en Z haut sort à l'échelle et en Y haut.
#[test]
fn the_layer_unit_and_up_axis_land_on_the_scene_root() {
    let header = "    metersPerUnit = 0.01\n    upAxis = \"Z\"\n";
    let run = compile_layer("axes", &wrap(header, QUAD));
    let (_, gltf) = run.prepared("usd");
    let nodes = gltf["nodes"].as_array().expect("nodes");
    let root = nodes.last().expect("racine");
    let matrix: Vec<f64> = root["matrix"]
        .as_array()
        .expect("matrix")
        .iter()
        .map(|value| (value.as_f64().expect("nombre") * 1e6).round() / 1e6)
        .collect();
    assert_eq!(
        matrix,
        vec![0.01, 0., 0., 0., 0., 0., -0.01, 0., 0., 0.01, 0., 0., 0., 0., 0., 1.],
        "l'échelle de la couche puis le passage de Z haut à Y haut"
    );
}
