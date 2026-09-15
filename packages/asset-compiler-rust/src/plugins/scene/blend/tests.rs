//! Ce que seul l'intérieur du pilote peut prouver : la lecture d'un fichier à l'ancienne
//! disposition d'entête, dont le dépôt ne possède aucun exemplaire, et le calcul des normales sur
//! une géométrie que l'on pose à la main. Tout le reste se prouve depuis la dorée, par le
//! compilateur entier.
use super::*;

/// Écrit un fichier Blender minimal à l'ancienne disposition, depuis la description du format :
/// entête de douze octets, blocs à champs de trente-deux bits, un `DNA1` d'une seule structure et
/// un bloc de données typé par elle.
fn legacy_file(value: f32) -> Vec<u8> {
    let mut sdna = Vec::new();
    sdna.extend_from_slice(b"SDNA");
    section(
        &mut sdna,
        b"NAME",
        &[b"*next\0".to_vec(), b"value\0".to_vec()],
    );
    section(
        &mut sdna,
        b"TYPE",
        &[b"void\0".to_vec(), b"float\0".to_vec(), b"Thing\0".to_vec()],
    );
    sdna.extend_from_slice(b"TLEN");
    for length in [0u16, 4, 12] {
        sdna.extend_from_slice(&length.to_le_bytes());
    }
    sdna.extend_from_slice(&[0, 0]);
    sdna.extend_from_slice(b"STRC");
    sdna.extend_from_slice(&1u32.to_le_bytes());
    for word in [2u16, 2, 0, 0, 1, 1] {
        sdna.extend_from_slice(&word.to_le_bytes());
    }
    let mut out = b"BLENDER-v405".to_vec();
    block(&mut out, b"DNA1", 0, 0, &sdna);
    let mut data = 0u64.to_le_bytes().to_vec();
    data.extend_from_slice(&value.to_le_bytes());
    block(&mut out, b"DATA", 0, 0x4242, &data);
    block(&mut out, b"ENDB", 0, 0, &[]);
    out
}

/// Une section de chaînes du SDNA : son étiquette, son compte, les chaînes, l'alignement sur quatre.
fn section(out: &mut Vec<u8>, label: &[u8; 4], entries: &[Vec<u8>]) {
    out.extend_from_slice(label);
    out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    for entry in entries {
        out.extend_from_slice(entry);
    }
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}

/// Un bloc à l'ancienne disposition : code, taille, adresse d'origine, index SDNA, nombre.
fn block(out: &mut Vec<u8>, code: &[u8; 4], sdna: u32, old: u64, data: &[u8]) {
    out.extend_from_slice(code);
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&old.to_le_bytes());
    out.extend_from_slice(&sdna.to_le_bytes());
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(data);
}

// Comportement : l'ancienne disposition d'entête se lit, et un champ se demande par son nom — c'est
// le SDNA du fichier, jamais un décalage écrit en dur, qui dit où il commence.
#[test]
fn an_old_header_reads_and_its_fields_resolve_by_name() {
    let bytes = legacy_file(2.5);
    let file = BlendFile::open(&bytes, MAX_BYTES).expect("un fichier à l'ancienne disposition");
    assert_eq!(file.version, 405);
    let thing = file.dna.index("Thing").expect("la structure du fichier");
    let field = file.dna.layout(thing).expect("sa disposition");
    assert_eq!(field.field("next").expect("next").offset, 0);
    assert_eq!(field.field("value").expect("value").offset, POINTER);
    let block = file.of(*b"DATA").next().expect("le bloc de données");
    let view = file.view(block).expect("sa vue");
    assert_eq!(view.float("value", 0.0), 2.5);
    assert_eq!(
        view.float("absent", 7.0),
        7.0,
        "un champ absent rend le défaut"
    );
}

// Comportement : un fichier dont l'entête annonce des pointeurs de 32 bits, un boutisme gros ou une
// variante de bloc inconnue est refusé par son nom, jamais lu de travers.
#[test]
fn headers_outside_the_subset_are_refused_by_name() {
    let mut narrow = legacy_file(1.0);
    narrow[7] = b'_';
    assert_eq!(refusal(&narrow), "blend-pointer-size-unsupported");
    let mut reversed = legacy_file(1.0);
    reversed[8] = b'V';
    assert_eq!(refusal(&reversed), "blend-endianness-unsupported");
    assert_eq!(
        refusal(b"not a blender file at all"),
        "blend-header-invalid"
    );
}

fn refusal(bytes: &[u8]) -> &'static str {
    BlendFile::open(bytes, MAX_BYTES)
        .err()
        .expect("ce fichier devait être refusé")
        .code
}

// Comportement : une face nette garde sa propre normale sur chacun de ses coins ; une face lisse
// reçoit la moyenne des faces qui touchent chacun de ses sommets. Deux triangles en toit le disent.
#[test]
fn sharp_faces_keep_their_own_normal_and_smooth_faces_share_it() {
    let roof = |sharp: bool| Geometry {
        positions: vec![
            0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 2.0, 0.0, 0.0, 2.0, 1.0, 0.0,
        ],
        corners: vec![0, 1, 2, 1, 3, 4],
        offsets: vec![0, 3, 6],
        uv: Vec::new(),
        material: vec![0, 0],
        sharp: vec![sharp, sharp],
    };
    let flat = normals::corners(&roof(true));
    assert_eq!(flat.len(), 18);
    // Le premier versant monte, le second descend : leurs normales penchent en sens contraire.
    assert!(flat[0] < 0.0 && flat[9] > 0.0, "{flat:?}");
    for corner in 0..3 {
        assert_eq!(&flat[0..3], &flat[corner * 3..corner * 3 + 3]);
    }
    let smooth = normals::corners(&roof(false));
    // Le sommet 1 est partagé par les deux faces : sa normale moyennée est verticale.
    assert!(smooth[3].abs() < 1e-6, "{smooth:?}");
    assert!((smooth[5] - 1.0).abs() < 1e-6, "{smooth:?}");
}
