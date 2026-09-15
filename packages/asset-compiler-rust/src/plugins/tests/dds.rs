//! La dorée du pilote DDS : chaque codec déclaré, décodé depuis un conteneur écrit octet par octet
//! dans `bytes.rs`, doit rendre exactement les pixels RGBA8 écrits en clair ici. Les valeurs de
//! référence viennent de la spécification, pas du décodeur : l'interpolation entière des blocs BCn
//! est posée à la main, donc un décodeur qui arrondirait autrement se verrait immédiatement.
//!
//! Deux fichiers réels du corpus complètent la dorée : un BC1 de 256 × 256 à neuf niveaux, qui
//! prouve que l'entête d'un encodeur tiers se lit et que la chaîne de mips est comptée, et un DDS
//! tronqué, qui prouve qu'un fichier coupé ressort en raison de rapport.
use super::super::image as registry;

mod bytes;
mod refus;
mod sans_compression;

const MAX_ALLOC: u64 = 64 * 1024 * 1024;
/// Les blocs BCn couvrent 4 × 4 pixels : la dorée en pose exactement un par codec.
const SIDE: u32 = 4;

/// Les indices de couleur, un par pixel : chaque ligne décale d'un cran, donc les quatre couleurs
/// du bloc apparaissent dans les quatre lignes et aucune position n'est privilégiée.
const ORDER: [u8; 16] = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
/// Les indices d'une rampe à trois bits : les huit valeurs, deux fois.
const RAMP: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];
/// Les indices d'alpha à quatre bits de BC2, étendus par la spécification en `v << 4 | v`.
const NIBBLES: [u8; 16] = [15, 0, 8, 4, 0, 8, 4, 15, 8, 4, 15, 0, 4, 15, 0, 8];

/// Les quatre couleurs du bloc BC1 de la dorée. Les bornes sont le rouge pur `0xf800` et le bleu
/// pur `0x001f` en 565 ; `couleur0 > couleur1`, donc les deux couleurs du milieu sont les tiers
/// entiers que la spécification définit : (2·c0 + c1)/3 puis (c0 + 2·c1)/3.
const COLORS: [[u8; 3]; 4] = [[255, 0, 0], [0, 0, 255], [170, 0, 85], [85, 0, 170]];
/// La rampe d'alpha de bornes 255 et 0 : `borne0 > borne1`, donc les six septièmes entiers.
const ALPHA: [u8; 8] = [255, 0, 218, 182, 145, 109, 72, 36];
/// La rampe de bornes 200 et 100, sur le second canal de BC5.
const GREEN: [u8; 8] = [200, 100, 185, 171, 157, 142, 128, 114];

/// Décode un conteneur par le registre et compare ses pixels, un par un, à la référence.
fn check(case: &str, file: &[u8], expected: &[[u8; 4]]) {
    let decoder = registry::by_head(file).expect("un pilote revendique ces octets");
    assert_eq!(decoder.name(), "dds", "{case}");
    let image = super::rgba8(
        registry::decode(file, MAX_ALLOC).unwrap_or_else(|reason| panic!("{case}: {reason}")),
    );
    assert_eq!((image.width(), image.height()), (SIDE, SIDE), "{case}");
    assert_eq!(
        image.pixels().map(|pixel| pixel.0).collect::<Vec<_>>(),
        expected,
        "{case}"
    );
}

/// Les couleurs du bloc BC1, opaques : ce que rendent BC1, BC2 et BC3 pour leurs canaux RGB.
fn colors() -> Vec<[u8; 4]> {
    ORDER
        .iter()
        .map(|index| {
            let [red, green, blue] = COLORS[*index as usize];
            [red, green, blue, 255]
        })
        .collect()
}

/// Le bloc BC7 de la dorée, en mode 6 : deux bornes RGBA de sept bits plus un bit P, puis les
/// indices de quatre bits — trois seulement pour le premier pixel, dont la spécification implique
/// le bit de poids fort. Les indices 0 et 15 tombent sur les poids 0 et 64, donc exactement sur
/// une borne : aucune interpolation n'entre dans la référence.
fn bc7_block() -> [u8; 16] {
    let mut bits = bytes::Bits::new();
    bits.put(0, 6).put(1, 1);
    for value in [127, 0, 0, 127, 0, 0, 127, 63] {
        bits.put(value, 7);
    }
    bits.put(0, 1).put(0, 1).put(0, 3);
    for pixel in 1..16 {
        bits.put(if pixel % 2 == 1 { 15 } else { 0 }, 4);
    }
    bits.block()
}

// Dorée du pilote DDS : les six codecs compressés que le pilote déclare rendent, pixel par pixel,
// la reconstruction entière de la spécification. Sans perte veut dire : pas un octet de plus.
#[test]
fn chaque_codec_compresse_declare_rend_les_pixels_de_la_reference() {
    let colors = colors();
    let color_block = bytes::color_block(ORDER);
    let red = bytes::ramp_block(255, 0, RAMP);
    let mut bc2 = bytes::indices(NIBBLES, 4);
    bc2.extend_from_slice(&color_block);
    let mut bc3 = red.clone();
    bc3.extend_from_slice(&color_block);
    let mut bc5 = red.clone();
    bc5.extend_from_slice(&bytes::ramp_block(200, 100, RAMP));
    let with_alpha = |source: &[u8; 16], table: &[u8]| -> Vec<[u8; 4]> {
        colors
            .iter()
            .zip(source)
            .map(|([red, green, blue, _], index)| [*red, *green, *blue, table[*index as usize]])
            .collect()
    };
    let expanded: Vec<u8> = NIBBLES.iter().map(|value| value << 4 | value).collect();
    let nibble_alpha: Vec<[u8; 4]> = colors
        .iter()
        .zip(&expanded)
        .map(|([red, green, blue, _], alpha)| [*red, *green, *blue, *alpha])
        .collect();
    for (case, tag, payload, expected) in [
        ("bc1", b"DXT1", color_block.clone(), colors.clone()),
        ("bc2", b"DXT3", bc2, nibble_alpha),
        ("bc3", b"DXT5", bc3, with_alpha(&RAMP, &ALPHA)),
        (
            "bc4",
            b"ATI1",
            red.clone(),
            RAMP.map(|index| [ALPHA[index as usize], 0, 0, 255])
                .to_vec(),
        ),
        (
            "bc5",
            b"ATI2",
            bc5,
            RAMP.map(|index| [ALPHA[index as usize], GREEN[index as usize], 0, 255])
                .to_vec(),
        ),
    ] {
        let file = bytes::container(bytes::fourcc_format(tag), SIDE, SIDE, 1, &payload);
        check(case, &file, &expected);
    }
    // BC7 n'a pas de `dwFourCC` : il ne se nomme que par le `dxgiFormat` de l'entête DX10.
    let bc7: Vec<[u8; 4]> = (0..16)
        .map(|pixel| {
            if pixel % 2 == 0 {
                [254, 0, 0, 254]
            } else {
                [0, 254, 0, 126]
            }
        })
        .collect();
    check("bc7", &bytes::dx10(98, SIDE, SIDE, &bc7_block()), &bc7);
    // Les mêmes blocs nommés par DX10 plutôt que par `dwFourCC` donnent les mêmes pixels.
    check(
        "dxgi bc1",
        &bytes::dx10(71, SIDE, SIDE, &color_block),
        &colors,
    );
}
