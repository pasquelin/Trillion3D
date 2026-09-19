//! A13 — The final key hashed every byte of the import manifest, metrics included.
//! Conversion timing entered it: three compilations of the same files, with the
//! same intermediate glTF bytes and the same import key, yielded three distinct
//! final keys. The source path entered too — the compiling machine, not the
//! compiled scene.
use super::usd_driver::{compile_layer, wrap, QUAD};
use super::*;

/// Key exposed by a compilation of `source` in a fresh cache: it is from cache
/// to cache, not from a cache already served to itself, that an unstable key shows.
fn cle_dans_un_cache_neuf(source: &Path, tag: &str) -> String {
    compile_golden_source(source, tag).result["key"]
        .as_str()
        .expect("key")
        .to_string()
}

/// Three keys in a row for the same source, each in its own cache.
fn trois_cles(source: &Path, tag: &str) -> [String; 3] {
    [
        cle_dans_un_cache_neuf(source, tag),
        cle_dans_un_cache_neuf(source, tag),
        cle_dans_un_cache_neuf(source, tag),
    ]
}

// Behaviour: a native driver — ufbx import of an OBJ — yields the same key on
// every conversion, and a modified input changes it.
#[test]
fn trois_imports_dun_obj_rendent_la_meme_cle() {
    let root = scratch("identite", "obj");
    let obj = obj_source(&root, "obj", "newmtl Uni\nKd 1 1 1\n");
    let [une, deux, trois] = trois_cles(&obj, "identite-obj");
    assert_eq!(une, deux, "two conversions of the same bytes, one key");
    assert_eq!(deux, trois, "the third does not drift either");

    fs::write(obj.with_file_name("scene.mtl"), "newmtl Uni\nKd 0 1 0\n").expect("mtl");
    let modifiee = cle_dans_un_cache_neuf(&obj, "identite-obj-mtl");
    assert_ne!(une, modifiee, "a modified library changes the key");
    fs::remove_dir_all(root).expect("nettoyage");
}

// Behaviour: a scene driver — the USD layer — also yields the same key on every
// conversion, and a modified layer changes it.
#[test]
fn trois_imports_dune_couche_usd_rendent_la_meme_cle() {
    let couche = wrap("", QUAD);
    let cles: Vec<String> = (0..3)
        .map(|_| {
            compile_layer("identite-usd", &couche).result["key"]
                .as_str()
                .expect("key")
                .to_string()
        })
        .collect();
    assert_eq!(cles[0], cles[1], "two conversions, one key");
    assert_eq!(cles[1], cles[2], "the third does not drift either");

    let autre = compile_layer(
        "identite-usd-autre",
        &wrap("", &QUAD.replace("(1, 1, 0)", "(2, 1, 0)")),
    );
    assert_ne!(
        cles[0],
        autre.result["key"].as_str().expect("key"),
        "a modified layer changes the key"
    );
}

// Behaviour: compiler options stay in identity — two triangle budgets yield two
// products, therefore two keys.
#[test]
fn une_option_modifiee_change_la_cle() {
    let (root, options) = fixture();
    let premiere = compile(&options, |_| {}).expect("compile")["key"]
        .as_str()
        .expect("key")
        .to_string();
    let autres = Options {
        triangle_budget: options.triangle_budget + 1,
        cache: root.join("cache-autre"),
        ..options.clone()
    };
    let seconde = compile(&autres, |_| {}).expect("compile")["key"]
        .as_str()
        .expect("key")
        .to_string();
    assert_ne!(premiere, seconde, "a changed budget changes the key");
    fs::remove_dir_all(root).expect("nettoyage");
}
