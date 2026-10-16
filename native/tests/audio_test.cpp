// Tests for the Sound API's decoding (src/overlay/audio.cpp uses the same miniaudio and
// stb_vorbis set-up): each format the engine plays, read from the Sound test sample's
// files (made by tools/sounds/make-sample-sounds.py). Runs without the game or a sound
// device.
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

    std::printf("\n%s: %d failure(s)\n", g_failures ? "FAILED" : "PASSED", g_failures);
    return g_failures ? 1 : 0;
}
