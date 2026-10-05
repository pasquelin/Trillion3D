use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

/// The physics cook's C++ (`packages/physics-jolt-wasm`): the physics engine from the pinned submodule and
/// `cook/cook.cpp`, built by the same CMake file as the web module (`-DCOOK=ON`).
const PHYSICS: &str = "../physics-jolt-wasm";

/// The page codec (`packages/page-codec-wasm`), a path dependency built into the compiler.
const CODEC: &str = "../page-codec-wasm";

/// The repository's cargo configuration, which sets the C++ flags the C++ simplifier is built with.
const CARGO_CONFIG: &str = "../../.cargo/config.toml";

fn run(command: &mut Command) {
    let status = command
        .status()
        .expect("cmake is needed to build the physics cook");
    assert!(status.success(), "{command:?} failed");
}

/// Builds and links the native cook; returns the physics engine commit, which enters the compiler's
/// fingerprint: a cache cooked with another engine build is another product.
fn physics_cook(output: &Path) -> String {
    let jolt = Path::new(PHYSICS).join("JoltPhysics");
    assert!(
        jolt.join("Jolt/Jolt.h").exists(),
        "Jolt submodule missing.\nRun: git submodule update --init"
    );
    for watched in [
        "cook",
        "src/blob.h",
        "src/mesh.h",
        "src/softSettings.h",
        "src/words.h",
        "CMakeLists.txt",
        "JoltPhysics/Jolt",
    ] {
        println!("cargo:rerun-if-changed={PHYSICS}/{watched}");
    }
    let commit = Command::new("git")
        .args(["-C", &jolt.to_string_lossy(), "rev-parse", "HEAD"])
        .output()
        .expect("git is needed to name the Jolt commit");
    let commit = String::from_utf8(commit.stdout)
        .expect("commit")
        .trim()
        .to_string();
    assert_eq!(commit.len(), 40, "Jolt submodule has no commit");
    let build = output.join("physics-cook");
    // The cook writes the same bytes on every platform (#1352): the engine's cross-platform mode turns
    // off every fused multiply-add (`-ffp-contract=off`, `/fp:precise`), and an x86-64 build stays
    // on SSE 4.2, which every processor the compiler supports has, rather than assume AVX2. One
    // configuration, `Distribution`, named for the multi-configuration generator of Windows, whose
    // C++ runtime is the dynamic one Rust links.
    run(Command::new("cmake")
        .args(["-S", PHYSICS, "-B"])
        .arg(&build)
        .args([
            "-DCOOK=ON",
            "-DCMAKE_BUILD_TYPE=Distribution",
            "-DCMAKE_CONFIGURATION_TYPES=Distribution",
            "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
            "-DCROSS_PLATFORM_DETERMINISTIC=ON",
            "-DUSE_STATIC_MSVC_RUNTIME_LIBRARY=OFF",
        ])
        .args(
            ["AVX", "AVX2", "LZCNT", "TZCNT", "F16C", "FMADD"]
                .map(|set| format!("-DUSE_{set}=OFF")),
        ));
    run(Command::new("cmake").args(["--build"]).arg(&build).args([
        "--config",
        "Distribution",
        "--target",
        "joltCook",
        "--parallel",
    ]));
    // Windows' multi-configuration generator writes each archive in its configuration's folder.
    let msvc = env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    for directory in [build.clone(), build.join("Jolt")] {
        let archives = if msvc {
            directory.join("Distribution")
        } else {
            directory
        };
        println!("cargo:rustc-link-search=native={}", archives.display());
    }
    println!("cargo:rustc-link-lib=static=joltCook");
    println!("cargo:rustc-link-lib=static=Jolt");
    // The target's C++ library, not the host's: MSVC links its own from the objects.
    match (msvc, env::var("CARGO_CFG_TARGET_OS").as_deref()) {
        (true, _) => {}
        (_, Ok("macos")) => println!("cargo:rustc-link-lib=c++"),
        _ => println!("cargo:rustc-link-lib=stdc++"),
    }
    commit
}

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
    // The page codec is linked in: its encoding is the compiler's, so it enters the hash.
    source_files(&Path::new(CODEC).join("src"), &mut files)?;
    files.extend([
        PathBuf::from("Cargo.toml"),
        PathBuf::from("Cargo.lock"),
        PathBuf::from("build.rs"),
        Path::new(CODEC).join("Cargo.toml"),
        // The C++ flags of the simplifier: `-ffp-contract=off` changes the bytes it produces.
        PathBuf::from(CARGO_CONFIG),
    ]);
    files.sort();
    // The whole source directories are watched, not each file in turn: a module added after the
    // previous build is in no per-file watch list, so the build script would not rerun and the
    // next build would keep the previous implementation hash — a cache key that stays still while
    // the compiler moves.
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed={CODEC}/src");
    let mut digest = Sha256::new();
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    // The inputs as hashed, one per line: what the compiler's own test reads (`compiler_identity`).
    let inputs: Vec<String> = files
        .iter()
        .map(|path| path.display().to_string())
        .collect();
    fs::write(output.join("implementation_inputs.txt"), inputs.join("\n"))?;
    for path in files {
        println!("cargo:rerun-if-changed={}", path.display());
        digest.update(path.to_string_lossy().as_bytes());
        digest.update([0]);
        digest.update(fs::read(path)?);
    }
    let jolt = physics_cook(&output);
    println!("cargo:rustc-env=JOLT_COMMIT={jolt}");
    digest.update(jolt.as_bytes());
    for source in [
        "cook/cook.cpp",
        "src/blob.h",
        "src/mesh.h",
        "src/softSettings.h",
        "src/words.h",
    ] {
        digest.update(fs::read(Path::new(PHYSICS).join(source))?);
    }
    fs::write(
        output.join("implementation_hash.txt"),
        format!("{:x}", digest.finalize()),
    )
}
