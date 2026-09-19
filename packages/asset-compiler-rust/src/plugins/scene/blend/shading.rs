//! A material's shader graph, reduced to what is used.
//!
//! A Blender link leaves a node output and arrives on an input; this module only keeps what glTF
//! needs: which node feeds which input, and whether that node is an image. Inputs are asked for
//! by their identifier, never by their rank, and their declared value is read by the field name
//! the SDNA gives the input's type.
use super::*;

const TEX_IMAGE: &str = "ShaderNodeTexImage";
const NORMAL_MAP: &str = "ShaderNodeNormalMap";

/// A material's graph: which node feeds which input, and through which output.
pub(super) struct Tree<'a> {
    links: HashMap<u64, (u64, u64)>,
    file: &'a BlendFile,
}

/// What a link brings to an input: the node it leaves, and the identifier of its output — the
/// channel, when that node is an image.
pub(super) struct Link<'a> {
    pub(super) node: At<'a>,
    pub(super) socket: String,
}

/// A scalar quantity: the declared value, and a count when a linked input replaces it with a
/// computation the intermediate scene does not carry.
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

/// Emission: colour multiplied by its strength, clamped to [0, 1] as glTF requires.
///
/// An image linked on the emission colour **replaces** the declared colour, which Blender then
/// no longer evaluates: the glTF factor then only carries the strength, which glTF multiplies
/// by the image. Taking the replaced colour would extinguish the emission as soon as the author
/// left black there.
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

/// The normal texture: the `Normal` input goes through a normal-map node, whose colour input
/// holds the image.
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

/// The image linked on an input, when it is indeed an image that feeds it.
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

/// The named input of a node: by its identifier, failing that by its label.
pub(super) fn socket<'a>(node: &At<'a>, wanted: &str) -> Option<At<'a>> {
    node.list("inputs")
        .into_iter()
        .find(|socket| socket.text("identifier") == wanted || socket.text("name") == wanted)
}

/// The declared values of an input: a float, a colour or a vector, according to its type.
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
    /// The graph's links, indexed by the input they feed.
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
    /// The node that feeds this input, if there is one.
    pub(super) fn source(&self, socket: &At<'a>) -> Option<At<'a>> {
        self.link(socket).map(|link| link.node)
    }
    /// The link that feeds this input: its node and the output it leaves.
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
