//! La lecture des sections du bloc `DNA1`, octet par octet.
//!
//! Chaque section annonce un compte ; aucun n'est cru sans être borné par ce que le bloc porte
//! encore, et aucun produit de dimensions ou de tailles n'est posé sans être vérifié. Un fichier
//! qui ment sur l'un d'eux est refusé sous `blend-dna-invalid`, jamais par une panique.
use super::{Field, Layout, POINTER};
use crate::plugins::scene::blend::{refused, CompilerError, Result};
use std::collections::HashMap;

fn invalid() -> CompilerError {
    refused(
        "blend-dna-invalid",
        "blend: the DNA1 block does not read back",
    )
}

/// Une étiquette de section, lue là où elle doit être.
pub(super) fn tag(bytes: &[u8], at: &mut usize, expected: &[u8; 4]) -> Result<()> {
    let found = bytes.get(*at..*at + 4).ok_or_else(invalid)?;
    if found != expected {
        return Err(invalid());
    }
    *at += 4;
    Ok(())
}

/// Le compte d'une section, borné par ce que le bloc peut encore porter : chaque entrée y pèse au
/// moins `unit` octets, donc un compte qui ne tient pas dans le reste du bloc ment.
pub(super) fn count(bytes: &[u8], at: &mut usize, unit: usize) -> Result<usize> {
    let total = u32::from_le_bytes(word(bytes, at)?) as usize;
    let room = bytes.len().saturating_sub(*at);
    match total.checked_mul(unit) {
        Some(needed) if needed <= room => Ok(total),
        _ => Err(invalid()),
    }
}

pub(super) fn word<const N: usize>(bytes: &[u8], at: &mut usize) -> Result<[u8; N]> {
    let found: [u8; N] = bytes
        .get(*at..*at + N)
        .ok_or_else(invalid)?
        .try_into()
        .map_err(|_| invalid())?;
    *at += N;
    Ok(found)
}

/// Une section de chaînes : son étiquette, son compte, puis les chaînes, le tout aligné sur quatre.
pub(super) fn strings(bytes: &[u8], at: &mut usize, label: &[u8; 4]) -> Result<Vec<String>> {
    tag(bytes, at, label)?;
    // Une chaîne pèse au moins son zéro terminal : le compte tient donc dans le reste du bloc.
    let total = count(bytes, at, 1)?;
    let mut out = Vec::with_capacity(total);
    for _ in 0..total {
        let rest = bytes.get(*at..).ok_or_else(invalid)?;
        let end = rest
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(invalid)?;
        out.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        *at += end + 1;
    }
    *at = (*at + 3) & !3;
    Ok(out)
}

/// Une structure et ses champs : les décalages se cumulent dans l'ordre déclaré, un pointeur pesant
/// toujours la taille de pointeur du fichier, un tableau le produit de ses dimensions.
pub(super) fn layout(
    bytes: &[u8],
    at: &mut usize,
    names: &[String],
    types: &[String],
    lengths: &[usize],
) -> Result<Layout> {
    let kind = u16::from_le_bytes(word(bytes, at)?) as usize;
    let total = u16::from_le_bytes(word(bytes, at)?) as usize;
    let mut fields = HashMap::with_capacity(total);
    let mut offset = 0;
    for _ in 0..total {
        let kind = u16::from_le_bytes(word(bytes, at)?) as usize;
        let name = u16::from_le_bytes(word(bytes, at)?) as usize;
        let name = names.get(name).ok_or_else(invalid)?;
        let pointer = name.contains('*');
        let unit = if pointer {
            POINTER
        } else {
            *lengths.get(kind).ok_or_else(invalid)?
        };
        let count = elements(name).ok_or_else(invalid)?;
        fields.insert(
            key(name).to_string(),
            Field {
                offset,
                kind: types.get(kind).ok_or_else(invalid)?.clone(),
                unit,
                count,
                pointer,
            },
        );
        offset = unit
            .checked_mul(count)
            .and_then(|span| offset.checked_add(span))
            .ok_or_else(invalid)?;
    }
    // La taille déclarée par `TLEN` fait foi — c'est celle du pas d'un tableau de structures ; la
    // somme des champs ne sert que si le fichier n'en déclare pas.
    let declared = lengths.get(kind).copied().unwrap_or(0);
    Ok(Layout {
        name: types.get(kind).ok_or_else(invalid)?.clone(),
        size: if declared > 0 { declared } else { offset },
        fields,
    })
}

/// Le nom nu d'un champ, sans les étoiles, les crochets ni les parenthèses d'un pointeur de
/// fonction : c'est par ce nom que le lecteur demande un champ.
fn key(name: &str) -> &str {
    let start = name
        .find(|c: char| c.is_alphanumeric() || c == '_')
        .unwrap_or(name.len());
    let rest = &name[start..];
    let end = rest
        .find(|c: char| !(c.is_alphanumeric() || c == '_'))
        .unwrap_or(rest.len());
    &rest[..end]
}

/// Le nombre d'éléments qu'un nom de champ déclare : le produit de ses dimensions, une pour un
/// champ simple. Rien quand ce produit déborde — le nom ment alors sur ce que le fichier porte.
fn elements(name: &str) -> Option<usize> {
    let mut total: usize = 1;
    let mut rest = name;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find(']') else {
            break;
        };
        let dimension = rest[open + 1..open + close].parse::<usize>().unwrap_or(1);
        total = total.checked_mul(dimension)?;
        rest = &rest[open + close + 1..];
    }
    Some(total)
}
