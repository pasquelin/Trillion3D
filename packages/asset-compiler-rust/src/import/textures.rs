use super::*;

/// Per-file view over the shared image/sampler/texture tables; indices it hands out are final.
pub(super) struct TextureTable<'a> {
    pub(super) source_dir: &'a Path,
    pub(super) canonical_dir: PathBuf,
    pub(super) bin: &'a mut Bin,
    pub(super) images: &'a mut Vec<Value>,
    pub(super) samplers: &'a mut Vec<Value>,
    pub(super) textures: &'a mut Vec<Value>,
    pub(super) sampler_ids: &'a mut HashMap<(u32, u32), usize>,
    pub(super) report: &'a mut Report,
    pub(super) by_element: HashMap<u32, Option<usize>>,
}
impl<'a> TextureTable<'a> {
    pub(super) fn wrap(mode: ufbx::WrapMode) -> u32 {
        match mode {
            ufbx::WrapMode::Clamp => 33071,
            _ => 10497,
        }
    }
    pub(super) fn sampler(&mut self, texture: &ufbx::Texture) -> usize {
        let key = (Self::wrap(texture.wrap_u), Self::wrap(texture.wrap_v));
        if let Some(id) = self.sampler_ids.get(&key) {
            return *id;
        }
        self.samplers
            .push(json!({"magFilter":9729,"minFilter":9987,"wrapS":key.0,"wrapT":key.1}));
        let id = self.samplers.len() - 1;
        self.sampler_ids.insert(key, id);
        id
    }
    /// Le type MIME du pilote d'image qui revendique ce chemin. Hors registre, rien : le glTF
    /// intermédiaire ne nomme que des images qu'un pilote sait relire.
    pub(super) fn mime(path: &Path) -> Option<&'static str> {
        crate::plugins::image::by_extension(path).map(|decoder| decoder.mime())
    }
    /// Finds a decodable image for a texture: embedded bytes first, then the declared paths inside the
    /// source directory, then a sibling of a format the image registry knows, next to one it does not.
    pub(super) fn resolve(&mut self, texture: &ufbx::Texture) -> Option<Value> {
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
                self.report.add("texture-embedded-format");
                return None;
            };
            let view = self.bin.view(&texture.content, None);
            return Some(json!({"name":name,"mimeType":mime,"bufferView":view}));
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
        let mut outside = false;
        for candidate in candidates.iter().chain(siblings.iter()) {
            if !candidate.is_file() {
                continue;
            }
            let Some(mime) = Self::mime(candidate) else {
                continue;
            };
            let Ok(relative) = normalise(candidate)
                .strip_prefix(&self.canonical_dir)
                .map(Path::to_path_buf)
            else {
                outside = true;
                continue;
            };
            let uri = relative
                .components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/");
            return Some(json!({"name":name,"mimeType":mime,"uri":uri}));
        }
        self.report.add(if outside {
            "texture-outside-source"
        } else if Self::mime(Path::new(&name)).is_some() {
            "texture-missing"
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
                        self.report.add("texture-uv-transform");
                    }
                    self.images.push(image);
                    let sampler = self.sampler(file);
                    self.textures
                        .push(json!({"source":self.images.len()-1,"sampler":sampler}));
                    Some(self.textures.len() - 1)
                }
                None => None,
            },
            None => {
                self.report.add("texture-procedural");
                None
            }
        };
        self.by_element.insert(id, result);
        result
    }
}
