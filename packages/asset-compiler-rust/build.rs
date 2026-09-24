use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

/// The physics cook's C++ (`packages/physics-jolt-wasm`): Jolt from the pinned submodule and
/// `cook/cook.cpp`, built by the same CMake file as the web module (`-DCOOK=ON`).
const PHYSICS: &str = "../physics-jolt-wasm";

/// The page codec (`packages/page-codec-wasm`), a path dependency built into the compiler.
const CODEC: &str = "../page-codec-wasm";

fn run(command: &mut Command) {
    let status = command
        .status()
        .expect("cmake is needed to build the physics cook");
    assert!(status.success(), "{command:?} failed");
}

/// Builds and links the native cook; returns the Jolt commit, which enters the compiler's
/// fingerprint: a cache cooked with another Jolt is another product.
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
    run(Command::new("cmake")
        .args(["-S", PHYSICS, "-B"])
        .arg(&build)
        .args([
            "-DCOOK=ON",
            "-DCMAKE_BUILD_TYPE=Distribution",
            "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
        ]));
    run(Command::new("cmake").args(["--build"]).arg(&build).args([
        "--target",
        "joltCook",
        "--parallel",
    ]));
    println!("cargo:rustc-link-search=native={}", build.display());
    println!(
        "cargo:rustc-link-search=native={}",
        build.join("Jolt").display()
    );
    println!("cargo:rustc-link-lib=static=joltCook");
    println!("cargo:rustc-link-lib=static=Jolt");
    let cpp = if cfg!(target_os = "macos") {
        "c++"
    } else {
        "stdc++"
    };
    println!("cargo:rustc-link-lib={cpp}");
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
    for source in ["cook/cook.cpp", "src/mesh.h"] {
        digest.update(fs::read(Path::new(PHYSICS).join(source))?);
    }
    fs::write(
        output.join("implementation_hash.txt"),
        format!("{:x}", digest.finalize()),
    )
}
