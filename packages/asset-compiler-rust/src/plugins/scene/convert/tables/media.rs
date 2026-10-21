//! glTF table images and textures: shared registry for drivers naming
//! images by URI under resource root.
//!
//! Image added once per URI, texture once per pair
//! (image, sampler): two material entries displaying same file same
//! way cite same texture, regardless of writing driver.
use super::*;

/// The path of `path` relative to `root`, both made absolute and rid of `.` and `..`, its
/// segments joined by `/`; `None` outside `root`. The one rule by which a driver names an image
/// under the served root, before `SceneTables::image` escapes it as a URI.
pub(crate) fn relative_under(root: &Path, path: &Path) -> Option<String> {
    let relative = normalise(path)
        .strip_prefix(normalise(root))
        .ok()?
        .to_path_buf();
    let parts: Vec<String> = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect();
    Some(parts.join("/"))
}

/// MIME type of image driver claiming URI under root, when file present.
fn readable(root: &Path, uri: &str) -> Option<&'static str> {
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
        let uri = crate::support::uri::encode_relative(Path::new(&relative));
        self.images
            .push(json!({"name":name,"mimeType":mime,"uri":uri}));
        let index = self.images.len() - 1;
        self.images_by_uri.insert(relative, index);
        index
    }

    /// Rank of an image the source embeds, its bytes copied into the binary.
    pub(crate) fn image_embedded(&mut self, name: &str, mime: &'static str, bytes: &[u8]) -> usize {
        let view = self.bin.view(bytes, None);
        self.images
            .push(json!({"name":name,"mimeType":mime,"bufferView":view}));
        self.images.len() - 1
    }

    /// Rank of the image at the first of `candidates` — paths relative to `root` — an image
    /// driver reads there, added on first request. When none reads, the texture the source names
    /// `written` is reported missing and the scene continues without it: one refusal, whatever
    /// the driver.
    pub(crate) fn image_found(
        &mut self,
        root: &Path,
        candidates: impl IntoIterator<Item = String>,
        written: &str,
    ) -> Option<usize> {
        let mut candidates = candidates.into_iter();
        let found = candidates.find_map(|path| readable(root, &path).map(|mime| (path, mime)));
        let Some((relative, mime)) = found else {
            self.report
                .add(crate::plugins::scene::codes::TEXTURE_MISSING);
            self.report.notes.push(format!(
                "unreadable texture or outside image registry: {written}"
            ));
            return None;
        };
        Some(self.image(relative, mime))
    }

    /// Rank of texture binding image to sampler, added once.
    pub(crate) fn texture(&mut self, source: usize, sampler: usize) -> usize {
        if let Some(known) = self.textures_by_pair.get(&(source, sampler)) {
            return *known;
        }
        self.textures
            .push(json!({"source":source,"sampler":sampler}));
        self.count("textures", 1);
        let rank = self.textures.len() - 1;
        self.textures_by_pair.insert((source, sampler), rank);
        rank
    }
}
