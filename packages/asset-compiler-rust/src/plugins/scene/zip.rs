//! ZIP driver, a container. The archive is not a scene: it is extracted under the cache, then its
//! contents are routed like any other source, and this driver yields whatever the retained scene
//! driver yields. Nothing is re-encoded — a ZIP is wrapping, extraction is lossless.
//!
//! Provenance: open format (APPNOTE 6.3.10, PKWARE), read by `archive/zip_reader.rs`, the ZIP
//! reader shared with the `usdz` container.
use super::*;

pub(super) static ZIP: Zip = Zip;
pub(super) struct Zip;

impl Plugin for Zip {
    fn name(&self) -> &'static str {
        "zip"
    }
    /// The container reads no geometry: this version names the extractor, not a decoder.
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
        archive::container(request, self, None, |file, root| {
            archive::zip_reader::extract(request, file, root)
        })
    }
}
