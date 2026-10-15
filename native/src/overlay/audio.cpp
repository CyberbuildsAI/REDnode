// REDnode's own audio output (Sound API, phase S1), beside the game's Wwise.
//
// Built on miniaudio (public domain or MIT-0), started on first use. This first step is
// the research spike in docs/sound.md: it proves our output plays cleanly beside the
// game's, with a test tone. Files, categories and volume come next.
//
// Bridge methods, run on the game thread:
//   audio.tone   {"params":{"hz":440,"ms":800,"volume":0.2}}: a sine tone through REDnode's
//                own output. Answers the output device and its format.

#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING
#include <miniaudio.h>

#include "jvalue.hpp"
#include "overlay.hpp"

#include <memory>
#include <mutex>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
std::mutex g_audioMutex;
std::unique_ptr<ma_engine> g_engine;
bool g_failed = false;

// One playing tone: the generator and the sound that plays it, kept until it ends.
struct Tone
{
    ma_waveform wave;
    ma_sound sound;
};
std::vector<std::unique_ptr<Tone>> g_tones;

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

// Tones that have finished are freed when the next one starts.
void Sweep()
{
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
}

double Number(const json::Value& aParams, const char* aKey, double aDefault)
{
    const json::Value* v = aParams.Get(aKey);
    return v && v->kind == json::Value::Kind::Number ? v->number : aDefault;
}
} // namespace

bool IsAudioMethod(const std::string& aMethod)
{
    return aMethod == "audio.tone";
}

std::string Audio(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    (void)aMethod;
    std::scoped_lock lock(g_audioMutex);
    ma_engine* engine = Engine(aError);
    if (!engine)
        return {};
    Sweep();

    const double hz = std::clamp(Number(aParams, "hz", 440), 20.0, 20000.0);
    const double ms = std::clamp(Number(aParams, "ms", 800), 10.0, 10000.0);
    const double volume = std::clamp(Number(aParams, "volume", 0.2), 0.0, 1.0);

    auto tone = std::make_unique<Tone>();
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

void StopAudio()
{
    std::scoped_lock lock(g_audioMutex);
    for (auto& t : g_tones)
    {
        ma_sound_uninit(&t->sound);
        ma_waveform_uninit(&t->wave);
    }
    g_tones.clear();
    if (g_engine)
    {
        ma_engine_uninit(g_engine.get());
        g_engine.reset();
        Log("Audio: output stopped");
    }
}
} // namespace rednode::overlay::detail
