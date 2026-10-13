// Turns a copy of the game's back buffer into a small SDR picture for the host:
// scales it down with a box filter, converts HDR (scRGB or HDR10) to SDR, and
// writes BGRA. Pure CPU code, so the unit tests run it without the game.

#pragma once

#include <dxgiformat.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace rednode::overlay::detail::capture
{
enum class PixelKind
{
    Rgba8,
    Bgra8,
    Rgb10A2,
    Half4,
    Unsupported
};

inline PixelKind KindOf(DXGI_FORMAT aFormat)
{
    switch (aFormat)
    {
    case DXGI_FORMAT_R8G8B8A8_TYPELESS:
    case DXGI_FORMAT_R8G8B8A8_UNORM:
    case DXGI_FORMAT_R8G8B8A8_UNORM_SRGB:
        return PixelKind::Rgba8;
    case DXGI_FORMAT_B8G8R8A8_TYPELESS:
    case DXGI_FORMAT_B8G8R8A8_UNORM:
    case DXGI_FORMAT_B8G8R8A8_UNORM_SRGB:
    case DXGI_FORMAT_B8G8R8X8_UNORM:
        return PixelKind::Bgra8;
    case DXGI_FORMAT_R10G10B10A2_TYPELESS:
    case DXGI_FORMAT_R10G10B10A2_UNORM:
        return PixelKind::Rgb10A2;
    case DXGI_FORMAT_R16G16B16A16_TYPELESS:
    case DXGI_FORMAT_R16G16B16A16_FLOAT:
        return PixelKind::Half4;
    default:
        return PixelKind::Unsupported;
    }
}

inline std::string Base64(const uint8_t* aData, size_t aSize)
{
    static constexpr char Table[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve((aSize + 2) / 3 * 4);
    size_t i = 0;
    for (; i + 2 < aSize; i += 3)
    {
        const uint32_t v = (uint32_t(aData[i]) << 16) | (uint32_t(aData[i + 1]) << 8) | aData[i + 2];
        out += Table[v >> 18];
        out += Table[(v >> 12) & 63];
        out += Table[(v >> 6) & 63];
        out += Table[v & 63];
    }
    if (i < aSize)
    {
        const uint32_t v = (uint32_t(aData[i]) << 16) | (i + 1 < aSize ? uint32_t(aData[i + 1]) << 8 : 0);
        out += Table[v >> 18];
        out += Table[(v >> 12) & 63];
        out += i + 1 < aSize ? Table[(v >> 6) & 63] : '=';
        out += '=';
    }
    return out;
}

inline float HalfToFloat(uint16_t aHalf)
{
    const bool negative = (aHalf & 0x8000) != 0;
    const uint32_t exp = (aHalf >> 10) & 0x1F;
    const uint32_t mant = aHalf & 0x3FF;
    float f;
    if (exp == 0)
        f = std::ldexp(float(mant), -24); // zero or subnormal
    else if (exp == 31)
        f = mant ? NAN : INFINITY;
    else
        f = std::ldexp(float(mant | 0x400), int(exp) - 25);
    return negative ? -f : f;
}

inline float SrgbEncode(float aLinear)
{
    const float v = std::clamp(aLinear, 0.0f, 1.0f);
    return v <= 0.0031308f ? v * 12.92f : 1.055f * std::pow(v, 1.0f / 2.4f) - 0.055f;
}

// PQ (SMPTE ST 2084) to nits.
inline float PqToNits(float aE)
{
    constexpr float m1 = 2610.0f / 16384.0f, m2 = 2523.0f / 4096.0f * 128.0f;
    constexpr float c1 = 3424.0f / 4096.0f, c2 = 2413.0f / 4096.0f * 32.0f, c3 = 2392.0f / 4096.0f * 32.0f;
    const float p = std::pow(std::clamp(aE, 0.0f, 1.0f), 1.0f / m2);
    return 10000.0f * std::pow(std::max(p - c1, 0.0f) / (c2 - c3 * p), 1.0f / m1);
}

// aRows: aHeight rows of aRowPitch bytes. aMode: 0 SDR, 1 scRGB, 2 HDR10 (PQ).
// Returns outWidth x outHeight BGRA pixels, at most aMaxWidth wide, aspect kept.
inline std::vector<uint8_t> Convert(const uint8_t* aRows, uint32_t aRowPitch, uint32_t aWidth, uint32_t aHeight,
                                    PixelKind aKind, int aMode, uint32_t aMaxWidth, float aPaperWhiteNits,
                                    uint32_t& aOutWidth, uint32_t& aOutHeight)
{
    const uint32_t outW = std::max(1u, std::min(aWidth, aMaxWidth));
    const uint32_t outH = std::max(1u, uint32_t(uint64_t(aHeight) * outW / aWidth));
    aOutWidth = outW;
    aOutHeight = outH;
    std::vector<uint8_t> out(size_t(outW) * outH * 4);
    for (uint32_t oy = 0; oy < outH; ++oy)
    {
        const uint32_t y0 = uint32_t(uint64_t(oy) * aHeight / outH);
        const uint32_t y1 = std::max(y0 + 1, uint32_t(uint64_t(oy + 1) * aHeight / outH));
        for (uint32_t ox = 0; ox < outW; ++ox)
        {
            const uint32_t x0 = uint32_t(uint64_t(ox) * aWidth / outW);
            const uint32_t x1 = std::max(x0 + 1, uint32_t(uint64_t(ox + 1) * aWidth / outW));
            // Averaged in the source's own encoding, then converted once per output pixel.
            float sum[3] = {0, 0, 0};
            for (uint32_t y = y0; y < y1; ++y)
            {
                const uint8_t* row = aRows + size_t(y) * aRowPitch;
                for (uint32_t x = x0; x < x1; ++x)
                {
                    float r, g, b;
                    if (aKind == PixelKind::Rgba8 || aKind == PixelKind::Bgra8)
                    {
                        const uint8_t* p = row + size_t(x) * 4;
                        r = p[aKind == PixelKind::Rgba8 ? 0 : 2] / 255.0f;
                        g = p[1] / 255.0f;
                        b = p[aKind == PixelKind::Rgba8 ? 2 : 0] / 255.0f;
                    }
                    else if (aKind == PixelKind::Rgb10A2)
                    {
                        uint32_t v;
                        std::memcpy(&v, row + size_t(x) * 4, 4);
                        r = (v & 0x3FF) / 1023.0f;
                        g = ((v >> 10) & 0x3FF) / 1023.0f;
                        b = ((v >> 20) & 0x3FF) / 1023.0f;
                    }
                    else
                    {
                        uint16_t h[4];
                        std::memcpy(h, row + size_t(x) * 8, 8);
                        r = HalfToFloat(h[0]);
                        g = HalfToFloat(h[1]);
                        b = HalfToFloat(h[2]);
                    }
                    sum[0] += r;
                    sum[1] += g;
                    sum[2] += b;
                }
            }
            const float n = float(uint64_t(y1 - y0) * (x1 - x0));
            float c[3] = {sum[0] / n, sum[1] / n, sum[2] / n};
            if (aMode == 1)
            {
                // scRGB: linear, 1.0 = 80 nits, Rec. 709 primaries.
                for (float& v : c)
                    v = SrgbEncode(v * 80.0f / aPaperWhiteNits);
            }
            else if (aMode == 2)
            {
                // HDR10: PQ in Rec. 2020 primaries, to linear Rec. 709 relative to paper white.
                const float lr = PqToNits(c[0]) / aPaperWhiteNits;
                const float lg = PqToNits(c[1]) / aPaperWhiteNits;
                const float lb = PqToNits(c[2]) / aPaperWhiteNits;
                c[0] = SrgbEncode(1.6605f * lr - 0.5876f * lg - 0.0728f * lb);
                c[1] = SrgbEncode(-0.1246f * lr + 1.1329f * lg - 0.0083f * lb);
                c[2] = SrgbEncode(-0.0182f * lr - 0.1006f * lg + 1.1187f * lb);
            }
            uint8_t* o = out.data() + (size_t(oy) * outW + ox) * 4;
            o[0] = uint8_t(std::clamp(c[2], 0.0f, 1.0f) * 255.0f + 0.5f);
            o[1] = uint8_t(std::clamp(c[1], 0.0f, 1.0f) * 255.0f + 0.5f);
            o[2] = uint8_t(std::clamp(c[0], 0.0f, 1.0f) * 255.0f + 0.5f);
            o[3] = 255;
        }
    }
    return out;
}
} // namespace rednode::overlay::detail::capture
