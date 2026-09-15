//! Doré du pilote `blend` : une scène Blender CC0 passe par le routeur, le pilote, puis le
//! compilateur, et la scène intermédiaire qu'il a écrite est comparée à `expected.json` — nœuds,
//! matrices converties, maillages, primitives par matériau, matériaux PBR et images, valeur par
//! valeur. Ce que le pilote refuse est fixé ici aussi, par son code.
//!
//! La fixture est décrite dans `fixtures/blend/README.md`. Régénération de l'attendu, depuis la
//! racine du dépôt :
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_la_fixture_blend --nocapture
//! npx prettier --write packages/asset-compiler-rust/fixtures/blend/procedural-materials/expected.json
//! ```
//!
//! Ignorée par défaut : elle écrit dans `fixtures/`. Le diff qu'elle produit se relit avant d'être
//! commité — un attendu régénéré sans lecture ne surveille plus rien.
use super::*;

const CASE: &str = "Scene Blender 5.2 CC0 compressee en Zstandard : trois objets qui partagent un meme cube, accroches a un objet vide qui les porte, six faces a trois materiaux, une couche d UV, des faces toutes nettes, un materiau emissif d intensite 3, un materiau opaque et un materiau transparent dont la couleur et l alpha viennent d une meme image PNG empaquetee dans le fichier.";
const RULE: &str = "Blender travaille en Z vers le haut, le glTF en Y vers le haut : un unique noeud racine porte la conversion d axes, et aucun sommet n est retouche. Un maillage partage par trois objets n est ecrit qu une fois ; seules les matrices different. L indice de matiere vit a la face chez Blender et a la primitive en glTF : les six faces donnent trois primitives. Les normales ne sont pas dans le fichier et sont calculees a la lecture, a plat pour une face nette. L emission vaut couleur x intensite, bornee a 1 par le glTF et comptee des qu elle depasse. Les octets de l image empaquetee partent tels quels dans le binaire de la scene, par une vue de tampon : aucun reencodage.";

/// La fixture CC0 et le dossier qui porte son attendu.
fn fixture() -> PathBuf {
    golden_dir("blend/procedural-materials")
}

// Comportement 27 : la scène Blender dorée passe par le compilateur et tout ce que le pilote en a
// tiré — nœuds, matrices, maillages, matériaux, images — est comparé exactement à expected.json.
#[test]
fn the_blend_scene_matches_its_golden_expected_json() {
    let run = compile_golden_source(&fixture().join("scene.blend"), "blend");
    assert_eq!(
        blend_digest(&run),
        golden_expected(&fixture()),
        "fixture blend : la scène intermédiaire diverge de expected.json"
    );
}

// Comportement 28 : ce que le pilote refuse est nommé. Un fichier tronqué au milieu d'un bloc, et
// un dossier qui porte deux fichiers Blender, sortent chacun par leur code, sans panique.
#[test]
fn a_truncated_file_and_an_ambiguous_directory_are_refused_by_name() {
    let truncated = golden_dir("blend/limites").join("truncated.blend");
    assert_eq!(
        refused_golden_source(&truncated, "blend-tronque"),
        "blend-truncated"
    );
    let dir = std::env::temp_dir().join(format!("wg-blend-deux-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("dossier");
    for name in ["a.blend", "b.blend"] {
        fs::copy(&truncated, dir.join(name)).expect("copie");
    }
    assert_eq!(
        refused_golden_source(&dir, "blend-ambigu"),
        "SOURCE_FORMAT_AMBIGUOUS"
    );
    fs::remove_dir_all(dir).expect("nettoyage");
}

/// Ce que la dorée fixe : le pilote retenu, son rapport, puis la scène elle-même — chaque nœud avec
/// son nom, sa matrice et son maillage, chaque maillage avec les matériaux de ses primitives, et
/// chaque matériau avec ses facteurs PBR.
pub(super) fn blend_digest(run: &GoldenRun) -> Value {
    let (manifest, gltf) = run.prepared("blend");
    let materials: Vec<Vec<Value>> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .map(|mesh| {
            mesh["primitives"]
                .as_array()
                .expect("primitives")
                .iter()
                .map(|primitive| primitive["material"].clone())
                .collect()
        })
        .collect();
    let names: Vec<Value> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .map(|mesh| mesh["name"].clone())
        .collect();
    json!({
      "rapport": {
        "formatVersion": run.result["formatVersion"],
        "plugin": manifest["source"]["plugin"],
        "counts": manifest["source"]["counts"],
        "unsupported": manifest["unsupported"],
        "notes": manifest["notes"],
      },
      "instancie": {
        "meshNodes": manifest["runtime"]["meshNodes"],
        "trianglesAcrossNodes": manifest["runtime"]["trianglesAcrossNodes"],
        "selectedTriangles": run.result["selectedTriangles"],
        "totalNodes": run.result["totalNodes"],
      },
      "scene": {
        "roots": gltf["scenes"][0]["nodes"],
        "nodes": gltf["nodes"],
        "meshNames": names,
        "primitiveMaterials": materials,
      },
      "apparence": {
        "materials": gltf["materials"],
        "images": gltf["images"],
        "samplers": gltf["samplers"],
      },
    })
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_blend() {
    let run = compile_golden_source(&fixture().join("scene.blend"), "blend");
    write_expected(&fixture(), blend_digest(&run), CASE, RULE);
}
