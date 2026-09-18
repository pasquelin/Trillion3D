//! Doré des aperçus progressifs : la seule couverture du chemin complet glTF réel → `compile()` →
//! cache → sidecar binaire pour la section `texturePreviews`. Les tests en éprouvette de
//! `texture_preview/tests/` fixent la math sur des images construites en mémoire ; celui-ci fixe
//! les octets qu'un moteur lira vraiment, décodeur PNG et JPEG compris.
use super::*;

/// Colonnes du sidecar, dans l'ordre que `packages/sdk-core/manifestBinaryFormat.ts` publie sous
/// `COLUMN_NAMES`. Le doré les relit par leur rang, comme un lecteur extérieur, sans emprunter les
/// constantes privées de l'écrivain : un rang qui bouge est un changement de format, pas un détail.
const HEADER_WORDS: usize = 4;
const TEXTURE_PREVIEW_U32: usize = 21;
const TEXTURE_PREVIEW_SHA: usize = 22;
const TEXTURE_PREVIEW_PIXELS: usize = 23;
/// Nombres par entrée : texture, image, largeur, hauteur, genre et vue de provenance, premier
/// niveau, nombre de niveaux, début et longueur des pixels, atlas, niveaux cuits en fichiers.
const PREVIEW_WORDS: usize = 12;
/// `alphaCutoff` du matériau MASK de la fixture, en octet : 0,25 × 255 arrondi. Compter les texels
/// qui l'atteignent à chaque niveau dit d'un coup d'œil si la couverture du masque a été préservée,
/// et si l'alpha des deux textures non masquées est resté intact.
const MASK_CUTOFF_BYTE: u8 = 64;

// Comportement 24 : la fixture dorée à textures passe par le compilateur et chaque octet de ses
// aperçus est comparé à expected.json — provenance, géométrie des niveaux, pixels et couverture.
#[test]
fn texture_previews_match_their_golden_expected_json() {
    let fixture_dir = golden_dir("apercus/atlas-couleur");
    let run = compile_golden(&fixture_dir, "atlas-couleur");
    assert_eq!(
        previews_digest(&run),
        golden_expected(&fixture_dir),
        "fixture atlas-couleur: les aperçus de texture divergent de expected.json"
    );
}

/// Le condensé que le doré compare : le rapport de l'étape, les compteurs du manifeste mince, puis
/// pour chaque entrée du sidecar sa provenance et chacun de ses niveaux octet par octet.
pub(super) fn previews_digest(run: &GoldenRun) -> Value {
    let bytes = &run.binary;
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("mot"));
    let column = |index: usize| {
        let at = (HEADER_WORDS + index * 2) * 4;
        (word(at) as usize, word(at + 4) as usize)
    };
    let (words_at, words_len) = column(TEXTURE_PREVIEW_U32);
    let (sha_at, _) = column(TEXTURE_PREVIEW_SHA);
    let (pixels_at, _) = column(TEXTURE_PREVIEW_PIXELS);
    let previews: Vec<Value> = (0..words_len / (PREVIEW_WORDS * 4))
        .map(|entry| {
            let base = words_at + entry * PREVIEW_WORDS * 4;
            let sha = &bytes[sha_at + entry * 64..sha_at + entry * 64 + 64];
            entry_digest(
                bytes,
                base,
                pixels_at,
                std::str::from_utf8(sha).expect("sha"),
                word,
            )
        })
        .collect();
    json!({
      "formatVersion": run.result["formatVersion"],
      "manifestBinaryVersion": run.slim["binary"]["version"],
      "textures": run.slim["textures"],
      "report": run.result["texturePreviews"],
      "binary": {
        "texturePreviews": run.slim["binary"]["texturePreviews"],
        "texturePreviewBytes": run.slim["binary"]["texturePreviewBytes"],
      },
      "previews": previews,
    })
}

/// Une entrée : les douze nombres qu'elle déclare, le condensé de son image source, et la suite de
/// ses niveaux découpée aux dimensions que `preview_level_size` redéduit — jamais à celles annoncées.
fn entry_digest(
    bytes: &[u8],
    base: usize,
    pixels_at: usize,
    sha256: &str,
    word: impl Fn(usize) -> u32,
) -> Value {
    let (width, height) = (word(base + 8), word(base + 12));
    let first = word(base + 24);
    let mut at = pixels_at + word(base + 32) as usize;
    let mut levels = Vec::new();
    for level in first..first + word(base + 28) {
        let (w, h) = texture_preview::preview_level_size(width, height, level);
        let end = at + (w as usize) * (h as usize) * 4;
        levels.push(level_digest(level, w, h, &bytes[at..end]));
        at = end;
    }
    json!({
      "texture": word(base), "image": word(base + 4), "width": width, "height": height,
      "sourceKind": word(base + 16), "sourceView": word(base + 20),
      "firstLevel": first, "levelCount": word(base + 28),
      "pixelOffset": word(base + 32), "pixelBytes": word(base + 36),
      "atlas": word(base + 40), "bakedLevels": word(base + 44),
      "sourceSha256": sha256, "levels": levels,
    })
}

/// Un niveau : ses dimensions, le condensé de tous ses octets — un seul qui change fait rougir le
/// doré — puis cinq texels et la couverture au seuil, pour que le diff dise *où* le calcul a bougé.
fn level_digest(level: u32, w: u32, h: u32, texels: &[u8]) -> Value {
    let texel = |x: u32, y: u32| {
        let at = ((y * w + x) * 4) as usize;
        json!(&texels[at..at + 4])
    };
    let covered = texels
        .iter()
        .skip(3)
        .step_by(4)
        .filter(|alpha| **alpha >= MASK_CUTOFF_BYTE)
        .count();
    json!({
      "level": level, "size": [w, h], "sha256": hash(texels), "coveredAtMaskCutoff": covered,
      "samples": [texel(0, 0), texel(w - 1, 0), texel(0, h - 1), texel(w - 1, h - 1),
                  texel(w / 2, h / 2)],
    })
}
