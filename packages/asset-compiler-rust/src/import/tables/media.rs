//! glTF table images and textures: shared registry for drivers naming
//! images by URI under resource root.
//!
//! Image added once per URI, texture once per pair
//! (image, sampler): two material entries displaying same file same
//! way cite same texture, regardless of writing driver.
use super::*;

/// MIME type of image driver claiming URI under root, when file present.
pub(crate) fn readable(root: &Path, uri: &str) -> Option<&'static str> {
    let path = root.join(uri);
    crate::plugins::image::by_extension(&path)
        .filter(|_| path.is_file())
        .map(|decoder| decoder.mime())
}

impl SceneTables {
    /// Rank of image for relative URI, added on first request.
    pub(crate) fn image(&mut self, relative: String, mime: &'static str) -> usize {
        if let Some(known) = self.images_by_uri.get(&relative) {
            return *known;
        }
        let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();
        // glTF URI, not path under root: `%`, `#`, space, non-unreserved chars
        // escaped, otherwise consumer reads different name or nothing.
        let uri = crate::uri::encode_relative(Path::new(&relative));
        self.images
            .push(json!({"name":name,"mimeType":mime,"uri":uri}));
        let index = self.images.len() - 1;
        self.images_by_uri.insert(relative, index);
        index
    }

    /// Reports texture no image driver reads under root, by source path:
    /// scene continues without it.
    pub(crate) fn image_unreadable(&mut self, written: &str) {
        self.report.notes.push(format!(
            "texture illisible ou hors registre d'images: {written}"
        ));
    }

    /// Rank of texture binding image to sampler, added once.
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
