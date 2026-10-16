// Overlay lifecycle and shared helpers.

#include "overlay.hpp"

#include <cstdarg>
#include <cstdio>

namespace rednode::overlay
{
namespace
{
RED4ext::v1::PluginHandle g_handle = nullptr;
const RED4ext::v1::Sdk* g_sdk = nullptr;
bool g_installed = false;
} // namespace

void detail::Log(const char* aFormat, ...)
{
    if (!g_sdk)
        return;
    char buffer[512];
    va_list args;
    va_start(args, aFormat);
    std::vsnprintf(buffer, sizeof(buffer), aFormat, args);
    va_end(args);
    g_sdk->logger->Info(g_handle, buffer);
}

std::string JsonString(std::string_view aText)
{
    std::string out = "\"";
    for (const char c : aText)
    {
        switch (c)
        {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        case '\n':
            out += "\\n";
            break;
        default:
            if (static_cast<unsigned char>(c) < 0x20)
            {
                char buf[8];
                std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                out += buf;
            }
            else
            {
                out += c;
            }
        }
    }
    return out + "\"";
}

void Start(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk, const std::filesystem::path& aPluginDir)
{
    g_handle = aHandle;
    g_sdk = aSdk;
    detail::StartLink();
    detail::StartHost(aPluginDir);
}

void Install()
{
    if (g_installed)
        return;
    HWND window = nullptr;
    if (!detail::InstallCompositor(window))
        return;
    detail::InstallInput(window);
    g_installed = true;
}

void Update(uint64_t aFrame)
{
    detail::RunRequests(aFrame);
    detail::PollGameState(aFrame);
    detail::UpdateAudio();
}

uint64_t detail::NowMs()
{
    return GetTickCount64();
}

void ClearGameRefs()
{
    detail::ClearRefs();
}

void Stop()
{
    detail::UninstallInput();
    detail::UninstallCompositor();
    detail::StopAudio();
    detail::StopLink();
    detail::StopHost();
    g_installed = false;
}
} // namespace rednode::overlay
