//! Shared base for drivers served by ufbx (MIT, pinned version, no editor SDK).
//!
//! Two formats, two drivers: they differ only by name, version, extension and header. Conversion
//! to the intermediate scene lives once — in `import`.
use super::*;

pub(super) struct UfbxDriver {
    pub(super) name: &'static str,
    pub(super) version: &'static str,
    pub(super) extensions: &'static [&'static str],
    /// Format header, empty for a text format that only its extension identifies.
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
        crate::import::import_source(request, self).map(|directory| request.converted(directory))
    }
}
