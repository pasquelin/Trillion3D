//! La dorée du pilote KTX 2.0 : ce que le conteneur porte doit ressortir texel pour texel.
//!
//! Elle travaille sur deux matières. Les fichiers de `fixtures/ktx2/` couvrent les trois chemins du
//! pilote de bout en bout — un niveau non compressé, le même sous supercompression Zstandard, et
//! les deux charges Basis Universal, UASTC LDR et ETC1S. Les conteneurs minuscules de `bytes.rs`,
//! écrits champ par champ depuis la spécification, couvrent les codecs nommés par `vkFormat` : les
//! valeurs de référence y viennent de la spécification du codec, pas du décodeur.
//!
//! Ce que la dorée ne refait pas : l'interpolation entière des blocs BCn, déjà fixée bloc par bloc
//! par la dorée du pilote `dds`, qui passe par le même socle `image::blocks` et le même décodeur.
//! Ici on fixe ce qui est propre à KTX2 — quel `vkFormat` mène à quel codec, et la géométrie de son
//! bloc, prouvée par l'octet qui manque.
use super::super::image as registry;
use super::fixture;

mod bytes;
mod codecs;
mod refus;

const MAX_ALLOC: u64 = 64 * 1024 * 1024;
/// Les blocs des codecs déclarés couvrent 4 × 4 texels : la dorée en pose exactement un par cas.
const SIDE: u32 = 4;
/// `VK_FORMAT_R8G8B8A8_SRGB`, `VK_FORMAT_BC1_RGB_UNORM_BLOCK`, `VK_FORMAT_BC1_RGBA_UNORM_BLOCK` et
/// `VK_FORMAT_ASTC_4x4_UNORM_BLOCK`, les quatre formats dont la dorée écrit les texels en clair.
const RGBA8_SRGB: u32 = 43;
const BC1_RGB: u32 = 131;
const BC1_RGBA: u32 = 133;
const ASTC_4X4: u32 = 157;

/// Les indices du bloc BC1 de la dorée : chaque ligne décale d'un cran, donc les quatre couleurs du
/// bloc apparaissent dans les quatre lignes et aucune position n'est privilégiée.
const ORDER: [u8; 16] = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
/// Bleu pur et rouge pur en 565. `couleur0 < couleur1` : la spécification passe alors le bloc en
/// trois couleurs, la troisième est la moyenne entière des deux bornes, et l'indice 3 désigne un
/// texel noir — transparent en `BC1_RGBA`, opaque en `BC1_RGB`.
const BLUE_565: u16 = 0x001f;
const RED_565: u16 = 0xf800;

/// Un conteneur valide qu'un cas de refus met ensuite en défaut, champ par champ.
fn valid() -> Vec<u8> {
    bytes::container(RGBA8_SRGB, SIDE, SIDE, &[0u8; 64])
}

/// Décode un conteneur par le registre, en vérifiant au passage que c'est bien ce pilote qui l'a
/// revendiqué : la dorée ne prouve rien si un autre pilote a répondu.
fn decoded(case: &str, file: &[u8]) -> ::image::RgbaImage {
    let decoder = registry::by_head(file).expect("un pilote revendique ces octets");
    assert_eq!(decoder.name(), "ktx2", "{case}");
    super::rgba8(registry::decode(file, MAX_ALLOC).unwrap_or_else(|reason| panic!("{case}: {reason}")))
}

/// Les texels d'un conteneur, dans l'ordre de lecture.
fn texels(case: &str, file: &[u8]) -> Vec<[u8; 4]> {
    decoded(case, file)
        .pixels()
        .map(|pixel| pixel.0)
        .collect::<Vec<_>>()
}

/// Les seize texels de `base.ktx2` : le dégradé que la fixture écrit en clair, canal par canal.
fn base_texels() -> Vec<[u8; 4]> {
    (0..16u32)
        .map(|texel| {
            let (x, y) = (texel % 4, texel / 4);
            [
                (x * 85) as u8,
                (y * 85) as u8,
                ((x + y) * 42) as u8,
                (255 - (x + y) * 17) as u8,
            ]
        })
        .collect()
}

// Dorée du pilote KTX2 : un niveau non compressé ressort octet pour octet, la supercompression
// Zstandard n'en change pas un texel, et les deux charges Basis Universal se transcodent.
#[test]
fn les_quatre_fichiers_de_la_fixture_se_decodent_chacun_par_son_chemin() {
    let base = fixture("ktx2", "base.ktx2");
    assert_eq!(texels("base", &base), base_texels());
    // La supercompression n'est qu'un emballage : défaite, elle rend exactement les mêmes octets.
    let zstd = fixture("ktx2", "base-zstd.ktx2");
    assert_eq!(texels("base-zstd", &zstd), base_texels());
    // UASTC LDR 4 × 4, découpé au coin supérieur gauche du corpus : seize blocs, seize par seize.
    let uastc = decoded("uastc", &fixture("ktx2", "uastc.ktx2"));
    assert_eq!((uastc.width(), uastc.height()), (16, 16));
    // ETC1S sous supercompression BasisLZ, tel que l'encodeur de Khronos l'a écrit.
    let basis = decoded("basis", &fixture("ktx2", "basis.ktx2"));
    assert_eq!((basis.width(), basis.height()), (256, 256));
    // Les deux charges portent la même image que le corpus a encodée : son coin est un dégradé
    // bleu, et les quatre coins d'une charge avec alpha ne sont jamais tous opaques.
    assert!(basis.get_pixel(0, 0).0[2] > basis.get_pixel(0, 0).0[1]);
}

// Dorée du pilote KTX2 : chaque `vkFormat` non compressé ou en trois couleurs rend les texels que
// la spécification du codec définit, et le bit d'alpha de BC1 sépare bien `_RGB` de `_RGBA`.
#[test]
fn chaque_vkformat_declare_rend_les_texels_de_la_reference() {
    // Non compressé : les octets du niveau sont déjà ceux du contrat, ils ressortent tels quels.
    let level: Vec<u8> = base_texels().into_iter().flatten().collect();
    let plain = bytes::container(RGBA8_SRGB, SIDE, SIDE, &level);
    assert_eq!(texels("rgba8", &plain), base_texels());
    // BC1 en trois couleurs : les deux bornes, leur moyenne entière, puis le texel noir.
    let block = bytes::bc1(BLUE_565, RED_565, ORDER);
    let expect = |black: [u8; 4]| -> Vec<[u8; 4]> {
        let table = [
            [0, 0, 255, 255],
            [255, 0, 0, 255],
            [127, 0, 127, 255],
            black,
        ];
        ORDER.iter().map(|index| table[*index as usize]).collect()
    };
    assert_eq!(
        texels("bc1 rgb", &bytes::container(BC1_RGB, SIDE, SIDE, &block)),
        expect([0, 0, 0, 255]),
        "sans canal alpha, le quatrième texel est noir opaque"
    );
    assert_eq!(
        texels("bc1 rgba", &bytes::container(BC1_RGBA, SIDE, SIDE, &block)),
        expect([0, 0, 0, 0]),
        "avec canal alpha, le même bloc rend ce texel transparent"
    );
    // ASTC 4 × 4 « void extent » : la couleur est écrite en clair dans le bloc, aucune
    // interpolation n'entre dans la référence.
    let solid = [37u8, 211, 90, 168];
    let astc = bytes::container(ASTC_4X4, SIDE, SIDE, &bytes::astc_void_extent(solid));
    assert_eq!(texels("astc 4x4", &astc), vec![solid; 16]);
}
