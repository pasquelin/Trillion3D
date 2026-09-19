//! Relative URIs of images in an intermediate scene: the escaping that writes
//! them and the decoding that reads them back, side by side because they must
//! be exact inverses of each other. A filename that carries `%`, `#` or `?` is
//! legal on disk and forbidden as-is in a URI: written raw, it would re-read as
//! a different name, or as nothing.
//!
//! The rule is glTF 2.0's: an RFC 3986 relative reference. Every byte outside
//! the unreserved characters `A-Z a-z 0-9 - . _ ~` is written `%XX`, and the
//! only component separator that remains is `/`.
use std::path::{Path, PathBuf};

/// Characters a URI carries without escaping.
fn unreserved(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~')
}

/// A path component — a file or folder name — as a URI component.
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

/// A relative path as a relative URI: each component escaped, joined by slashes.
pub(crate) fn encode_relative(path: &Path) -> String {
    path.components()
        .map(|part| component(&part.as_os_str().to_string_lossy()))
        .collect::<Vec<_>>()
        .join("/")
}

/// Decodes the `%XX` escapes of a glTF URI. Returns `None` on a truncated or
/// invalid escape, and on a byte sequence that is not UTF-8: an unreadable name
/// is not guessed.
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

/// The file a glTF image URI designates under a resolution root, without ever
/// leaving it: each component must be an ordinary filename, neither `.`, nor
/// `..`, nor a root, nor a platform separator. The refusal is named — a report
/// line for the caller that keeps one, and a missing fingerprint for the one
/// that computes an identity.
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

    // Behaviour: what is written re-reads identically, including reserved characters.
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

    // Behaviour: a name with no character to escape does not change, and the slash
    // remains the only separator — a URI already written by a driver does not move
    // under this change.
    #[test]
    fn un_nom_ordinaire_ne_change_pas() {
        assert_eq!(
            encode_relative(Path::new("textures/checker.png")),
            "textures/checker.png"
        );
    }

    // Behaviour: a truncated or invalid escape is not guessed.
    #[test]
    fn un_echappement_invalide_ne_se_decode_pas() {
        assert_eq!(decode("a%"), None);
        assert_eq!(decode("a%zz.png"), None);
        assert_eq!(decode("%FF.png"), None);
    }
}
