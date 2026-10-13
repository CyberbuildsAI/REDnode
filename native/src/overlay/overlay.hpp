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
// Forgets every game object reference handed to apps and mods. Called on each
// session attach, when the objects of the last session are gone.
void ClearGameRefs();

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
uint64_t NowMs(); // a millisecond clock, for double-clicks
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
// The changed part of a window's image, ready to upload.
struct WindowFrame
{
    uint32_t fullWidth = 0, fullHeight = 0; // the whole window image
    uint32_t x = 0, y = 0;                  // where the region goes
    uint32_t width = 0, height = 0;         // the region
    std::vector<uint8_t> pixels;            // BGRA, premultiplied, width * height
};
void HandleWindowCommand(const std::string& aJson); // host -> plugin "cmd" messages
void SubmitFrame(uint32_t aWindow, uint32_t aWidth, uint32_t aHeight, std::vector<uint8_t>&& aPixels);
// A frame shared on the GPU: an NT handle already duplicated into this process.
struct SharedFrame
{
    HANDLE handle = nullptr;
    uint32_t width = 0, height = 0;
    uint32_t frameId = 0;
};
// Keeps the newest shared frame per window; an older one still waiting is closed and acknowledged.
void SubmitShared(uint32_t aWindow, const SharedFrame& aFrame);
bool TakeShared(uint32_t aWindow, SharedFrame& aOut);
// Gives back the shared frames of every window not in aDrawn: hidden mode, or hidden with the game's UI.
void DropSharedExcept(const std::vector<WindowView>& aDrawn);
// True once Present is hooked. Until then a shared frame is acknowledged as soon as it arrives.
void SetCompositorActive(bool aActive);
// Tells the host it may give these shared textures back to Chromium.
void AckFrames(const std::vector<uint32_t>& aFrameIds);
// Alpha read back from the GPU, for click-through on GPU-shared windows. Rows are aRowPitch bytes of BGRA.
void SubmitAlpha(uint32_t aWindow, uint32_t aWidth, uint32_t aHeight, const uint8_t* aRows, uint32_t aRowPitch);
// Asks for a picture of the game, sent to the host as {"event":"capture"}: the back
// buffer before the overlay is drawn, or after it, scaled to at most aMaxWidth. Any thread.
void RequestCapture(uint32_t aId, bool aWithOverlay, uint32_t aMaxWidth);
// Reports, once, that GPU sharing failed, so the host falls back to the CPU path.
void ReportSharedFailure(const char* aWhat, long aCode);

// A changed rectangle of a window's image, in page pixels.
void SubmitRect(uint32_t aWindow, uint32_t aFullWidth, uint32_t aFullHeight, uint32_t aX, uint32_t aY, uint32_t aWidth,
                uint32_t aHeight, const uint8_t* aPixels);
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

// reflect.cpp: the generic game API (rtti.call, rtti.get, rtti.release). Game thread.
namespace json
{
struct Value;
}
bool IsReflectMethod(const std::string& aMethod);
std::string Reflect(const std::string& aMethod, const json::Value& aParams, std::string& aError); // result JSON
void ClearRefs();
} // namespace detail
} // namespace rednode::overlay
