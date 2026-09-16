//! Le conteneur `.unitypackage` devant un flux gzip qui ne se termine pas comme il le promet.
use super::*;
use crate::plugins::scene::unitypackage::UNITYPACKAGE;

/// Le GUID d'un asset du paquet, tel que l'éditeur en écrit un.
const GUID: &str = "00000000000000000000000000000001";

/// Un paquet sain : un dossier de GUID, son chemin cible et ses octets.
fn package() -> Vec<u8> {
    let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
        Vec::new(),
        flate2::Compression::default(),
    ));
    for (member, bytes) in [
        ("pathname", &b"Assets/checker.png"[..]),
        ("asset", &b"\x89PNG\r\n\x1a\n"[..]),
    ] {
        let mut header = tar::Header::new_ustar();
        header.set_mode(0o644);
        header.set_size(bytes.len() as u64);
        builder
            .append_data(&mut header, format!("{GUID}/{member}"), bytes)
            .expect("entrée du paquet");
    }
    builder
        .into_inner()
        .expect("fin du tar")
        .finish()
        .expect("fin du gzip")
}

/// Les mêmes octets, dont le pied gzip ment : chaque variante est celle d'un transfert interrompu
/// ou d'un disque qui a rendu autre chose que ce qu'on lui avait confié.
fn damaged(kind: &str) -> Vec<u8> {
    let mut bytes = package();
    let end = bytes.len();
    match kind {
        // Le flux s'arrête avant son pied : les derniers octets n'ont jamais été écrits.
        "tronque" => bytes.truncate(end - 8),
        // Le condensé du pied ne vaut plus celui des octets décompressés.
        "crc" => bytes[end - 8] ^= 0xff,
        // La taille annoncée par le pied ne vaut plus celle des octets décompressés.
        _ => bytes[end - 4] ^= 0xff,
    }
    bytes
}

// Comportement 4 : un paquet sain va jusqu'au routage de ce qu'il porte — ici une image, qu'aucun
// pilote de scène ne revendique —, et aucune des trois formes de pied menteur n'y arrive : le flux
// est lu jusqu'au bout, et ce qui ne s'y termine pas est refusé sous le nom des archives illisibles.
#[test]
fn a_package_whose_gzip_footer_lies_is_refused_as_unreadable() {
    let sain = outcome("paquet-sain", &UNITYPACKAGE, "sain.unitypackage", &package());
    assert_eq!(
        sain.code, "SOURCE_FORMAT_UNKNOWN",
        "le paquet sain se lit entier"
    );
    cleanup(sain.dir);
    for kind in ["tronque", "crc", "isize"] {
        let abime = outcome(kind, &UNITYPACKAGE, "abime.unitypackage", &damaged(kind));
        assert_eq!(abime.code, UNREADABLE, "pied gzip « {kind} »");
        assert!(extracted(&abime.dir).is_empty(), "pied gzip « {kind} »");
        cleanup(abime.dir);
    }
}
