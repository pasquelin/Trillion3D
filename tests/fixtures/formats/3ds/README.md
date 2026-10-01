# 3DS static mesh fixture

CC0, authored from the published Autodesk 3DS chunk grammar. `generate.py` reproduces `scene.3ds`: two ordered triangles, two distinct equal-valued named materials, UV coordinates, smoothing masks, master scale and a local modelling frame. Vertex coordinates remain in the authored editor/world coordinate system; the local frame is metadata and is not applied twice.

The bounded native reader accepts static EDIT3DS triangle meshes. Keyframe animation/hierarchy, lights, cameras, texture maps and unsupported material channels are explicitly refused. All chunk reads remain inside their parent payload. Smoothing work is capped at ten million vertex/face contributions.
