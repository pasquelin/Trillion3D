//! Dorées des pilotes BMP et GIF, par le chemin complet : une scène glTF réelle dont l'unique
//! texture couleur est un BMP bas-haut, puis un GIF indexé, compilée par le harnais commun.
//!
//! Ce que ces dorées fixent, que les tests en éprouvette de `plugins/tests/` ne peuvent pas fixer,
//! c'est l'image telle qu'un moteur la lira : les octets des aperçus progressifs, après que le
//! compilateur entier soit passé. C'est là que l'ordre des lignes d'un BMP se prouve vraiment — une
//! image stockée de bas en haut et remise à l'endroit ne se distingue d'une image retournée que
//! lorsqu'on regarde les pixels arrivés au bout de la chaîne.
//!
//! Régénération de l'attendu, depuis la racine du dépôt :
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_les_fixtures_bmp_et_gif --nocapture
//! npx prettier --write packages/asset-compiler-rust/fixtures/bmp/expected.json \
//!   packages/asset-compiler-rust/fixtures/gif/expected.json
//! ```
//!
//! Ignorée par défaut : elle écrit dans `fixtures/`. Le diff qu'elle produit se relit avant d'être
//! commité — un attendu régénéré sans lecture ne surveille plus rien.
use super::apercus_golden::previews_digest;
use super::*;

/// Les deux fixtures et la phrase qui dit ce que chacune met sous surveillance. La scène et son
/// binaire sont les mêmes des deux côtés — un quad, deux triangles, la texture sur toute sa face —
/// pour que la seule différence entre les deux attendus soit le format de l'image.
const FIXTURES: [(&str, &str); 2] = [
    (
        "bmp",
        "Un quad dont la couleur de base est vraies-couleurs-24-bas.bmp, un BMP 4 × 2 en vraies couleurs 24 bits stocké de bas en haut, compilé par le harnais commun.",
    ),
    (
        "gif",
        "Un quad dont la couleur de base est palette-globale.gif, un GIF 4 × 2 indexé sur une table de couleurs globale de huit entrées, compilé par le harnais commun.",
    ),
];
const RULE: &str = "Chaque texture couleur porte la queue sans perte de sa chaîne de mips, du premier niveau dont aucun côté ne dépasse 64 jusqu'au 1×1, en RGBA8 sRGB à alpha droit. Ni le BMP ni le GIF n'ajoutent de perte : le premier est lu tel quel et remis dans l'ordre de l'image, le second est indexé, et une table de couleurs porte déjà du 8-8-8.";

// Comportement : les deux formats hérités du web traversent le compilateur entier, et chaque octet
// de leurs aperçus est comparé à expected.json — provenance, géométrie des niveaux et pixels.
#[test]
fn les_apercus_des_deux_formats_herites_suivent_leur_expected_json() {
    for (format, _) in FIXTURES {
        let dir = golden_dir(format);
        let run = compile_golden(&dir, "scene");
        assert_eq!(
            previews_digest(&run),
            golden_expected(&dir),
            "fixture {format} : les aperçus de texture divergent de expected.json"
        );
    }
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_les_fixtures_bmp_et_gif() {
    for (format, case) in FIXTURES {
        let dir = golden_dir(format);
        let run = compile_golden(&dir, "scene");
        write_expected(&dir, previews_digest(&run), case, RULE);
    }
}
