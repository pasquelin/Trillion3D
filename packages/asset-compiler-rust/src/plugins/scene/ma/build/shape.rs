//! Les formes d'un `transform` : celles qui entrent dans la scène, et ce que le fichier n'y met pas.
//!
//! Un nœud `mesh` de Maya n'est pas toujours une surface à dessiner. Une forme **intermédiaire**
//! est l'entrée d'un historique de construction — la boîte d'origine sous la déformation qui la
//! plie —, que Maya n'affiche jamais ; une forme dont la visibilité est éteinte est cachée par le
//! fichier lui-même. Émettre l'une ou l'autre ferait apparaître une géométrie que la scène cache.
use super::*;

/// Les maillages glTF que ce transform porte : ses formes filles, puis celles qu'un `parent -add`
/// lui accroche. Chaque forme n'est construite qu'une fois, quel que soit le nombre de transforms
/// qui la citent.
pub(super) fn shapes(world: &mut World<'_>, node: usize) -> Vec<usize> {
    let own: Vec<usize> = world.kids[node]
        .iter()
        .copied()
        .filter(|shape| report::is_mesh(&world.document.nodes[*shape].kind))
        .collect();
    let added = world.added[node].clone();
    let mut out = Vec::new();
    for shape in own.into_iter().chain(added) {
        if drawn(world, shape) {
            out.extend(mesh::build(world, shape));
        }
    }
    out
}

/// Cette forme entre-t-elle dans la scène ? Une forme intermédiaire et une forme invisible sont
/// comptées chacune sous son nom, et ni l'une ni l'autre n'est convertie.
fn drawn(world: &mut World<'_>, shape: usize) -> bool {
    let document = world.document;
    let flag = |names: &[&str]| document.nodes[shape].attr(names).and_then(Attr::flag);
    let intermediate = flag(&["io", "intermediateObject"]) == Some(true);
    let hidden = flag(&["v", "visibility"]) == Some(false);
    if intermediate {
        world.refuse(report::SHAPE_INTERMEDIATE);
    } else if hidden {
        world.scene.count("invisible", 1);
    }
    !intermediate && !hidden
}

/// Compte, par son type, chaque nœud que ce pilote ne convertit pas : caméras, lampes, surfaces
/// paramétriques, squelettes, nœuds d'outil, nœuds de script. Rien de tout cela n'est un échec.
pub(super) fn ignored(world: &mut World<'_>) {
    let document = world.document;
    for node in document.nodes.iter().filter(|node| {
        !report::is_transform(&node.kind) && !report::is_mesh(&node.kind) && !shades(&node.kind)
    }) {
        world
            .scene
            .report
            .add(&format!("{}:{}", report::NODE_IGNORED, node.kind));
    }
}

/// Ce nœud décrit-il le nuançage — un nuanceur, un ensemble, une image, un placage ? Ces nœuds
/// n'entrent pas dans la hiérarchie : les matériaux les lisent, et ils ne sont donc pas comptés.
fn shades(kind: &str) -> bool {
    report::is_shader(kind)
        || matches!(
            kind,
            "shadingEngine" | "file" | "place2dTexture" | "bump2d" | "materialInfo" | "groupId"
        )
}
