// Game window hook: the F10 hotkey, and input for overlay windows in interactive mode.
//
// F10 cycles passive -> interactive -> hidden. Esc leaves interactive mode.
// In interactive mode mouse and keyboard messages go to windows.cpp, which
// routes them to the right overlay window, and are not passed to the game.
// The game hides and locks the cursor, so the overlay keeps a virtual cursor
// over the whole screen, moved by raw mouse input. The compositor draws it.

#include "overlay.hpp"

#include <windowsx.h>

#include <algorithm>
#include <atomic>

namespace rednode::overlay::detail
{
namespace
{
constexpr UINT ToggleKey = VK_F10;

HWND g_window = nullptr;
WNDPROC g_origProc = nullptr;
std::atomic_int g_mode{static_cast<int>(Mode::Passive)};

// Virtual cursor in reference pixels. Written by the window thread, read by the compositor.
std::atomic<float> g_cursorX{0};
std::atomic<float> g_cursorY{0};
bool g_rawMouse = false;    // raw mouse input seen: use it, ignore WM_MOUSEMOVE and buttons
bool g_rawKeyboard = false; // raw keyboard input seen: use it, ignore WM_KEYDOWN and WM_CHAR
uint64_t g_activatedAt = 0; // when the game window last came back to the front, NowMs()

// The click that brings the game back to the front (after Alt+Tab) is not meant for
// the overlay: on empty screen it would leave interactive mode and hide the cursor.
// Buttons are ignored for a moment after the game is activated. (O8 test: the
// cursor "disappeared" after switching to the desktop and back.)
bool JustActivated()
{
    return g_activatedAt && NowMs() - g_activatedAt < 300;
}

void MoveCursorTo(float aX, float aY)
{
    const Screen s = GetScreen();
    g_cursorX = std::clamp(aX, 0.0f, std::max(0.0f, s.width - 1));
    g_cursorY = std::clamp(aY, 0.0f, std::max(0.0f, s.height - 1));
    OnMouseMove(g_cursorX, g_cursorY);
}

// Client-area mouse position to reference pixels.
bool ClientToReference(LPARAM aLParam, float& aX, float& aY)
{
    RECT client{};
    GetClientRect(g_window, &client);
    const Screen s = GetScreen();
    if (client.right <= 0 || client.bottom <= 0 || s.scale <= 0)
        return false;
    aX = float(GET_X_LPARAM(aLParam)) * s.width / float(client.right);
    aY = float(GET_Y_LPARAM(aLParam)) * s.height / float(client.bottom);
    return true;
}

void ToggleMode()
{
    SetMode(static_cast<Mode>((g_mode.load() + 1) % 3));
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
        OnChar(text[i]);
}

LRESULT HandleRawInput(HWND aWnd, WPARAM aWParam, LPARAM aLParam, bool aInteractive, bool& aHandled)
{
    alignas(8) BYTE buffer[sizeof(RAWINPUT)];
    UINT size = sizeof(buffer);
    if (GetRawInputData(reinterpret_cast<HRAWINPUT>(aLParam), RID_INPUT, buffer, &size, sizeof(RAWINPUTHEADER)) ==
        UINT(-1))
        return 0;
    const auto* raw = reinterpret_cast<const RAWINPUT*>(buffer);

    // Input that arrives while another window is in front (the desktop after Alt+Tab)
    // is not the player's input to the game: it must not move the overlay's cursor,
    // press its buttons or toggle it.
    if (GET_RAWINPUT_CODE_WPARAM(aWParam) == RIM_INPUTSINK)
        return 0;

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
                OnKey(down, k.VKey);
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
            MoveCursorTo(g_cursorX + float(m.lLastX), g_cursorY + float(m.lLastY));
        const USHORT f = JustActivated() ? 0 : m.usButtonFlags;
        if (f & RI_MOUSE_LEFT_BUTTON_DOWN)
            OnMouseButton(true, "left");
        if (f & RI_MOUSE_LEFT_BUTTON_UP)
            OnMouseButton(false, "left");
        if (f & RI_MOUSE_RIGHT_BUTTON_DOWN)
            OnMouseButton(true, "right");
        if (f & RI_MOUSE_RIGHT_BUTTON_UP)
            OnMouseButton(false, "right");
        if (f & RI_MOUSE_WHEEL)
            OnWheel(static_cast<SHORT>(m.usButtonData));
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
                    OnKey(true, UINT(aWParam));
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
                OnKey(false, UINT(aWParam));
            return 0;
        }
        break;
    case WM_CHAR:
    case WM_SYSCHAR:
        if (interactive)
        {
            if (!g_rawKeyboard)
                OnChar(wchar_t(aWParam));
            return 0;
        }
        break;
    case WM_MOUSEMOVE:
        if (interactive)
        {
            float x, y;
            if (!g_rawMouse && ClientToReference(aLParam, x, y))
                MoveCursorTo(x, y);
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
            if (!g_rawMouse && !JustActivated())
            {
                const bool down = aMsg == WM_LBUTTONDOWN || aMsg == WM_RBUTTONDOWN || aMsg == WM_LBUTTONDBLCLK;
                const bool left = aMsg == WM_LBUTTONDOWN || aMsg == WM_LBUTTONUP || aMsg == WM_LBUTTONDBLCLK;
                OnMouseButton(down, left ? "left" : "right");
            }
            return 0;
        }
        break;
    case WM_MOUSEWHEEL:
        if (interactive)
        {
            if (!g_rawMouse)
                OnWheel(GET_WHEEL_DELTA_WPARAM(aWParam));
            return 0;
        }
        break;
    case WM_SETCURSOR:
        if (interactive)
        {
            SetCursor(nullptr); // the compositor draws the cursor
            return TRUE;
        }
        break;
    case WM_ACTIVATEAPP:
        if (aWParam)
            g_activatedAt = NowMs();
        Log("Overlay: the game %s the front (mode %s)", aWParam ? "came back to" : "left", ModeName(GetMode()));
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
    if (old == Mode::Interactive)
        OnLeaveInteractive();
    if (aMode == Mode::Interactive)
    {
        const Screen s = GetScreen();
        MoveCursorTo(s.width * 0.5f, s.height * 0.5f);
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
