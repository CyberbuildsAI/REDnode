// Named pipe link to the overlay host. One host at a time.
//
// Wire format, both directions: uint32 type, uint32 length, then length bytes.
//   type 1 FRAME (host -> game): uint32 window, uint32 width, uint32 height, then
//                                 width * height BGRA pixels, premultiplied alpha
//   type 2 JSON  (both ways):    one UTF-8 JSON object. From the host, objects
//                                 with "cmd" manage windows (windows.cpp); the
//                                 rest are bridge requests (bridge.cpp)
//
// The pipe is overlapped so the reader and writer threads never block each other.

#include "overlay.hpp"

#include <atomic>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>

namespace rednode::overlay::detail
{
namespace
{
constexpr wchar_t PipeName[] = L"\\\\.\\pipe\\rednode-overlay";
constexpr uint32_t TypeFrame = 1;
constexpr uint32_t TypeJson = 2;
constexpr uint32_t MaxMessage = 64u << 20;
constexpr size_t MaxQueued = 256;

HANDLE g_stopEvent = nullptr;
std::thread g_reader;
std::thread g_writer;

std::mutex g_pipeMutex;
HANDLE g_pipe = INVALID_HANDLE_VALUE;
std::atomic_bool g_connected{false};

std::mutex g_sendMutex;
std::condition_variable g_sendCv;
std::deque<std::string> g_sendQueue;
bool g_stopping = false;

// Waits for an overlapped operation. False on failure or when stopping.
bool Wait(HANDLE aPipe, OVERLAPPED& aOv, DWORD& aTransferred)
{
    HANDLE events[2] = {aOv.hEvent, g_stopEvent};
    if (WaitForMultipleObjects(2, events, FALSE, INFINITE) != WAIT_OBJECT_0)
    {
        CancelIoEx(aPipe, &aOv);
        GetOverlappedResult(aPipe, &aOv, &aTransferred, TRUE);
        return false;
    }
    return GetOverlappedResult(aPipe, &aOv, &aTransferred, FALSE) != 0;
}

bool ReadExact(HANDLE aPipe, void* aBuffer, uint32_t aSize)
{
    auto* p = static_cast<uint8_t*>(aBuffer);
    OVERLAPPED ov{};
    ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    bool ok = true;
    while (aSize > 0)
    {
        ResetEvent(ov.hEvent);
        DWORD got = 0;
        if (!ReadFile(aPipe, p, aSize, nullptr, &ov) && GetLastError() != ERROR_IO_PENDING)
        {
            ok = false;
            break;
        }
        if (!Wait(aPipe, ov, got) || got == 0)
        {
            ok = false;
            break;
        }
        p += got;
        aSize -= got;
    }
    CloseHandle(ov.hEvent);
    return ok;
}

bool WriteAll(HANDLE aPipe, const void* aBuffer, uint32_t aSize)
{
    auto* p = static_cast<const uint8_t*>(aBuffer);
    OVERLAPPED ov{};
    ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    bool ok = true;
    while (aSize > 0)
    {
        ResetEvent(ov.hEvent);
        DWORD put = 0;
        if (!WriteFile(aPipe, p, aSize, nullptr, &ov) && GetLastError() != ERROR_IO_PENDING)
        {
            ok = false;
            break;
        }
        if (!Wait(aPipe, ov, put) || put == 0)
        {
            ok = false;
            break;
        }
        p += put;
        aSize -= put;
    }
    CloseHandle(ov.hEvent);
    return ok;
}

void Dispatch(uint32_t aType, std::vector<uint8_t>&& aPayload)
{
    if (aType == TypeFrame && aPayload.size() >= 12)
    {
        uint32_t head[3]; // window, width, height
        std::memcpy(head, aPayload.data(), sizeof(head));
        const uint64_t expected = 12ull + uint64_t(head[1]) * head[2] * 4;
        if (head[1] == 0 || head[2] == 0 || head[1] > 4096 || head[2] > 4096 || aPayload.size() != expected)
        {
            Log("Overlay: ignored a malformed frame (%u x %u, %zu bytes)", head[1], head[2], aPayload.size());
            return;
        }
        aPayload.erase(aPayload.begin(), aPayload.begin() + 12);
        SubmitFrame(head[0], head[1], head[2], std::move(aPayload));
    }
    else if (aType == TypeJson)
    {
        std::string json(aPayload.begin(), aPayload.end());
        if (json.find("\"cmd\":") != std::string::npos)
            HandleWindowCommand(json);
        else
            QueueRequest(std::move(json));
    }
}

void ReaderLoop()
{
    while (WaitForSingleObject(g_stopEvent, 0) != WAIT_OBJECT_0)
    {
        HANDLE pipe = CreateNamedPipeW(PipeName, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
                                       PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1,
                                       1u << 20, 1u << 20, 0, nullptr);
        if (pipe == INVALID_HANDLE_VALUE)
        {
            Log("Overlay: could not create the pipe (error %lu)", GetLastError());
            WaitForSingleObject(g_stopEvent, 2000);
            continue;
        }

        OVERLAPPED ov{};
        ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        bool connected = false;
        if (ConnectNamedPipe(pipe, &ov))
        {
            connected = true;
        }
        else if (GetLastError() == ERROR_PIPE_CONNECTED)
        {
            connected = true;
        }
        else if (GetLastError() == ERROR_IO_PENDING)
        {
            DWORD unused = 0;
            connected = Wait(pipe, ov, unused);
        }
        CloseHandle(ov.hEvent);

        if (connected)
        {
            {
                std::scoped_lock lock(g_pipeMutex);
                g_pipe = pipe;
            }
            g_connected = true;
            Log("Overlay: host connected");
            SendJson(std::string("{\"event\":\"hello\",\"plugin\":\"REDnode 0.6.0\",\"mode\":") +
                     JsonString(ModeName(GetMode())) + "}");

            for (;;)
            {
                uint32_t header[2];
                if (!ReadExact(pipe, header, sizeof(header)) || header[1] > MaxMessage)
                {
                    break;
                }
                std::vector<uint8_t> payload(header[1]);
                if (header[1] > 0 && !ReadExact(pipe, payload.data(), header[1]))
                {
                    break;
                }
                Dispatch(header[0], std::move(payload));
            }

            g_connected = false;
            {
                std::scoped_lock lock(g_pipeMutex);
                g_pipe = INVALID_HANDLE_VALUE;
            }
            CloseAllWindows();
            if (GetMode() == Mode::Interactive)
                SetMode(Mode::Passive); // give input back to the game
            Log("Overlay: host disconnected");
        }

        DisconnectNamedPipe(pipe);
        CloseHandle(pipe);
    }
}

void WriterLoop()
{
    for (;;)
    {
        std::string message;
        {
            std::unique_lock lock(g_sendMutex);
            g_sendCv.wait(lock, [] { return g_stopping || !g_sendQueue.empty(); });
            if (g_stopping)
            {
                return;
            }
            message = std::move(g_sendQueue.front());
            g_sendQueue.pop_front();
        }

        std::scoped_lock lock(g_pipeMutex);
        if (g_pipe == INVALID_HANDLE_VALUE)
        {
            continue;
        }
        const uint32_t header[2] = {TypeJson, static_cast<uint32_t>(message.size())};
        if (WriteAll(g_pipe, header, sizeof(header)))
        {
            WriteAll(g_pipe, message.data(), header[1]);
        }
    }
}
} // namespace

void StartLink()
{
    g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    g_reader = std::thread(ReaderLoop);
    g_writer = std::thread(WriterLoop);
}

void StopLink()
{
    if (!g_stopEvent)
    {
        return;
    }
    {
        std::scoped_lock lock(g_sendMutex);
        g_stopping = true;
    }
    g_sendCv.notify_all();
    SetEvent(g_stopEvent);
    if (g_reader.joinable())
    {
        g_reader.join();
    }
    if (g_writer.joinable())
    {
        g_writer.join();
    }
    CloseHandle(g_stopEvent);
    g_stopEvent = nullptr;
}

bool IsConnected()
{
    return g_connected;
}
} // namespace rednode::overlay::detail

void rednode::overlay::SendJson(std::string aJson)
{
    using namespace detail;
    if (!g_connected)
    {
        return;
    }
    {
        std::scoped_lock lock(g_sendMutex);
        if (g_sendQueue.size() >= MaxQueued)
        {
            g_sendQueue.pop_front();
        }
        g_sendQueue.push_back(std::move(aJson));
    }
    g_sendCv.notify_one();
}
