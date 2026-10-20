//! The intermediate scene a driver hands the compiler: where it lies, and where its image URIs
//! resolve.
use super::image_root;
use std::path::{Path, PathBuf};

/// The intermediate scene, ready to load.
pub enum PreparedScene {
    /// The source already carried `manifest.json`: it is the intermediate scene, no driver.
    Manifest,
    /// The named glTF file is read as-is under the source: the driver converted nothing.
    InPlace(String),
    /// The driver wrote `model.gltf`, `model.bin` and their manifest into `directory`, under
    /// the cache. `images` remains the root where its image URIs resolve, which has not moved.
    Converted { directory: PathBuf, images: PathBuf },
    /// The named glTF file is read as-is under `directory`, an archive's extraction, where its
    /// image URIs resolve too: nothing converted, nothing written beside it. The compiler computes
    /// its manifest as for a glTF outside an archive — the same identity —, in the one load.
    Extracted { directory: PathBuf, file: String },
}

impl PreparedScene {
    /// A scene written into `directory`, whose image URIs resolve under `images`.
    pub fn converted(directory: PathBuf, images: &Path) -> Self {
        Self::Converted {
            directory,
            images: images.to_path_buf(),
        }
    }
    /// Image-resolution root of this scene. `source` is the path given to the compiler, which
    /// an unconverted scene never leaves.
    pub fn images(&self, source: &Path) -> PathBuf {
        match self {
            Self::Converted { images, .. } => images.clone(),
            Self::Extracted { directory, .. } => directory.clone(),
            Self::Manifest | Self::InPlace(_) => image_root(source),
        }
    }
}
