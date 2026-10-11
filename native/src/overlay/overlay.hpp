#pragma once

// HTML overlay proof of concept. See docs/overlay.md.
//
// An out-of-process host (Electron) renders web apps off-screen and streams
// the frames here over a named pipe. The compositor draws the latest frame on
// top of the game in a Present hook. The window hook sends input back to the
// host. Bridge requests from apps run on the game thread.

#include <RED4ext/RED4ext.hpp>

#include <Windows.h>

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace rednode::overlay
{
// Plugin load: start the pipe to the overlay host.
void Start(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk);
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
    Passive = 0,     // drawn, input goes to the game
    Interactive = 1, // drawn, input goes to the overlay
    Hidden = 2       // not drawn
};
Mode GetMode();
void SetMode(Mode aMode);
const char* ModeName(Mode aMode);

// Where the panel is on the back buffer, in back buffer pixels.
struct PanelRect
{
    float x = 0, y = 0, width = 0, height = 0; // panel
    float scale = 1;                           // back buffer pixels per page pixel
    float backBufferWidth = 0, backBufferHeight = 0;
};
PanelRect GetPanelRect();

void Log(const char* aFormat, ...);

// link.cpp
void StartLink();
void StopLink();
bool IsConnected();

// compositor.cpp
bool InstallCompositor(HWND& aWindow);
void UninstallCompositor();
void SubmitFrame(uint32_t aWidth, uint32_t aHeight, std::vector<uint8_t>&& aPixels);
void DropFrame(); // back to the placeholder, e.g. when the host disconnects

// input.cpp
bool InstallInput(HWND aWindow);
void UninstallInput();

// bridge.cpp
void QueueRequest(std::string aJson);
void RunRequests(uint64_t aFrame);
} // namespace detail
} // namespace rednode::overlay
