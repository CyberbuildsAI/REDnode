// REDnode native plugin.
//
// P1 probe. Proves four things on one game load:
//   1. RED4ext loads the plugin and its logger works.
//   2. The plugin can read the game's RTTI.
//   3. Synchronous redscript-to-native calls work (the Tier 1 path).
//   4. Events queued from scripts are drained on the game thread by a
//      per-frame pump (the Tier 2 path).
//
// Also dumps the game's RTTI for the game API reference when the file
// dump.request sits next to the DLL. See dump.cpp.
//
// And runs the HTML overlay proof of concept. See overlay/ and docs/overlay.md.

#include "dump.hpp"
#include "overlay/overlay.hpp"

#include <RED4ext/RED4ext.hpp>

#include <Windows.h>

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace
{
RED4ext::v1::PluginHandle g_handle = nullptr;
const RED4ext::v1::Sdk* g_sdk = nullptr;

// Events queued by scripts, drained once per frame on the game thread.
std::mutex g_eventsMutex;
std::vector<std::pair<std::string, int32_t>> g_events;

std::uint64_t g_frames = 0;
constexpr std::uint64_t HeartbeatFrames = 3600;

std::filesystem::path GetPluginDir()
{
    // The plugin handle is this DLL's module handle.
    std::wstring path(MAX_PATH, L'\0');
    const auto length = GetModuleFileNameW(g_handle, path.data(), static_cast<DWORD>(path.size()));
    path.resize(length);
    return std::filesystem::path(path).parent_path();
}

// redscript: public static native func REDnode_Ping(value: Int32) -> Int32
// The script waits for the return value. Returns value * 2.
void REDnode_Ping(RED4ext::IScriptable* aContext, RED4ext::CStackFrame* aFrame, void* aOut, int64_t a4)
{
    RED4EXT_UNUSED_PARAMETER(aContext);
    RED4EXT_UNUSED_PARAMETER(a4);

    int32_t value = 0;
    RED4ext::GetParameter(aFrame, &value);
    aFrame->code++; // skip ParamEnd

    if (aOut)
    {
        *static_cast<int32_t*>(aOut) = value * 2;
    }
}

// redscript: public static native func REDnode_Emit(name: String, value: Int32) -> Void
// Queues an event and returns at once. The script never waits on the pump.
void REDnode_Emit(RED4ext::IScriptable* aContext, RED4ext::CStackFrame* aFrame, void* aOut, int64_t a4)
{
    RED4EXT_UNUSED_PARAMETER(aContext);
    RED4EXT_UNUSED_PARAMETER(aOut);
    RED4EXT_UNUSED_PARAMETER(a4);

    RED4ext::CString name;
    int32_t value = 0;
    RED4ext::GetParameter(aFrame, &name);
    RED4ext::GetParameter(aFrame, &value);
    aFrame->code++; // skip ParamEnd

    std::scoped_lock lock(g_eventsMutex);
    g_events.emplace_back(name.c_str(), value);
}

void PostRegisterTypes()
{
    auto rtti = RED4ext::CRTTISystem::Get();
    const RED4ext::CBaseFunction::Flags flags = {.isNative = true, .isStatic = true};

    auto ping = RED4ext::CGlobalFunction::Create("REDnode_Ping", "REDnode_Ping", &REDnode_Ping);
    ping->flags = flags;
    ping->AddParam("Int32", "value");
    ping->SetReturnType("Int32");
    rtti->RegisterFunction(ping);

    auto emit = RED4ext::CGlobalFunction::Create("REDnode_Emit", "REDnode_Emit", &REDnode_Emit);
    emit->flags = flags;
    emit->AddParam("String", "name");
    emit->AddParam("Int32", "value");
    rtti->RegisterFunction(emit);

    g_sdk->logger->InfoF(g_handle, "RTTI ready: %u types, %u global functions", rtti->types.size,
                         rtti->funcs.size);
}

// Dumps the RTTI once if dump.request exists, then deletes the request.
// Runs when the game first reaches the Running state, after scripts load.
void DumpIfRequested()
{
    const auto dir = GetPluginDir();
    const auto request = dir / L"dump.request";
    std::error_code ec;
    if (!std::filesystem::exists(request, ec))
    {
        return;
    }

    const auto* v = g_sdk->runtime;
    const auto version = std::to_string(v->major) + "." + std::to_string(v->minor) + "." + std::to_string(v->patch);
    const auto file = dir / L"rtti-dump.json";

    std::string error;
    if (rednode::DumpRtti(file, version, error))
    {
        std::filesystem::remove(request, ec);
        g_sdk->logger->InfoWF(g_handle, L"RTTI dump written to %ls", file.c_str());
    }
    else
    {
        g_sdk->logger->ErrorF(g_handle, "RTTI dump failed: %s", error.c_str());
    }
}

bool OnRunningEnter(RED4ext::CGameApplication* aApp)
{
    RED4EXT_UNUSED_PARAMETER(aApp);

    g_sdk->logger->Info(g_handle, "Game thread pump started");
    DumpIfRequested();
    rednode::overlay::Install();
    return true;
}

bool OnRunningUpdate(RED4ext::CGameApplication* aApp)
{
    RED4EXT_UNUSED_PARAMETER(aApp);

    ++g_frames;

    std::vector<std::pair<std::string, int32_t>> events;
    {
        std::scoped_lock lock(g_eventsMutex);
        events.swap(g_events);
    }

    for (const auto& [name, value] : events)
    {
        g_sdk->logger->InfoF(g_handle, "Event drained on frame %llu: %s = %d", g_frames, name.c_str(), value);
        rednode::overlay::SendJson("{\"event\":\"game\",\"name\":" + rednode::overlay::JsonString(name) +
                                   ",\"value\":" + std::to_string(value) + ",\"frame\":" + std::to_string(g_frames) +
                                   "}");
    }

    rednode::overlay::Update(g_frames);

    if (g_frames % HeartbeatFrames == 0)
    {
        g_sdk->logger->InfoF(g_handle, "Pump heartbeat: %llu frames", g_frames);
    }

    return false; // ignored in the Running state
}

bool OnRunningExit(RED4ext::CGameApplication* aApp)
{
    RED4EXT_UNUSED_PARAMETER(aApp);

    g_sdk->logger->InfoF(g_handle, "Game thread pump stopped after %llu frames", g_frames);
    return true;
}
} // namespace

RED4EXT_C_EXPORT bool RED4EXT_CALL Main(RED4ext::v1::PluginHandle aHandle, RED4ext::v1::EMainReason aReason,
                                        const RED4ext::v1::Sdk* aSdk)
{
    switch (aReason)
    {
    case RED4ext::v1::EMainReason::Load:
    {
        g_handle = aHandle;
        g_sdk = aSdk;

        aSdk->logger->Info(aHandle, "REDnode 0.4.0 loading (P1 probe, overlay O1)");

        RED4ext::CRTTISystem::Get()->AddPostRegisterCallback(PostRegisterTypes);

        static RED4ext::v1::GameState running{OnRunningEnter, OnRunningUpdate, OnRunningExit};
        if (!aSdk->gameStates->Add(aHandle, RED4ext::EGameStateType::Running, &running))
        {
            aSdk->logger->Error(aHandle, "Could not add the Running game state");
        }

        rednode::overlay::Start(aHandle, aSdk);

        const auto scripts = GetPluginDir() / L"Scripts";
        if (!aSdk->scripts->Add(aHandle, scripts.c_str()))
        {
            aSdk->logger->ErrorWF(aHandle, L"Could not add scripts from %ls", scripts.c_str());
        }
        break;
    }
    case RED4ext::v1::EMainReason::Unload:
    {
        rednode::overlay::Stop();
        break;
    }
    }

    return true;
}

RED4EXT_C_EXPORT void RED4EXT_CALL Query(RED4ext::v1::PluginInfo* aInfo)
{
    aInfo->name = L"REDnode";
    aInfo->author = L"CyberbuildsAI";
    aInfo->version = RED4EXT_V1_SEMVER(0, 4, 0);
    aInfo->runtime = RED4EXT_V1_RUNTIME_VERSION_LATEST;
    aInfo->sdk = RED4EXT_V1_SDK_VERSION_CURRENT;
}

RED4EXT_C_EXPORT uint32_t RED4EXT_CALL Supports()
{
    return RED4EXT_API_VERSION_1;
}
