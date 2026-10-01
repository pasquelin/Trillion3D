//! MPD virtual files and bounded local dependencies; nothing consults an installed part library.
use super::*;
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

pub(super) struct Documents {
    pub files: BTreeMap<String, String>,
    root: PathBuf,
    bytes: usize,
}
impl Documents {
    pub fn new(bytes: &[u8], request: &SceneRequest<'_>) -> Result<(Self, String)> {
        let root = request
            .inputs
            .first()
            .and_then(|p| p.parent())
            .unwrap_or(Path::new("."));
        let mut out = Self {
            files: BTreeMap::new(),
            root: root.to_path_buf(),
            bytes: 0,
        };
        let name = request
            .inputs
            .first()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("main.ldr");
        let first = out.insert(name, bytes, request)?;
        Ok((out, first))
    }
    fn insert(&mut self, name: &str, bytes: &[u8], request: &SceneRequest<'_>) -> Result<String> {
        self.bytes = self.bytes.saturating_add(bytes.len());
        source::admit(self.bytes, request.ram_budget / 8, "ldraw")?;
        let text =
            std::str::from_utf8(bytes).map_err(|_| source::invalid("ldraw", "invalid UTF-8"))?;
        let mut current = None;
        let mut first = None;
        let mut prefix = String::new();
        for line in text.lines() {
            let line = line.trim();
            if let Some(file) = line.strip_prefix("0 FILE ") {
                let key = key(file)?;
                if self.files.insert(key.clone(), String::new()).is_some() {
                    return Err(source::invalid("ldraw", "duplicate MPD file"));
                }
                if first.is_none() {
                    if prefix
                        .lines()
                        .any(|line| !line.is_empty() && !line.starts_with("0 "))
                    {
                        return Err(source::invalid("ldraw", "geometry before MPD FILE"));
                    }
                    self.files.get_mut(&key).unwrap().push_str(&prefix);
                }
                first.get_or_insert(key.clone());
                current = Some(key);
            } else if line == "0 NOFILE" {
                current = None;
            } else if let Some(file) = &current {
                let body = self.files.get_mut(file).unwrap();
                body.push_str(line);
                body.push('\n');
            } else if first.is_none() {
                prefix.push_str(line);
                prefix.push('\n');
            } else if !line.is_empty() && !line.starts_with('0') {
                return Err(source::invalid("ldraw", "geometry outside an MPD FILE"));
            }
        }
        if let Some(first) = first {
            return Ok(first);
        }
        let name = key(name)?;
        if self.files.insert(name.clone(), text.to_owned()).is_some() {
            return Err(source::invalid("ldraw", "duplicate dependency"));
        }
        Ok(name)
    }
    pub fn get(
        &mut self,
        name: &str,
        request: &SceneRequest<'_>,
        scene: &mut SceneTables,
    ) -> Result<String> {
        let key = key(name)?;
        if !self.files.contains_key(&key) {
            let path = super::super::archive::safe_join(&self.root, &name.replace('\\', "/"))?;
            let root = self.root.canonicalize()?;
            let path = path.canonicalize()?;
            if !path.starts_with(&root) {
                return Err(source::invalid("ldraw", "dependency escapes model root"));
            }
            super::super::archive::check(request)?;
            let remaining = (request.ram_budget / 8).saturating_sub(self.bytes);
            let mut bytes = Vec::new();
            File::open(path)?
                .take(remaining as u64 + 1)
                .read_to_end(&mut bytes)?;
            source::admit(bytes.len(), remaining, "ldraw")?;
            scene.read_file(&key, bytes.len(), &crate::hash(&bytes));
            let main = self.insert(name, &bytes, request)?;
            if main != key {
                let body = self.files[&main].clone();
                self.files.insert(key.clone(), body);
            }
        }
        Ok(self.files[&key].clone())
    }
}
pub(super) fn key(name: &str) -> Result<String> {
    let name = name.trim().replace('\\', "/");
    super::super::archive::safe_join(Path::new("model"), &name)?;
    Ok(name.to_ascii_lowercase())
}
