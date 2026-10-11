// Overlay windows: the registry, hit testing, focus, z-order and dragging.
//
// The host opens windows and marks drag handles; the plugin owns placement.
// Input arrives in reference pixels from input.cpp and is routed here:
//   - the frontmost window under the cursor whose pixel is not transparent
//     gets the event (transparent pixels click through to the window below);
//   - a press on a drag handle moves the window here, at the game's frame rate,
//     and is not sent to the page;
//   - a press on empty screen leaves interactive mode, giving input back to the game;
//   - keys go to the focused window.
//
// Host -> plugin commands (JSON, "cmd"):
//   {"cmd":"window.open","window":1,"x":448,"y":220,"width":1024,"height":640,"draggable":true}
//   {"cmd":"window.drag","window":1,"regions":[x,y,w,h, ...]}   page pixels
//   {"cmd":"window.close","window":1}
// Plugin -> host events:
//   {"event":"input","window":1,"type":"mouseMove","x":..,"y":..}   page pixels
//   {"event":"focus","window":1}     0 when no window has focus
//   {"event":"moved","window":1,"x":..,"y":..}   after a drag, reference pixels

#include "json.hpp"
#include "overlay.hpp"

#include <algorithm>
#include <functional>
#include <mutex>

namespace rednode::overlay::detail
{
namespace
{
constexpr uint8_t ClickThroughAlpha = 8; // alpha below this counts as transparent
constexpr float KeepOnScreen = 48.0f;    // reference pixels of a window that stay visible

struct DragRegion
{
    float x, y, w, h;
};

struct Window
{
    uint32_t id = 0;
    float x = 0, y = 0;
    uint32_t width = 0, height = 0;
    bool draggable = true;
    std::vector<DragRegion> dragRegions;

    std::vector<uint8_t> alpha; // for hit testing, from the newest frame
    uint32_t alphaWidth = 0, alphaHeight = 0;

    WindowFrame pending;
    bool hasPending = false;
};

std::mutex g_mutex;
std::vector<Window> g_windows; // back to front
uint32_t g_focus = 0;
uint32_t g_hover = 0;
uint32_t g_capture = 0; // the window that got the mouse press, gets the release
uint32_t g_dragging = 0;
float g_dragOffsetX = 0, g_dragOffsetY = 0;
float g_mouseX = 0, g_mouseY = 0;

std::mutex g_screenMutex;
Screen g_screen;

// Actions collected under the lock and run after it is released.
using Actions = std::vector<std::function<void()>>;
void Run(Actions& aActions)
{
    for (auto& a : aActions)
        a();
}

Window* Find(uint32_t aId)
{
    for (auto& w : g_windows)
    {
        if (w.id == aId)
            return &w;
    }
    return nullptr;
}

struct Hit
{
    Window* window = nullptr;
    float localX = 0, localY = 0;
    bool onDragHandle = false;
};

Hit HitTest(float aX, float aY)
{
    for (auto it = g_windows.rbegin(); it != g_windows.rend(); ++it)
    {
        Window& w = *it;
        const float lx = aX - w.x;
        const float ly = aY - w.y;
        if (lx < 0 || ly < 0 || lx >= float(w.width) || ly >= float(w.height))
            continue;
        if (!w.alpha.empty())
        {
            const auto px = std::min(uint32_t(lx), w.alphaWidth - 1);
            const auto py = std::min(uint32_t(ly), w.alphaHeight - 1);
            if (w.alpha[size_t(py) * w.alphaWidth + px] < ClickThroughAlpha)
                continue; // transparent: try the window below
        }
        Hit hit{&w, lx, ly, false};
        if (w.draggable)
        {
            for (const auto& r : w.dragRegions)
            {
                if (lx >= r.x && ly >= r.y && lx < r.x + r.w && ly < r.y + r.h)
                    hit.onDragHandle = true;
            }
        }
        return hit;
    }
    return {};
}

void BringToFront(uint32_t aId)
{
    const auto it = std::find_if(g_windows.begin(), g_windows.end(), [&](const Window& w) { return w.id == aId; });
    if (it != g_windows.end() && it + 1 != g_windows.end())
        std::rotate(it, it + 1, g_windows.end());
}

std::string MouseJson(uint32_t aWindow, const char* aType, float aX, float aY, const char* aButton = nullptr,
                      int aDelta = 0)
{
    std::string json = "{\"event\":\"input\",\"window\":" + std::to_string(aWindow) + ",\"type\":\"" + aType +
                       "\",\"x\":" + std::to_string(int(aX)) + ",\"y\":" + std::to_string(int(aY));
    if (aButton)
        json += std::string(",\"button\":\"") + aButton + "\"";
    if (aDelta)
        json += ",\"delta\":" + std::to_string(aDelta);
    return json + "}";
}

void Send(Actions& aActions, std::string aJson)
{
    aActions.push_back([json = std::move(aJson)]() mutable { SendJson(std::move(json)); });
}

void SetFocus(Actions& aActions, uint32_t aId)
{
    if (g_focus == aId)
        return;
    g_focus = aId;
    Send(aActions, "{\"event\":\"focus\",\"window\":" + std::to_string(aId) + "}");
}

void SetHover(Actions& aActions, uint32_t aId)
{
    if (g_hover == aId)
        return;
    if (Window* old = Find(g_hover))
        Send(aActions, MouseJson(old->id, "mouseLeave", g_mouseX - old->x, g_mouseY - old->y));
    g_hover = aId;
}

void Clamp(Window& aWindow)
{
    Screen s;
    {
        std::scoped_lock lock(g_screenMutex);
        s = g_screen;
    }
    if (s.width <= 0)
        return;
    aWindow.x = std::clamp(aWindow.x, KeepOnScreen - float(aWindow.width), s.width - KeepOnScreen);
    aWindow.y = std::clamp(aWindow.y, 0.0f, s.height - KeepOnScreen);
}
} // namespace

Screen GetScreen()
{
    std::scoped_lock lock(g_screenMutex);
    return g_screen;
}

void SetScreen(const Screen& aScreen)
{
    std::scoped_lock lock(g_screenMutex);
    g_screen = aScreen;
}

void HandleWindowCommand(const std::string& aJson)
{
    std::string cmd;
    double id = 0;
    if (!json::String(aJson, "cmd", cmd) || !json::Number(aJson, "window", id) || id <= 0)
        return;

    Actions actions;
    {
        std::scoped_lock lock(g_mutex);
        Window* w = Find(uint32_t(id));

        if (cmd == "window.open")
        {
            double x = 0, y = 0, width = 0, height = 0;
            json::Number(aJson, "x", x);
            json::Number(aJson, "y", y);
            json::Number(aJson, "width", width);
            json::Number(aJson, "height", height);
            if (width < 1 || height < 1 || width > 4096 || height > 4096)
                return;
            if (!w)
            {
                if (g_windows.size() >= MaxWindows)
                {
                    Log("Overlay: too many windows, ignored window %u", uint32_t(id));
                    return;
                }
                g_windows.push_back({});
                w = &g_windows.back();
                w->id = uint32_t(id);
            }
            w->x = float(x);
            w->y = float(y);
            w->width = uint32_t(width);
            w->height = uint32_t(height);
            w->draggable = json::Bool(aJson, "draggable", true);
            Clamp(*w);
        }
        else if (cmd == "window.drag" && w)
        {
            std::vector<double> v;
            json::Numbers(aJson, "regions", v);
            w->dragRegions.clear();
            for (size_t i = 0; i + 3 < v.size(); i += 4)
                w->dragRegions.push_back({float(v[i]), float(v[i + 1]), float(v[i + 2]), float(v[i + 3])});
        }
        else if (cmd == "window.close" && w)
        {
            const uint32_t closing = w->id;
            g_windows.erase(g_windows.begin() + (w - g_windows.data()));
            if (g_focus == closing)
                SetFocus(actions, 0);
            if (g_hover == closing)
                g_hover = 0;
            if (g_capture == closing)
                g_capture = 0;
            if (g_dragging == closing)
                g_dragging = 0;
        }
    }
    Run(actions);
}

void SubmitFrame(uint32_t aWindow, uint32_t aWidth, uint32_t aHeight, std::vector<uint8_t>&& aPixels)
{
    std::scoped_lock lock(g_mutex);
    Window* w = Find(aWindow);
    if (!w)
        return;
    // Keep the alpha channel for click-through.
    w->alphaWidth = aWidth;
    w->alphaHeight = aHeight;
    w->alpha.resize(size_t(aWidth) * aHeight);
    for (size_t i = 0; i < w->alpha.size(); ++i)
        w->alpha[i] = aPixels[i * 4 + 3];
    w->pending.width = aWidth;
    w->pending.height = aHeight;
    w->pending.pixels = std::move(aPixels);
    w->hasPending = true;
}

void CloseAllWindows()
{
    std::scoped_lock lock(g_mutex);
    g_windows.clear();
    g_focus = g_hover = g_capture = g_dragging = 0;
}

std::vector<WindowView> SnapshotWindows()
{
    std::scoped_lock lock(g_mutex);
    std::vector<WindowView> out;
    out.reserve(g_windows.size());
    for (const auto& w : g_windows)
        out.push_back({w.id, w.x, w.y, w.width, w.height});
    return out;
}

bool TakeFrame(uint32_t aWindow, WindowFrame& aOut)
{
    std::scoped_lock lock(g_mutex);
    Window* w = Find(aWindow);
    if (!w || !w->hasPending)
        return false;
    aOut = std::move(w->pending);
    w->pending = {};
    w->hasPending = false;
    return true;
}

void OnMouseMove(float aX, float aY)
{
    Actions actions;
    {
        std::scoped_lock lock(g_mutex);
        g_mouseX = aX;
        g_mouseY = aY;

        if (Window* d = Find(g_dragging))
        {
            d->x = aX - g_dragOffsetX;
            d->y = aY - g_dragOffsetY;
            Clamp(*d);
        }
        else if (Window* c = Find(g_capture))
        {
            Send(actions, MouseJson(c->id, "mouseMove", aX - c->x, aY - c->y));
        }
        else
        {
            const Hit hit = HitTest(aX, aY);
            SetHover(actions, hit.window ? hit.window->id : 0);
            if (hit.window)
                Send(actions, MouseJson(hit.window->id, "mouseMove", hit.localX, hit.localY));
        }
    }
    Run(actions);
}

void OnMouseButton(bool aDown, const char* aButton)
{
    Actions actions;
    bool leaveInteractive = false;
    {
        std::scoped_lock lock(g_mutex);
        if (aDown)
        {
            const Hit hit = HitTest(g_mouseX, g_mouseY);
            if (!hit.window)
            {
                // Empty screen: give input back to the game.
                SetFocus(actions, 0);
                leaveInteractive = true;
            }
            else
            {
                const uint32_t id = hit.window->id;
                BringToFront(id); // invalidates hit.window
                Window* w = Find(id);
                SetFocus(actions, id);
                if (hit.onDragHandle && std::string_view(aButton) == "left")
                {
                    g_dragging = id;
                    g_dragOffsetX = g_mouseX - w->x;
                    g_dragOffsetY = g_mouseY - w->y;
                }
                else
                {
                    g_capture = id;
                    Send(actions, MouseJson(id, "mouseDown", hit.localX, hit.localY, aButton));
                }
            }
        }
        else if (Window* d = Find(g_dragging))
        {
            g_dragging = 0;
            Send(actions, "{\"event\":\"moved\",\"window\":" + std::to_string(d->id) +
                              ",\"x\":" + std::to_string(int(d->x)) + ",\"y\":" + std::to_string(int(d->y)) + "}");
        }
        else if (Window* c = Find(g_capture))
        {
            g_capture = 0;
            Send(actions, MouseJson(c->id, "mouseUp", g_mouseX - c->x, g_mouseY - c->y, aButton));
        }
    }
    Run(actions);
    if (leaveInteractive)
        SetMode(Mode::Passive);
}

void OnWheel(int aDelta)
{
    Actions actions;
    {
        std::scoped_lock lock(g_mutex);
        const Hit hit = HitTest(g_mouseX, g_mouseY);
        if (hit.window)
            Send(actions, MouseJson(hit.window->id, "mouseWheel", hit.localX, hit.localY, nullptr, aDelta));
    }
    Run(actions);
}

void OnKey(bool aDown, UINT aVk)
{
    uint32_t focus;
    {
        std::scoped_lock lock(g_mutex);
        focus = g_focus;
    }
    if (focus)
        SendJson("{\"event\":\"input\",\"window\":" + std::to_string(focus) + ",\"type\":\"" +
                 (aDown ? "keyDown" : "keyUp") + "\",\"vk\":" + std::to_string(aVk) + "}");
}

void OnChar(wchar_t aChar)
{
    if (aChar < 0x20 && aChar != L'\r' && aChar != L'\b' && aChar != L'\t')
        return;
    uint32_t focus;
    {
        std::scoped_lock lock(g_mutex);
        focus = g_focus;
    }
    if (focus)
        SendJson("{\"event\":\"input\",\"window\":" + std::to_string(focus) + ",\"type\":\"char\",\"code\":" +
                 std::to_string(unsigned(aChar)) + "}");
}

void OnLeaveInteractive()
{
    Actions actions;
    {
        std::scoped_lock lock(g_mutex);
        if (Window* c = Find(g_capture))
            Send(actions, MouseJson(c->id, "mouseUp", g_mouseX - c->x, g_mouseY - c->y, "left"));
        if (Window* d = Find(g_dragging))
            Send(actions, "{\"event\":\"moved\",\"window\":" + std::to_string(d->id) +
                              ",\"x\":" + std::to_string(int(d->x)) + ",\"y\":" + std::to_string(int(d->y)) + "}");
        g_capture = g_dragging = 0;
        SetHover(actions, 0);
    }
    Run(actions);
}
} // namespace rednode::overlay::detail
