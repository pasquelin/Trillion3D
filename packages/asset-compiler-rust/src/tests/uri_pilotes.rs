//! Name of an image in the intermediate scene of the `ma` and `usd` drivers: a
//! relative URI, never the raw path. A filename legal on disk carries `%`, `#` or
//! space, which a URI relative reference does not admit as-is.
use super::*;

/// A filename legal on disk and forbidden as-is in a URI.
const AWKWARD: &str = "co%lor #1 rouge.png";
/// The same thing once escaped, as the intermediate scene must carry it.
const ESCAPED: &str = "co%25lor%20%231%20rouge.png";

/// A throwaway folder carrying the awkwardly named image, and the source the case writes there.
fn source(tag: &str, name: &str, body: &str) -> (PathBuf, PathBuf) {
    let dir = scratch("uri", tag);
    fs::write(dir.join(AWKWARD), b"\x89PNG\r\n\x1a\n").expect("image");
    let file = dir.join(name);
    fs::write(&file, body).expect("source");
    (dir, file)
}

/// URI of the only image of the intermediate scene a driver wrote.
fn only_image_uri(run: &GoldenRun, plugin: &str) -> String {
    let images = run.prepared(plugin).1["images"]
        .as_array()
        .expect("images")
        .clone();
    assert_eq!(images.len(), 1, "only one image in this scene");
    images[0]["uri"].as_str().expect("uri").to_string()
}

/// What the written URI is worth, and what it yields once decoded.
fn assert_round_trip(uri: &str) {
    assert_eq!(uri, ESCAPED);
    assert_eq!(uri::decode(uri).as_deref(), Some(AWKWARD));
}

// Behaviour 2: the `ma` driver names its texture by a URI. Maya writes a path;
// the intermediate scene carries the relative reference glTF expects, otherwise
// the compiler rereads another name, or nothing.
#[test]
fn the_maya_driver_writes_an_escaped_image_uri() {
    let body = format!(
        "createNode transform -n \"T\";\n{}\
         \tsetAttr \".iog[0].og[0].gcl\" -type \"componentList\" 1 \"f[0:0]\";\n\
         createNode lambert -n \"Peint\";\n\
         createNode file -n \"Image\";\n\
         \tsetAttr \".ftn\" -type \"string\" \"{AWKWARD}\";\n\
         connectAttr \"Image.oc\" \"Peint.c\";\n\
         createNode shadingEngine -n \"PeintSG\";\n\
         connectAttr \"Peint.oc\" \"PeintSG.ss\";\n\
         connectAttr \"TShape.iog.og[0]\" \"PeintSG.dsm\" -na;\n",
        ma_driver::quad("TShape", "T"),
    );
    let head = "//Maya ASCII 2024 scene\nrequires maya \"2024\";\ncurrentUnit -l centimeter -a degree -t film;\n";
    let (dir, file) = source("ma", "scene.ma", &format!("{head}{body}"));
    let run = compile_golden_source(&file, "uri-ma");
    assert_round_trip(&only_image_uri(&run, "ma"));
    fs::remove_dir_all(&dir).expect("nettoyage");
}

// Behaviour 2: the `usd` driver names its texture by a URI, by the same helper and the same rule.
#[test]
fn the_usd_driver_writes_an_escaped_image_uri() {
    let body = format!(
        "#usda 1.0\n(\n    defaultPrim = \"Root\"\n)\n\n\
         def Xform \"Root\"\n{{\n\
         \x20   def Mesh \"Quad\"\n    {{\n\
         \x20       int[] faceVertexCounts = [3]\n\
         \x20       int[] faceVertexIndices = [0, 1, 2]\n\
         \x20       point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n\
         \x20       rel material:binding = </Root/Peint>\n    }}\n\
         \x20   def Material \"Peint\"\n    {{\n\
         \x20       token outputs:surface.connect = </Root/Peint/Surface.outputs:surface>\n\
         \x20       def Shader \"Surface\"\n        {{\n\
         \x20           uniform token info:id = \"UsdPreviewSurface\"\n\
         \x20           color3f inputs:diffuseColor.connect = </Root/Peint/Image.outputs:rgb>\n\
         \x20           token outputs:surface\n        }}\n\
         \x20       def Shader \"Image\"\n        {{\n\
         \x20           uniform token info:id = \"UsdUVTexture\"\n\
         \x20           asset inputs:file = @{AWKWARD}@\n\
         \x20           float3 outputs:rgb\n        }}\n    }}\n}}\n"
    );
    let (dir, file) = source("usd", "scene.usda", &body);
    let run = compile_golden_source(&file, "uri-usd");
    assert_round_trip(&only_image_uri(&run, "usd"));
    fs::remove_dir_all(&dir).expect("nettoyage");
}
