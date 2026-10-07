//! The compiler's Rust inputs: its own sources and those of every crate it links from the
//! repository, test code left out. `packages/sdk-node/src/compiler/buildInputs.mts` reads the same
//! list the same way, so a launch calls a binary stale exactly when its hash would move.

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

/// The `{ path = "…" }` entries of the manifest in `crate_dir`, in the sections that link into the
/// build — every `…dependencies` table but `dev-dependencies` —, resolved from `crate_dir`.
fn manifest_paths(crate_dir: &Path) -> io::Result<Vec<PathBuf>> {
    let manifest = fs::read_to_string(crate_dir.join("Cargo.toml"))?;
    let mut linked = false;
    let mut out = Vec::new();
    for line in manifest.lines().map(str::trim) {
        if let Some(section) = line.strip_prefix('[') {
            let name = section.trim_end_matches(']');
            linked = name.ends_with("dependencies") && !name.ends_with("dev-dependencies");
        } else if linked && line.contains('{') {
            if let Some((path, _)) = line
                .split_once("path = \"")
                .and_then(|(_, rest)| rest.split_once('"'))
            {
                out.push(normal(&crate_dir.join(path)));
            }
        }
    }
    Ok(out)
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

/// A `mod name;` of a source: the module it names — a file under `#[path]`, else the path of
/// `name.rs` and `name/` without extension — and whether `#[cfg(test)]` gates it.
struct Declaration {
    module: PathBuf,
    exact: bool,
    test: bool,
}

impl Declaration {
    fn covers(&self, file: &Path) -> bool {
        match self.exact {
            true => file == self.module,
            false => file == self.module.with_extension("rs") || file.starts_with(&self.module),
        }
    }
}

/// The `mod name;` declarations of `file`, line comments cut. The attributes read are those
/// between the declaration and the item before it.
fn declarations(file: &Path, text: &str) -> Vec<Declaration> {
    let here = file.parent().unwrap_or(Path::new(""));
    let stem = file
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("");
    let dir = match stem {
        "lib" | "main" | "mod" => here.to_path_buf(),
        _ => file.with_extension(""),
    };
    let code: Vec<&str> = text
        .lines()
        .map(|line| line.split_once("//").map_or(line, |(code, _)| code))
        .collect();
    let code = code.join("\n");
    let mut out = Vec::new();
    for (at, _) in code.match_indices("mod") {
        let word = |c: char| c.is_alphanumeric() || c == '_';
        let rest = &code[at + 3..];
        if code[..at].ends_with(word) || !rest.starts_with(char::is_whitespace) {
            continue;
        }
        let rest = rest.trim_start();
        let end = rest.find(|c: char| !word(c)).unwrap_or(rest.len());
        if end == 0 || !rest[end..].trim_start().starts_with(';') {
            continue;
        }
        let head = &code[code[..at].rfind([';', '{', '}']).map_or(0, |i| i + 1)..at];
        let path = head
            .split_once("#[path = \"")
            .and_then(|(_, path)| path.split_once('"'));
        out.push(Declaration {
            module: path.map_or_else(
                || dir.join(&rest[..end]),
                |(path, _)| normal(&here.join(path)),
            ),
            exact: path.is_some(),
            test: head.contains("#[cfg(test)]"),
        });
    }
    out
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
