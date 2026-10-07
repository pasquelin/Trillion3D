//! The build's reading of the compiler's inputs (`build_inputs.rs`), tested here — a build script
//! has no test harness of its own —, and the list the binary prints of them.
#[path = "../build_inputs.rs"]
mod build_inputs;

use std::{path::Path, process::Command};

// Behaviour: `--build-inputs` prints the list the build hashed, one file per line: every production
// source of the compiler and of the crates it links, and their manifests.
#[test]
fn the_binary_prints_the_inputs_its_build_hashed() {
    let output = Command::new(env!("CARGO_BIN_EXE_trillion3d-compiler"))
        .arg("--build-inputs")
        .output()
        .unwrap();
    assert!(output.status.success());
    let printed = String::from_utf8(output.stdout).unwrap();
    let printed: Vec<&str> = printed.lines().collect();
    let mut sources = Vec::new();
    build_inputs::production_sources(Path::new("."), &mut sources).unwrap();
    for linked in build_inputs::path_dependencies().unwrap() {
        build_inputs::production_sources(&linked, &mut sources).unwrap();
        sources.push(linked.join("Cargo.toml"));
    }
    for source in sources {
        let source = source.display().to_string();
        assert!(
            printed.contains(&source.as_str()),
            "{source} is not printed"
        );
    }
    assert!(printed.contains(&"Cargo.lock"));
}
