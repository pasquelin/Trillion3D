//! What sheet and page display: one row per IMAGE, never per binding.
use super::*;
use crate::texture_preview::{AtlasKind, PreviewSource, TexturePreview};

/// 1×1 preview of given image, cited by texture .
fn apercu(texture: u32, image: u32, sha256: &str) -> TexturePreview {
    TexturePreview {
        texture,
        image,
        width: 1,
        height: 1,
        source: PreviewSource::Uri,
        sha256: sha256.into(),
        kind: AtlasKind::Color,
        first_level: 0,
        baked_levels: 0,
        pixels: vec![10, 20, 30, 40],
    }
}

fn forme() -> AlphaShape {
    AlphaShape {
        texels: 1,
        absent: 0.5,
        present: 0.4,
        between: 0.1,
        at_contour: 1.0,
    }
}

// Behavior: two textures citing same image — same foliage under two
// samplers — make one row, blend primitives they hold
// sum up. Otherwise page would put two switches on single answer, checking
// one unchecking the other.
#[test]
fn deux_textures_dune_meme_image_ne_font_quune_ligne() {
    let g = json!({ "images": [{ "uri": "dossier/feuillage.png" }] });
    let previews = [apercu(3, 0, "abc"), apercu(7, 0, "abc")];
    let measures = BTreeMap::from([(3usize, forme()), (7usize, forme())]);
    let weights = BTreeMap::from([(3usize, 2u64), (7usize, 3u64)]);
    let decisions = load_decisions(Path::new("/introuvable"), Path::new("/introuvable"))
        .expect("aucune feuille");
    let entries = entries(&g, &previews, &measures, &decisions, &weights);
    assert_eq!(entries.len(), 1, "une image, une ligne");
    assert_eq!(
        entries[0].weight, 5,
        "les primitives des deux liaisons s'additionnent"
    );
    assert_eq!(
        entries[0].name, "dossier/feuillage.png",
        "the full relative URI, so the texture is found at full resolution"
    );
}

// Comportement : deux images distinctes gardent deux lignes, et chacune son interrupteur.
#[test]
fn deux_images_distinctes_gardent_deux_lignes() {
    let g = json!({ "images": [{ "uri": "a.png" }, { "uri": "b.png" }] });
    let previews = [apercu(0, 0, "abc"), apercu(1, 1, "def")];
    let measures = BTreeMap::from([(0usize, forme()), (1usize, forme())]);
    let decisions = load_decisions(Path::new("/introuvable"), Path::new("/introuvable"))
        .expect("aucune feuille");
    let entries = entries(&g, &previews, &measures, &decisions, &BTreeMap::new());
    assert_eq!(entries.len(), 2);
}
