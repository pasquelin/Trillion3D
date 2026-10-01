# G-code tool path

Original hand-authored fixture, dedicated to the public domain under CC0-1.0.
No machine or printer is operated by this file: the compiler reads its path only.

Four segments are expected: one rapid, two extrusion, one linear without extrusion.
Coordinates are converted from machine Z-up into right-handed Y-up metres.
The rapid ends at (0.01, 0.03, -0.02); the last segment ends at
(0.0504, 0.03, -0.02). G92 resets the coordinate/extruder reading without motion.
The extrusion segments run at 0.01 metres per second. Each segment retains its
source line and extrusion delta in the intermediate scene's mesh extras.

The supported static dialect is G0/G1, G20/G21, G90/G91, G92 and M82/M83.
Temperature/fan settings are counted as non-geometric process settings.
Arcs, homing, work offsets, tool changes, macros and checksummed transport blocks
are refused explicitly; no tool motion is guessed for unsupported commands.
