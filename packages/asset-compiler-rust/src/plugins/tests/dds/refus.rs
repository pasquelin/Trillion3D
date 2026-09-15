//! L'autre moitié de la dorée : ce que le pilote refuse, et sous quel nom il le rapporte. Un DDS
//! hors liste ne panique pas et n'interrompt aucune compilation — il laisse le moteur retomber sur
//! son blanc, et le manifeste compte la raison. Chaque refus est vérifié par son code de raison.
use super::super::super::image as registry;
use super::super::fixture;
use super::{bytes, MAX_ALLOC, ORDER, SIDE};

/// Décalages absolus des champs que ces cas modifient après coup, nombre magique compris.
const DEPTH: usize = 24;
const CAPS2: usize = 112;
const ARRAY_SIZE: usize = 140;
const MISC_FLAGS_2: usize = 144;

fn patched(mut file: Vec<u8>, at: usize, value: u32) -> Vec<u8> {
    file[at..at + 4].copy_from_slice(&value.to_le_bytes());
    file
}

fn dxt1(payload: &[u8], levels: u32) -> Vec<u8> {
    bytes::container(bytes::fourcc_format(b"DXT1"), SIDE, SIDE, levels, payload)
}

// Contrat du pilote : le format est reconnu par l'extension comme par le nombre magique, et tout
// ce qui n'est pas déclaré ressort en raison de rapport nommée, jamais en panique.
#[test]
fn un_dds_hors_liste_ou_tronque_ressort_en_raison_de_rapport_jamais_en_panique() {
    for extension in ["dds", "DDS"] {
        let path = std::path::PathBuf::from(format!("albedo.{extension}"));
        let decoder = registry::by_extension(&path).expect("revendiqué");
        assert_eq!(decoder.name(), "dds", "{extension}");
        assert_eq!(decoder.mime(), "image/vnd.ms-dds");
    }
    // Trente et un octets sur quarante-trois mille : le nombre magique est là, l'entête non.
    let truncated = fixture("dds", "tronque.dds");
    assert_eq!(registry::by_head(&truncated).map(|d| d.name()), Some("dds"));
    assert_eq!(
        registry::decode(&truncated, MAX_ALLOC).err(),
        Some("dds-header-truncated")
    );
    // Un entête DX10 annoncé mais absent est la même coupure, vue vingt octets plus loin.
    let block = bytes::color_block(ORDER);
    let dx10 = bytes::container(bytes::fourcc_format(b"DX10"), SIDE, SIDE, 1, &[]);
    assert_eq!(
        registry::decode(&dx10, MAX_ALLOC).err(),
        Some("dds-header-truncated")
    );
    // Codecs hors liste : BC6H flottant, variantes signées, alpha prémultiplié, 16 bits, masques
    // inattendus, et un `DDS_PIXELFORMAT` qui ne nomme ni `dwFourCC` ni canaux RGB.
    for (case, file) in [
        ("bc6h", bytes::dx10(95, SIDE, SIDE, &[0; 16])),
        ("bc4 signé", bytes::dx10(81, SIDE, SIDE, &[0; 8])),
        ("bc1 typeless", bytes::dx10(70, SIDE, SIDE, &block)),
        (
            "bc3 prémultiplié",
            patched(bytes::dx10(77, SIDE, SIDE, &[0; 16]), MISC_FLAGS_2, 2),
        ),
        (
            "dxt2 prémultiplié",
            bytes::container(bytes::fourcc_format(b"DXT2"), SIDE, SIDE, 1, &block),
        ),
        (
            "565 sur seize bits",
            bytes::container(
                bytes::mask_format(16, [0xf800, 0x07e0, 0x001f, 0]),
                SIDE,
                SIDE,
                1,
                &[0; 32],
            ),
        ),
        (
            "masques décalés",
            bytes::container(
                bytes::mask_format(32, [0xff, 0xff00, 0xff_0000, 0x0f00_0000]),
                SIDE,
                SIDE,
                1,
                &[0; 64],
            ),
        ),
        (
            "ni fourcc ni rgb",
            bytes::container(
                [
                    0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    0, 0, 0, 0, 0, 0, 0,
                ],
                SIDE,
                SIDE,
                1,
                &block,
            ),
        ),
    ] {
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("dds-codec-unsupported"),
            "{case}"
        );
    }
    // Dispositions hors liste : cube, volume, tableau de textures.
    for (case, file) in [
        ("cube", patched(dxt1(&block, 1), CAPS2, 0x200)),
        ("volume", patched(dxt1(&block, 1), DEPTH, 4)),
        (
            "tableau",
            patched(bytes::dx10(71, SIDE, SIDE, &block), ARRAY_SIZE, 6),
        ),
    ] {
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("dds-layout-unsupported"),
            "{case}"
        );
    }
    // Entête hors domaine : taille annoncée fausse, dimension nulle, niveaux absurdes.
    for (case, file) in [
        ("taille d'entête", patched(dxt1(&block, 1), 4, 120)),
        ("largeur nulle", patched(dxt1(&block, 1), 16, 0)),
        ("niveaux absurdes", dxt1(&block, 4_000)),
    ] {
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("dds-header-invalid"),
            "{case}"
        );
    }
    // La chaîne annoncée doit tenir : neuf niveaux promis, un seul bloc écrit.
    assert_eq!(
        registry::decode(&dxt1(&block, 9), MAX_ALLOC).err(),
        Some("dds-data-truncated")
    );
    // Le plafond d'allocation est un refus, jamais une allocation tentée : 4 × 4 pixels font
    // soixante-quatre octets de RGBA8, un de plus que ce plafond.
    assert_eq!(
        registry::decode(&dxt1(&block, 1), 63).err(),
        Some("dds-image-too-large")
    );
}

// Contrat du pilote sur un fichier réel, écrit par un encodeur tiers : l'entête se lit, seul le
// niveau 0 ressort, et la chaîne de mips annoncée est comptée — un octet de moins et le fichier
// n'est plus lisible.
#[test]
fn le_bc1_a_neuf_niveaux_rend_son_niveau_zero_et_compte_sa_chaine() {
    let file = fixture("dds", "bc1-mips.dds");
    assert_eq!(registry::by_head(&file).map(|d| d.name()), Some("dds"));
    let registry::DecodedImage::Rgba8(image) = registry::decode(&file, MAX_ALLOC).expect("décodé");
    assert_eq!((image.width(), image.height()), (256, 256));
    // L'encodeur du corpus écrit des blocs constants : chaque carré de 4 × 4 ressort d'une seule
    // couleur. Un niveau mélangé à un autre, ou un décalage d'une ligne, se verrait ici.
    for block in 0..(64 * 64) {
        let (left, top) = (block % 64 * 4, block / 64 * 4);
        let first = image.get_pixel(left, top).0;
        for pixel in 0..16u32 {
            let seen = image.get_pixel(left + pixel % 4, top + pixel / 4).0;
            assert_eq!(seen, first, "bloc ({left}, {top})");
        }
    }
    assert_eq!(
        registry::decode(&file[..file.len() - 1], MAX_ALLOC).err(),
        Some("dds-data-truncated"),
        "neuf niveaux annoncés, un octet manquant"
    );
}
