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
