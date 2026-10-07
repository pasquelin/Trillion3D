//! The compiler's Rust inputs: its own sources and those of every crate it links from the
//! repository, test code left out. The build hashes this list and the binary prints it
//! (`trillion3d-compiler --build-inputs`): a launch calls a binary stale when a file of it is newer
//! (`packages/sdk-node/src/compiler/freshness.mts`), exactly when its hash would move.

#[path = "build_inputs/code.rs"]
mod code;
#[path = "build_inputs/declarations.rs"]
mod declarations;
#[path = "build_inputs/manifest.rs"]
mod manifest;
#[cfg(test)]
#[path = "build_inputs/tests.rs"]
mod tests;

use declarations::declarations;

use std::{
    fs, io,
    path::{Component, Path, PathBuf},
};

/// `path` with its `.` and `..` folded away by name: `../page-codec-wasm/../math/rust` is
/// `../math/rust`, one crate under one name.
fn normal(path: &Path) -> PathBuf {
    let mut out: Vec<Component> = Vec::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir if matches!(out.last(), Some(Component::Normal(_))) => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out.iter().collect()
}

/// The path dependencies of the manifest in `crate_dir` that link into the build, resolved from
/// `crate_dir`.
fn manifest_paths(crate_dir: &Path) -> io::Result<Vec<PathBuf>> {
    let manifest = fs::read_to_string(crate_dir.join("Cargo.toml"))?;
    Ok(manifest::dependency_paths(&manifest)
        .into_iter()
        .map(|path| normal(&crate_dir.join(path)))
        .collect())
}

/// The crates the compiler builds from the repository, relative to its own folder: the path
/// dependencies of its manifest, then theirs, each once (the page codec, the maths).
pub fn path_dependencies() -> io::Result<Vec<PathBuf>> {
    let mut crates: Vec<PathBuf> = Vec::new();
    let mut pending = manifest_paths(Path::new("."))?;
    while let Some(next) = pending.pop() {
        if !crates.contains(&next) {
            pending.extend(manifest_paths(&next)?);
            crates.push(next);
        }
    }
    crates.sort();
    Ok(crates)
}

/// Whether a file or folder name is test code by its name, as `isTestModule`
/// (`scripts/repository-files.ts`) reads a Rust path — `test`, `tests`, or ending in `_test` or
/// `_tests` — or the golden harness (`golden.rs`, `golden/`), built for the tests alone.
fn test_named(name: &str) -> bool {
    let stem = name.strip_suffix(".rs").unwrap_or(name);
    let suffixed = |suffix: &str| {
        stem.strip_suffix(suffix).is_some_and(|head| {
            !head.is_empty() && head.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
    };
    matches!(stem, "test" | "tests" | "golden") || suffixed("_test") || suffixed("_tests")
}

fn rust_files(directory: &Path, into: &mut Vec<PathBuf>) -> io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            rust_files(&path, into)?;
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            into.push(path);
        }
    }
    Ok(())
}

/// The production sources of the crate in `crate_dir`: the `.rs` files of its `src` folder but the
/// test code — those named as tests, the modules a `#[cfg(test)]` declares, and every module a
/// test file declares, to the last.
pub fn production_sources(crate_dir: &Path, into: &mut Vec<PathBuf>) -> io::Result<()> {
    let src = normal(&crate_dir.join("src"));
    let mut files = Vec::new();
    rust_files(&src, &mut files)?;
    files.sort();
    let mut declared = Vec::new();
    for (by, file) in files.iter().enumerate() {
        let text = fs::read_to_string(file)?;
        declared.extend(
            declarations(file, &text)
                .into_iter()
                .map(|module| (by, module)),
        );
    }
    let mut test: Vec<bool> = files
        .iter()
        .map(|file| {
            let inside = file.strip_prefix(&src).unwrap_or(file);
            inside
                .iter()
                .any(|part| part.to_str().is_some_and(test_named))
        })
        .collect();
    loop {
        let grown: Vec<usize> = (0..files.len())
            .filter(|&at| !test[at])
            .filter(|&at| {
                declared
                    .iter()
                    .any(|(by, module)| (module.test || test[*by]) && module.covers(&files[at]))
            })
            .collect();
        if grown.is_empty() {
            break;
        }
        grown.into_iter().for_each(|at| test[at] = true);
    }
    into.extend(
        files
            .into_iter()
            .zip(test)
            .filter(|(_, test)| !test)
            .map(|(file, _)| file),
    );
    Ok(())
}
