//! L'autre moitié de la dorée : ce que le pilote refuse, et sous quel nom il le rapporte. Un KTX2
//! hors liste ne panique pas et n'interrompt aucune compilation — il laisse le moteur retomber sur
//! son blanc, et le manifeste compte la raison. Chaque refus est vérifié par son code de raison.
use super::super::super::image as registry;
use super::super::fixture;
use super::{bytes, valid, MAX_ALLOC, RGBA8_SRGB, SIDE};
use std::path::PathBuf;

// Contrat du pilote : le format est reconnu par l'extension comme par l'identifiant, et tout ce qui
// n'est pas déclaré ressort en raison de rapport nommée, jamais en panique.
#[test]
fn un_ktx2_hors_liste_ou_tronque_ressort_en_raison_de_rapport_jamais_en_panique() {
    for extension in ["ktx2", "KTX2"] {
        let path = PathBuf::from(format!("albedo.{extension}"));
        let decoder = registry::by_extension(&path).expect("revendiqué");
        assert_eq!(decoder.name(), "ktx2", "{extension}");
        assert_eq!(decoder.mime(), "image/ktx2");
    }
    // Quarante octets sur huit mille : l'identifiant est là, l'entête non.
    let truncated = fixture("ktx2", "tronque.ktx2");
    assert_eq!(
        registry::by_head(&truncated).map(|d| d.name()),
        Some("ktx2")
    );
    assert_eq!(
        registry::decode(&truncated, MAX_ALLOC).err(),
        Some("ktx2-header-truncated")
    );
    // Un index de niveaux annoncé mais absent est la même coupure, vue plus loin.
    let promised = bytes::chain(RGBA8_SRGB, SIDE, SIDE, &[0u8; 64], 4);
    assert_eq!(
        registry::decode(&promised[..100], MAX_ALLOC).err(),
        Some("ktx2-header-truncated")
    );
    invalid_headers();
    layouts_and_schemes();
    truncated_data(promised);
}

/// Entête présent mais hors domaine. L'identifiant est vérifié ici aussi : appelé par l'extension,
/// un pilote peut recevoir des octets qu'il n'aurait pas revendiqués par leur tête.
fn invalid_headers() {
    let mut foreign = valid();
    foreign[0] = 0;
    for (case, file) in [
        ("identifiant", foreign),
        ("largeur nulle", bytes::patched(valid(), bytes::WIDTH, 0)),
        ("typeSize", bytes::patched(valid(), bytes::TYPE_SIZE, 4)),
        (
            "niveaux absurdes",
            bytes::patched(valid(), bytes::LEVELS, 40),
        ),
        (
            "niveau dans l'index",
            bytes::patched64(valid(), bytes::HEADER_END, 8),
        ),
    ] {
        let plugin = registry::by_extension(&PathBuf::from("albedo.ktx2")).expect("revendiqué");
        assert_eq!(
            plugin.decode(&file, MAX_ALLOC).err(),
            Some("ktx2-header-invalid"),
            "{case}"
        );
    }
}

/// Dispositions, supercompressions et `vkFormat` hors des listes déclarées, chacun par son nom.
fn layouts_and_schemes() {
    for (case, at, value) in [
        ("une dimension", bytes::HEIGHT, 0),
        ("volume", bytes::DEPTH, 4),
        ("tableau", bytes::LAYERS, 6),
        ("cube", bytes::FACES, 6),
    ] {
        assert_eq!(
            registry::decode(&bytes::patched(valid(), at, value), MAX_ALLOC).err(),
            Some("ktx2-layout-unsupported"),
            "{case}"
        );
    }
    // ZLIB, puis un numéro que la spécification n'a pas attribué.
    for scheme in [3, 9] {
        let file = bytes::patched(valid(), bytes::SUPERCOMPRESSION, scheme);
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("ktx2-supercompression-unsupported"),
            "schéma {scheme}"
        );
    }
    // Variantes signées, BC6H flottant, ordres d'octets autres que RGBA, canaux de plus de huit
    // bits, et les empreintes ASTC autres que 4 × 4.
    for (case, format) in [
        ("bc4 signé", 140),
        ("bc6h flottant", 143),
        ("bgra8", 44),
        ("rgba16 flottant", 97),
        ("astc 5x4", 159),
    ] {
        let file = bytes::patched(valid(), bytes::FORMAT, format);
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("ktx2-format-unsupported"),
            "{case}"
        );
    }
}

/// Ce qui manque : la chaîne annoncée, le niveau annoncé, la place sous le plafond d'allocation, et
/// une charge Basis Universal que le transcodeur ne reconnaît pas.
fn truncated_data(promised: Vec<u8>) {
    for (case, file) in [
        ("chaîne", promised),
        (
            "niveau hors fichier",
            bytes::patched64(valid(), bytes::HEADER_END + 8, 10_000),
        ),
        (
            "niveau court",
            bytes::container(RGBA8_SRGB, SIDE, SIDE, &[0u8; 63]),
        ),
    ] {
        assert_eq!(
            registry::decode(&file, MAX_ALLOC).err(),
            Some("ktx2-data-truncated"),
            "{case}"
        );
    }
    // Le plafond d'allocation est un refus, jamais une allocation tentée : 4 × 4 texels font
    // soixante-quatre octets de RGBA8, un de plus que ce plafond. Les deux chemins le vérifient
    // avant de lire quoi que ce soit.
    let basis = bytes::patched(valid(), bytes::FORMAT, 0);
    for (case, file) in [("vkFormat nommé", valid()), ("charge basis", basis.clone())] {
        assert_eq!(
            registry::decode(&file, 63).err(),
            Some("ktx2-image-too-large"),
            "{case}"
        );
    }
    assert_eq!(
        registry::decode(&basis, MAX_ALLOC).err(),
        Some("ktx2-transcode-failed"),
        "une charge que le transcodeur ne reconnaît pas"
    );
}
