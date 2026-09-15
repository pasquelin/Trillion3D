//! Doré du pilote `psd` : la seule couverture du chemin complet glTF réel → `compile()` → cache →
//! sidecar binaire pour une texture Photoshop. Les tests en éprouvette de `plugins/tests/psd.rs`
//! fixent ce que le pilote rend pixel par pixel ; celui-ci fixe les octets qu'un moteur lira
//! vraiment, une fois le composite aplati passé par le compilateur entier.
//!
//! La scène est le quad de la dorée flottante, sa couleur de base remplacée par `rgb-brut.psd` :
//! une texture PSD entre dans les aperçus progressifs comme n'importe quelle source de huit bits,
//! sans refus et sans perte ajoutée. La provenance de la fixture est dans `fixtures/psd/README.md`.
//!
//! Régénération de l'attendu, depuis la racine du dépôt :
//!
//! ```text
//! cargo test --release --manifest-path packages/asset-compiler-rust/Cargo.toml \
//!   -- --ignored regenere_la_fixture_psd --nocapture
//! npx prettier --write packages/asset-compiler-rust/fixtures/psd/expected.json
//! ```
//!
//! Ignorée par défaut : elle écrit dans `fixtures/`. Le diff qu'elle produit se relit avant d'être
//! commité — un attendu régénéré sans lecture ne surveille plus rien.
use super::apercus_golden::previews_digest;
use super::*;

const CASE: &str = "Un quad dont la couleur de base est rgb-brut.psd, un composite Photoshop aplati de 4 × 2 en RVB huit bits à surface brute, compilé par le harnais commun.";
const RULE: &str = "Un composite aplati de huit bits par canal entre dans les aperçus progressifs comme toute autre source RGBA8 : la queue sans perte de sa chaîne de mips est produite, aucune raison n'est portée au rapport, et les pixels sont ceux que le fichier portait déjà — jamais des calques recomposés.";

// Comportement : la fixture dorée à texture PSD passe par le compilateur et chaque octet de ses
// aperçus est comparé à expected.json — provenance, géométrie des niveaux, pixels et couverture.
#[test]
fn psd_texture_previews_match_their_golden_expected_json() {
    let dir = golden_dir("psd");
    let run = compile_golden(&dir, "scene");
    assert_eq!(
        previews_digest(&run),
        golden_expected(&dir),
        "fixture psd : les aperçus de texture divergent de expected.json"
    );
}

#[test]
#[ignore = "écrit dans fixtures/ ; se relance à la main, et son diff se relit"]
fn regenere_la_fixture_psd() {
    let dir = golden_dir("psd");
    let run = compile_golden(&dir, "scene");
    write_expected(&dir, previews_digest(&run), CASE, RULE);
}
