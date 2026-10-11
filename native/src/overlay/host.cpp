// Starts the packaged overlay host with the game.
//
// Players get the host as red4ext/plugins/REDnode/host/REDnode-overlay.exe. The
// plugin starts it at load, with the apps folder, the game's process id and a
// log file. The host goes into a job object that ends it when the job handle
// closes: at plugin unload, or when Windows cleans up after a game crash.
//
// Without a packaged host (a developer setup), nothing starts: run the host by
// hand with `npm run overlay`. If both run, the host started first keeps the
// pipe and the other exits.

#include "overlay.hpp"

#include <filesystem>
#include <string>
#include <system_error>

namespace rednode::overlay::detail
{
namespace
{
HANDLE g_job = nullptr;
HANDLE g_process = nullptr;
} // namespace

void StartHost(const std::filesystem::path& aPluginDir)
{
    std::error_code ec;
    const auto hostDir = aPluginDir / L"host";
    const auto exe = hostDir / L"REDnode-overlay.exe";
    if (!std::filesystem::exists(exe, ec))
    {
        Log("Overlay: no packaged host in %s. Start it by hand with npm run overlay.", hostDir.string().c_str());
        return;
    }

    const auto logFile = aPluginDir.parent_path().parent_path() / L"logs" / L"rednode-overlay.log";
    std::filesystem::remove(logFile, ec); // one log per game session

    std::wstring cmd = L"\"" + exe.wstring() + L"\" --apps-dir=\"" + (aPluginDir / L"apps").wstring() +
                       L"\" --parent-pid=" + std::to_wstring(GetCurrentProcessId()) + L" --log=\"" +
                       logFile.wstring() + L"\"";

    g_job = CreateJobObjectW(nullptr, nullptr);
    if (g_job)
    {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(g_job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));
    }

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    if (!CreateProcessW(exe.c_str(), cmd.data(), nullptr, nullptr, FALSE, CREATE_SUSPENDED, nullptr,
                        hostDir.c_str(), &si, &pi))
    {
        Log("Overlay: could not start the host (error %lu)", GetLastError());
        return;
    }
    if (g_job && !AssignProcessToJobObject(g_job, pi.hProcess))
        Log("Overlay: could not put the host in a job object (error %lu). It exits by itself when the game does.",
            GetLastError());
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    g_process = pi.hProcess;
    Log("Overlay: started the host, process %lu", pi.dwProcessId);
}

void StopHost()
{
    // Closing the job ends the host and every Chromium process it started.
    if (g_job)
    {
        CloseHandle(g_job);
        g_job = nullptr;
    }
    if (g_process)
    {
        CloseHandle(g_process);
        g_process = nullptr;
    }
}
} // namespace rednode::overlay::detail
