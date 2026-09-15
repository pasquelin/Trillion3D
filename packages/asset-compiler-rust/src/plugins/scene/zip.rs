//! Pilote ZIP, conteneur. L'archive n'est pas une scène : elle est extraite sous le cache, puis son
//! contenu est routé comme n'importe quelle source, et ce pilote rend ce que le pilote de scène
//! retenu rend. Rien n'est réencodé — un ZIP est un emballage, l'extraction est sans perte.
//!
//! Provenance : format ouvert (APPNOTE 6.3.10, PKWARE), lu par `archive/zip_reader.rs`, le module
//! de lecture ZIP partagé avec le conteneur `usdz`.
use super::*;

pub(super) static ZIP: Zip = Zip;
pub(super) struct Zip;

impl Plugin for Zip {
    fn name(&self) -> &'static str {
        "zip"
    }
    /// Le conteneur ne lit aucune géométrie : cette version nomme l'extracteur, pas un décodeur.
    fn version(&self) -> &'static str {
        "zip-appnote-6.3.10-zip-8.6.0-extract-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["zip"]
    }
}

impl ScenePlugin for Zip {
    fn accepts_head(&self, head: &[u8]) -> bool {
        archive::zip_reader::accepts_head(head)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        archive::container(request, self, |file, root| {
            archive::zip_reader::extract(request, file, root)
        })
    }
}
