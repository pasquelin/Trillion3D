//! Les images et les textures des tables glTF : le registre partagé par les pilotes qui nomment
//! leurs images par leur URI sous la racine des ressources.
//!
//! Une image n'est versée qu'une fois par URI, et une texture qu'une fois par couple
//! (image, échantillonneur) : deux entrées de matériau qui montrent le même fichier de la même
//! façon citent la même texture, quel que soit le pilote qui les écrit.
use super::*;

/// Le type MIME du pilote d'image qui revendique cette URI sous la racine, quand le fichier y est.
pub(crate) fn readable(root: &Path, uri: &str) -> Option<&'static str> {
    let path = root.join(uri);
    crate::plugins::image::by_extension(&path)
        .filter(|_| path.is_file())
        .map(|decoder| decoder.mime())
}

impl SceneTables {
    /// Le rang de l'image de cette URI relative, versée à la première demande.
    pub(crate) fn image(&mut self, relative: String, mime: &'static str) -> usize {
        if let Some(known) = self.images_by_uri.get(&relative) {
            return *known;
        }
        let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();
        // Une URI glTF, pas le chemin sous la racine : `%`, `#`, l'espace et tout ce qui n'est pas
        // un caractère non réservé s'échappe, sinon le consommateur relit un autre nom, ou rien.
        let uri = crate::uri::encode_relative(Path::new(&relative));
        self.images
            .push(json!({"name":name,"mimeType":mime,"uri":uri}));
        let index = self.images.len() - 1;
        self.images_by_uri.insert(relative, index);
        index
    }

    /// Note au rapport la texture qu'aucun pilote d'image ne lit sous la racine, par le chemin que
    /// la source en écrivait : la scène continue sans elle.
    pub(crate) fn image_unreadable(&mut self, written: &str) {
        self.report.notes.push(format!(
            "texture illisible ou hors registre d'images: {written}"
        ));
    }

    /// Le rang de la texture qui lie cette image à cet échantillonneur, versée une seule fois.
    pub(crate) fn texture(&mut self, source: usize, sampler: usize) -> usize {
        let entry = json!({"source":source,"sampler":sampler});
        if let Some(known) = self.textures.iter().position(|kept| *kept == entry) {
            return known;
        }
        self.textures.push(entry);
        self.count("textures", 1);
        self.textures.len() - 1
    }
}
