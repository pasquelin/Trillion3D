//! Regenerate the Rust/TypeScript proxy contract fixtures, and report exact serialized bytes.
use trillion3d_compiler::proxy;
#[path = "../src/proxy/share_fixture.rs"]
mod fixture;

fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../sdk-core/src/scene/core/fixtures");
    let proxy = fixture::binary_fixture();
    for (name, bytes) in [
        ("proxy-v5.bin", proxy.encode()),
        ("proxy-flat.bin", fixture::flat_file(&proxy)),
    ] {
        std::fs::create_dir_all(&root).expect("fixture directory");
        std::fs::write(root.join(name), bytes).expect("fixture written");
    }
    let proxy = fixture::lattice(1000, fixture::plate());
    println!(
        "proxy.bin serialized bytes (not runtime RSS): v3={}, v5={}, shared={}/1000",
        fixture::flat_file(&proxy).len(),
        proxy.encode().len(),
        proxy.sharing.instances.len()
    );
}
