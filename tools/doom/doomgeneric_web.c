// Mini Arcade — browser backend for doomgeneric (GPL-2.0, like the engine).
//
// The engine owns nothing of the page: every frame, key, sound and song crosses
// into JavaScript through the small EM_JS bridge below, and the page's own
// js/games/doom.js decides how to draw, play and route input.

#include <stdio.h>
#include <string.h>
#include <emscripten.h>

#include "doomgeneric.h"
#include "doomtype.h"
#include "i_sound.h"
#include "w_wad.h"
#include "z_zone.h"
#include "m_misc.h"
#include "deh_str.h"
#include "memio.h"
#include "mus2mid.h"

/* --- JS bridge ----------------------------------------------------------- */

EM_JS(void, js_frame, (const void *pixels, int w, int h), { Module.doom.frame(pixels, w, h); });
EM_JS(void, js_title, (const char *t), { Module.doom.title && Module.doom.title(UTF8ToString(t)); });
EM_JS(void, js_sfx_play, (int ch, int lump, const void *data, int len, int vol, int sep), {
  Module.doom.sfxPlay(ch, lump, data, len, vol, sep);
});
EM_JS(void, js_sfx_params, (int ch, int vol, int sep), { Module.doom.sfxParams(ch, vol, sep); });
EM_JS(void, js_sfx_stop, (int ch), { Module.doom.sfxStop(ch); });
EM_JS(int, js_sfx_playing, (int ch), { return Module.doom.sfxPlaying(ch) ? 1 : 0; });
EM_JS(int, js_song_register, (const void *midi, int len), { return Module.doom.songRegister(midi, len); });
EM_JS(void, js_song_play, (int id, int looping), { Module.doom.songPlay(id, !!looping); });
EM_JS(void, js_song_stop, (void), { Module.doom.songStop(); });
EM_JS(void, js_song_volume, (int v), { Module.doom.songVolume(v); });
EM_JS(void, js_song_pause, (int paused), { Module.doom.songPause(!!paused); });

/* --- Platform: video, time, input ---------------------------------------- */

#define KEYQUEUE_SIZE 64
static unsigned short key_queue[KEYQUEUE_SIZE];
static unsigned int key_w = 0, key_r = 0;

// Called from JavaScript for every key press and release.
EMSCRIPTEN_KEEPALIVE void dg_key(int pressed, int doom_key)
{
    key_queue[key_w] = (unsigned short)(((pressed ? 1 : 0) << 8) | (doom_key & 0xFF));
    key_w = (key_w + 1) % KEYQUEUE_SIZE;
}

// One engine step. JavaScript calls it when at least one 35 Hz tic is due,
// so the engine's own wait loop never has to spin.
EMSCRIPTEN_KEEPALIVE void dg_tick(void) { doomgeneric_Tick(); }

void DG_Init(void) {}

void DG_DrawFrame(void) { js_frame(DG_ScreenBuffer, DOOMGENERIC_RESX, DOOMGENERIC_RESY); }

void DG_SleepMs(uint32_t ms) { (void)ms; }   // never block the page

uint32_t DG_GetTicksMs(void) { return (uint32_t)emscripten_get_now(); }

int DG_GetKey(int *pressed, unsigned char *doom_key)
{
    if (key_r == key_w) return 0;
    unsigned short k = key_queue[key_r];
    key_r = (key_r + 1) % KEYQUEUE_SIZE;
    *pressed = k >> 8;
    *doom_key = k & 0xFF;
    return 1;
}

void DG_SetWindowTitle(const char *title) { js_title(title); }

int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);   // the loop is driven from JavaScript
    return 0;
}

/* --- Sound effects: hand the raw DMX lump to Web Audio -------------------- */

int use_libsamplerate = 0;
float libsamplerate_scale = 0.65f;
char *timidity_cfg_path = "";

static boolean use_prefix;

static snddevice_t sfx_devices[] = {
    SNDDEVICE_SB, SNDDEVICE_PAS, SNDDEVICE_GUS, SNDDEVICE_WAVEBLASTER,
    SNDDEVICE_SOUNDCANVAS, SNDDEVICE_AWE32,
};

static boolean Web_InitSound(boolean prefix) { use_prefix = prefix; return true; }
static void Web_ShutdownSound(void) {}
static void Web_UpdateSound(void) {}
static void Web_PrecacheSounds(sfxinfo_t *sounds, int n) { (void)sounds; (void)n; }

static int Web_GetSfxLumpNum(sfxinfo_t *sfx)
{
    char name[9];
    if (sfx->link != NULL) sfx = sfx->link;
    if (use_prefix) M_snprintf(name, sizeof(name), "ds%s", DEH_String(sfx->name));
    else M_StringCopy(name, DEH_String(sfx->name), sizeof(name));
    return W_GetNumForName(name);
}

static int Web_StartSound(sfxinfo_t *sfx, int channel, int vol, int sep)
{
    int lump = sfx->lumpnum;
    if (lump < 0) return -1;
    const void *data = W_CacheLumpNum(lump, PU_STATIC);
    js_sfx_play(channel, lump, data, W_LumpLength(lump), vol, sep);
    return channel;
}

static void Web_UpdateSoundParams(int ch, int vol, int sep) { js_sfx_params(ch, vol, sep); }
static void Web_StopSound(int ch) { js_sfx_stop(ch); }
static boolean Web_SoundIsPlaying(int ch) { return js_sfx_playing(ch) != 0; }

sound_module_t DG_sound_module = {
    sfx_devices, arrlen(sfx_devices),
    Web_InitSound, Web_ShutdownSound, Web_GetSfxLumpNum, Web_UpdateSound,
    Web_UpdateSoundParams, Web_StartSound, Web_StopSound, Web_SoundIsPlaying,
    Web_PrecacheSounds,
};

/* --- Music: MUS -> MIDI here, a synthesiser in JavaScript plays it -------- */

static snddevice_t music_devices[] = {
    SNDDEVICE_PAS, SNDDEVICE_GUS, SNDDEVICE_WAVEBLASTER, SNDDEVICE_SOUNDCANVAS,
    SNDDEVICE_GENMIDI, SNDDEVICE_AWE32, SNDDEVICE_SB, SNDDEVICE_ADLIB,
};

static boolean Web_InitMusic(void) { return true; }
static void Web_ShutdownMusic(void) { js_song_stop(); }
static void Web_SetMusicVolume(int v) { js_song_volume(v); }
static void Web_PauseSong(void) { js_song_pause(1); }
static void Web_ResumeSong(void) { js_song_pause(0); }
static void Web_UnRegisterSong(void *handle) { (void)handle; }
static void Web_StopSong(void) { js_song_stop(); }
static boolean Web_MusicIsPlaying(void) { return true; }
static void Web_Poll(void) {}

static void *Web_RegisterSong(void *data, int len)
{
    int id;
    if (len > 4 && memcmp(data, "MUS\x1a", 4) == 0) {
        MEMFILE *in = mem_fopen_read(data, len), *out = mem_fopen_write();
        void *midi; size_t midi_len;
        if (mus2mid(in, out)) { mem_fclose(in); mem_fclose(out); return NULL; }   // returns true on error
        mem_get_buf(out, &midi, &midi_len);
        id = js_song_register(midi, (int)midi_len);
        mem_fclose(in); mem_fclose(out);
    } else {
        id = js_song_register(data, len);   // already MIDI (some PWADs)
    }
    return (void *)(intptr_t)id;
}

static void Web_PlaySong(void *handle, boolean looping)
{
    if (handle != NULL) js_song_play((int)(intptr_t)handle, looping);
}

music_module_t DG_music_module = {
    music_devices, arrlen(music_devices),
    Web_InitMusic, Web_ShutdownMusic, Web_SetMusicVolume, Web_PauseSong,
    Web_ResumeSong, Web_RegisterSong, Web_UnRegisterSong, Web_PlaySong,
    Web_StopSong, Web_MusicIsPlaying, Web_Poll,
};
