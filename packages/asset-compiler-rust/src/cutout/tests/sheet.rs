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
        layouts: [None; 2],
        blocks: [Vec::new(), Vec::new()],
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
fn two_textures_of_one_image_make_a_single_row() {
    let g = json!({ "images": [{ "uri": "dossier/feuillage.png" }] });
    let previews = [apercu(3, 0, "abc"), apercu(7, 0, "abc")];
    let measures = BTreeMap::from([(3usize, forme()), (7usize, forme())]);
    let weights = BTreeMap::from([(3usize, 2u64), (7usize, 3u64)]);
    let decisions =
        load_decisions(Path::new("/introuvable"), Path::new("/introuvable")).expect("no sheet");
    let entries = entries(&g, &previews, &measures, &decisions, &weights);
    assert_eq!(entries.len(), 1, "one image, one line");
    assert_eq!(
        entries[0].weight, 5,
        "primitives of both bindings are summed"
    );
    assert_eq!(
        entries[0].name, "dossier/feuillage.png",
        "the full relative URI, so the texture is found at full resolution"
    );
}

// Behaviour: two distinct images keep two lines, and each has its own switch.
#[test]
fn two_distinct_images_keep_two_rows() {
    let g = json!({ "images": [{ "uri": "a.png" }, { "uri": "b.png" }] });
    let previews = [apercu(0, 0, "abc"), apercu(1, 1, "def")];
    let measures = BTreeMap::from([(0usize, forme()), (1usize, forme())]);
    let decisions =
        load_decisions(Path::new("/introuvable"), Path::new("/introuvable")).expect("no sheet");
    let entries = entries(&g, &previews, &measures, &decisions, &BTreeMap::new());
    assert_eq!(entries.len(), 2);
}
