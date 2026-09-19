//! The objects the file's active scene holds.
//!
//! A Blender file stores everything it contains side by side: objects of another scene, and those
//! that no collection holds any more — Blender keeps them as long as a user still references them
//! — live in the same `OB` blocks as those of the open scene. Importing the file is not importing
//! its blocks: it is importing the scene its global block designates, by its master collection
//! and the child collections, minus those the active view layer excludes. What that leaves out
//! is counted, never silenced.
//!
//! A file that does not describe its active scene — no global block, no master collection — is
//! not guessed: all its objects are then read, as before, and nothing is counted.
use super::*;

/// Maximum depth of a collection tree, cycle included.
const MAX_DEPTH: usize = 64;
/// The bit by which a view layer excludes a collection from the scene.
const EXCLUDE: i64 = 1;

/// The addresses of the active scene's objects, when the file describes it.
pub(super) fn objects(file: &BlendFile) -> Option<HashSet<u64>> {
    let global = file
        .of(*b"GLOB")
        .next()
        .and_then(|block| file.view(block))?;
    let master = global.follow("curscene")?.follow("master_collection")?;
    let mut held = HashSet::new();
    gather(&master, &excluded(&global), &mut held, 0);
    Some(held)
}

/// The collections the active view layer removes from the scene.
fn excluded(global: &At<'_>) -> HashSet<u64> {
    let mut out = HashSet::new();
    let Some(layer) = global.follow("cur_view_layer") else {
        return out;
    };
    layers(&layer.list("layer_collections"), &mut out, 0);
    out
}

fn layers(held: &[At<'_>], out: &mut HashSet<u64>, depth: usize) {
    if depth >= MAX_DEPTH {
        return;
    }
    for layer in held {
        if layer.int("flag", 0) & EXCLUDE != 0 {
            if let Some(collection) = layer.follow("collection") {
                out.insert(collection.old);
            }
            continue;
        }
        layers(&layer.list("layer_collections"), out, depth + 1);
    }
}

/// The objects of a collection and of its children, those the view layer excludes set aside.
fn gather(collection: &At<'_>, excluded: &HashSet<u64>, out: &mut HashSet<u64>, depth: usize) {
    if depth >= MAX_DEPTH {
        return;
    }
    for held in collection.list("gobject") {
        let object = held.pointer("ob");
        if object != 0 {
            out.insert(object);
        }
    }
    for child in collection.list("children") {
        let Some(inner) = child.follow("collection") else {
            continue;
        };
        if !excluded.contains(&inner.old) {
            gather(&inner, excluded, out, depth + 1);
        }
    }
}
