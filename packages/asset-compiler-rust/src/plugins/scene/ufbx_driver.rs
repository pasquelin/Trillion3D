//! Socle des pilotes servis par ufbx (MIT, version figée, aucun SDK d'éditeur).
//!
//! Deux formats, deux pilotes : ils ne diffèrent que par leur nom, leur version, leur extension et
//! leur entête. La conversion vers la scène intermédiaire, elle, vit une seule fois — dans `import`.
use super::*;

pub(super) struct UfbxDriver {
    pub(super) name: &'static str,
    pub(super) version: &'static str,
    pub(super) extensions: &'static [&'static str],
    /// Entête du format, vide pour un format texte que seule son extension désigne.
    pub(super) magic: &'static [u8],
}

impl Plugin for UfbxDriver {
    fn name(&self) -> &'static str {
        self.name
    }
    fn version(&self) -> &'static str {
        self.version
    }
    fn extensions(&self) -> &'static [&'static str] {
        self.extensions
    }
}

impl ScenePlugin for UfbxDriver {
    fn accepts_head(&self, head: &[u8]) -> bool {
        !self.magic.is_empty() && head.starts_with(self.magic)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        crate::import::import_source(request, self).map(PreparedScene::Converted)
    }
}
