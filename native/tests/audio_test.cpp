// Tests for the Sound API's decoding and mix (src/overlay/audio.cpp uses the same miniaudio
// and stb_vorbis set-up): each format the engine plays, read from the Sound test sample's
// files (made by tools/sounds/make-sample-sounds.py), pan on the stereo mix, and the
// conversion of that mix to a 7.1 device. Runs without the game or a sound device.
//
//   .\tools\build-native.ps1 builds and runs it.

#pragma warning(push, 0) // third-party code
#define STB_VORBIS_HEADER_ONLY
#include <extras/stb_vorbis.c>
#define MINIAUDIO_IMPLEMENTATION
#define MA_NO_ENCODING
#define MA_NO_DEVICE_IO
#include <miniaudio.h>
#undef STB_VORBIS_HEADER_ONLY
#include <extras/stb_vorbis.c>
#pragma warning(pop)

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace
{
int g_failures = 0;

void Check(bool aOk, const std::string& aWhat)
{
    std::printf("%s  %s\n", aOk ? "ok  " : "FAIL", aWhat.c_str());
    if (!aOk)
        ++g_failures;
}

// Decodes a whole file to 32-bit float at its own rate; answers its seconds and peak.
bool Decode(const std::string& aFile, double& aSeconds, float& aPeak)
{
    ma_decoder_config config = ma_decoder_config_init(ma_format_f32, 0, 0);
    ma_decoder decoder;
    if (ma_decoder_init_file(aFile.c_str(), &config, &decoder) != MA_SUCCESS)
        return false;
    std::vector<float> buffer(4096 * decoder.outputChannels);
    ma_uint64 frames = 0;
    aPeak = 0;
    for (;;)
    {
        ma_uint64 read = 0;
        const ma_result r = ma_decoder_read_pcm_frames(&decoder, buffer.data(), 4096, &read);
        for (ma_uint64 k = 0; k < read * decoder.outputChannels; ++k)
            aPeak = std::max(aPeak, std::fabs(buffer[size_t(k)]));
        frames += read;
        if (r != MA_SUCCESS || read == 0)
            break;
    }
    aSeconds = double(frames) / decoder.outputSampleRate;
    ma_decoder_uninit(&decoder);
    return true;
}

// Plays a file through a stereo engine without a device, as the plugin's mix does, with
// a pan; answers the energy that reached the left and right channels.
bool PanEnergy(const std::string& aFile, float aPan, double& aLeft, double& aRight)
{
    ma_engine_config config = ma_engine_config_init();
    config.noDevice = MA_TRUE;
    config.channels = 2;
    config.sampleRate = 48000;
    ma_engine engine;
    if (ma_engine_init(&config, &engine) != MA_SUCCESS)
        return false;
    ma_sound sound;
    if (ma_sound_init_from_file(&engine, aFile.c_str(), MA_SOUND_FLAG_DECODE | MA_SOUND_FLAG_NO_SPATIALIZATION, nullptr,
            nullptr, &sound) != MA_SUCCESS)
    {
        ma_engine_uninit(&engine);
        return false;
    }
    ma_sound_set_pan(&sound, aPan);
    ma_sound_start(&sound);
    std::vector<float> buffer(4800 * 2);
    aLeft = aRight = 0;
    for (int block = 0; block < 10; ++block) // half a second
    {
        ma_engine_read_pcm_frames(&engine, buffer.data(), 4800, nullptr);
        for (size_t k = 0; k < buffer.size(); k += 2)
        {
            aLeft += double(buffer[k]) * buffer[k];
            aRight += double(buffer[k + 1]) * buffer[k + 1];
        }
    }
    ma_sound_uninit(&sound);
    ma_engine_uninit(&engine);
    return true;
}
} // namespace

int main()
{
    const std::string dir = REDNODE_SOUNDS_DIR;
    struct Case
    {
        const char* file;
        double seconds;
    };
    // The lengths the generator writes. MP3 adds encoder padding, so allow 0.1 s.
    const Case cases[] = {{"music.ogg", 8.0}, {"beep.wav", 0.15}, {"chime.flac", 2.5}, {"voice.mp3", 1.6}};
    for (const Case& c : cases)
    {
        double seconds = 0;
        float peak = 0;
        const bool ok = Decode(dir + "/" + c.file, seconds, peak);
        Check(ok, std::string(c.file) + " decodes");
        if (!ok)
            continue;
        char what[160];
        std::snprintf(what, sizeof(what), "%s is %.2f s (expected %.2f)", c.file, seconds, c.seconds);
        Check(std::fabs(seconds - c.seconds) < 0.1, what);
        std::snprintf(what, sizeof(what), "%s is not silent (peak %.2f)", c.file, peak);
        Check(peak > 0.3f && peak <= 1.01f, what);
    }

    // Pan: the plugin mixes in stereo, because miniaudio pans only a stereo mix.
    const std::string chime = dir + "/chime.flac";
    struct PanCase
    {
        float pan;
        const char* what;
    };
    for (const PanCase& p : {PanCase{-1, "left"}, PanCase{1, "right"}, PanCase{0, "centre"}})
    {
        double left = 0, right = 0;
        const bool ok = PanEnergy(chime, p.pan, left, right);
        Check(ok, std::string("chime plays panned ") + p.what);
        if (!ok)
            continue;
        const bool placed = p.pan < 0 ? left > 0 && right < left * 1e-3 : p.pan > 0 ? right > 0 && left < right * 1e-3
                                                                              : left > 0 && std::fabs(left - right) < left * 1e-3;
        char what[160];
        std::snprintf(what, sizeof(what), "pan %s reaches left %.1f, right %.1f", p.what, left, right);
        Check(placed, what);
    }

    // The device's conversion from that stereo mix to a 7.1 output: the front pair only.
    {
        ma_channel in[2] = {MA_CHANNEL_FRONT_LEFT, MA_CHANNEL_FRONT_RIGHT};
        ma_channel out[8];
        ma_channel_map_init_standard(ma_standard_channel_map_microsoft, out, 8, 8);
        ma_channel_converter_config config =
            ma_channel_converter_config_init(ma_format_f32, 2, in, 8, out, ma_channel_mix_mode_simple);
        ma_channel_converter converter;
        const bool ok = ma_channel_converter_init(&config, nullptr, &converter) == MA_SUCCESS;
        Check(ok, "stereo to 7.1 converter starts");
        if (ok)
        {
            const float frame[2] = {1.0f, 0.5f};
            float result[8] = {};
            ma_channel_converter_process_pcm_frames(&converter, result, frame, 1);
            bool front = true;
            for (int c = 0; c < 8; ++c)
            {
                const float want = out[c] == MA_CHANNEL_FRONT_LEFT ? 1.0f : out[c] == MA_CHANNEL_FRONT_RIGHT ? 0.5f : 0.0f;
                front = front && std::fabs(result[c] - want) < 1e-6f;
            }
            char what[200];
            std::snprintf(what, sizeof(what), "stereo reaches only the front pair of 7.1 (%.2f %.2f %.2f %.2f %.2f %.2f %.2f %.2f)",
                result[0], result[1], result[2], result[3], result[4], result[5], result[6], result[7]);
            Check(front, what);
            ma_channel_converter_uninit(&converter, nullptr);
        }
    }

    std::printf("\n%s: %d failure(s)\n", g_failures ? "FAILED" : "PASSED", g_failures);
    return g_failures ? 1 : 0;
}
