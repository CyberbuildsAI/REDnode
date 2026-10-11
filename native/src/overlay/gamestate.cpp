// Reads the game's UI state on the game thread, for HUD widgets that hide
// while the game shows a menu, photo mode, a scene or the main menu.
//
// | State      | Source                                                         |
// |------------|----------------------------------------------------------------|
// | menu       | UI_System blackboard, IsInMenu                                 |
// | photo-mode | PhotoModeSystem.IsPhotoModeActive()                            |
// | scene      | the player's PlayerStateMachine blackboard, SceneTier >= 4     |
// | main-menu  | no player: the main menu and loading screens                   |
//
// The SceneTier threshold is unverified. Tiers run from 1 (free gameplay) to
// 5 (full cinematic); the in-game test calibrates it.
//
// Sends {"event":"ui-state", ...} to the host when the state changes.

#include "overlay.hpp"
#include "rtti.hpp"

#include <atomic>
#include <string>

namespace rednode::overlay::detail
{
namespace
{
constexpr int SceneTierThreshold = 4; // unverified
constexpr uint64_t PollEveryFrames = 6;

std::atomic<uint32_t> g_state{StateMainMenu};
std::atomic_bool g_resend{true};
int g_lastTier = -1;
bool g_warned = false;

rtti::Handle g_defs; // GetAllBlackboardDefs(), a long-lived singleton

rtti::Handle BlackboardDefs()
{
    if (!g_defs)
    {
        auto* fn = RED4ext::CRTTISystem::Get()->GetFunction("GetAllBlackboardDefs");
        RED4ext::StackArgs_t none;
        if (fn)
            RED4ext::ExecuteFunction(static_cast<void*>(nullptr), fn, &g_defs, none);
    }
    return g_defs;
}

// The definition object for one blackboard, e.g. UI_System.
rtti::Handle Def(const char* aName)
{
    auto* slot = static_cast<rtti::Handle*>(rtti::Property(BlackboardDefs(), aName));
    return slot ? *slot : rtti::Handle{};
}

bool InMenu()
{
    auto ui = Def("UI_System");
    void* id = rtti::Property(ui, "IsInMenu");
    if (!id)
        return false;
    auto system = rtti::GameSystem("GetBlackboardSystem");
    rtti::Handle board;
    RED4ext::StackArgs_t getArgs;
    getArgs.emplace_back(nullptr, &ui);
    if (!rtti::Call(system, "Get", &board, getArgs) || !board)
        return false;
    bool value = false;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, id);
    rtti::Call(board, "GetBool", &value, args);
    return value;
}

bool InPhotoMode()
{
    bool value = false;
    rtti::Call(rtti::GameSystem("GetPhotoModeSystem"), "IsPhotoModeActive", &value);
    return value;
}

int SceneTier(const rtti::Handle& aPlayer)
{
    auto psm = Def("PlayerStateMachine");
    void* id = rtti::Property(psm, "SceneTier");
    uint64_t entityId = 0;
    if (!id || !rtti::Call(aPlayer, "GetEntityID", &entityId))
        return -1;
    auto system = rtti::GameSystem("GetBlackboardSystem");
    rtti::Handle board;
    RED4ext::StackArgs_t getArgs;
    getArgs.emplace_back(nullptr, &entityId);
    getArgs.emplace_back(nullptr, &psm);
    if (!rtti::Call(system, "GetLocalInstanced", &board, getArgs) || !board)
        return -1;
    int32_t tier = -1;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, id);
    rtti::Call(board, "GetInt", &tier, args);
    return tier;
}
} // namespace

void PollGameState(uint64_t aFrame)
{
    if (aFrame % PollEveryFrames != 0 && !g_resend)
        return;

    uint32_t state = 0;
    int tier = -1;
    const auto player = rtti::Player();
    if (!player)
    {
        state |= StateMainMenu;
    }
    else
    {
        if (InMenu())
            state |= StateMenu;
        if (InPhotoMode())
            state |= StatePhotoMode;
        tier = SceneTier(player);
        if (tier >= SceneTierThreshold)
            state |= StateScene;
        if (tier < 0 && !g_warned)
        {
            g_warned = true;
            Log("Overlay: could not read the scene tier; scene hiding is off");
        }
    }

    const uint32_t old = g_state.exchange(state);
    if (old != state || tier != g_lastTier || g_resend.exchange(false))
    {
        g_lastTier = tier;
        SendJson("{\"event\":\"ui-state\",\"menu\":" + std::string(state & StateMenu ? "true" : "false") +
                 ",\"photoMode\":" + (state & StatePhotoMode ? "true" : "false") +
                 ",\"scene\":" + (state & StateScene ? "true" : "false") +
                 ",\"mainMenu\":" + (state & StateMainMenu ? "true" : "false") +
                 ",\"sceneTier\":" + std::to_string(tier) + "}");
    }
}

uint32_t GetUiState()
{
    return g_state.load();
}

void ResendGameState()
{
    g_resend = true;
}
} // namespace rednode::overlay::detail
