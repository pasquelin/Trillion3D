# KMZ placed COLLADA fixture

CC0, authored using OGC KML 2.2 and the companion COLLADA fixture. `generate.py` reproduces the ZIP with fixed timestamps. It contains one Model with three triangle instances, geographic location, heading, scale and an embedded COLLADA file.

KMZ reuses the existing guarded ZIP extractor, writes atomically into its archive cache, and imports package-local COLLADA links. Absolute WGS84 locations are expressed in a local east/north/up frame anchored at the first Model, then converted to the compiler's Y-up frame. Geographic coordinates and the anchor remain in node extras. Terrain-dependent altitude modes, overlays, network links, remapping and non-model geometry are explicitly refused. The supported root document is `doc.kml`.
