# Models

All models are glTF binary (`.glb`), compressed with meshopt (`gltfpack -cc -kn -km -vtf -vp 16`), built by `tools/blender/`. Units are metres. Blender axes: Z up, +Y north, +X east (the exporter converts to Y-up).

Each file can be replaced by an artist-made model with the **same file name and node names**. Materials are matched by name (see the list at the end).

| File | Origin | Nodes the app uses |
| --- | --- | --- |
| `cpp.glb` | CPP centre at sea level | `crane_slew` (rotates about vertical), `crane_boom` (child of slew, luffs about its X axis), `crane_tip` (empty at the boom head), `crane_hook`, `crane_cable` (1 m long, scaled along its length), `flare_tip` (empty), `lamp_0`…`lamp_4` (deck light positions) |
| `lq.glb` | LQ centre at sea level | `windsock` (points +X, rotated to the wind), `helideck_centre` (empty on the deck surface), `lamp_0`…`lamp_2` |
| `bridge.glb` | CPP centre (field coordinates) | — |
| `whp.glb` | platform centre at sea level | `riser_base` (empty at the flowline riser foot) |
| `psv.glb` | midships at the waterline, bow +Y | `radar_1`, `radar_2` (spin), `cargo_lift` (container lifted by the CPP crane), `exhaust_l`, `exhaust_r` |
| `heli.glb` | ground between the main wheels, nose +Y | `main_rotor` (spins about vertical), `rotor_disc`, `tail_rotor` (spins about X), `tail_disc`, `landing_light` |
| `whaleshark.glb`, `whale.glb` | body centre, head +Y | `blowhole` (whale only). Bodies bend in the vertex shader, so keep enough edge loops along the length |
| `turtle.glb` | shell centre | `flipper_l`, `flipper_r`, `hind_l`, `hind_r` (pivots at the shoulders) |
| `fish.glb` | each fish at the origin | `fish_scad`, `fish_trevally`, `fish_barracuda`, `fish_grouper` |
| `gull.glb` | body centre | `wing_l`, `wing_r` |
| `crew.glb` | feet on the ground | `leg_l`, `leg_r` (hips), `arm_l`, `arm_r` (shoulders) |
| `seabed_props.glb` | each prop at its own base | `rock_0..2`, `coral_0..1`, `sponge_0` |
| `shore.glb` | trunkline landfall at the shoreline, sea toward −X | — |

## Material names

| Name pattern | Behaviour in the app |
| --- | --- |
| `jacket*`, `anode*` | weathering plus splash-zone darkening and marine growth below the waterline |
| `paint_*`, `steel_*`, `pipe_*`, `cladding_*`, `galv`, `hull_*`, `deck_*`, `tank_*`, `concrete` | world-space grime and rust streaks |
| `grating*`, `net*` | alpha-tested (see-through) |
| `glass`, `glass_tint` | glossy glazing; `glass_tint` is transparent |
| `emit_window` | accommodation windows lit at dusk and night |
| `emit_red` | aviation obstruction lights (always on, brighter at night) |
| `emit_*` (other) | floodlights and navigation lights, on at dusk and night |
| `rotor_blur` | transparent rotor blur disc |
| `creature_*` | skin (slightly rougher) |

Baked ambient occlusion is stored as each material's glTF occlusion texture on UV set 1 (`lightmap`).
