use crate::compiler::source::assembly::plan::AssemblyParents;
use crate::hlod::options::Assigned;
use crate::*;
mod finish;
mod primitives;
mod products;
pub(crate) mod progress;
mod scene;
mod stages;
use scene::{load_scene, pick, read_images, rooted, Job};
use stages::{compile_stage, finish_compile, written};

/// Compiles the source of `o` into its cache folder and returns the manifest of the product, or
/// the proven manifest of a folder that already holds it. The stages run in this order: the scene
/// loaded and picked (`scene.rs`), the images read, the cache consulted, then the
/// primitives compiled, their geometry written and the products built over it (`stages.rs`).
pub fn compile(o: &Options, progress: impl Fn(Value) + Sync) -> Result<Value> {
    check(o)?;
    validate_compile_options(o)?;
    let started = Instant::now();
    // Phase counters of this job, and of no other: they follow the thread until return.
    let phases = crate::support::perf::JobPhases::default();
    let _attached = phases.attach();
    // Held until return: two compilations of one cache would each prune what the other published.
    let _lock = CacheLock::acquire(o)?;
    let progress = with_ratio(progress);
    let routed: RoutedSource = crate::plugins::scene::prepare_source(o, &progress)?;
    // Where relative image URIs resolve, read before a converted scene moves `o.source` away.
    let image_root = routed.scene.images(&o.source);
    let moved = rooted(o, &routed.scene);
    let o = &*moved;
    let mut loaded = load_scene(o, &routed.scene)?;
    let bin = loaded.binary.bytes();
    let picked = pick(o, &mut loaded.g, bin)?;
    // The pool is born and dies with this job: its workers adopt its counters, not a neighbour's.
    let pool = phases.pool(o.threads)?;
    let images = read_images(&pool, &loaded.g, bin, (&picked, &image_root))?;
    // Identity of the product, not the raw bytes of what the source declares:
    // conversion timings leave it, images the scene cites enter it.
    let key = super::cache::identity::cache_key(o, &loaded, (&image_root, &images.shas))?;
    // A folder already holding this product is proven, then kept as is (`cache/reuse.rs`).
    if let Some(reused) = super::cache::reuse::reuse(o, &key, &pool, &progress)? {
        return super::cache::reuse::finish(o, &key, reused, started, &loaded.manifest, &progress);
    }
    // The plan charges the displacement a mesh bakes into its triangles (`displace`).
    let mut mesh_builds = o.mesh_build()?.meshes(&loaded.g)?;
    crate::compiler::source::fallback::inherit(&loaded.g, &mut mesh_builds);
    let job = Job {
        o,
        loaded: &loaded,
        bin,
        image_root: &image_root,
        key: &key,
        picked: &picked,
        images: &images,
        mesh_builds: &mesh_builds,
    };
    let (built, source_bin, produced) = compile_stage(&job, (pool, &phases, started), &progress)?;
    let sealed = written(o, produced, &progress)?;
    finish_compile(
        &job,
        built,
        sealed,
        (source_bin, routed.plugin.map(crate::plugins::provenance)),
        (&phases, started),
        &progress,
    )
}
