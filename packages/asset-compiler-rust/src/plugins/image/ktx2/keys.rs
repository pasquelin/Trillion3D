//! La section clé-valeur d'un KTX 2.0, et les deux clés que ce pilote lit.
//!
//! La spécification de Khronos la décrit entrée par entrée : chaque entrée porte sa longueur sur
//! quatre octets, puis sa clé terminée par un zéro, puis sa valeur, le tout complété jusqu'au
//! multiple de quatre. Les clés y sont des chaînes UTF-8 ; celles que ce module cherche portent des
//! valeurs ASCII de quelques caractères.
//!
//! `KTXorientation` dit dans quel sens le fichier a écrit ses texels — `rd`, vers la droite et vers
//! le bas, est l'orientation du contrat d'image. `KTXswizzle` dit quelle permutation de canaux
//! appliquer avant de lire la couleur. Les ignorer sans un mot retournait une texture ou échangeait
//! ses canaux sans que rien ne le signale.
use std::collections::BTreeMap;

/// Les deux mots de l'entête qui désignent la section : son décalage puis sa longueur.
const OFFSET: usize = 56;
const LENGTH: usize = 60;
/// La longueur d'une entrée, sur quatre octets, et le multiple sur lequel elles s'alignent.
const ENTRY_LENGTH: usize = 4;
const ALIGN: usize = 4;

/// Les clés que ce pilote lit, avec leur valeur telle que le fichier l'écrit.
pub(super) const ORIENTATION: &str = "KTXorientation";
pub(super) const SWIZZLE: &str = "KTXswizzle";

/// Les entrées de la section, par leur clé. Une section absente, tronquée ou mal alignée rend une
/// table vide : ce module ne refuse rien, il lit ce qui est lisible.
pub(super) fn read(bytes: &[u8]) -> BTreeMap<&str, &str> {
    let mut out = BTreeMap::new();
    let Some(mut rest) = section(bytes) else {
        return out;
    };
    while let Some(entry) = next(&mut rest) {
        let mut parts = entry.splitn(2, |byte| *byte == 0);
        let (Some(key), Some(value)) = (parts.next(), parts.next()) else {
            continue;
        };
        if let (Ok(key), Ok(value)) = (str::from_utf8(key), str::from_utf8(trimmed(value))) {
            out.entry(key).or_insert(value);
        }
    }
    out
}

/// La section clé-valeur telle que l'entête la désigne, bornée par la longueur du fichier.
fn section(bytes: &[u8]) -> Option<&[u8]> {
    let word = |at: usize| {
        let field: [u8; 4] = bytes.get(at..at + 4)?.try_into().ok()?;
        usize::try_from(u32::from_le_bytes(field)).ok()
    };
    let (at, length) = (word(OFFSET)?, word(LENGTH)?);
    bytes.get(at..at.checked_add(length)?)
}

/// L'entrée suivante, le curseur passé derrière elle et derrière son alignement. Une longueur qui
/// sort de la section arrête le parcours : elle ne lit jamais à côté.
fn next<'a>(rest: &mut &'a [u8]) -> Option<&'a [u8]> {
    let field: [u8; 4] = rest.get(..ENTRY_LENGTH)?.try_into().ok()?;
    let length = usize::try_from(u32::from_le_bytes(field)).ok()?;
    let end = ENTRY_LENGTH.checked_add(length)?;
    let entry = rest.get(ENTRY_LENGTH..end)?;
    *rest = rest.get(end.next_multiple_of(ALIGN)..).unwrap_or_default();
    Some(entry)
}

/// La valeur sans le zéro terminal que la spécification lui donne, ni le remplissage d'alignement.
fn trimmed(value: &[u8]) -> &[u8] {
    let end = value
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(value.len());
    &value[..end]
}
