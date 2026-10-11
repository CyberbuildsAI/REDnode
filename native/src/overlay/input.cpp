// Game window hook: the F10 hotkey, and input for the overlay in interactive mode.
//
// F10 cycles passive -> interactive -> hidden. Esc leaves interactive mode.
// In interactive mode mouse and keyboard messages are sent to the host and not
// passed to the game. The game hides and locks the cursor, so the overlay keeps
// a virtual cursor moved by raw mouse input, and the page draws it.
// Whether this stops all game input is unverified: see docs/overlay.md.

#include "overlay.hpp"

#include <windowsx.h>

#include <algorithm>
#include <atomic>
#include <string>

namespace rednode::overlay::detail
{
namespace
{
constexpr UINT ToggleKey = VK_F10;

HWND g_window = nullptr;
WNDPROC g_origProc = nullptr;
std::atomic_int g_mode{static_cast<int>(Mode::Passive)};

// Virtual cursor in page pixels. Written by the window thread, read by the
// compositor, which draws it every frame.
std::atomic<float> g_cursorX{0};
std::atomic<float> g_cursorY{0};
bool g_rawMouse = false;    // raw mouse input seen: use it, ignore WM_MOUSEMOVE and buttons
bool g_rawKeyboard = false; // raw keyboard input seen: use it, ignore WM_KEYDOWN and WM_CHAR

void PageSize(float& aWidth, float& aHeight)
{
    const PanelRect r = GetPanelRect();
    aWidth = r.scale > 0 ? r.width / r.scale : 0;
    aHeight = r.scale > 0 ? r.height / r.scale : 0;
}

void SendMouse(const char* aType, const char* aButton = nullptr, int aDelta = 0)
{
    std::string json = "{\"event\":\"input\",\"type\":\"";
    json += aType;
    json += "\",\"x\":" + std::to_string(int(g_cursorX.load())) + ",\"y\":" + std::to_string(int(g_cursorY.load()));
    if (aButton)
        json += std::string(",\"button\":\"") + aButton + "\"";
    if (aDelta)
        json += ",\"delta\":" + std::to_string(aDelta);
    json += "}";
    SendJson(std::move(json));
}

void SendKey(const char* aType, UINT aVk)
{
    SendJson(std::string("{\"event\":\"input\",\"type\":\"") + aType + "\",\"vk\":" + std::to_string(aVk) + "}");
}

void SendChar(wchar_t aChar)
{
    if (aChar < 0x20 && aChar != L'\r' && aChar != L'\b' && aChar != L'\t')
        return;
    SendJson("{\"event\":\"input\",\"type\":\"char\",\"code\":" + std::to_string(unsigned(aChar)) + "}");
}

void MoveCursorBy(float aDx, float aDy)
{
    float w, h;
    PageSize(w, h);
    g_cursorX = std::clamp(g_cursorX.load() + aDx, 0.0f, std::max(0.0f, w - 1));
    g_cursorY = std::clamp(g_cursorY.load() + aDy, 0.0f, std::max(0.0f, h - 1));
    SendMouse("mouseMove");
}

// Client-area mouse position to page pixels.
bool ClientToPage(LPARAM aLParam, float& aX, float& aY)
{
    RECT client{};
    GetClientRect(g_window, &client);
    const PanelRect r = GetPanelRect();
    if (client.right <= 0 || client.bottom <= 0 || r.scale <= 0)
        return false;
    const float bx = float(GET_X_LPARAM(aLParam)) * r.backBufferWidth / float(client.right);
    const float by = float(GET_Y_LPARAM(aLParam)) * r.backBufferHeight / float(client.bottom);
    aX = (bx - r.x) / r.scale;
    aY = (by - r.y) / r.scale;
    return true;
}

void ToggleMode()
{
    const auto next = static_cast<Mode>((g_mode.load() + 1) % 3);
    SetMode(next);
}

// Text for a raw key press, from the current modifier state.
void SendRawChar(UINT aVk, UINT aScanCode)
{
    BYTE state[256] = {};
    for (int vk : {VK_SHIFT, VK_LSHIFT, VK_RSHIFT, VK_CONTROL, VK_LCONTROL, VK_RCONTROL, VK_MENU, VK_LMENU, VK_RMENU})
    {
        if (GetAsyncKeyState(vk) & 0x8000)
            state[vk] = 0x80;
    }
    if (GetKeyState(VK_CAPITAL) & 1)
        state[VK_CAPITAL] = 1;
    wchar_t text[4] = {};
    const int n = ToUnicodeEx(aVk, aScanCode, state, text, 4, 0x4 /* no keyboard state change */, GetKeyboardLayout(0));
    for (int i = 0; i < n; ++i)
        SendChar(text[i]);
}

LRESULT HandleRawInput(HWND aWnd, WPARAM aWParam, LPARAM aLParam, bool aInteractive, bool& aHandled)
{
    alignas(8) BYTE buffer[sizeof(RAWINPUT)];
    UINT size = sizeof(buffer);
    if (GetRawInputData(reinterpret_cast<HRAWINPUT>(aLParam), RID_INPUT, buffer, &size, sizeof(RAWINPUTHEADER)) ==
        UINT(-1))
        return 0;
    const auto* raw = reinterpret_cast<const RAWINPUT*>(buffer);

    if (raw->header.dwType == RIM_TYPEKEYBOARD)
    {
        const auto& k = raw->data.keyboard;
        const bool down = !(k.Flags & RI_KEY_BREAK);
        g_rawKeyboard = true;
        static bool toggleHeld = false;
        if (k.VKey == ToggleKey)
        {
            if (down && !toggleHeld)
                ToggleMode();
            toggleHeld = down;
            aHandled = true;
            return DefWindowProcW(aWnd, WM_INPUT, aWParam, aLParam);
        }
        if (aInteractive)
        {
            if (down && k.VKey == VK_ESCAPE)
            {
                SetMode(Mode::Passive);
            }
            else
            {
                SendKey(down ? "keyDown" : "keyUp", k.VKey);
                if (down)
                    SendRawChar(k.VKey, k.MakeCode);
            }
            aHandled = true;
            return DefWindowProcW(aWnd, WM_INPUT, aWParam, aLParam);
        }
    }
    else if (raw->header.dwType == RIM_TYPEMOUSE && aInteractive)
    {
        const auto& m = raw->data.mouse;
        g_rawMouse = true;
        if (!(m.usFlags & MOUSE_MOVE_ABSOLUTE) && (m.lLastX || m.lLastY))
            MoveCursorBy(float(m.lLastX), float(m.lLastY));
        const USHORT f = m.usButtonFlags;
        if (f & RI_MOUSE_LEFT_BUTTON_DOWN)
            SendMouse("mouseDown", "left");
        if (f & RI_MOUSE_LEFT_BUTTON_UP)
            SendMouse("mouseUp", "left");
        if (f & RI_MOUSE_RIGHT_BUTTON_DOWN)
            SendMouse("mouseDown", "right");
        if (f & RI_MOUSE_RIGHT_BUTTON_UP)
            SendMouse("mouseUp", "right");
        if (f & RI_MOUSE_WHEEL)
            SendMouse("mouseWheel", nullptr, static_cast<SHORT>(m.usButtonData));
        aHandled = true;
        return DefWindowProcW(aWnd, WM_INPUT, aWParam, aLParam);
    }
    return 0;
}

LRESULT CALLBACK WndProc(HWND aWnd, UINT aMsg, WPARAM aWParam, LPARAM aLParam)
{
    const bool interactive = GetMode() == Mode::Interactive;

    switch (aMsg)
    {
    case WM_INPUT:
    {
        bool handled = false;
        const LRESULT result = HandleRawInput(aWnd, aWParam, aLParam, interactive, handled);
        if (handled)
            return result;
        break;
    }
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
        if (aWParam == ToggleKey)
        {
            if (!g_rawKeyboard && !(aLParam & (1 << 30)))
                ToggleMode();
            return 0;
        }
        if (interactive)
        {
            if (!g_rawKeyboard)
            {
                if (aWParam == VK_ESCAPE)
                    SetMode(Mode::Passive);
                else
                    SendKey("keyDown", UINT(aWParam));
            }
            return 0;
        }
        break;
    case WM_KEYUP:
    case WM_SYSKEYUP:
        if (aWParam == ToggleKey)
            return 0;
        if (interactive)
        {
            if (!g_rawKeyboard)
                SendKey("keyUp", UINT(aWParam));
            return 0;
        }
        break;
    case WM_CHAR:
    case WM_SYSCHAR:
        if (interactive)
        {
            if (!g_rawKeyboard)
                SendChar(wchar_t(aWParam));
            return 0;
        }
        break;
    case WM_MOUSEMOVE:
        if (interactive)
        {
            float x, y;
            if (!g_rawMouse && ClientToPage(aLParam, x, y))
            {
                g_cursorX = x;
                g_cursorY = y;
                SendMouse("mouseMove");
            }
            return 0;
        }
        break;
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_RBUTTONDOWN:
    case WM_RBUTTONUP:
    case WM_LBUTTONDBLCLK:
        if (interactive)
        {
            if (!g_rawMouse)
            {
                const bool down = aMsg == WM_LBUTTONDOWN || aMsg == WM_RBUTTONDOWN || aMsg == WM_LBUTTONDBLCLK;
                const bool left = aMsg == WM_LBUTTONDOWN || aMsg == WM_LBUTTONUP || aMsg == WM_LBUTTONDBLCLK;
                SendMouse(down ? "mouseDown" : "mouseUp", left ? "left" : "right");
            }
            return 0;
        }
        break;
    case WM_MOUSEWHEEL:
        if (interactive)
        {
            if (!g_rawMouse)
                SendMouse("mouseWheel", nullptr, GET_WHEEL_DELTA_WPARAM(aWParam));
            return 0;
        }
        break;
    case WM_SETCURSOR:
        if (interactive)
        {
            SetCursor(nullptr); // the page draws the cursor
            return TRUE;
        }
        break;
    default:
        break;
    }
    return CallWindowProcW(g_origProc, aWnd, aMsg, aWParam, aLParam);
}
} // namespace

Mode GetMode()
{
    return static_cast<Mode>(g_mode.load());
}

void SetMode(Mode aMode)
{
    const auto old = static_cast<Mode>(g_mode.exchange(static_cast<int>(aMode)));
    if (old == aMode)
        return;
    if (aMode == Mode::Interactive)
    {
        float w, h;
        PageSize(w, h);
        g_cursorX = w * 0.5f;
        g_cursorY = h * 0.5f;
        SendMouse("mouseMove");
    }
    Log("Overlay: %s", ModeName(aMode));
    SendJson(std::string("{\"event\":\"overlay\",\"mode\":") + JsonString(ModeName(aMode)) + "}");
}

const char* ModeName(Mode aMode)
{
    switch (aMode)
    {
    case Mode::Interactive:
        return "interactive";
    case Mode::Hidden:
        return "hidden";
    default:
        return "passive";
    }
}

void GetCursor(float& aX, float& aY)
{
    aX = g_cursorX.load();
    aY = g_cursorY.load();
}

bool InstallInput(HWND aWindow)
{
    if (g_origProc)
        return true;
    if (!aWindow || !IsWindow(aWindow))
    {
        Log("Overlay: no game window to hook");
        return false;
    }
    g_window = aWindow;
    g_origProc = reinterpret_cast<WNDPROC>(
        SetWindowLongPtrW(aWindow, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&WndProc)));
    if (!g_origProc)
    {
        Log("Overlay: could not hook the game window (error %lu)", GetLastError());
        return false;
    }
    return true;
}

void UninstallInput()
{
    if (!g_origProc)
        return;
    // Only restore if nobody hooked the window after us. If someone did, their
    // chain still calls ours, which keeps passing messages through.
    if (GetWindowLongPtrW(g_window, GWLP_WNDPROC) == reinterpret_cast<LONG_PTR>(&WndProc))
        SetWindowLongPtrW(g_window, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(g_origProc));
    g_mode = static_cast<int>(Mode::Passive);
}
} // namespace rednode::overlay::detail
