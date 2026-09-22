use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

fn source_files(directory: &Path, into: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            if path.file_name().is_some_and(|name| name == "tests") {
                continue;
            }
            source_files(&path, into)?;
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            into.push(path);
        }
    }
    Ok(())
}

fn main() -> std::io::Result<()> {
    let mut files = Vec::new();
    source_files(Path::new("src"), &mut files)?;
    files.extend([
        PathBuf::from("Cargo.toml"),
        PathBuf::from("Cargo.lock"),
        PathBuf::from("build.rs"),
    ]);
    files.sort();
    // The whole source directory is watched, not each file in turn: a module added after the
    // previous build is in no per-file watch list, so the build script would not rerun and the
    // next build would keep the previous implementation hash — a cache key that stays still while
    // the compiler moves.
    println!("cargo:rerun-if-changed=src");
    let mut digest = Sha256::new();
    for path in files {
        println!("cargo:rerun-if-changed={}", path.display());
        digest.update(path.to_string_lossy().as_bytes());
        digest.update([0]);
        digest.update(fs::read(path)?);
    }
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    fs::write(
        output.join("implementation_hash.txt"),
        format!("{:x}", digest.finalize()),
    )
}
