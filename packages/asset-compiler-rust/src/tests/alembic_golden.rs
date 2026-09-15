//! Doré et refus du pilote Alembic : une archive Ogawa CC0 passe par le routeur, le pilote, puis le
//! compilateur, et la scène intermédiaire qu'il a écrite est comparée à `expected.json` — hiérarchie,
//! matrices, primitives, matériaux des face sets, sommets découpés par coin, valeur par valeur. Les
//! autres cas fixent ce que le pilote reconnaît et ce qu'il refuse.
//!
//! Régénération de l'attendu, depuis la racine du dépôt :
//!
//! ```text
//! cargo test --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_la_fixture_alembic --nocapture
//! ```
//!
//! Ignorée par défaut : elle écrit dans `fixtures/`, et le diff qu'elle produit se relit avant
//! d'être commité.
use super::*;

const CASE: &str = "Trois cubes Alembic de huit sommets, posés par des Xform en x = 0, 3 et 6 sous une racine commune ; six faces de quatre côtés chacun, normales et coordonnées de texture par coin de face, et trois face sets nommés Emissive, Opaque et Transparent.";
const RULE: &str = "Une face Alembic est enroulée dans l'ordre horaire, une face glTF dans l'ordre inverse : chaque face est lue à l'envers, découpée en éventail, et ses coins distincts deviennent des sommets distincts. Un face set donne son nom à un matériau neutre et découpe une primitive. Trois objets aux mêmes octets sont un seul maillage et trois nœuds.";

fn fixture() -> PathBuf {
    golden_dir("alembic/procedural-static")
}

// Comportement 27 : la scène Alembic dorée passe par le compilateur et tout ce que le pilote en a
// tiré — hiérarchie, matrices, primitives, matériaux, sommets — est comparé à expected.json.
#[test]
fn the_alembic_scene_matches_its_golden_expected_json() {
    let run = compile_golden_source(&fixture().join("scene.abc"), "alembic");
    assert_eq!(
        alembic_digest(&run),
        golden_expected(&fixture()),
        "fixture alembic : la scène intermédiaire diverge de expected.json"
    );
}

// Comportement 28 : un `.abc` au conteneur HDF5 et une archive tronquée sont refusés au travers du
// compilateur entier, chacun sous son propre nom — l'appelant apprend ce qui cloche, pas seulement
// que la source n'a pas compilé.
#[test]
fn an_hdf5_container_and_a_truncated_archive_are_refused_by_name() {
    let limits = golden_dir("alembic/limites");
    assert_eq!(
        refused_golden_source(&limits.join("hdf5.abc"), "alembic-hdf5"),
        "alembic-hdf5-unsupported"
    );
    assert_eq!(
        refused_golden_source(&limits.join("truncated.abc"), "alembic-truncated"),
        "alembic-file-invalid"
    );
}

// Comportement 29 : un `.abc` va au pilote alembic, par son extension comme par son entête Ogawa,
// et un dossier qui en porte un s'y route sans qu'on lui désigne quoi que ce soit.
#[test]
fn an_ogawa_file_routes_to_the_alembic_plugin() {
    let routed = |path: &Path| match plugins::scene::route(path).expect("route") {
        plugins::scene::Routed::Driver(plugin, _) => plugin.name().to_string(),
        plugins::scene::Routed::Manifest => panic!("routé vers le manifeste"),
    };
    assert_eq!(routed(&fixture().join("scene.abc")), "alembic");
    let dir = std::env::temp_dir().join(format!("wg-alembic-route-{}", std::process::id()));
    fs::create_dir_all(&dir).expect("dossier");
    fs::copy(fixture().join("scene.abc"), dir.join("nameless")).expect("copie");
    assert_eq!(routed(&dir.join("nameless")), "alembic", "entête seule");
    assert_eq!(routed(&dir), "alembic", "dossier");
    fs::remove_dir_all(&dir).expect("nettoyage");
}

// Comportement 30 : ce que le pilote ne convertit pas, il le compte — courbes, subdivision rendue
// en polygones plats, animation dont seul le premier échantillon est lu, normales absentes — et un
// `Xform` qui n'hérite pas de son père devient une racine de la scène, avec sa propre matrice.
#[test]
fn what_the_plugin_leaves_aside_is_counted_and_a_detached_xform_becomes_a_root() {
    let run = compile_golden_source(&golden_dir("alembic/limites").join("cases.abc"), "alembic");
    let (manifest, gltf) = run.prepared("alembic");
    assert_eq!(
        manifest["unsupported"],
        json!({"alembic-animation-ignored": 1, "alembic-curves-unsupported": 1,
               "alembic-normals-missing": 3, "alembic-subd-as-polygons": 1,
               "alembic-transform-not-inherited": 1})
    );
    // Deux racines : le `Xform` porteur, et celui qui refuse d'hériter.
    assert_eq!(gltf["scenes"][0]["nodes"], json!([2, 4]));
    assert_eq!(gltf["nodes"][4]["name"], "Detached");
    assert_eq!(
        gltf["nodes"][4]["matrix"],
        json!([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 10.0, 0.0, 0.0, 1.0]),
        "la translation de l'opération reste, seul l'héritage tombe"
    );
    // Un pentagone donne trois triangles, une face de subdivision à quatre côtés en donne deux, et
    // un maillage sans normales n'en porte aucune dans le glTF.
    let triangles = |mesh: usize| {
        let id = gltf["meshes"][mesh]["primitives"][0]["indices"]
            .as_u64()
            .expect("indices") as usize;
        gltf["accessors"][id]["count"].as_u64().expect("count") / 3
    };
    assert_eq!((triangles(0), triangles(1), triangles(2)), (3, 2, 1));
    assert!(gltf["meshes"][0]["primitives"][0]["attributes"]["NORMAL"].is_null());
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_alembic() {
    let run = compile_golden_source(&fixture().join("scene.abc"), "alembic");
    write_expected(&fixture(), alembic_digest(&run), CASE, RULE);
}

/// Ce que la dorée fixe : le rapport du pilote, puis la scène intermédiaire elle-même — chaque nœud
/// avec son nom, sa matrice et ses enfants, chaque primitive avec son matériau et ses sommets, et
/// les valeurs qui prouvent l'enroulement, le découpage des coins et la conversion des coordonnées.
fn alembic_digest(run: &GoldenRun) -> Value {
    let (mut digest, _, gltf) = scene_digest(run, "alembic");
    let accessor = |id: &Value| gltf["accessors"][id.as_u64().expect("accesseur") as usize].clone();
    let primitives: Vec<Value> = gltf["meshes"]
        .as_array()
        .expect("meshes")
        .iter()
        .flat_map(|mesh| mesh["primitives"].as_array().expect("primitives").clone())
        .map(|primitive| {
            json!({
                "material": primitive["material"],
                "vertices": accessor(&primitive["attributes"]["POSITION"])["count"],
                "min": accessor(&primitive["attributes"]["POSITION"])["min"],
                "max": accessor(&primitive["attributes"]["POSITION"])["max"],
                "hasNormals": !primitive["attributes"]["NORMAL"].is_null(),
                "triangles": accessor(&primitive["indices"])["count"].as_u64().unwrap_or(0) / 3,
            })
        })
        .collect();
    digest["primitives"] = json!(primitives);
    digest["materials"] = gltf["materials"].clone();
    digest["firstPrimitive"] = first_primitive(&gltf, run);
    digest
}

/// Les valeurs de la première primitive, lues dans le binaire : positions, normales, coordonnées de
/// texture et indices. C'est là que l'enroulement inversé et la seconde coordonnée retournée se
/// voient en clair, nombre par nombre.
fn first_primitive(gltf: &Value, run: &GoldenRun) -> Value {
    let bytes = fs::read(run.prepared_dir("alembic").join("model.bin")).expect("model.bin");
    // Le début d'un accesseur dans le binaire, et le nombre d'éléments qu'il annonce.
    let span = |id: &Value| {
        let accessor = &gltf["accessors"][id.as_u64().expect("accesseur") as usize];
        let view = &gltf["bufferViews"][accessor["bufferView"].as_u64().expect("vue") as usize];
        let at = view["byteOffset"].as_u64().unwrap_or(0) as usize;
        (at, accessor["count"].as_u64().expect("count") as usize)
    };
    let primitive = &gltf["meshes"][0]["primitives"][0];
    let floats = |name: &str, width: usize| {
        let (at, count) = span(&primitive["attributes"][name]);
        (0..count * width)
            .map(|index| {
                let word = &bytes[at + index * 4..at + index * 4 + 4];
                f64::from(f32::from_le_bytes(word.try_into().expect("mot")))
            })
            .collect::<Vec<f64>>()
    };
    let (at, count) = span(&primitive["indices"]);
    let indices: Vec<u16> = (0..count)
        .map(|index| {
            let word = &bytes[at + index * 2..at + index * 2 + 2];
            u16::from_le_bytes(word.try_into().expect("mot"))
        })
        .collect();
    json!({
        "positions": floats("POSITION", 3),
        "normals": floats("NORMAL", 3),
        "texcoords": floats("TEXCOORD_0", 2),
        "indices": indices,
    })
}
