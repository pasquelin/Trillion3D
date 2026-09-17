//! La page qui sert à répondre, sans application ni serveur.
//!
//! Un seul fichier, ouvert d'un double-clic : les vignettes y sont enfermées, il n'y a rien à
//! installer et rien ne part sur le réseau. Chaque ligne montre la texture en couleur, la même en
//! noir et blanc — le blanc est ce qui se voit, le noir ce qui disparaît —, ses nombres, et un
//! interrupteur déjà positionné sur la proposition du compilateur. Le bouton d'enregistrement rend
//! la feuille que le compilateur vient d'écrire, réponses changées : la page emporte cette feuille
//! telle quelle et n'en connaît qu'un champ, ce qui empêche les deux formats de diverger.
//!
//! Les vignettes voyagent en pixels bruts : la page les repeint sur une toile, ce qui évite
//! d'emporter un encodeur d'image dans le compilateur.
use super::*;

const TEMPLATE: &str = include_str!("page.html");

pub(crate) fn write_page(path: &Path, entries: &[Entry], sheet: &Value, model: &str) -> Result<()> {
    let rows: Vec<Value> = entries
        .iter()
        .map(|entry| {
            json!({"sha256":entry.sha256,"weight":entry.weight,
                "width":entry.thumbnail_size.0,"height":entry.thumbnail_size.1,
                "pixels":base64(&entry.thumbnail)})
        })
        .collect();
    // La feuille voyage telle qu'elle vient d'être écrite : la page la réécrit en ne changeant que
    // les réponses, donc son format — numéro de version compris — n'existe qu'à un seul endroit.
    let data = serde_json::to_string(&json!({"model":model,"sheet":sheet,"textures":rows}))?;
    // `</script>` dans une chaîne fermerait la balise qui la porte : la seule séquence à neutraliser.
    let page = TEMPLATE.replace("\"__DONNEES__\"", &data.replace("</", "<\\/"));
    atomic(path, page.as_bytes())
}

/// Base64 standard, sans dépendance : trois octets deviennent quatre caractères, la fin est comblée.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let mut word = 0u32;
        for (at, byte) in chunk.iter().enumerate() {
            word |= u32::from(*byte) << (16 - 8 * at);
        }
        for at in 0..4 {
            if at <= chunk.len() {
                out.push(ALPHABET[(word >> (18 - 6 * at)) as usize & 63] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // Comportement : le base64 du module rend ce que rend l'encodage standard, bourrage compris.
    #[test]
    fn le_base64_suit_la_norme() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64(&[0u8, 255, 128]), "AP+A");
    }
}
