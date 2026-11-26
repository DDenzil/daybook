# Sound files

Put each file in this folder named `<ID>.mp3`, then add its ID to the `available` list in `manifest.json` (only listed files are requested, so the browser console stays clean). Files can be added one at a time. "Mono" sounds are placed at a point in the scene; "stereo" sounds surround the listener. The app handles the muffling at the waterline and the fade with distance.

| ID | Sound | Type | Length | Channels | Notes |
| --- | --- | --- | --- | --- | --- |
| amb_sea_calm | Open sea, gentle waves, light wind | Loop | 60–120 s | Stereo | Base bed above water |
| amb_sea_rough | Choppier sea, stronger wind gusts | Loop | 60–120 s | Stereo | Rough sea state |
| amb_waves_steel | Waves slapping and sloshing against steel legs | Loop | 20–40 s | Mono | Placed at the jacket legs |
| amb_machinery | Process plant hum, compressors, distant pumps | Loop | 30–60 s | Mono | Placed at the central platform |
| amb_flare | Steady flare roar | Loop | 20–40 s | Mono | Placed at the flare tip |
| amb_hvac | Roof fans and air-conditioning units | Loop | 20–30 s | Mono | Placed on the living quarters |
| amb_gulls | Gulls calling, sparse | One-shot | 1–4 s | Mono | Played at random |
| amb_metal_creak | Steel creaks and clanks | One-shot | 1–3 s | Mono | Played at random |
| heli_distant | Distant helicopter drone | Loop | 15–30 s | Mono | Approach and departure |
| heli_close | Close rotor beat and turbine whine | Loop | 15–30 s | Mono | Hover, landing, on deck |
| heli_spool_down | Engines and rotors winding down | One-shot | 30–60 s | Mono | |
| heli_spool_up | Engine start and rotor spool-up | One-shot | 30–60 s | Mono | |
| heli_touchdown | Landing gear contact on deck | One-shot | under 2 s | Mono | |
| osv_engine | Ship diesel engines at cruising speed | Loop | 20–40 s | Mono | |
| osv_thrusters | Thruster whine and water churn while holding position | Loop | 20–40 s | Mono | Alongside the platform |
| osv_hull_water | Water rushing along a moving hull | Loop | 20–40 s | Mono | |
| osv_horn | Ship horn, one long blast | One-shot | 2–5 s | Mono | Arrival and departure |
| crane_winch | Hydraulic crane motor and winch | Loop | 10–20 s | Mono | During lifts |
| crane_alarm | Lifting warning beeper | Loop | 2–5 s | Mono | During lifts |
| cargo_set_down | Container landing on a steel deck | One-shot | 1–3 s | Mono | |
| uw_ambience | Underwater ambience, low and muffled | Loop | 60–120 s | Stereo | Base bed below water |
| uw_machinery | Distant low machinery hum heard underwater | Loop | 30–60 s | Mono | Placed at the central platform |
| uw_bubbles | Bubble stream | Loop | 10–20 s | Mono | Placed at bubble sources |
| uw_whale_call | Low baleen whale calls | One-shot | 3–10 s | Mono | During whale sightings |
| cam_splash_in | Camera plunging below the surface | One-shot | 1–2 s | Stereo | |
| cam_splash_out | Camera breaking the surface | One-shot | 1–2 s | Stereo | |
| ui_click | Soft button click | One-shot | under 0.3 s | Stereo | |
| ui_alert | Gentle chime for sightings and events | One-shot | under 1.5 s | Stereo | |
| ui_deploy | Confirmation tone for a new wellhead | One-shot | under 1.5 s | Stereo | |

## Delivery specification

- MP3 at 192 kbps or higher, 48 kHz. Keep uncompressed WAV originals elsewhere.
- Loops must join seamlessly: no gap or click at the join, no fade in or out.
- One-shots start immediately, with no silence before the sound.
- No speech, music or recognisable brand sounds.
- Every file must be cleared for use on a public website. Record its source and licence in `CREDITS.md`.
