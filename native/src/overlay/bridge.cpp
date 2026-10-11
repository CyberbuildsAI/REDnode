// Bridge requests from overlay apps, run on the game thread between frames.
//
// Request:  {"id": 7, "method": "player.position"}
// Response: {"id": 7, "result": {...}}  or  {"id": 7, "error": "..."}
//
// Methods in the proof of concept:
//   game.info        the REDnode frame counter
//   player.position  V's world position, through GetPlayer and Entity.GetWorldPosition

#include "overlay.hpp"

#include <RED4ext/Scripting/Natives/ScriptGameInstance.hpp>
#include <RED4ext/Scripting/Natives/Vector4.hpp>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>

namespace rednode::overlay::detail
{
namespace
{
std::mutex g_requestMutex;
std::vector<std::string> g_requests;

// Minimal field readers. Requests come from our own host, one flat object each.
bool ReadInt(const std::string& aJson, const char* aKey, long long& aOut)
{
    const auto at = aJson.find(std::string("\"") + aKey + "\":");
    if (at == std::string::npos)
        return false;
    const char* start = aJson.c_str() + at + std::strlen(aKey) + 3;
    char* end = nullptr;
    aOut = std::strtoll(start, &end, 10);
    return end != start;
}

bool ReadString(const std::string& aJson, const char* aKey, std::string& aOut)
{
    const auto key = std::string("\"") + aKey + "\":\"";
    const auto at = aJson.find(key);
    if (at == std::string::npos)
        return false;
    const auto start = at + key.size();
    const auto end = aJson.find('"', start);
    if (end == std::string::npos)
        return false;
    aOut = aJson.substr(start, end - start);
    return true;
}

std::string Reply(long long aId, const std::string& aBody)
{
    return "{\"id\":" + std::to_string(aId) + "," + aBody + "}";
}

std::string Error(long long aId, const char* aMessage)
{
    return Reply(aId, "\"error\":" + JsonString(aMessage));
}

RED4ext::CBaseFunction* FindMethod(RED4ext::CClass* aClass, const char* aName)
{
    for (auto* c = aClass; c; c = c->parent)
    {
        if (auto* f = c->GetFunction(aName))
            return f;
    }
    return nullptr;
}

std::string PlayerPosition(long long aId)
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* getPlayer = rtti->GetFunction("GetPlayer;GameInstance");
    if (!getPlayer)
        return Error(aId, "GetPlayer not found");

    RED4ext::ScriptGameInstance game;
    RED4ext::Handle<RED4ext::IScriptable> player;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &game);
    if (!RED4ext::ExecuteFunction(static_cast<void*>(nullptr), getPlayer, &player, args) || !player)
        return Error(aId, "No player. Load a save first.");

    auto* getPosition = FindMethod(player->GetType(), "GetWorldPosition");
    if (!getPosition)
        return Error(aId, "GetWorldPosition not found");
    RED4ext::Vector4 pos;
    if (!RED4ext::ExecuteFunction(player.GetPtr(), getPosition, &pos))
        return Error(aId, "GetWorldPosition failed");

    char body[160];
    std::snprintf(body, sizeof(body), "\"result\":{\"x\":%.3f,\"y\":%.3f,\"z\":%.3f}", pos.X, pos.Y, pos.Z);
    return Reply(aId, body);
}

std::string Handle(const std::string& aJson, uint64_t aFrame)
{
    long long id = 0;
    std::string method;
    if (!ReadInt(aJson, "id", id) || !ReadString(aJson, "method", method))
        return {};

    if (method == "game.info")
        return Reply(id, "\"result\":{\"frame\":" + std::to_string(aFrame) + "}");
    if (method == "player.position")
        return PlayerPosition(id);
    return Error(id, ("Unknown method: " + method).c_str());
}
} // namespace

void QueueRequest(std::string aJson)
{
    std::scoped_lock lock(g_requestMutex);
    if (g_requests.size() < 256)
        g_requests.push_back(std::move(aJson));
}

void RunRequests(uint64_t aFrame)
{
    std::vector<std::string> requests;
    {
        std::scoped_lock lock(g_requestMutex);
        requests.swap(g_requests);
    }
    for (const auto& r : requests)
    {
        auto reply = Handle(r, aFrame);
        if (!reply.empty())
            SendJson(std::move(reply));
    }
}
} // namespace rednode::overlay::detail
