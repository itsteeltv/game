#!/usr/bin/env bash
# Rebuilds js/games/doom/engine.{js,wasm} from source.
#   DOOMGENERIC=path/to/doomgeneric  (git clone https://github.com/ozkl/doomgeneric,
#                                     built at commit dcb7a8dbc7a16ce3dda29382ac9aae9d77d21284)
#   emcc on PATH                     (Emscripten SDK: https://emscripten.org)
# The engine is GPL-2.0; doomgeneric_web.c (this folder) is the only addition.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${DOOMGENERIC:?set DOOMGENERIC to the doomgeneric checkout}/doomgeneric"
OUT="$HERE/../../js/games/doom"
mkdir -p "$OUT"

# Every engine file of the official emscripten Makefile, minus its SDL backend.
FILES="dummy am_map doomdef doomstat dstrings d_event d_items d_iwad d_loop d_main d_mode d_net
f_finale f_wipe g_game hu_lib hu_stuff info i_cdmus i_endoom i_joystick i_scale i_sound i_system
i_timer memio m_argv m_bbox m_cheat m_config m_controls m_fixed m_menu m_misc m_random p_ceilng
p_doors p_enemy p_floor p_inter p_lights p_map p_maputl p_mobj p_plats p_pspr p_saveg p_setup
p_sight p_spec p_switch p_telept p_tick p_user r_bsp r_data r_draw r_main r_plane r_segs r_sky
r_things sha1 sounds statdump st_lib st_stuff s_sound tables v_video wi_stuff w_checksum w_file
w_main w_wad z_zone w_file_stdc i_input i_video doomgeneric mus2mid"

emcc -O2 -DFEATURE_SOUND -DDOOMGENERIC_RESX=320 -DDOOMGENERIC_RESY=200 \
  -I"$HERE/stub" -I"$SRC" -Wno-implicit-function-declaration -Wno-int-conversion \
  $(for f in $FILES; do printf '%s ' "$SRC/$f.c"; done) "$HERE/doomgeneric_web.c" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createDoom -sENVIRONMENT=web \
  -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
  -sFORCE_FILESYSTEM=1 -lidbfs.js \
  -sEXPORTED_FUNCTIONS=_main,_dg_key,_dg_tick \
  -sEXPORTED_RUNTIME_METHODS=FS,IDBFS,callMain,HEAPU8 \
  -o "$OUT/engine.js"
ls -la "$OUT"
