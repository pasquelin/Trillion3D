//! A13 — La clé finale hachait tous les octets du manifeste d'import, métriques comprises. Le temps
//! mesuré d'une conversion y entrait : trois compilations des mêmes fichiers, aux mêmes octets de
//! glTF intermédiaire et à la même clé d'import, rendaient trois clés finales distinctes. Le chemin
//! de la source y entrait aussi — la machine qui compile, et non la scène compilée.
use super::usd_driver::{compile_layer, wrap, QUAD};
use super::*;

/// La clé exposée par une compilation de `source` dans un cache neuf : c'est de cache à cache, et
/// non d'un cache déjà servi à lui-même, qu'une clé instable se voit.
fn cle_dans_un_cache_neuf(source: &Path, tag: &str) -> String {
    compile_golden_source(source, tag).result["key"]
        .as_str()
        .expect("clé")
        .to_string()
}

/// Trois clés de suite pour la même source, chacune dans son propre cache.
fn trois_cles(source: &Path, tag: &str) -> [String; 3] {
    [
        cle_dans_un_cache_neuf(source, tag),
        cle_dans_un_cache_neuf(source, tag),
        cle_dans_un_cache_neuf(source, tag),
    ]
}

// Comportement : un pilote natif — l'import ufbx d'un OBJ — rend la même clé à chaque conversion,
// et une entrée modifiée la change.
#[test]
fn trois_imports_dun_obj_rendent_la_meme_cle() {
    let root = scratch("identite", "obj");
    let obj = obj_source(&root, "obj", "newmtl Uni\nKd 1 1 1\n");
    let [une, deux, trois] = trois_cles(&obj, "identite-obj");
    assert_eq!(
        une, deux,
        "deux conversions des mêmes octets, une seule clé"
    );
    assert_eq!(deux, trois, "la troisième non plus ne dérive pas");

    fs::write(obj.with_file_name("scene.mtl"), "newmtl Uni\nKd 0 1 0\n").expect("mtl");
    let modifiee = cle_dans_un_cache_neuf(&obj, "identite-obj-mtl");
    assert_ne!(une, modifiee, "une bibliothèque modifiée change la clé");
    fs::remove_dir_all(root).expect("nettoyage");
}

// Comportement : un pilote de scène — la couche USD — rend lui aussi la même clé à chaque
// conversion, et une couche modifiée la change.
#[test]
fn trois_imports_dune_couche_usd_rendent_la_meme_cle() {
    let couche = wrap("", QUAD);
    let cles: Vec<String> = (0..3)
        .map(|_| {
            compile_layer("identite-usd", &couche).result["key"]
                .as_str()
                .expect("clé")
                .to_string()
        })
        .collect();
    assert_eq!(cles[0], cles[1], "deux conversions, une seule clé");
    assert_eq!(cles[1], cles[2], "la troisième non plus ne dérive pas");

    let autre = compile_layer(
        "identite-usd-autre",
        &wrap("", &QUAD.replace("(1, 1, 0)", "(2, 1, 0)")),
    );
    assert_ne!(
        cles[0],
        autre.result["key"].as_str().expect("clé"),
        "une couche modifiée change la clé"
    );
}

// Comportement : les options du compilateur restent dans l'identité — deux budgets de triangles
// donnent deux produits, donc deux clés.
#[test]
fn une_option_modifiee_change_la_cle() {
    let (root, options) = fixture();
    let premiere = compile(&options, |_| {}).expect("compile")["key"]
        .as_str()
        .expect("clé")
        .to_string();
    let autres = Options {
        triangle_budget: options.triangle_budget + 1,
        cache: root.join("cache-autre"),
        ..options.clone()
    };
    let seconde = compile(&autres, |_| {}).expect("compile")["key"]
        .as_str()
        .expect("clé")
        .to_string();
    assert_ne!(premiere, seconde, "un budget changé change la clé");
    fs::remove_dir_all(root).expect("nettoyage");
}
