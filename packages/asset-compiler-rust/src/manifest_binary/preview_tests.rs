use super::*;
use crate::texture_preview::PreviewSource;

fn templates() -> Templates<'static> {
    Templates {
        binary: "clusters.bin",
        page: "../../objects/{sha}.bin",
        geometry: "../../objects/{sha}.bin",
        bundle: "../../objects/{sha}.bin",
    }
}
fn preview(texture: u32, width: u32, height: u32, fill: u8) -> TexturePreview {
    TexturePreview {
        texture,
        image: texture,
        width,
        height,
        source: PreviewSource::Uri,
        sha256: std::iter::repeat_n('a', 64).collect(),
        first_level: preview_first_level(width, height),
        pixels: vec![fill; preview_pixel_bytes(width, height)],
    }
}

// Comportement 9 (a) : le sidecar fait l'aller-retour écriture/lecture de la section des aperçus —
// chaque champ écrit par `split` se relit identique à l'octet près, sans passer par un décodeur.
#[test]
fn texture_previews_round_trip_through_the_binary_columns() {
    let previews = vec![preview(0, 32, 16, 11), preview(3, 8, 8, 222)];
    let (_, bytes) = split(&json!({"primitives": []}), &templates(), &previews).expect("split");
    let word = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let column = |index: usize| {
        let at = (HEADER_WORDS + index * 2) * 4;
        (word(at) as usize, word(at + 4) as usize)
    };
    let (words_off, words_len) = column(TEXTURE_PREVIEW_U32);
    let (sha_off, _) = column(TEXTURE_PREVIEW_SHA);
    let (pixels_off, _) = column(TEXTURE_PREVIEW_PIXELS);
    assert_eq!(words_len, previews.len() * PREVIEW_WORDS * 4);
    let mut offset = 0usize;
    for (entry, source) in previews.iter().enumerate() {
        let base = words_off + entry * PREVIEW_WORDS * 4;
        assert_eq!(word(base), source.texture);
        assert_eq!(word(base + 4), source.image);
        assert_eq!(word(base + 8), source.width);
        assert_eq!(word(base + 12), source.height);
        assert_eq!(word(base + 16), source.source.kind());
        assert_eq!(word(base + 20), source.source.buffer_view());
        assert_eq!(word(base + 24), source.first_level);
        assert_eq!(
            word(base + 28),
            preview_level_count(source.width, source.height)
        );
        let sha = std::str::from_utf8(&bytes[sha_off + entry * 64..sha_off + entry * 64 + 64])
            .expect("ascii");
        assert_eq!(sha, source.sha256);
        // La plage d'octets de l'entrée est celle que l'entrée déclare, et elle suit la précédente.
        let (start, length) = (word(base + 32) as usize, word(base + 36) as usize);
        assert_eq!(start, offset);
        assert_eq!(length, source.pixels.len());
        assert_eq!(
            &bytes[pixels_off + start..pixels_off + start + length],
            source.pixels.as_slice()
        );
        offset += length;
    }
}

// Comportement 9 (b) : un fichier d'une version antérieure (ici 3, les aperçus de longueur fixe)
// est refusé d'emblée, jamais lu comme s'il avait la nouvelle section.
#[test]
fn a_sidecar_of_an_older_version_is_refused() {
    let (_, bytes) = split(&json!({"primitives": []}), &templates(), &[]).expect("split");
    let mut old = bytes.clone();
    old[4..8].copy_from_slice(&3u32.to_le_bytes());
    assert!(digests(&old).is_err());
}

// Comportement 9 (c) : un index de texture qui ne progresse pas est refusé.
#[test]
fn encode_previews_rejects_a_decreasing_texture_index() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let previews = vec![preview(3, 4, 4, 1), preview(2, 4, 4, 1)];
    let error =
        crate::manifest_binary::preview::encode_previews(&previews, &mut columns).unwrap_err();
    assert_eq!(error.code, "INVALID_MANIFEST");
}

// Comportement 9 (d) : une dimension source nulle est refusée.
#[test]
fn encode_previews_rejects_a_null_dimension() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let previews = vec![preview(0, 0, 4, 1)];
    assert!(crate::manifest_binary::preview::encode_previews(&previews, &mut columns).is_err());
}

// Comportement 9 (e) : un mauvais nombre d'octets de pixels — donc un décalage de niveau faux vu
// depuis les constantes de niveau — est refusé.
#[test]
fn encode_previews_rejects_the_wrong_pixel_byte_length() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let mut malformed = preview(0, 4, 4, 1);
    malformed.pixels.pop();
    assert!(crate::manifest_binary::preview::encode_previews(&[malformed], &mut columns).is_err());
}

// Comportement 9 (f) : une entrée dont le premier niveau annoncé ne correspond pas à ses dimensions
// est refusée, même quand ses octets de pixels ont la bonne longueur pour ce premier niveau erroné
// n'étant pas en cause : c'est bien la géométrie déclarée, pas la taille des pixels, qui ment ici.
#[test]
fn encode_previews_rejects_a_first_level_that_disagrees_with_the_dimensions() {
    let mut columns: Vec<Column> = (0..COLUMNS).map(|_| Column::default()).collect();
    let mut malformed = preview(0, 128, 128, 1);
    malformed.first_level += 1;
    let error =
        crate::manifest_binary::preview::encode_previews(&[malformed], &mut columns).unwrap_err();
    assert_eq!(error.code, "INVALID_MANIFEST");
}
