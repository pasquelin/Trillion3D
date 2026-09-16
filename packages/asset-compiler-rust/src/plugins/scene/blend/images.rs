//! Les images d'un fichier Blender : celles qu'il désigne, et celles qu'il emporte.
//!
//! Un bloc `IM` porte un chemin — `//` y désigne le dossier du fichier — et, quand l'auteur a
//! empaqueté l'image, un `PackedFile` : la taille et les octets du fichier d'origine, tels quels.
//! Ces octets partent dans le binaire de la scène intermédiaire **sans être touchés**, par une vue
//! de tampon que le glTF prévoit pour cela : aucun réencodage, aucune seconde version sur le
//! disque, et le décodeur d'image du compilateur relit exactement le fichier que l'auteur a
//! empaqueté. Une image seulement désignée reste nommée par son chemin, relativement à la racine
//! servie — la même racine que pour tous les pilotes, `scene::image_root`.
use super::*;

/// Plafond des octets d'une image empaquetée : au-delà, l'image n'est pas versée.
const MAX_PACKED_BYTES: usize = 256 * 1024 * 1024;

/// Les images déjà versées, par l'adresse du bloc qui les porte.
#[derive(Default)]
pub(super) struct Images {
    by_block: HashMap<u64, Option<usize>>,
}

impl Images {
    /// Le rang de la texture glTF de cette image, versée à la première demande.
    pub(super) fn texture(&mut self, image: &At<'_>, root: &Path, out: &mut Out) -> Option<usize> {
        if let Some(known) = self.by_block.get(&image.old) {
            return *known;
        }
        let found = resolve(image, root, out);
        self.by_block.insert(image.old, found);
        found
    }
}

fn resolve(image: &At<'_>, root: &Path, out: &mut Out) -> Option<usize> {
    let declared = image.text("name").replace('\\', "/");
    let name = declared
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("image")
        .to_string();
    let Some(mime) = crate::plugins::image::by_extension(Path::new(&name)).map(|d| d.mime()) else {
        out.report.add("blend-image-format");
        out.report
            .notes
            .push(format!("image hors registre d'images: {name}"));
        return None;
    };
    if let Some(bytes) = packed(image) {
        let view = out.bin.view(bytes, None);
        return Some(out.image(json!({"name": name, "mimeType": mime, "bufferView": view})));
    }
    let Some(uri) = linked(&declared, root) else {
        out.report.add("blend-image-outside-source");
        out.report
            .notes
            .push(format!("image hors de la racine servie: {declared}"));
        return None;
    };
    Some(out.image(json!({"name": name, "mimeType": mime, "uri": uri})))
}

/// Les octets empaquetés d'une image, quand elle en porte et qu'ils tiennent sous le plafond.
fn packed<'a>(image: &At<'a>) -> Option<&'a [u8]> {
    let file = image.follow_as("packedfile", "PackedFile")?;
    let size = usize::try_from(file.int("size", 0)).ok()?;
    if size == 0 || size > MAX_PACKED_BYTES {
        return None;
    }
    file.block("data").and_then(|bytes| bytes.get(..size))
}

/// L'URI d'une image seulement désignée, relative à la racine servie et échappée comme toute
/// référence relative d'URI. Une image qui vit hors de cette racine n'a pas d'URI : elle est
/// comptée, et la scène continue sans elle.
pub(super) fn linked(declared: &str, root: &Path) -> Option<String> {
    let relative = declared.strip_prefix("//").unwrap_or(declared);
    let path = Path::new(relative);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let under = normalise(&absolute);
    let inside = under.strip_prefix(normalise(root)).ok()?;
    // Une URI glTF, pas un chemin : `%`, `#`, l'espace et tout ce qui n'est pas un caractère non
    // réservé s'échappe, sinon le consommateur relit un autre nom, ou rien.
    Some(crate::uri::encode_relative(inside))
}
