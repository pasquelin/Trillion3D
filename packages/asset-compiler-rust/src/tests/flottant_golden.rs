//! Dorées des deux pilotes flottants, par le chemin complet : une scène glTF réelle dont l'unique
//! texture couleur est un EXR ou un Radiance HDR, compilée par le harnais commun.
//!
//! Ce que ces dorées fixent n'est pas une image mais un **refus** : les aperçus progressifs sont du
//! RGBA8 sRGB, une image flottante n'y entre pas sans report de tons, donc sans perte ajoutée. La
//! compilation aboutit, la texture est comptée, et la raison `image-float-unsupported` est nommée
//! au rapport. Les valeurs décodées, elles, se prouvent dans `src/plugins/tests/`.
use super::*;

// Comportement : une texture flottante traverse le compilateur sans le faire échouer et sans être
// rognée à huit bits ; elle est nommée au rapport des aperçus, par la raison du contrat d'image.
#[test]
fn une_texture_flottante_est_nommee_au_rapport_plutot_que_ramenee_a_huit_bits() {
    for format in ["exr", "hdr"] {
        let fixture_dir = golden_dir(format);
        let run = compile_golden(&fixture_dir, "scene");
        assert_eq!(
            float_digest(&run),
            golden_expected(&fixture_dir),
            "fixture {format}: la sortie compilée diverge de expected.json"
        );
    }
}

/// Ce que la dorée compare : le contrat d'image que ce binaire publie, le pilote qui revendique la
/// texture, le rapport des aperçus — d'où vient le refus nommé — et la scène elle-même.
fn float_digest(run: &GoldenRun) -> Value {
    json!({
      "imageContract": plugins::image::VERSION,
      "report": run.result["texturePreviews"],
      "scene": {
        "formatVersion": run.result["formatVersion"],
        "manifestBinaryVersion": run.slim["binary"]["version"],
        "sidecarSha256": hash(&run.binary),
        "primitives": run.result["primitives"].as_array().expect("primitives").len(),
        "selectedTriangles": run.result["selectedTriangles"],
        "texturePreviewBytes": run.slim["binary"]["texturePreviewBytes"],
      },
    })
}
