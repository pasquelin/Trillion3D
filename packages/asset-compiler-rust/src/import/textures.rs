use super::*;
use crate::gltf_codes::{CLAMP_TO_EDGE, REPEAT};
use tables::media::relative_under;

/// Per-file view over the shared image/sampler/texture tables; indices it hands out are final.
pub(super) struct TextureTable<'a> {
    pub(super) source_dir: &'a Path,
    /// The tables every driver fills: images by URI once, samplers by setting, textures by pair.
    pub(super) scene: &'a mut SceneTables,
    /// Audit record carrying import identity: each tried image path enters, present
    /// or not. Without it, image added near unchanged source did not alter key.
    pub(super) externals: &'a external::Externals,
    pub(super) by_element: HashMap<u32, Option<usize>>,
}
/// Map option declared "on": `-clamp on` form of material library, which
/// reader stores as raw property without applying.
fn switched_on(texture: &ufbx::Texture, name: &str) -> bool {
    texture
        .element
        .props
        .find_prop(name)
        .map(|prop| prop.value_int != 0)
        .unwrap_or(false)
}

impl<'a> TextureTable<'a> {
    pub(super) fn wrap(mode: ufbx::WrapMode) -> u32 {
        match mode {
            ufbx::WrapMode::Clamp => CLAMP_TO_EDGE,
            _ => REPEAT,
        }
    }
    pub(super) fn sampler(&mut self, texture: &ufbx::Texture) -> usize {
        // `-clamp on` sets border mode for both axes: option source declares and
        // glTF supports as-is is not counted, it is converted.
        if switched_on(texture, "clamp") {
            return self.scene.sampler_uv(CLAMP_TO_EDGE, CLAMP_TO_EDGE);
        }
        self.scene
            .sampler_uv(Self::wrap(texture.wrap_u), Self::wrap(texture.wrap_v))
    }
    /// MIME type of image driver claiming path. Outside registry, nothing: intermediate
    /// glTF names only images an image driver knows how to read.
    pub(super) fn mime(path: &Path) -> Option<&'static str> {
        crate::plugins::image::by_extension(path).map(|decoder| decoder.mime())
    }
    /// Finds a decodable image for a texture: embedded bytes first, then the declared paths inside the
    /// source directory, then a sibling of a format the image registry knows, next to one it does not.
    pub(super) fn resolve(&mut self, texture: &ufbx::Texture) -> Option<usize> {
        let name = Path::new(&*texture.filename)
            .file_name()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                Path::new(&*texture.relative_filename)
                    .file_name()
                    .and_then(|s| s.to_str())
            })
            .unwrap_or("texture")
            .to_string();
        if !texture.content.is_empty() {
            let Some(mime) = Self::mime(Path::new(&name)) else {
                self.scene.report.add("texture-embedded-format");
                return None;
            };
            return Some(self.scene.image_embedded(&name, mime, &texture.content));
        }
        let mut candidates: Vec<PathBuf> = Vec::new();
        for declared in [
            &*texture.absolute_filename,
            &*texture.relative_filename,
            &*texture.filename,
        ] {
            if declared.is_empty() {
                continue;
            }
            let path = Path::new(declared);
            candidates.push(if path.is_absolute() {
                path.to_path_buf()
            } else {
                self.source_dir.join(path)
            });
        }
        candidates.push(self.source_dir.join(&name));
        candidates.push(self.source_dir.join("textures").join(&name));
        let mut siblings = Vec::new();
        for candidate in &candidates {
            for extension in crate::plugins::image::extensions() {
                siblings.push(candidate.with_extension(extension));
            }
        }
        // Declared paths often repeat — absolute name, relative name, bare name refer to
        // same file. Trying them once yields same answer and readable audit record.
        let mut seen = std::collections::HashSet::new();
        let examined: Vec<PathBuf> = candidates
            .into_iter()
            .chain(siblings)
            .filter(|path| seen.insert(path.clone()))
            .collect();
        let mut outside = false;
        for candidate in &examined {
            // Consulted, hence decisive: state enters import identity, whether existing
            // or not. Loop stops at first retained candidate, audit record along with it.
            self.externals.note_texture(candidate);
            if !candidate.is_file() {
                continue;
            }
            let Some(mime) = Self::mime(candidate) else {
                continue;
            };
            let Some(relative) = relative_under(self.source_dir, candidate) else {
                outside = true;
                continue;
            };
            return Some(self.scene.image(relative, mime));
        }
        self.scene.report.add(if outside {
            "texture-outside-source"
        } else if Self::mime(Path::new(&name)).is_some() {
            crate::plugins::scene::codes::TEXTURE_MISSING
        } else {
            "texture-format"
        });
        None
    }
    pub(super) fn texture(&mut self, texture: &ufbx::Texture) -> Option<usize> {
        let id = texture.element.element_id;
        if let Some(known) = self.by_element.get(&id) {
            return *known;
        }
        let file: Option<&ufbx::Texture> = if texture.type_ == ufbx::TextureType::File {
            Some(texture)
        } else {
            texture.file_textures.iter().next().map(|t| &**t)
        };
        let result = match file {
            Some(file) => match self.resolve(file) {
                Some(image) => {
                    if texture.has_uv_transform {
                        self.scene.report.add("texture-uv-transform");
                    }
                    let sampler = self.sampler(file);
                    Some(self.scene.texture(image, sampler))
                }
                None => None,
            },
            None => {
                self.scene.report.add("texture-procedural");
                None
            }
        };
        self.by_element.insert(id, result);
        result
    }
}
