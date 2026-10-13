// Tests for the game frame capture's conversion (src/overlay/capture.hpp): scaling,
// channel order, HDR to SDR and base64. Runs without the game.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/capture.hpp"

#include <cstdio>
#include <cstdlib>

using namespace rednode::overlay::detail::capture;

namespace
{
int g_failures = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s  %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failures;
}

bool Near(int aA, int aB, int aTolerance = 1)
{
    return std::abs(aA - aB) <= aTolerance;
}

uint16_t FloatToHalf(float aF)
{
    // Enough for the test values: normal, positive numbers.
    uint32_t bits;
    std::memcpy(&bits, &aF, 4);
    const uint32_t exp = ((bits >> 23) & 0xFF) - 127 + 15;
    return uint16_t((exp << 10) | ((bits >> 13) & 0x3FF));
}
} // namespace

int main()
{
    Check(Base64(reinterpret_cast<const uint8_t*>("Man"), 3) == "TWFu", "base64 of three bytes");
    Check(Base64(reinterpret_cast<const uint8_t*>("Ma"), 2) == "TWE=", "base64 with one byte of padding");
    Check(Base64(reinterpret_cast<const uint8_t*>("M"), 1) == "TQ==", "base64 with two bytes of padding");

    Check(KindOf(DXGI_FORMAT_R8G8B8A8_UNORM) == PixelKind::Rgba8, "the game's usual SDR format is read");
    Check(KindOf(DXGI_FORMAT_R10G10B10A2_UNORM) == PixelKind::Rgb10A2, "HDR10 is read");
    Check(KindOf(DXGI_FORMAT_R16G16B16A16_FLOAT) == PixelKind::Half4, "scRGB is read");
    Check(KindOf(DXGI_FORMAT_R32G32B32A32_FLOAT) == PixelKind::Unsupported, "other formats are refused");

    // 4 x 2 RGBA, rows padded to 32 bytes: left half red, right half blue.
    {
        std::vector<uint8_t> rows(32 * 2, 0xEE);
        for (int y = 0; y < 2; ++y)
            for (int x = 0; x < 4; ++x)
            {
                uint8_t* p = rows.data() + y * 32 + x * 4;
                p[0] = x < 2 ? 255 : 0;
                p[1] = 0;
                p[2] = x < 2 ? 0 : 255;
                p[3] = 255;
            }
        uint32_t w = 0, h = 0;
        const auto out = Convert(rows.data(), 32, 4, 2, PixelKind::Rgba8, 0, 2, 200.0f, w, h);
        Check(w == 2 && h == 1, "scaled to the width asked for, aspect kept");
        Check(out[0] == 0 && out[2] == 255 && out[3] == 255, "RGBA red comes out as BGRA red");
        Check(out[4] == 255 && out[6] == 0, "the right half is blue");
    }

    // A box of two greys averages; padding bytes are never read.
    {
        std::vector<uint8_t> rows = {100, 100, 100, 255, 200, 200, 200, 255, 0xEE, 0xEE, 0xEE, 0xEE};
        uint32_t w = 0, h = 0;
        const auto out = Convert(rows.data(), 12, 2, 1, PixelKind::Bgra8, 0, 1, 200.0f, w, h);
        Check(w == 1 && h == 1 && Near(out[0], 150) && Near(out[1], 150), "pixels in a box are averaged");
    }

    // Not scaled up: a small frame keeps its size.
    {
        std::vector<uint8_t> rows(8, 0);
        uint32_t w = 0, h = 0;
        Convert(rows.data(), 8, 2, 1, PixelKind::Rgba8, 0, 1280, 200.0f, w, h);
        Check(w == 2 && h == 1, "a frame narrower than the limit keeps its size");
    }

    // HDR10: paper white (200 nits) is PQ 0.58 or so; it comes out near white.
    {
        const float pq200 = 0.5807f;
        const uint32_t v10 = uint32_t(pq200 * 1023.0f + 0.5f);
        const uint32_t px = v10 | (v10 << 10) | (v10 << 20) | (3u << 30);
        uint8_t rows[4];
        std::memcpy(rows, &px, 4);
        uint32_t w = 0, h = 0;
        const auto out = Convert(rows, 4, 1, 1, PixelKind::Rgb10A2, 2, 1, 200.0f, w, h);
        Check(Near(out[0], 255, 4) && Near(out[1], 255, 4) && Near(out[2], 255, 4), "HDR10 paper white comes out white");
        Check(std::abs(PqToNits(pq200) - 200.0f) < 4.0f, "PQ 0.58 is about 200 nits");
    }

    // scRGB: 2.5 is 200 nits (paper white), 0.5 is 40 nits (a fifth of it, about 124 in sRGB).
    {
        uint16_t px[4] = {FloatToHalf(2.5f), FloatToHalf(0.5f), FloatToHalf(0.0f), FloatToHalf(1.0f)};
        px[2] = 0;
        uint8_t rows[8];
        std::memcpy(rows, px, 8);
        uint32_t w = 0, h = 0;
        const auto out = Convert(rows, 8, 1, 1, PixelKind::Half4, 1, 1, 200.0f, w, h);
        Check(out[2] == 255, "scRGB paper white is full red");
        Check(Near(out[1], 124, 2), "scRGB 40 nits is a fifth of paper white, sRGB encoded");
        Check(out[0] == 0, "scRGB zero is black");
        Check(HalfToFloat(0x3C00) == 1.0f && HalfToFloat(0xC000) == -2.0f, "half floats decode");
    }

    std::printf("\n%s: %d failure(s)\n", g_failures ? "FAILED" : "PASSED", g_failures);
    return g_failures ? 1 : 0;
}
