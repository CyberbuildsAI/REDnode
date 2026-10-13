// Tests for the overlay window manager (src/overlay/windows.cpp): hit testing,
// click-through, focus, z-order, dragging and keyboard routing.
// Runs without the game: the plugin functions windows.cpp calls are stubbed here.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/overlay.hpp"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

namespace rednode::overlay
{
std::vector<std::string> g_sent;
void SendJson(std::string aJson)
{
    g_sent.push_back(std::move(aJson));
}
std::string JsonString(std::string_view aText)
{
    return "\"" + std::string(aText) + "\"";
}

namespace detail
{
Mode g_mode = Mode::Interactive;
Mode GetMode()
{
    return g_mode;
}
void SetMode(Mode aMode)
{
    g_mode = aMode;
}
const char* ModeName(Mode)
{
    return "";
}
void Log(const char*, ...)
{
}
uint32_t g_uiState = 0;
uint32_t GetUiState()
{
    return g_uiState;
}
uint64_t g_now = 1000;
uint64_t NowMs()
{
    return g_now;
}
} // namespace detail
} // namespace rednode::overlay

using namespace rednode::overlay;
using namespace rednode::overlay::detail;

namespace
{
int g_failures = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s  %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failures;
}

bool SentContains(const std::string& aText)
{
    for (const auto& s : g_sent)
    {
        if (s.find(aText) != std::string::npos)
            return true;
    }
    return false;
}

// An opaque frame, optionally with a transparent hole.
std::vector<uint8_t> Frame(uint32_t aW, uint32_t aH, uint32_t aHoleX = 0, uint32_t aHoleY = 0, uint32_t aHoleW = 0,
                           uint32_t aHoleH = 0)
{
    std::vector<uint8_t> px(size_t(aW) * aH * 4, 255);
    for (uint32_t y = aHoleY; y < aHoleY + aHoleH; ++y)
        for (uint32_t x = aHoleX; x < aHoleX + aHoleW; ++x)
            px[(size_t(y) * aW + x) * 4 + 3] = 0;
    return px;
}

WindowView View(uint32_t aId)
{
    for (const auto& v : SnapshotWindows())
        if (v.id == aId)
            return v;
    return {0, 0, 0, 0, 0};
}
} // namespace

int main()
{
    // Anchored windows are placed once the screen size is known.
    SetScreen({0, 0, 0, 0, 0});
    HandleWindowCommand(
        R"({"cmd":"window.open","window":9,"anchor":"bottom-right","x":-40,"y":-100,"width":440,"height":380})");
    Check(SnapshotWindows().empty(), "an anchored window waits for the screen size");
    SetScreen({1.0f, 1920, 1080, 1920, 1080});
    Check(View(9).x == 1440 && View(9).y == 600, "bottom-right anchor with an offset from the corner");
    HandleWindowCommand(R"({"cmd":"window.open","window":8,"anchor":"center","x":0,"y":0,"width":1024,"height":640})");
    Check(View(8).x == 448 && View(8).y == 220, "center anchor");
    HandleWindowCommand(R"({"cmd":"window.open","window":7,"anchor":"top","x":0,"y":10,"width":200,"height":100})");
    Check(View(7).x == 860 && View(7).y == 10, "top anchor");
    HandleWindowCommand(R"({"cmd":"window.open","window":6,"x":100,"y":50,"width":200,"height":100})");
    Check(View(6).x == 100 && View(6).y == 50, "no anchor means top-left");
    CloseAllWindows();

    // A: 400 x 300 at (100, 100), title bar is a drag handle. B: 200 x 200 at (300, 200),
    // with a transparent 100 x 100 hole in the middle.
    HandleWindowCommand(R"({"cmd":"window.open","window":1,"x":100,"y":100,"width":400,"height":300,"draggable":true})");
    HandleWindowCommand(R"({"cmd":"window.drag","window":1,"regions":[0,0,400,30]})");
    HandleWindowCommand(R"({"cmd":"window.open","window":2,"x":300,"y":200,"width":200,"height":200,"draggable":true})");
    SubmitFrame(1, 400, 300, Frame(400, 300));
    SubmitFrame(2, 200, 200, Frame(200, 200, 50, 50, 100, 100));
    Check(SnapshotWindows().size() == 2, "two windows open");
    Check(SnapshotWindows().back().id == 2, "the window opened last is in front");

    g_sent.clear();
    OnMouseMove(310, 210); // B's opaque corner, over A
    Check(SentContains(R"("window":2,"type":"mouseMove","x":10,"y":10)"), "move over an opaque pixel goes to the front window");

    g_sent.clear();
    OnMouseMove(400, 300); // B's transparent hole, over A
    Check(SentContains(R"("window":1,"type":"mouseMove","x":300,"y":200)"), "transparent pixels click through to the window below");
    Check(SentContains(R"("window":2,"type":"mouseLeave")"), "the window the mouse left gets mouseLeave");

    // A window that has drawn nothing yet (no alpha map) is invisible: it never catches
    // input meant for the window below it.
    HandleWindowCommand(R"({"cmd":"window.open","window":4,"x":120,"y":120,"width":100,"height":100})");
    g_sent.clear();
    OnMouseMove(150, 150);
    Check(SentContains(R"("window":1,"type":"mouseMove","x":50,"y":50)") && !SentContains(R"("window":4)"),
          "a window with nothing drawn lets input through");
    HandleWindowCommand(R"({"cmd":"window.close","window":4})");
    OnMouseMove(400, 300);

    g_sent.clear();
    OnMouseButton(true, "left");
    Check(SentContains(R"({"event":"focus","window":1})"), "a click focuses the window");
    Check(SnapshotWindows().back().id == 1, "a click brings the window to the front");
    Check(SentContains(R"("window":1,"type":"mouseDown")"), "the click reaches the page");
    OnMouseButton(false, "left");
    Check(SentContains(R"("window":1,"type":"mouseUp")"), "the release goes to the same window");

    g_sent.clear();
    OnKey(true, 'A');
    OnChar(L'a');
    Check(SentContains(R"("window":1,"type":"keyDown","vk":65)") && SentContains(R"("window":1,"type":"char","code":97)"),
          "keys go to the focused window");

    // Drag A by its title bar from (110, 110) to (310, 160).
    g_sent.clear();
    OnMouseMove(110, 110);
    OnMouseButton(true, "left");
    Check(!SentContains("mouseDown"), "a press on a drag handle is not sent to the page");
    OnMouseMove(310, 160);
    Check(View(1).x == 300 && View(1).y == 150, "dragging moves the window with the cursor");
    OnMouseButton(false, "left");
    Check(SentContains(R"({"event":"moved","window":1,"x":300,"y":150})"), "the end of a drag reports the new position");

    // A drag cannot lose the window off screen.
    OnMouseMove(310, 160);
    OnMouseButton(true, "left");
    OnMouseMove(5000, 5000);
    OnMouseButton(false, "left");
    Check(View(1).x <= 1920 - 48 && View(1).y <= 1080 - 48, "a dragged window stays partly on screen");

    // B is not draggable from its body: a press there goes to the page.
    g_sent.clear();
    OnMouseMove(305, 205);
    OnMouseButton(true, "left");
    OnMouseButton(false, "left");
    Check(SentContains(R"("window":2,"type":"mouseDown")"), "a press outside drag handles reaches the page");

    // A click on empty screen gives input back to the game.
    g_sent.clear();
    OnMouseMove(30, 1000);
    OnMouseButton(true, "left");
    Check(GetMode() == Mode::Passive, "a click on empty screen leaves interactive mode");
    Check(SentContains(R"({"event":"focus","window":0})"), "and clears the focus");

    // HUD widgets: drawn, but clicks go through them; hideWith hides them.
    SetMode(Mode::Interactive);
    HandleWindowCommand(
        R"({"cmd":"window.open","window":3,"kind":"hud","hideWith":["menu","scene"],"x":1000,"y":600,"width":200,"height":100})");
    SubmitFrame(3, 200, 100, Frame(200, 100));
    g_sent.clear();
    OnMouseMove(1050, 650);
    OnMouseButton(true, "left");
    Check(!SentContains(R"("window":3)"), "a HUD widget never gets input");
    Check(GetMode() == Mode::Passive, "a click on a HUD widget passes through, here to empty screen");
    g_uiState = StateMenu;
    Check(View(3).id == 0, "hideWith menu hides the widget while a menu is open");
    g_uiState = StatePhotoMode;
    Check(View(3).id == 3, "a state not in hideWith leaves it visible");
    g_uiState = 0;
    HandleWindowCommand(R"({"cmd":"window.close","window":3})");

    // Pin to HUD: a window that is not on the HUD shows only in interactive mode.
    HandleWindowCommand(R"({"cmd":"window.open","window":5,"x":10,"y":10,"width":100,"height":100,"onHud":false})");
    SetMode(Mode::Passive);
    Check(View(5).id == 0, "a window not pinned to the HUD is hidden during gameplay");
    SetMode(Mode::Interactive);
    Check(View(5).id == 5, "and shown while the player interacts");
    HandleWindowCommand(R"({"cmd":"window.hud","window":5,"onHud":true})");
    SetMode(Mode::Passive);
    Check(View(5).id == 5, "pinned to the HUD, it stays during gameplay");
    HandleWindowCommand(R"({"cmd":"window.open","window":6,"kind":"hud","x":10,"y":10,"width":100,"height":100,"onHud":false})");
    Check(View(6).id == 6, "a HUD widget is always on the HUD");
    HandleWindowCommand(R"({"cmd":"window.close","window":5})");
    HandleWindowCommand(R"({"cmd":"window.close","window":6})");
    SetMode(Mode::Passive); // as before this block

    // Changed rectangles: only the changed part is uploaded, and alpha follows it.
    HandleWindowCommand(R"({"cmd":"window.open","window":4,"x":0,"y":0,"width":100,"height":100})");
    SubmitFrame(4, 100, 100, Frame(100, 100));
    WindowFrame f;
    Check(TakeFrame(4, f) && f.width == 100 && f.height == 100 && f.x == 0, "a full frame uploads everything");
    std::vector<uint8_t> clear(10 * 5 * 4, 0); // a transparent 10 x 5 patch
    SubmitRect(4, 100, 100, 20, 30, 10, 5, clear.data());
    SubmitRect(4, 100, 100, 40, 32, 10, 5, clear.data());
    Check(TakeFrame(4, f) && f.x == 20 && f.y == 30 && f.width == 30 && f.height == 7, "two changes upload their union");
    Check(!TakeFrame(4, f), "nothing new, nothing to upload");
    SetMode(Mode::Interactive);
    g_sent.clear();
    OnMouseMove(25, 32);
    Check(!SentContains(R"("window":4)"), "a transparent patch clicks through");
    HandleWindowCommand(R"({"cmd":"window.close","window":4})");

    // Leaving interactive mode clears the focus, so clicking the same window
    // again refocuses it. (Found in the O5 test: Signal sometimes stayed dimmed.)
    HandleWindowCommand(R"({"cmd":"window.open","window":5,"x":300,"y":300,"width":100,"height":100})");
    SubmitFrame(5, 100, 100, Frame(100, 100));
    SetMode(Mode::Interactive);
    OnMouseMove(350, 350);
    OnMouseButton(true, "left");
    OnMouseButton(false, "left");
    g_sent.clear();
    OnLeaveInteractive();
    Check(SentContains(R"({"event":"focus","window":0})"), "leaving interactive mode clears the focus");
    g_sent.clear();
    OnMouseMove(350, 350);
    OnMouseButton(true, "left");
    OnMouseButton(false, "left");
    Check(SentContains(R"({"event":"focus","window":5})"), "clicking the same window again focuses it again");
    HandleWindowCommand(R"({"cmd":"window.close","window":5})");

    // Shared GPU frames are given back at once whenever nothing will draw them.
    // (Found in the O5 test: frames waited a second for the host's sweep.)
    g_sent.clear();
    SubmitShared(1, {nullptr, 400, 300, 11});
    Check(SentContains(R"("frames":[11])"), "before Present is hooked, a shared frame is acknowledged at once");
    g_sent.clear();
    SetCompositorActive(true);
    Check(SentContains(R"({"event":"repaint"})"), "hooking Present asks the host for new frames");
    g_sent.clear();
    SubmitShared(1, {nullptr, 400, 300, 12});
    Check(!SentContains("frame-done"), "with Present hooked, a shared frame waits for the compositor");
    DropSharedExcept(SnapshotWindows());
    Check(!SentContains("frame-done"), "a drawn window keeps its shared frame");
    DropSharedExcept({});
    Check(SentContains(R"("frames":[12])"), "a window that is not drawn gives its shared frame back");
    g_sent.clear();
    SubmitShared(2, {nullptr, 200, 200, 13});
    HandleWindowCommand(R"({"cmd":"window.close","window":2})");
    Check(SentContains(R"("frames":[13])"), "closing a window gives its waiting shared frame back");
    HandleWindowCommand(R"({"cmd":"window.open","window":2,"x":300,"y":200,"width":200,"height":200})");

    // A double-click on a title bar (a drag handle) is sent to the page, to roll the window up.
    SetMode(Mode::Interactive);
    HandleWindowCommand(R"({"cmd":"window.open","window":7,"x":1200,"y":100,"width":300,"height":200,"draggable":true})");
    HandleWindowCommand(R"({"cmd":"window.drag","window":7,"regions":[0,0,300,30]})");
    SubmitFrame(7, 300, 200, Frame(300, 200));
    g_sent.clear();
    OnMouseMove(1250, 110);
    OnMouseButton(true, "left");
    OnMouseButton(false, "left");
    Check(!SentContains("title-dblclick"), "one click on a title bar is not a double-click");
    g_now += 300;
    OnMouseButton(true, "left");
    OnMouseButton(false, "left");
    Check(SentContains(R"({"event":"title-dblclick","window":7,"x":50,"y":10})"), "two quick clicks on a title bar are");
    g_sent.clear();
    g_now += 300;
    OnMouseButton(true, "left");
    OnMouseButton(false, "left");
    g_now += 600;
    OnMouseButton(true, "left");
    OnMouseButton(false, "left");
    Check(!SentContains("title-dblclick"), "two slow clicks are not");
    g_now += 100;
    OnMouseMove(1290, 110);
    OnMouseButton(true, "left");
    OnMouseButton(false, "left");
    Check(!SentContains("title-dblclick"), "a second click 40 px away is not");
    HandleWindowCommand(R"({"cmd":"window.close","window":7})");

    // Closing.
    SetMode(Mode::Interactive);
    HandleWindowCommand(R"({"cmd":"window.close","window":2})");
    Check(SnapshotWindows().size() == 1 && SnapshotWindows()[0].id == 1, "window.close removes the window");
    CloseAllWindows();
    Check(SnapshotWindows().empty(), "CloseAllWindows removes everything");

    // The window limit: 17 windows fit (the W1 test had 17 open); past the limit the
    // window is refused and the host is told.
    for (uint32_t k = 1; k <= MaxWindows; ++k)
    {
        HandleWindowCommand("{\"cmd\":\"window.open\",\"window\":" + std::to_string(k) +
                            ",\"x\":0,\"y\":0,\"width\":10,\"height\":10}");
    }
    Check(SnapshotWindows().size() == MaxWindows && MaxWindows >= 17, "dozens of windows can be open at once");
    g_sent.clear();
    HandleWindowCommand("{\"cmd\":\"window.open\",\"window\":999,\"x\":0,\"y\":0,\"width\":10,\"height\":10}");
    Check(SnapshotWindows().size() == MaxWindows && SentContains(R"({"event":"window-refused","window":999)"),
          "a window past the limit is refused, and the host is told");
    CloseAllWindows();

    std::printf("\n%s: %d failure(s)\n", g_failures ? "FAILED" : "PASSED", g_failures);
    return g_failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
