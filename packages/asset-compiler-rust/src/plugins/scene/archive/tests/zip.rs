//! Le conteneur `.zip` devant une charge que son index annonce et que le lecteur ne déplie pas.
use super::*;
use crate::plugins::scene::zip::ZIP;

/// Des octets qui ne sont pas un flux `deflate` : le premier bloc s'annonce d'un type réservé.
const GARBAGE: &[u8] = b"\x06\x00\x00\x00\x00pas un flux deflate";

/// Une archive dont la première entrée se lit et dont la seconde ment sur sa charge.
fn corrupted() -> Vec<u8> {
    zip_bytes(
        &[
            Entry::stored("scene.gltf", b"{}"),
            Entry {
                name: "textures/checker.png",
                data: GARBAGE,
                method: 8,
                size: 4096,
            },
        ],
        false,
    )
}

// Comportement 5 : une archive dont l'index tient mais dont une charge ne se déplie pas est refusée
// sous le nom des archives illisibles — et non comme une panne du disque —, et l'extraction ne
// laisse rien derrière elle : le dossier extrait n'apparaît que complet, jamais à moitié écrit.
#[test]
fn an_archive_whose_payload_does_not_unpack_is_refused_without_leaving_partial_files() {
    let run = outcome("zip-charge", &ZIP, "abimee.zip", &corrupted());
    assert_eq!(run.code, UNREADABLE);
    assert!(
        extracted(&run.dir).is_empty(),
        "une archive refusée ne laisse aucun dossier extrait"
    );
    cleanup(run.dir);
}
