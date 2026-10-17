// Reads the game's UI state on the game thread, for HUD widgets that hide
// while the game shows a menu, photo mode, a scene or the main menu.
//
// | State      | Source                                                         |
// |------------|----------------------------------------------------------------|
// | menu       | UI_System blackboard, IsInMenu                                 |
// | photo-mode | PhotoModeSystem.IsPhotoModeActive()                            |
// | scene      | the player's PlayerStateMachine blackboard, SceneTier >= 4     |
// | main-menu  | no player, or the system requests handler's IsPreGame(): the   |
// |            | main menu and loading screens, also the boot loading screen,   |
// |            | where the game already has a player                            |
//
// The SceneTier threshold is unverified. Tiers run from 1 (free gameplay) to
// 5 (full cinematic); the in-game test calibrates it.
//
// IsPreGame() is reached the way CET mods do, through an inkMenuScenario made for
// it: the handler is the game's own, not the scenario's. Unverified in REDnode.
//
// Sends {"event":"ui-state", ...} to the host when the state changes, and logs
// each change of main-menu with its reason.

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
bool g_preGameWarned = false;
int g_lastMainMenu = -1; // 0 or 1 once logged

rtti::Handle g_scenario; // an inkMenuScenario, only to reach the system requests handler

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

// The game's IsPreGame(): true before a save is running. -1 when it cannot be read.
int PreGame()
{
    if (!g_scenario)
    {
        auto* cls = RED4ext::CRTTISystem::Get()->GetClass("inkMenuScenario");
        auto* raw = cls ? static_cast<RED4ext::IScriptable*>(cls->CreateInstance(true)) : nullptr;
        if (!raw)
            return -1;
        g_scenario = rtti::Handle(raw);
    }
    rtti::Handle handler;
    if (!rtti::Call(g_scenario, "GetSystemRequestsHandler", &handler) || !handler)
        return -1;
    bool value = false;
    if (!rtti::Call(handler, "IsPreGame", &value))
        return -1;
    return value ? 1 : 0;
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
    const int preGame = PreGame();
    if (preGame < 0 && !g_preGameWarned)
    {
        g_preGameWarned = true;
        Log("Overlay: could not read IsPreGame; the main menu is only \"no player\"");
    }
    if (!player || preGame == 1)
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

    const int mainMenu = (state & StateMainMenu) ? 1 : 0;
    if (mainMenu != g_lastMainMenu)
    {
        g_lastMainMenu = mainMenu;
        Log("Overlay: main menu %s (player %s, IsPreGame %s)", mainMenu ? "on" : "off", player ? "yes" : "no",
            preGame < 0 ? "unread" : (preGame ? "true" : "false"));
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
