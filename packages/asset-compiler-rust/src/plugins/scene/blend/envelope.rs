//! L'enveloppe d'un fichier Blender, et ce que son entête annonce.
//!
//! Un fichier peut arriver nu, dans une trame gzip (les versions anciennes) ou dans une trame
//! Zstandard (le défaut depuis Blender 3). Les deux bibliothèques employées ne font que
//! décompresser, sous un plafond donné, et rien n'est réencodé.
//!
//! L'entête vient ensuite : les sept octets `BLENDER`, la taille de pointeur, le boutisme et la
//! version. L'ancienne disposition tient sur douze octets ; la récente annonce d'abord la longueur
//! de son entête en chiffres décimaux, puis une variante de bloc. Ce lecteur ne lit que les
//! pointeurs de huit octets en boutisme petit, et refuse le reste par son nom plutôt que de le lire
//! de travers.
use super::*;
use std::io::Read;

pub(super) const MAGIC: &[u8] = b"BLENDER";
const GZIP: &[u8] = b"\x1f\x8b";
const ZSTD: &[u8] = b"\x28\xb5\x2f\xfd";
/// La seule variante de bloc à soixante-quatre bits que ce lecteur sait lire.
const WIDE_VARIANT: u32 = 1;
/// La longueur de l'entête récent, la seule que ce lecteur décrit.
const WIDE_LENGTH: usize = 17;

/// Ce que l'entête annonce, une fois l'enveloppe défaite.
pub(super) struct Shape {
    pub(super) header: usize,
    pub(super) pointer: usize,
    pub(super) wide: bool,
    pub(super) version: u32,
}

fn truncated() -> CompilerError {
    refused(
        "blend-truncated",
        "blend: the compressed frame carrying this file does not read back to its end",
    )
}

/// Défait l'enveloppe : un fichier nu passe tel quel, un flux gzip ou Zstandard est décompressé
/// sous le plafond annoncé.
pub(super) fn unwrap(raw: &[u8], ceiling: usize) -> Result<Vec<u8>> {
    if raw.starts_with(MAGIC) {
        return Ok(raw.to_vec());
    }
    let mut out = Vec::new();
    if raw.starts_with(GZIP) {
        flate2::read::MultiGzDecoder::new(raw)
            .take(ceiling as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|_| truncated())?;
    } else if raw.starts_with(ZSTD) {
        zstandard(raw, ceiling, &mut out)?;
    } else {
        return Err(refused(
            "blend-header-invalid",
            "blend: this file starts neither with BLENDER nor with a gzip or Zstandard frame",
        ));
    }
    if out.len() > ceiling {
        return Err(refused(
            "blend-too-large",
            format!("blend: the file expands beyond the {ceiling}-byte ceiling"),
        ));
    }
    Ok(out)
}

/// Un flux Zstandard est une **suite** de trames, et la spécification y admet des trames ignorables
/// — Blender en écrit une, qui porte sa table de recherche. Le décodeur employé ne lit qu'une trame
/// à la fois : on les enchaîne donc ici, en sautant une trame ignorable à la longueur qu'elle
/// annonce. Rien n'est cru sans borne : le plafond restant limite chaque trame.
fn zstandard(raw: &[u8], ceiling: usize, out: &mut Vec<u8>) -> Result<()> {
    /// Le nombre magique d'une trame de données, et celui d'une trame ignorable, dont les quatre
    /// derniers bits sont libres.
    const FRAME: u32 = 0xFD2F_B528;
    const SKIPPABLE: u32 = 0x184D_2A50;
    let word = |bytes: &[u8]| u32::from_le_bytes(bytes.try_into().unwrap_or_default());
    let mut rest = raw;
    while let Some(magic) = rest.get(..4).map(&word) {
        if magic & 0xFFFF_FFF0 == SKIPPABLE {
            let length = word(rest.get(4..8).ok_or_else(truncated)?) as usize;
            rest = rest.get(8 + length..).ok_or_else(truncated)?;
            continue;
        }
        if magic != FRAME {
            break;
        }
        let room = (ceiling + 1).saturating_sub(out.len()) as u64;
        if room == 0 {
            break;
        }
        let mut source = rest;
        let mut decoder = ruzstd::StreamingDecoder::new(&mut source).map_err(|_| truncated())?;
        decoder
            .by_ref()
            .take(room)
            .read_to_end(out)
            .map_err(|_| truncated())?;
        drop(decoder);
        if source.len() == rest.len() {
            return Err(truncated());
        }
        rest = source;
    }
    Ok(())
}

/// Lit l'entête et rend la forme du fichier.
pub(super) fn head(bytes: &[u8]) -> Result<Shape> {
    let invalid = || refused("blend-header-invalid", "blend: unreadable BLENDER header");
    if !bytes.starts_with(MAGIC) || bytes.len() < 12 {
        return Err(invalid());
    }
    let digits = |from: usize, len: usize| -> Option<u32> {
        std::str::from_utf8(bytes.get(from..from + len)?)
            .ok()?
            .parse()
            .ok()
    };
    let legacy = bytes[7] == b'_' || bytes[7] == b'-';
    let (header, pointer, variant, endian, version) = if legacy {
        (12, bytes[7], WIDE_VARIANT, bytes[8], digits(9, 3))
    } else {
        let header = digits(7, 2).ok_or_else(invalid)? as usize;
        if bytes.len() < header || header != WIDE_LENGTH {
            return Err(invalid());
        }
        let variant = digits(10, 2).ok_or_else(invalid)?;
        (header, bytes[9], variant, bytes[12], digits(13, 4))
    };
    if variant != WIDE_VARIANT {
        return Err(refused(
            "blend-block-header-unsupported",
            format!("blend: block header variant {variant} is outside what this reader describes"),
        ));
    }
    if pointer != b'-' {
        return Err(refused(
            "blend-pointer-size-unsupported",
            "blend: this file was written with 32-bit pointers; re-save it from a 64-bit Blender",
        ));
    }
    if endian != b'v' {
        return Err(refused(
            "blend-endianness-unsupported",
            "blend: this file is big-endian; only little-endian files are read",
        ));
    }
    Ok(Shape {
        header,
        pointer: 8,
        wide: !legacy,
        version: version.ok_or_else(invalid)?,
    })
}
