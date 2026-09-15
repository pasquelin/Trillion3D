//! Les tests des deux contrats, et d'eux seuls : ce que le routeur choisit, ce qu'il refuse, et ce
//! que le registre d'images sait lire. Le comportement de chaque format se prouve dans sa fixture.
use super::*;
use std::{fs, path::PathBuf};

mod image_registry;
mod router;
mod tga;
mod tiff;

/// Un dossier jetable, nommé par le cas qui l'utilise.
fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "wg-plugins-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}
