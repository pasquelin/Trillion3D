//! KML Model packages reuse the guarded ZIP extractor and static COLLADA decoder.
use super::mesh_source as source;
use super::*;
use crate::import::SceneTables;
use std::fs;
mod kml;
mod placement;
#[cfg(test)]
mod tests;
pub(super) static KMZ: Kmz = Kmz;
pub(super) struct Kmz;
impl Plugin for Kmz {
    fn name(&self) -> &'static str {
        "kmz"
    }
    fn version(&self) -> &'static str {
        "kmz-kml22-collada-static-1"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["kmz"]
    }
}
impl ScenePlugin for Kmz {
    fn accepts_head(&self, _: &[u8]) -> bool {
        false
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        let file = archive::only_input(request, self)?;
        let mut zip =
            ::zip::ZipArchive::new(fs::File::open(file)?).map_err(|e| source::invalid("kmz", e))?;
        archive::under_entry_limit(zip.len())?;
        let mut paths = std::collections::BTreeSet::new();
        for index in 0..zip.len() {
            let entry = zip
                .by_index_raw(index)
                .map_err(|e| source::invalid("kmz", e))?;
            let path = archive::safe_join(Path::new("package"), entry.name())?;
            if !paths.insert(path) {
                return Err(source::invalid("kmz", "duplicate package path"));
            }
        }
        drop(zip);
        archive::container(request, self, None, |file, root| {
            let counts = archive::zip_reader::extract(request, file, root)?;
            for name in ["model.gltf", "model.bin", "manifest.json"] {
                if root.join(name).exists() {
                    return Err(source::invalid(
                        "kmz",
                        "package collides with generated scene names",
                    ));
                }
            }
            let mut scene = SceneTables::new(self);
            let metadata = fs::metadata(file)?;
            scene.read_file(
                &file.file_name().unwrap_or_default().to_string_lossy(),
                metadata.len() as usize,
                &crate::hash_file(file)?,
            );
            kml::read(root, request, &mut scene)?;
            if !scene.nodes.iter().any(|n| n["mesh"].is_number()) {
                return Err(source::invalid("kmz", "package has no Model surface"));
            }
            scene.write(self, root, file, Instant::now())?;
            Ok(counts)
        })
    }
}
