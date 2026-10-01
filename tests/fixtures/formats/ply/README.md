# PLY surface fixture

CC0, authored for this repository from the public PLY 1.0 grammar. Four vertices and two ordered triangles. The parser tests also encode this surface in both binary byte orders and exercise colours, material identity, alpha, and invalid data.

Unsigned colour channels are interpreted as sRGB; floating colour channels are linear. Alpha is linear. UV coordinates and authored normals are retained. Unsupported elements/properties are explicitly refused.
