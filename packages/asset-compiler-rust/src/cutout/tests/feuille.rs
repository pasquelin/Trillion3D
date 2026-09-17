//! Ce que la feuille et la page montrent : une ligne par IMAGE, jamais une par liaison.
use super::*;
use crate::texture_preview::{AtlasKind, PreviewSource, TexturePreview};

/// Un aperçu 1×1 d'une image donnée, cité par la texture `texture`.
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

// Comportement : deux textures qui citent la même image — le même feuillage sous deux
// échantillonneurs — ne font qu'une ligne, et ce qu'elles tiennent de primitives en mélange
// s'additionne. Sans cela la page poserait deux interrupteurs sur une seule réponse, et cocher
// l'un décocherait l'autre.
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
        "l'URI relative entière, pour que la texture se retrouve en pleine résolution"
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
