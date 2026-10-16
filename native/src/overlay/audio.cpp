// REDnode's own audio output (the Sound API, docs/sound.md), beside the game's Wwise.
//
// Built on miniaudio (public domain or MIT-0) and its stb_vorbis companion for OGG, started
// on first use. Packages' sound files play in three groups that follow the game's volume
// sliders: effects, dialogue and music, all under master. The host reads the sliders from
// the game's settings and sends them here (sound.mix). Sounds pause while a game menu is
// open, and everything mutes while the game is in the background if the player's
// "mute in background" setting is on.
//
// Files are opened on a loader thread, so a long file never holds up a frame. A sound
// that ends, is stopped or fails to load is announced to the host once, as
//   {"event":"sound-end","sound":n,"owner":"<package>","why":"ended"|"stopped"|"error","error":".."}
// (not "id": the host takes a message with an id for the answer to a request)
//
// Bridge methods, run on the game thread (the host checks which package owns a sound):
//   sound.play  {"file":"C:\\...\\a.ogg","owner":"pkg","category":"sfx"|"dialogue"|"music",
//                "volume":1,"loop":false,"delay":0,"start":0,"end":0,"rate":1,"pan":0,
//                "fadeIn":0,"stream":false,"pauseInMenu":true}
//               -> {"id":n}. delay and fadeIn in milliseconds; start and end in seconds (end 0:
//               the file's end); a loop repeats from start to end. rate 2 plays twice as fast
//               and an octave up.
//  sound.stop   {"id":n,"fadeOut":ms} one sound, or {"owner":"pkg","fadeOut":ms} all of a package's
//  sound.set    {"id":n,"volume":..,"rate":..,"pan":..,"fadeTo":{"volume":v,"ms":n}}
//  sound.list   {"owner":"pkg"} or {} -> [{"id","owner","file","category","state","position","length"}]
//  sound.mix    {"master":100,"sfx":100,"dialogue":100,"music":100,"muteInBackground":false}
//  audio.tone   {"hz":440,"ms":800,"volume":0.2}: a test tone (the S1 spike)

// REDnode's headers first: stb_vorbis leaves short macros defined that break them.
#include "jvalue.hpp"
#include "overlay.hpp"

#pragma warning(push, 0) // third-party code
#define STB_VORBIS_HEADER_ONLY
#include <extras/stb_vorbis.c>
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING
#include <miniaudio.h>
#undef STB_VORBIS_HEADER_ONLY
#include <extras/stb_vorbis.c>
#pragma warning(pop)

#include <algorithm>
#include <cmath>
#include <condition_variable>
#include <deque>
#include <map>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
enum Category
{
    Sfx,
    Dialogue,
    Music,
    CategoryCount
};
const char* const CategoryNames[CategoryCount] = {"sfx", "dialogue", "music"};

enum class State
{
    Loading,  // waiting for, or on, the loader thread
    Playing,  // started (may be waiting out its delay, or paused for a menu)
    Stopping, // fading out after sound.stop
    Done      // ended, stopped or failed: announced and freed on the next update
};

struct Sound
{
    uint32_t id = 0;
    std::string owner;
    std::string file;
    Category category = Sfx;
    double volume = 1;
    bool loop = false;
    double delayMs = 0;
    double start = 0;
    double end = 0;
    double rate = 1;
    double pan = 0;
    double fadeInMs = 0;
    bool stream = false;
    bool pauseInMenu = true;

    State state = State::Loading;
    bool inited = false;      // `sound` holds a miniaudio sound
    bool pausedByMenu = false;
    bool stopAsked = false;   // stopped while loading
    std::string why;          // why it is Done
    std::string error;
    ma_sound sound{};
};

std::mutex g_audioMutex;
std::unique_ptr<ma_engine> g_engine;
bool g_failed = false;
ma_sound_group g_groups[CategoryCount]{};
bool g_groupsReady = false;

std::map<uint32_t, std::unique_ptr<Sound>> g_sounds;
uint32_t g_nextSound = 1;

// The game's sliders, 0 to 100, and whether the game is in front.
double g_master = 100;
double g_levels[CategoryCount] = {100, 100, 100};
bool g_muteInBackground = false;
bool g_front = true;
bool g_menu = false;

// The loader thread.
std::thread g_loader;
std::condition_variable g_loadWake;
std::deque<uint32_t> g_loadQueue;
bool g_loaderStop = false;

// One playing test tone (audio.tone).
struct TestTone
{
    ma_waveform wave;
    ma_sound sound;
};
std::vector<std::unique_ptr<TestTone>> g_tones;

ma_engine* Engine(std::string& aError)
{
    if (g_engine)
        return g_engine.get();
    if (g_failed)
    {
        aError = "REDnode's audio output failed to start; see the plugin log";
        return nullptr;
    }
    auto engine = std::make_unique<ma_engine>();
    const ma_result r = ma_engine_init(nullptr, engine.get());
    if (r != MA_SUCCESS)
    {
        g_failed = true;
        Log("Audio: miniaudio could not start its engine: %s", ma_result_description(r));
        aError = std::string("REDnode's audio output could not start: ") + ma_result_description(r);
        return nullptr;
    }
    ma_device* device = ma_engine_get_device(engine.get());
    char name[256] = {};
    ma_device_get_name(device, ma_device_type_playback, name, sizeof(name), nullptr);
    Log("Audio: output started on \"%s\", %u Hz, %u channels (miniaudio %s)", name, ma_engine_get_sample_rate(engine.get()),
        ma_engine_get_channels(engine.get()), MA_VERSION_STRING);
    g_engine = std::move(engine);
    return g_engine.get();
}

// The slider as a gain: the game's 0 to 100, taken as linear. How Wwise maps its
// sliders is unverified; S1's test compares the two by ear.
float Gain(double aSlider)
{
    return float(std::clamp(aSlider, 0.0, 100.0) / 100.0);
}

void ApplyMix()
{
    if (!g_engine)
        return;
    const bool muted = g_muteInBackground && !g_front;
    ma_engine_set_volume(g_engine.get(), muted ? 0.0f : Gain(g_master));
    if (g_groupsReady)
    {
        for (int c = 0; c < CategoryCount; ++c)
            ma_sound_group_set_volume(&g_groups[c], Gain(g_levels[c]));
    }
}

// The engine and the category groups; under g_audioMutex.
bool Ready(std::string& aError)
{
    ma_engine* engine = Engine(aError);
    if (!engine)
        return false;
    if (!g_groupsReady)
    {
        for (int c = 0; c < CategoryCount; ++c)
        {
            if (ma_sound_group_init(engine, 0, nullptr, &g_groups[c]) != MA_SUCCESS)
            {
                for (int k = 0; k < c; ++k)
                    ma_sound_group_uninit(&g_groups[k]);
                aError = "REDnode's audio output could not make its sound groups";
                return false;
            }
        }
        g_groupsReady = true;
        ApplyMix();
    }
    return true;
}

std::wstring Wide(const std::string& aUtf8)
{
    if (aUtf8.empty())
        return {};
    const int n = MultiByteToWideChar(CP_UTF8, 0, aUtf8.data(), int(aUtf8.size()), nullptr, 0);
    std::wstring out(size_t(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, aUtf8.data(), int(aUtf8.size()), out.data(), n);
    return out;
}

double Number(const json::Value& aParams, const char* aKey, double aDefault)
{
    const json::Value* v = aParams.Get(aKey);
    return v && v->kind == json::Value::Kind::Number && std::isfinite(v->number) ? v->number : aDefault;
}

bool Flag(const json::Value& aParams, const char* aKey, bool aDefault)
{
    const json::Value* v = aParams.Get(aKey);
    return v && v->kind == json::Value::Kind::Bool ? v->boolean : aDefault;
}

std::string Text(const json::Value& aParams, const char* aKey)
{
    const json::Value* v = aParams.Get(aKey);
    return v && v->kind == json::Value::Kind::String ? v->text : std::string();
}

// Starts a loaded sound with its settings; under g_audioMutex.
void StartLoaded(Sound& s)
{
    ma_engine* engine = g_engine.get();
    ma_sound* snd = &s.sound;

    ma_uint32 sampleRate = 0;
    ma_sound_get_data_format(snd, nullptr, nullptr, &sampleRate, nullptr, 0);
    if (sampleRate && (s.start > 0 || s.end > 0))
    {
        const ma_uint64 beg = ma_uint64(s.start * sampleRate);
        const ma_uint64 end = s.end > s.start ? ma_uint64(s.end * sampleRate) : ~ma_uint64(0);
        ma_data_source_set_range_in_pcm_frames(ma_sound_get_data_source(snd), beg, end);
        ma_sound_seek_to_pcm_frame(snd, 0);
    }
    ma_sound_set_looping(snd, s.loop);
    ma_sound_set_volume(snd, float(std::max(0.0, s.volume)));
    ma_sound_set_pitch(snd, float(std::clamp(s.rate, 0.05, 8.0)));
    ma_sound_set_pan(snd, float(std::clamp(s.pan, -1.0, 1.0)));

    const ma_uint64 now = ma_engine_get_time_in_milliseconds(engine);
    const ma_uint64 at = now + ma_uint64(std::max(0.0, s.delayMs));
    if (s.delayMs > 0)
        ma_sound_set_start_time_in_milliseconds(snd, at);
    if (s.fadeInMs > 0)
        ma_sound_set_fade_start_in_milliseconds(snd, 0.0f, 1.0f, ma_uint64(s.fadeInMs), at);

    s.state = State::Playing;
    if (s.pauseInMenu && g_menu)
        s.pausedByMenu = true; // starts when the menu closes
    else
        ma_sound_start(snd);
}

void LoaderThread()
{
    for (;;)
    {
        uint32_t id = 0;
        Sound* s = nullptr;
        std::wstring path;
        ma_uint32 flags = MA_SOUND_FLAG_NO_SPATIALIZATION;
        ma_sound_group* group = nullptr;
        {
            std::unique_lock lock(g_audioMutex);
            g_loadWake.wait(lock, [] { return g_loaderStop || !g_loadQueue.empty(); });
            if (g_loaderStop)
                return;
            id = g_loadQueue.front();
            g_loadQueue.pop_front();
            auto it = g_sounds.find(id);
            if (it == g_sounds.end())
                continue;
            s = it->second.get();
            path = Wide(s->file);
            flags |= s->stream ? MA_SOUND_FLAG_STREAM : MA_SOUND_FLAG_DECODE;
            group = &g_groups[s->category];
        }

        // Opening and decoding happen outside the lock: the game thread keeps going.
        // The Sound stays put: nothing frees a sound while it is Loading.
        ma_sound_config config = ma_sound_config_init_2(g_engine.get());
        config.pFilePathW = path.c_str();
        config.flags = flags;
        config.pInitialAttachment = reinterpret_cast<ma_node*>(group);
        const ma_result r = ma_sound_init_ex(g_engine.get(), &config, &s->sound);

        std::scoped_lock lock(g_audioMutex);
        if (r != MA_SUCCESS)
        {
            s->state = State::Done;
            s->why = "error";
            s->error = std::string("could not open the file: ") + ma_result_description(r);
            Log("Audio: could not open %s for %s: %s", s->file.c_str(), s->owner.c_str(), ma_result_description(r));
            continue;
        }
        s->inited = true;
        if (s->stopAsked)
        {
            s->state = State::Done;
            s->why = "stopped";
            continue;
        }
        StartLoaded(*s);
    }
}

Category CategoryOf(const std::string& aName)
{
    for (int c = 0; c < CategoryCount; ++c)
        if (aName == CategoryNames[c])
            return Category(c);
    return Sfx;
}

const char* StateName(const Sound& s)
{
    switch (s.state)
    {
    case State::Loading:
        return "loading";
    case State::Playing:
        return s.pausedByMenu ? "paused" : "playing";
    case State::Stopping:
        return "stopping";
    default:
        return "done";
    }
}

std::string Play(const json::Value& aParams, std::string& aError)
{
    auto s = std::make_unique<Sound>();
    s->file = Text(aParams, "file");
    s->owner = Text(aParams, "owner");
    if (s->file.empty())
    {
        aError = "file is required";
        return {};
    }
    s->category = CategoryOf(Text(aParams, "category"));
    s->volume = Number(aParams, "volume", 1);
    s->loop = Flag(aParams, "loop", false);
    s->delayMs = Number(aParams, "delay", 0);
    s->start = std::max(0.0, Number(aParams, "start", 0));
    s->end = std::max(0.0, Number(aParams, "end", 0));
    s->rate = Number(aParams, "rate", 1);
    s->pan = Number(aParams, "pan", 0);
    s->fadeInMs = Number(aParams, "fadeIn", 0);
    s->stream = Flag(aParams, "stream", s->category == Music);
    s->pauseInMenu = Flag(aParams, "pauseInMenu", true);

    std::scoped_lock lock(g_audioMutex);
    if (!Ready(aError))
        return {};
    if (!g_loader.joinable())
    {
        g_loaderStop = false;
        g_loader = std::thread(LoaderThread);
    }
    const uint32_t id = g_nextSound++;
    s->id = id;
    g_sounds[id] = std::move(s);
    g_loadQueue.push_back(id);
    g_loadWake.notify_one();
    return "{\"id\":" + std::to_string(id) + "}";
}

// Under g_audioMutex.
void StopOne(Sound& s, double aFadeMs)
{
    if (s.state == State::Loading)
    {
        s.stopAsked = true;
        return;
    }
    if (s.state != State::Playing)
        return;
    s.why = "stopped";
    if (aFadeMs > 0 && !s.pausedByMenu)
    {
        ma_sound_stop_with_fade_in_milliseconds(&s.sound, ma_uint64(aFadeMs));
        s.state = State::Stopping;
    }
    else
    {
        ma_sound_stop(&s.sound);
        s.state = State::Done;
    }
}

std::string Stop(const json::Value& aParams, std::string& aError)
{
    const double fade = Number(aParams, "fadeOut", 0);
    const std::string owner = Text(aParams, "owner");
    const json::Value* idValue = aParams.Get("id");
    std::scoped_lock lock(g_audioMutex);
    int stopped = 0;
    if (idValue && idValue->kind == json::Value::Kind::Number)
    {
        auto it = g_sounds.find(uint32_t(idValue->number));
        if (it == g_sounds.end())
            return "{\"stopped\":0}"; // already ended
        StopOne(*it->second, fade);
        stopped = 1;
    }
    else if (!owner.empty())
    {
        for (auto& [id, s] : g_sounds)
        {
            if (s->owner == owner && s->state != State::Done)
            {
                StopOne(*s, fade);
                ++stopped;
            }
        }
    }
    else
    {
        aError = "id or owner is required";
        return {};
    }
    return "{\"stopped\":" + std::to_string(stopped) + "}";
}

std::string Set(const json::Value& aParams, std::string& aError)
{
    const json::Value* idValue = aParams.Get("id");
    if (!idValue || idValue->kind != json::Value::Kind::Number)
    {
        aError = "id is required";
        return {};
    }
    std::scoped_lock lock(g_audioMutex);
    auto it = g_sounds.find(uint32_t(idValue->number));
    if (it == g_sounds.end())
        return "false";
    Sound& s = *it->second;
    s.volume = Number(aParams, "volume", s.volume);
    s.rate = Number(aParams, "rate", s.rate);
    s.pan = Number(aParams, "pan", s.pan);
    if (s.state != State::Playing && s.state != State::Stopping)
        return "true"; // applied when it starts
    ma_sound_set_pitch(&s.sound, float(std::clamp(s.rate, 0.05, 8.0)));
    ma_sound_set_pan(&s.sound, float(std::clamp(s.pan, -1.0, 1.0)));
    if (const json::Value* fade = aParams.Get("fadeTo"); fade && fade->kind == json::Value::Kind::Object)
    {
        // A fade on the sound's fader, which multiplies its volume: from where it is now.
        const float target = float(std::max(0.0, Number(*fade, "volume", 1)));
        const ma_uint64 ms = ma_uint64(std::max(0.0, Number(*fade, "ms", 0)));
        ma_sound_set_fade_in_milliseconds(&s.sound, -1.0f, s.volume > 0 ? float(target / s.volume) : 0.0f, ms);
    }
    else
    {
        ma_sound_set_volume(&s.sound, float(std::max(0.0, s.volume)));
    }
    return "true";
}

std::string List(const json::Value& aParams)
{
    const std::string owner = Text(aParams, "owner");
    std::scoped_lock lock(g_audioMutex);
    std::string out = "[";
    for (auto& [id, s] : g_sounds)
    {
        if (!owner.empty() && s->owner != owner)
            continue;
        float position = 0;
        float length = 0;
        if (s->inited)
        {
            ma_sound_get_cursor_in_seconds(&s->sound, &position);
            ma_sound_get_length_in_seconds(&s->sound, &length);
        }
        if (out.size() > 1)
            out += ',';
        char nums[96];
        std::snprintf(nums, sizeof(nums), ",\"position\":%.3f,\"length\":%.3f}", position, length);
        out += "{\"id\":" + std::to_string(id) + ",\"owner\":" + JsonString(s->owner) + ",\"file\":" + JsonString(s->file) +
               ",\"category\":\"" + CategoryNames[s->category] + "\",\"state\":\"" + StateName(*s) + "\"" + nums;
    }
    return out + "]";
}

std::string Mix(const json::Value& aParams, std::string& aError)
{
    std::scoped_lock lock(g_audioMutex);
    g_master = Number(aParams, "master", g_master);
    for (int c = 0; c < CategoryCount; ++c)
        g_levels[c] = Number(aParams, CategoryNames[c], g_levels[c]);
    g_muteInBackground = Flag(aParams, "muteInBackground", g_muteInBackground);
    ApplyMix();
    (void)aError;
    return "true";
}

std::string Tone(const json::Value& aParams, std::string& aError)
{
    std::scoped_lock lock(g_audioMutex);
    ma_engine* engine = Engine(aError);
    if (!engine)
        return {};
    for (auto it = g_tones.begin(); it != g_tones.end();)
    {
        if (ma_sound_is_playing(&(*it)->sound))
        {
            ++it;
            continue;
        }
        ma_sound_uninit(&(*it)->sound);
        ma_waveform_uninit(&(*it)->wave);
        it = g_tones.erase(it);
    }

    const double hz = std::clamp(Number(aParams, "hz", 440), 20.0, 20000.0);
    const double ms = std::clamp(Number(aParams, "ms", 800), 10.0, 10000.0);
    const double volume = std::clamp(Number(aParams, "volume", 0.2), 0.0, 1.0);

    auto tone = std::make_unique<TestTone>();
    const ma_waveform_config config =
        ma_waveform_config_init(ma_format_f32, ma_engine_get_channels(engine), ma_engine_get_sample_rate(engine),
                                ma_waveform_type_sine, volume, hz);
    if (ma_waveform_init(&config, &tone->wave) != MA_SUCCESS)
    {
        aError = "Could not make the tone";
        return {};
    }
    if (ma_sound_init_from_data_source(engine, &tone->wave, 0, nullptr, &tone->sound) != MA_SUCCESS)
    {
        ma_waveform_uninit(&tone->wave);
        aError = "Could not play the tone";
        return {};
    }
    ma_sound_set_stop_time_in_milliseconds(&tone->sound, ma_engine_get_time_in_milliseconds(engine) + ma_uint64(ms));
    ma_sound_start(&tone->sound);
    g_tones.push_back(std::move(tone));

    ma_device* device = ma_engine_get_device(engine);
    char name[256] = {};
    ma_device_get_name(device, ma_device_type_playback, name, sizeof(name), nullptr);
    return "{\"device\":" + JsonString(name) + ",\"sampleRate\":" + std::to_string(ma_engine_get_sample_rate(engine)) +
           ",\"channels\":" + std::to_string(ma_engine_get_channels(engine)) + ",\"miniaudio\":\"" MA_VERSION_STRING "\"}";
}
} // namespace

bool IsAudioMethod(const std::string& aMethod)
{
    return aMethod == "audio.tone" || aMethod.rfind("sound.", 0) == 0;
}

std::string Audio(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    if (aMethod == "sound.play")
        return Play(aParams, aError);
    if (aMethod == "sound.stop")
        return Stop(aParams, aError);
    if (aMethod == "sound.set")
        return Set(aParams, aError);
    if (aMethod == "sound.list")
        return List(aParams);
    if (aMethod == "sound.mix")
        return Mix(aParams, aError);
    if (aMethod == "audio.tone")
        return Tone(aParams, aError);
    aError = "unknown method " + aMethod;
    return {};
}

void UpdateAudio()
{
    std::vector<std::string> ended;
    {
        std::scoped_lock lock(g_audioMutex);
        const bool menu = (GetUiState() & (StateMenu | StateMainMenu)) != 0;
        const bool menuChanged = menu != g_menu;
        g_menu = menu;
        if (g_sounds.empty())
            return;
        for (auto it = g_sounds.begin(); it != g_sounds.end();)
        {
            Sound& s = *it->second;
            if (s.state == State::Playing && menuChanged && s.pauseInMenu)
            {
                // ma_sound_stop keeps the position, so starting again resumes.
                if (menu && !s.pausedByMenu)
                {
                    ma_sound_stop(&s.sound);
                    s.pausedByMenu = true;
                }
                else if (!menu && s.pausedByMenu)
                {
                    ma_sound_start(&s.sound);
                    s.pausedByMenu = false;
                }
            }
            // At its end (not looping): ma_sound_is_playing would also be false while a
            // sound waits out its delay.
            if (s.state == State::Playing && ma_sound_at_end(&s.sound))
            {
                s.state = State::Done;
                s.why = "ended";
            }
            if (s.state == State::Stopping && !ma_sound_is_playing(&s.sound))
                s.state = State::Done;
            if (s.state != State::Done)
            {
                ++it;
                continue;
            }
            std::string event = "{\"event\":\"sound-end\",\"sound\":" + std::to_string(s.id) + ",\"owner\":" + JsonString(s.owner) +
                                ",\"why\":\"" + (s.why.empty() ? "ended" : s.why) + "\"";
            if (!s.error.empty())
                event += ",\"error\":" + JsonString(s.error);
            ended.push_back(event + "}");
            if (s.inited)
                ma_sound_uninit(&s.sound);
            it = g_sounds.erase(it);
        }
    }
    for (auto& e : ended)
        SendJson(std::move(e));
}

void SetAudioFront(bool aFront)
{
    std::scoped_lock lock(g_audioMutex);
    g_front = aFront;
    ApplyMix();
}

void StopAudio()
{
    {
        std::scoped_lock lock(g_audioMutex);
        g_loaderStop = true;
    }
    g_loadWake.notify_all();
    if (g_loader.joinable())
        g_loader.join();

    std::scoped_lock lock(g_audioMutex);
    g_loadQueue.clear();
    for (auto& [id, s] : g_sounds)
    {
        if (s->inited)
            ma_sound_uninit(&s->sound);
    }
    g_sounds.clear();
    for (auto& t : g_tones)
    {
        ma_sound_uninit(&t->sound);
        ma_waveform_uninit(&t->wave);
    }
    g_tones.clear();
    if (g_groupsReady)
    {
        for (auto& g : g_groups)
            ma_sound_group_uninit(&g);
        g_groupsReady = false;
    }
    if (g_engine)
    {
        ma_engine_uninit(g_engine.get());
        g_engine.reset();
        Log("Audio: output stopped");
    }
}
} // namespace rednode::overlay::detail
