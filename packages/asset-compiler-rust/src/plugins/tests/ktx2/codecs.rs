//! Ce que le `vkFormat` décide : quel décodeur lit le niveau, et sur quelle géométrie de bloc. Le
//! registre Vulkan fixe les deux, et l'octet qui manque le prouve format par format — un bloc plus
//! court d'un octet ne couvre plus la surface annoncée, donc le niveau est refusé.
//!
//! L'autre moitié est la supercompression Zstandard : la longueur que l'index annonce borne à la
//! fois l'allocation et la lecture, et un flux qui ne rend pas cette longueur est un refus, jamais
//! un tampon à moitié plein.
use super::super::super::image as registry;
use super::super::fixture;
use super::{bytes, ASTC_4X4, BC1_RGBA, MAX_ALLOC, SIDE};

/// Les `vkFormat` compressés déclarés et les octets de leur bloc de 4 × 4 texels, dans l'ordre du
/// registre Vulkan : BC1 sans puis avec alpha, BC2, BC3, BC4, BC5, BC7, les trois ETC2, les deux
/// EAC et l'ASTC 4 × 4, chacun avec sa variante `_SRGB` quand le registre en publie une.
const BLOCKS: [(u32, usize); 22] = [
    (131, 8),
    (132, 8),
    (133, 8),
    (134, 8),
    (135, 16),
    (136, 16),
    (137, 16),
    (138, 16),
    (139, 8),
    (141, 16),
    (145, 16),
    (146, 16),
    (147, 8),
    (148, 8),
    (149, 8),
    (150, 8),
    (151, 16),
    (152, 16),
    (153, 8),
    (155, 16),
    (157, 16),
    (158, 16),
];

// Contrat du pilote sur les codecs déclarés : chaque `vkFormat` compressé mène au décodeur dont la
// géométrie de bloc est celle du registre Vulkan, et rien de ce qui est déclaré ne panique.
#[test]
fn chaque_vkformat_compresse_declare_porte_la_geometrie_de_bloc_du_registre() {
    for (format, block) in BLOCKS {
        let full = bytes::container(format, SIDE, SIDE, &vec![0u8; block]);
        let image = super::super::rgba8(
            registry::decode(&full, MAX_ALLOC)
                .unwrap_or_else(|reason| panic!("format {format} : {reason}")),
        );
        assert_eq!((image.width(), image.height()), (SIDE, SIDE), "{format}");
        let short = bytes::container(format, SIDE, SIDE, &vec![0u8; block - 1]);
        assert_eq!(
            registry::decode(&short, MAX_ALLOC).err(),
            Some("ktx2-data-truncated"),
            "format {format} : un bloc de {block} octets, pas de {}",
            block - 1
        );
    }
    // Les deux formats compressés dont la dorée écrit les texels en clair sont bien dans la liste.
    for format in [BC1_RGBA, ASTC_4X4] {
        assert!(BLOCKS.iter().any(|(declared, _)| *declared == format));
    }
}

// Contrat du pilote sur la supercompression Zstandard : la longueur annoncée borne la lecture et
// l'allocation, et ce qui n'en sort pas exactement est un refus nommé.
#[test]
fn la_supercompression_zstandard_est_bornee_par_la_longueur_annoncee() {
    let file = fixture("ktx2", "base-zstd.ktx2");
    for (case, patched, ceiling, reason) in [
        (
            "annonce trop courte pour la surface",
            bytes::patched64(file.clone(), bytes::HEADER_END + 16, 32),
            MAX_ALLOC,
            "ktx2-data-truncated",
        ),
        (
            "annonce au-delà du plafond",
            bytes::patched64(file.clone(), bytes::HEADER_END + 16, 1000),
            64,
            "ktx2-image-too-large",
        ),
        (
            "trame coupée",
            bytes::patched64(file.clone(), bytes::HEADER_END + 8, 20),
            MAX_ALLOC,
            "ktx2-data-truncated",
        ),
        (
            "trame qui n'en est pas une",
            bytes::patched(file.clone(), ZSTD_DATA, 0),
            MAX_ALLOC,
            "ktx2-data-truncated",
        ),
    ] {
        assert_eq!(
            registry::decode(&patched, ceiling).err(),
            Some(reason),
            "{case}"
        );
    }
}

/// Le niveau 0 de `base-zstd.ktx2` commence après l'entête, l'index d'un niveau et un descripteur
/// de format de quatre-vingt-douze octets.
const ZSTD_DATA: usize = 196;

/// `VK_FORMAT_EAC_R11_UNORM_BLOCK` et `VK_FORMAT_EAC_R11G11_UNORM_BLOCK`.
const EAC_R11: u32 = 153;
const EAC_RG11: u32 = 155;
/// La table 13 de la spécification, `{-1, -2, -3, -10, 0, 1, 2, 9}` : ses trois premiers
/// modificateurs positifs valent 0, 1 et 2, les plus petits pas que le format sache écrire, donc
/// exactement ceux qu'une troncature de trois bits efface.
const TABLE_13: u8 = 13;

// Reproduction du constat 55 : un canal EAC porte onze bits, le contrat huit. Le décodeur externe
// les ramenait par `val >> 3`, une troncature qui abaisse une valeur sur huit d'un cran, et lisait
// le champ d'indices à l'envers, ce qui mélangeait les seize texels d'un bloc. Le pilote développe
// désormais ces deux formats lui-même, en onze bits, puis arrondit au plus proche.
//
// Le bloc écrit ici a pour mot de base 0 et pour multiplicateur 0 — que la spécification lit comme
// un —, donc ses valeurs valent `4 + modificateur`. Le texel 0 prend l'indice 5 (modificateur 1,
// valeur 5), le texel 15 l'indice 7 (modificateur 9, valeur 13), les quatorze autres l'indice 4
// (modificateur 0, valeur 4). Une troncature rendrait 0, 1 et 0 ; l'arrondi rend 1, 2 et 0.
#[test]
fn les_onze_bits_dun_canal_eac_sont_arrondis_et_les_texels_restent_en_place() {
    let mut indices = [4u8; 16];
    indices[0] = 5;
    indices[15] = 7;
    let rouge = bytes::eac(0, 0, TABLE_13, indices);
    let attendu: Vec<u8> = (0..16)
        .map(|texel| match texel {
            0 => 1,
            15 => 2,
            _ => 0,
        })
        .collect();
    let file = bytes::container(EAC_R11, SIDE, SIDE, &rouge);
    let image = super::super::rgba8(
        registry::decode(&file, MAX_ALLOC).unwrap_or_else(|reason| panic!("eac r11 : {reason}")),
    );
    let canal = |at: usize| -> Vec<u8> { image.pixels().map(|pixel| pixel.0[at]).collect() };
    assert_eq!(canal(0), attendu, "le rouge d'un EAC R11");
    assert_eq!(canal(1), vec![0; 16], "le vert d'un EAC R11 reste nul");
    assert_eq!(canal(3), vec![255; 16], "l'alpha d'un EAC est opaque");
    // Le second canal d'un RG11 est un bloc de plus, lu au même titre et rendu en vert.
    let mut deux = rouge.clone();
    deux.extend_from_slice(&bytes::eac(0, 0, TABLE_13, indices));
    let paire = bytes::container(EAC_RG11, SIDE, SIDE, &deux);
    let image = super::super::rgba8(
        registry::decode(&paire, MAX_ALLOC).unwrap_or_else(|reason| panic!("eac rg11 : {reason}")),
    );
    let canal = |at: usize| -> Vec<u8> { image.pixels().map(|pixel| pixel.0[at]).collect() };
    assert_eq!(canal(0), attendu, "le rouge d'un EAC RG11");
    assert_eq!(canal(1), attendu, "le vert d'un EAC RG11");
}
