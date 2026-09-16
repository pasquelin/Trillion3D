//! Le graphe de nuanceur d'un matériau, réduit à ce qui sert.
//!
//! Un lien de Blender part d'une sortie de nœud et arrive sur une entrée ; ce module n'en retient
//! que ce dont le glTF a besoin : quel nœud alimente quelle entrée, et si ce nœud est une image.
//! Les entrées sont demandées par leur identifiant, jamais par leur rang, et leur valeur déclarée
//! se lit par le nom de champ que le SDNA donne au type de l'entrée.
use super::*;

const TEX_IMAGE: &str = "ShaderNodeTexImage";
const NORMAL_MAP: &str = "ShaderNodeNormalMap";

/// Le graphe d'un matériau : quel nœud alimente quelle entrée, et par quelle sortie.
pub(super) struct Tree<'a> {
    links: HashMap<u64, (u64, u64)>,
    file: &'a BlendFile,
}

/// Ce qu'un lien apporte à une entrée : le nœud d'où il part, et l'identifiant de sa sortie — le
/// canal, quand ce nœud est une image.
pub(super) struct Link<'a> {
    pub(super) node: At<'a>,
    pub(super) socket: String,
}

/// Une grandeur scalaire : la valeur déclarée, et un compte quand une entrée branchée la remplace
/// par un calcul que la scène intermédiaire ne porte pas.
pub(super) fn factor(
    node: &At<'_>,
    tree: &Tree<'_>,
    name: &str,
    default: f32,
    out: &mut Out,
) -> f32 {
    let Some(socket) = socket(node, name) else {
        return default;
    };
    if tree.source(&socket).is_some() {
        out.report.add("blend-shader-input-unconverted");
    }
    value(&socket, default)[0]
}

/// L'émission : couleur multipliée par son intensité, bornée à [0, 1] comme le glTF l'exige.
///
/// Une image branchée sur la couleur d'émission **remplace** la couleur déclarée, que Blender
/// n'évalue alors plus : le facteur du glTF ne porte plus que l'intensité, que le glTF multiplie
/// par l'image. Prendre la couleur remplacée éteindrait l'émission dès que l'auteur y a laissé du
/// noir.
pub(super) fn emission(
    node: &At<'_>,
    tree: &Tree<'_>,
    root: &Path,
    images: &mut Images,
    out: &mut Out,
    gltf: &mut Value,
) {
    let Some(socket) = socket(node, "Emission Color") else {
        return;
    };
    let strength = socket_value(node, "Emission Strength", 1.0);
    let linked = texture(&socket, tree, root, images, out);
    let scaled: Vec<f32> = match linked {
        Some(_) => vec![strength; 3],
        None => value(&socket, 0.0)
            .iter()
            .take(3)
            .map(|part| part * strength)
            .collect(),
    };
    if scaled.iter().any(|part| *part > 1.0) {
        out.report.add("blend-emission-clamped");
    }
    if scaled.iter().any(|part| *part > 0.0) {
        gltf["emissiveFactor"] = json!(scaled
            .iter()
            .map(|part| part.clamp(0.0, 1.0))
            .collect::<Vec<f32>>());
    }
    if let Some(index) = linked {
        gltf["emissiveTexture"] = json!({"index": index});
    }
}

/// La texture de normales : l'entrée `Normal` passe par un nœud de carte de normales, dont l'entrée
/// couleur porte l'image.
pub(super) fn normal_texture(
    node: &At<'_>,
    tree: &Tree<'_>,
    root: &Path,
    images: &mut Images,
    out: &mut Out,
) -> Option<usize> {
    let source = tree.source(&socket(node, "Normal")?)?;
    if source.text("idname") != NORMAL_MAP {
        out.report.add("blend-shader-input-unconverted");
        return None;
    }
    texture(&socket(&source, "Color")?, tree, root, images, out)
}

/// L'image branchée sur une entrée, quand c'est bien une image qui l'alimente.
pub(super) fn texture(
    socket: &At<'_>,
    tree: &Tree<'_>,
    root: &Path,
    images: &mut Images,
    out: &mut Out,
) -> Option<usize> {
    let source = tree.source(socket)?;
    if source.text("idname") != TEX_IMAGE {
        out.report.add("blend-shader-input-unconverted");
        return None;
    }
    let image = source.follow("id")?;
    images.texture(&image, root, out)
}

/// L'entrée nommée d'un nœud : par son identifiant, à défaut par son libellé.
pub(super) fn socket<'a>(node: &At<'a>, wanted: &str) -> Option<At<'a>> {
    node.list("inputs")
        .into_iter()
        .find(|socket| socket.text("identifier") == wanted || socket.text("name") == wanted)
}

/// Les valeurs déclarées d'une entrée : un flottant, une couleur ou un vecteur, selon son type.
pub(super) fn value(socket: &At<'_>, default: f32) -> Vec<f32> {
    let found = socket
        .follow("default_value")
        .map(|held| held.floats("value"))
        .unwrap_or_default();
    if found.is_empty() {
        return vec![default];
    }
    found
}

pub(super) fn socket_value(node: &At<'_>, name: &str, default: f32) -> f32 {
    socket(node, name).map_or(default, |socket| value(&socket, default)[0])
}

impl<'a> Tree<'a> {
    /// Les liens du graphe, indexés par l'entrée qu'ils alimentent.
    pub(super) fn read(graph: &At<'a>) -> Tree<'a> {
        let mut links = HashMap::new();
        for link in graph.list("links") {
            links.insert(
                link.pointer("tosock"),
                (link.pointer("fromnode"), link.pointer("fromsock")),
            );
        }
        Tree {
            links,
            file: graph.file,
        }
    }
    /// Le nœud qui alimente cette entrée, s'il y en a un.
    pub(super) fn source(&self, socket: &At<'a>) -> Option<At<'a>> {
        self.link(socket).map(|link| link.node)
    }
    /// Le lien qui alimente cette entrée : son nœud et la sortie d'où il part.
    pub(super) fn link(&self, socket: &At<'a>) -> Option<Link<'a>> {
        let (node, from) = self.links.get(&socket.old)?;
        let node = self.file.view(self.file.at(*node)?)?;
        let socket = self
            .file
            .at(*from)
            .and_then(|block| self.file.view(block))
            .map(|socket| socket.text("identifier"))
            .unwrap_or_default();
        Some(Link { node, socket })
    }
}
