//! Les URI relatives d'images d'une scène intermédiaire : l'échappement qui les écrit et le
//! décodage qui les relit, côte à côte parce qu'ils doivent être exactement l'inverse l'un de
//! l'autre. Un nom de fichier qui porte `%`, `#` ou `?` est légal sur disque et interdit tel quel
//! dans une URI : écrit brut, il se relisait en un autre nom, ou en rien.
//!
//! La règle est celle de glTF 2.0, qui veut une référence relative RFC 3986 : tout octet hors des
//! caractères non réservés `A-Z a-z 0-9 - . _ ~` s'écrit `%XX`, et le séparateur de composants est
//! le seul `/` qui subsiste.
use std::path::{Path, PathBuf};

/// Les caractères qu'une URI porte sans échappement.
fn unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

/// Un composant de chemin — un nom de fichier ou de dossier — en composant d'URI.
fn component(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for byte in name.as_bytes() {
        if unreserved(*byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Un chemin relatif en URI relative : chaque composant échappé, joints par des barres obliques.
pub(crate) fn encode_relative(path: &Path) -> String {
    path.components()
        .map(|part| component(&part.as_os_str().to_string_lossy()))
        .collect::<Vec<_>>()
        .join("/")
}

/// Décode les échappements `%XX` d'une URI glTF. Rend `None` sur un échappement tronqué ou invalide,
/// et sur une suite d'octets qui n'est pas de l'UTF-8 : un nom illisible n'est pas deviné.
pub(crate) fn decode(uri: &str) -> Option<String> {
    let raw = uri.as_bytes();
    let mut out = Vec::with_capacity(raw.len());
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%' {
            let digits = raw.get(index + 1..index + 3)?;
            let text = std::str::from_utf8(digits).ok()?;
            out.push(u8::from_str_radix(text, 16).ok()?);
            index += 3;
        } else {
            out.push(raw[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Le fichier qu'une URI d'image de glTF désigne sous une racine de résolution, sans jamais en
/// sortir : chaque composant doit être un nom de fichier ordinaire, ni `.`, ni `..`, ni racine, ni
/// séparateur de plateforme. Le refus est nommé — c'est une ligne de rapport pour l'appelant qui en
/// tient un, et l'absence d'empreinte pour celui qui calcule une identité.
pub(crate) fn resolve_under(root: &Path, uri: &str) -> Result<PathBuf, &'static str> {
    if !crate::relative_image_uri(uri) {
        return Err("image-uri-not-relative");
    }
    let relative = decode(uri).ok_or("image-uri-undecodable")?;
    let mut path = root.to_path_buf();
    for component in relative.split('/') {
        if !crate::is_safe_source_name(component) {
            return Err("image-uri-outside-source");
        }
        path.push(component);
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Comportement : ce qui est écrit se relit à l'identique, y compris les caractères réservés.
    #[test]
    fn lechappement_et_le_decodage_sont_inverses() {
        for name in [
            "simple.png",
            "color%red.png",
            "a#b?c.png",
            "un nom espacé.png",
            "accentué é.png",
            "textures/sous dossier/x.png",
        ] {
            let uri = encode_relative(Path::new(name));
            assert!(
                !uri.contains('#') && !uri.contains('?') && !uri.contains(' '),
                "{uri}"
            );
            assert_eq!(decode(&uri).as_deref(), Some(name), "{uri}");
        }
    }

    // Comportement : un nom sans caractère à échapper ne change pas, et la barre oblique reste le
    // seul séparateur — une URI déjà écrite par un pilote ne bouge pas sous ce changement.
    #[test]
    fn un_nom_ordinaire_ne_change_pas() {
        assert_eq!(
            encode_relative(Path::new("textures/checker.png")),
            "textures/checker.png"
        );
    }

    // Comportement : un échappement tronqué ou invalide ne se devine pas.
    #[test]
    fn un_echappement_invalide_ne_se_decode_pas() {
        assert_eq!(decode("a%"), None);
        assert_eq!(decode("a%zz.png"), None);
        assert_eq!(decode("%FF.png"), None);
    }
}
