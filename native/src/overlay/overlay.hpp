#pragma once

// HTML overlay. See docs/overlay.md.
//
// An out-of-process host (Electron) renders overlay apps off-screen, one page
// per window, and streams the frames here over a named pipe. The plugin owns
// window placement, focus and dragging, so they keep up with the game. The
// compositor draws every window and the cursor in a Present hook. Bridge
// requests from apps run on the game thread.
//
// Coordinates: "reference pixels" are screen pixels at 1080p. Page pixels and
// reference pixels are the same size; both are scaled by back buffer height / 1080.

#include <RED4ext/RED4ext.hpp>

#include <Windows.h>

#include <cstdint>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace rednode::overlay
{
// Plugin load: start the pipe, and the packaged overlay host if there is one.
void Start(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk, const std::filesystem::path& aPluginDir);
// First Running frame: hook Present and the game window. Safe to call again.
void Install();
// Every game frame, on the game thread: run queued bridge requests.
void Update(uint64_t aFrame);
// Plugin unload: remove hooks and stop threads.
void Stop();

// Queues a JSON message for the host. Dropped when no host is connected. Any thread.
void SendJson(std::string aJson);
// Returns aText as a quoted, escaped JSON string.
std::string JsonString(std::string_view aText);

namespace detail
{
enum class Mode : int
{
    Passive = 0,     // windows drawn, input goes to the game
    Interactive = 1, // windows and cursor drawn, input goes to the windows
    Hidden = 2       // nothing drawn
};
Mode GetMode();
void SetMode(Mode aMode);
const char* ModeName(Mode aMode);

void Log(const char* aFormat, ...);

// The back buffer, published by the compositor every frame.
struct Screen
{
    float scale = 0;             // back buffer pixels per reference pixel
    float width = 0, height = 0; // in reference pixels
    float backBufferWidth = 0, backBufferHeight = 0;
};
Screen GetScreen();
void SetScreen(const Screen& aScreen);

// link.cpp
void StartLink();
void StopLink();
bool IsConnected();

// windows.cpp: the window registry and input routing. Thread safe.
constexpr uint32_t MaxWindows = 16;
struct WindowView // what the compositor needs, back to front
{
    uint32_t id;
    float x, y;             // reference pixels, top-left
    uint32_t width, height; // page pixels
};
struct WindowFrame
{
    uint32_t width = 0, height = 0;
    std::vector<uint8_t> pixels; // BGRA, premultiplied
};
void HandleWindowCommand(const std::string& aJson); // host -> plugin "cmd" messages
void SubmitFrame(uint32_t aWindow, uint32_t aWidth, uint32_t aHeight, std::vector<uint8_t>&& aPixels);
void CloseAllWindows(); // host disconnected
std::vector<WindowView> SnapshotWindows();
bool TakeFrame(uint32_t aWindow, WindowFrame& aOut);
// Input, called from the game window's thread. Positions in reference pixels.
void OnMouseMove(float aX, float aY);
void OnMouseButton(bool aDown, const char* aButton);
void OnWheel(int aDelta);
void OnKey(bool aDown, UINT aVk);
void OnChar(wchar_t aChar);
void OnLeaveInteractive();

// compositor.cpp
bool InstallCompositor(HWND& aWindow);
void UninstallCompositor();

// input.cpp
bool InstallInput(HWND aWindow);
void UninstallInput();
void GetCursor(float& aX, float& aY); // reference pixels

// gamestate.cpp: what the game is showing, for hideWith. Bits of GetUiState().
enum : uint32_t
{
    StateMenu = 1,      // a game menu is open
    StatePhotoMode = 2, // photo mode
    StateScene = 4,     // a cinematic scene
    StateMainMenu = 8,  // no player: main menu or loading screen
};
void PollGameState(uint64_t aFrame); // game thread
uint32_t GetUiState();               // any thread
void ResendGameState();              // send the state again, e.g. to a new host

// host.cpp
void StartHost(const std::filesystem::path& aPluginDir);
void StopHost();

// bridge.cpp
void QueueRequest(std::string aJson);
void RunRequests(uint64_t aFrame);
} // namespace detail
} // namespace rednode::overlay
