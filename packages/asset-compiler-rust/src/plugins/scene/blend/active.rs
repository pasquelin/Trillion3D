//! Les objets que la scène active du fichier porte.
//!
//! Un fichier Blender range côte à côte tout ce qu'il contient : les objets d'une autre scène, et
//! ceux que plus aucune collection ne porte — Blender les garde tant qu'un utilisateur les référence
//! encore — vivent dans les mêmes blocs `OB` que ceux de la scène ouverte. Importer le fichier, ce
//! n'est pas importer ses blocs : c'est importer la scène que son bloc global désigne, par sa
//! collection maîtresse et les collections filles, moins celles que la couche de vue active exclut.
//! Ce que cela laisse dehors est compté, jamais tu.
//!
//! Un fichier qui ne décrit pas sa scène active — pas de bloc global, pas de collection maîtresse —
//! n'est pas deviné : tous ses objets sont alors lus, comme avant, et rien n'est compté.
use super::*;

/// Profondeur maximale d'un arbre de collections, cycle compris.
const MAX_DEPTH: usize = 64;
/// Le bit par lequel une couche de vue exclut une collection de la scène.
const EXCLUDE: i64 = 1;

/// Les adresses des objets de la scène active, quand le fichier la décrit.
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

/// Les collections que la couche de vue active retire de la scène.
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

/// Les objets d'une collection et de ses filles, celles que la couche de vue exclut mises à part.
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
