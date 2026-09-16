//! Les bornes du lecteur, prouvées sur des fichiers minimaux écrits ici depuis la description
//! publique du format : un SDNA qui annonce plus que le fichier ne porte, une vue qui ne sort pas
//! des octets de son bloc, et le plafond de taille, qui vaut quelle que soit l'enveloppe.
use super::*;

/// Un SDNA à l'ancienne disposition, dont chaque partie peut être posée de travers : les noms de
/// champs — tous de type `float` —, et le nombre de structures que la section `STRC` annonce.
fn sdna(names: &[&str], announced: u32) -> Vec<u8> {
    let zero = |list: &[&str]| -> Vec<Vec<u8>> {
        list.iter()
            .map(|text| format!("{text}\0").into_bytes())
            .collect()
    };
    let mut out = b"SDNA".to_vec();
    section(&mut out, b"NAME", &zero(names));
    section(&mut out, b"TYPE", &zero(&["void", "float", "Thing"]));
    out.extend_from_slice(b"TLEN");
    for length in [0u16, 4, 12] {
        out.extend_from_slice(&length.to_le_bytes());
    }
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(b"STRC");
    out.extend_from_slice(&announced.to_le_bytes());
    // La structure : son type `Thing`, son nombre de champs, puis chaque champ par son type et son
    // nom.
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&(names.len() as u16).to_le_bytes());
    for rank in 0..names.len() {
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&(rank as u16).to_le_bytes());
    }
    out
}

/// Un fichier à l'ancienne disposition portant ce SDNA et un bloc de données de `held` octets.
fn file(sdna: &[u8], held: usize) -> Vec<u8> {
    let mut out = b"BLENDER-v405".to_vec();
    block(&mut out, b"DNA1", 0, 0, sdna);
    block(&mut out, b"DATA", 0, 0x4242, &vec![0u8; held]);
    block(&mut out, b"ENDB", 0, 0, &[]);
    out
}

// Constat 24 : un SDNA qui annonce des dimensions, une taille de champ ou un nombre de structures
// que le fichier ne porte pas est refusé sous son nom. Les produits étaient posés sans borne : ils
// débordaient — panique en débogage —, et le compte de `STRC` réservait avant d'être cru.
#[test]
fn a_hostile_sdna_is_refused_by_name_never_by_panic() {
    for (case, bytes) in [
        (
            "des dimensions dont le produit déborde",
            file(&sdna(&["value[18446744073709551615][2]"], 1), 16),
        ),
        (
            "un champ plus grand que la mémoire",
            file(&sdna(&["value[4611686018427387904]"], 1), 16),
        ),
        (
            "plus de structures que le bloc n'en porte",
            file(&sdna(&["value"], u32::MAX), 16),
        ),
    ] {
        assert_eq!(refusal(&bytes), "blend-dna-invalid", "{case}");
    }
}

// Constat 24 : une vue lit les champs de son bloc, et rien d'autre. Un bloc plus court que la
// structure que son entête nomme rendait les octets du bloc suivant comme s'ils étaient les siens.
#[test]
fn a_view_never_reads_past_the_end_of_its_block() {
    let bytes = file(&sdna(&["value"], 1), 0);
    let read = BlendFile::open(&bytes, MAX_BYTES).expect("un fichier minimal");
    let block = read.of(*b"DATA").next().expect("le bloc de données");
    let view = read.view(block).expect("sa vue");
    assert_eq!(
        view.float("value", 7.0),
        7.0,
        "un champ hors du bloc rend le défaut, jamais les octets du bloc suivant"
    );
}
