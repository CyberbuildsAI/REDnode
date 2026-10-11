// Draws the overlay windows and the cursor on the game's back buffer, just before Present.
//
// Uses the game's own D3D12 device and direct queue from the RED4ext SDK.
// Present is hooked by patching the swapchain vtable, so other hooks on the
// Present code (CET, Steam) keep running: we call whatever the vtable held.
// Back buffers are fetched per frame and never held, so resizes stay safe.
// Each window has its own texture and upload buffers; windows are drawn back
// to front, then the cursor on top.

#include "overlay.hpp"

#include <RED4ext/GpuApi/DeviceData.hpp>

#include <d3d12.h>
#include <d3dcompiler.h>
#include <dxgi1_6.h>
#include <wrl/client.h>

#include <algorithm>
#include <cstring>
#include <mutex>

using Microsoft::WRL::ComPtr;

namespace rednode::overlay::detail
{
namespace
{
constexpr UINT FramesInFlight = 3;
constexpr UINT MaxBackBuffers = 8;
constexpr float ReferenceHeight = 1080.0f; // page pixels map 1:1 at 1080p
constexpr float HdrPaperWhiteNits = 200.0f;  // unverified guess
constexpr float CursorWidth = 18.0f;        // reference pixels
constexpr float CursorHeight = 24.0f;

constexpr char ShaderSource[] = R"(
cbuffer Draw : register(b0)
{
    float4 rect;   // NDC: left, top, right, bottom
    float kind;    // 0 window texture, 1 cursor
    float mode;    // 0 SDR, 1 scRGB, 2 PQ
    float nits;
    float pad;
};
Texture2D tex : register(t0);
SamplerState smp : register(s0);
struct V { float4 pos : SV_Position; float2 uv : TEXCOORD0; };

V vs(uint id : SV_VertexID)
{
    float2 uv = float2(id & 1, id >> 1);
    V o;
    o.uv = uv;
    o.pos = float4(lerp(rect.x, rect.z, uv.x), lerp(rect.y, rect.w, uv.y), 0, 1);
    return o;
}

float3 ToLinear(float3 c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }

float3 ToPQ(float3 n)
{
    float3 y = pow(saturate(n / 10000.0), 0.1593017578125);
    return pow((0.8359375 + 18.8515625 * y) / (1.0 + 18.6875 * y), 78.84375);
}

// The cursor arrow, in reference pixels with the tip at (0, 0).
static const float2 Arrow[7] = {
    float2(0, 0), float2(0, 18), float2(5, 13.5), float2(8.5, 21), float2(11.5, 19.6), float2(8, 12.4), float2(15, 12.4)
};

// 0 outside, 1 outline, 2 fill.
float CursorHit(float2 p)
{
    bool inside = false;
    float d = 1e9;
    [unroll] for (int k = 0, j = 6; k < 7; j = k++)
    {
        float2 a = Arrow[k], b = Arrow[j];
        float dy = b.y - a.y;
        if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (abs(dy) < 1e-4 ? 1e-4 : dy) + a.x)
            inside = !inside;
        float2 ab = b - a;
        float t = saturate(dot(p - a, ab) / dot(ab, ab));
        d = min(d, length(p - (a + ab * t)));
    }
    if (inside) return d < 1.3 ? 1 : 2;
    return d < 1.3 ? 1 : 0;
}

float4 ps(V i) : SV_Target
{
    float4 c;
    if (kind < 0.5)
    {
        c = tex.Sample(smp, i.uv); // premultiplied, from Chromium
    }
    else
    {
        // Drawn by the plugin, not the page, so it moves at the game's frame rate.
        float hit = CursorHit(i.uv * float2(18, 24));
        c = hit > 1.5 ? float4(0.99, 0.93, 0.04, 1) : (hit > 0.5 ? float4(0.03, 0.035, 0.05, 1) : float4(0, 0, 0, 0));
    }

    if (mode > 0.5)
    {
        // HDR back buffer. Colors are sRGB and premultiplied.
        float3 lin = c.a > 0 ? ToLinear(saturate(c.rgb / c.a)) : 0;
        if (mode < 1.5)
        {
            c.rgb = lin * (nits / 80.0) * c.a; // scRGB: 1.0 is 80 nits
        }
        else
        {
            float3x3 toRec2020 = float3x3(0.6274, 0.3293, 0.0433, 0.0691, 0.9195, 0.0114, 0.0164, 0.0880, 0.8956);
            c.rgb = ToPQ(mul(toRec2020, lin) * nits) * c.a; // HDR10 PQ
        }
    }
    return c;
}
)";

struct Constants
{
    float rect[4];
    float kind;
    float mode;
    float nits;
    float pad;
};

using PresentFn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain*, UINT, UINT);
using Present1Fn = HRESULT(STDMETHODCALLTYPE*)(IDXGISwapChain1*, UINT, UINT, const DXGI_PRESENT_PARAMETERS*);
constexpr size_t PresentSlot = 8;   // IDXGISwapChain::Present
constexpr size_t Present1Slot = 22; // IDXGISwapChain1::Present1

void** g_vtable = nullptr;
PresentFn g_origPresent = nullptr;
Present1Fn g_origPresent1 = nullptr;

// GPU side of one overlay window. Only touched on the render thread.
struct GpuWindow
{
    uint32_t id = 0;
    UINT srvIndex = 0;
    ComPtr<ID3D12Resource> texture;
    UINT texWidth = 0;
    UINT texHeight = 0;
    bool texReady = false;       // holds a frame worth drawing
    bool texShaderState = false; // in PIXEL_SHADER_RESOURCE state, else COPY_DEST
    ComPtr<ID3D12Resource> upload[FramesInFlight];
    UINT64 uploadSize[FramesInFlight] = {};
};

struct Gpu
{
    ComPtr<ID3D12Device> device;
    ComPtr<ID3D12CommandQueue> queue;

    IDXGISwapChain* swapChain = nullptr;
    DXGI_FORMAT format = DXGI_FORMAT_UNKNOWN;
    UINT width = 0;
    UINT height = 0;
    float mode = 0; // 0 SDR, 1 scRGB, 2 PQ

    ComPtr<ID3D12RootSignature> rootSig;
    ComPtr<ID3D12PipelineState> pso;
    DXGI_FORMAT psoFormat = DXGI_FORMAT_UNKNOWN;
    ComPtr<ID3D12DescriptorHeap> rtvHeap;
    ComPtr<ID3D12DescriptorHeap> srvHeap; // MaxWindows + 1; the last slot is a null view for the cursor
    UINT rtvSize = 0;
    UINT srvSize = 0;

    ComPtr<ID3D12CommandAllocator> allocators[FramesInFlight];
    ComPtr<ID3D12GraphicsCommandList> list;
    ComPtr<ID3D12Fence> fence;
    HANDLE fenceEvent = nullptr;
    UINT64 fenceValue = 0;
    UINT64 slotFence[FramesInFlight] = {};
    uint64_t frameIndex = 0;

    std::vector<GpuWindow> windows;
    bool srvUsed[MaxWindows] = {};

    bool failed = false;
} g;

std::mutex g_renderMutex; // Present may come from more than one thread

bool Fail(const char* aWhat, HRESULT aHr)
{
    Log("Overlay: %s failed (0x%08lX). Overlay drawing disabled.", aWhat, static_cast<unsigned long>(aHr));
    g.failed = true;
    return false;
}

D3D12_RESOURCE_BARRIER Transition(ID3D12Resource* aRes, D3D12_RESOURCE_STATES aFrom, D3D12_RESOURCE_STATES aTo)
{
    D3D12_RESOURCE_BARRIER b{};
    b.Type = D3D12_RESOURCE_BARRIER_TYPE_TRANSITION;
    b.Transition.pResource = aRes;
    b.Transition.Subresource = D3D12_RESOURCE_BARRIER_ALL_SUBRESOURCES;
    b.Transition.StateBefore = aFrom;
    b.Transition.StateAfter = aTo;
    return b;
}

D3D12_CPU_DESCRIPTOR_HANDLE SrvCpu(UINT aIndex)
{
    auto h = g.srvHeap->GetCPUDescriptorHandleForHeapStart();
    h.ptr += SIZE_T(aIndex) * g.srvSize;
    return h;
}

D3D12_GPU_DESCRIPTOR_HANDLE SrvGpu(UINT aIndex)
{
    auto h = g.srvHeap->GetGPUDescriptorHandleForHeapStart();
    h.ptr += UINT64(aIndex) * g.srvSize;
    return h;
}

void WriteNullSrv(UINT aIndex)
{
    D3D12_SHADER_RESOURCE_VIEW_DESC srv{};
    srv.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    srv.ViewDimension = D3D12_SRV_DIMENSION_TEXTURE2D;
    srv.Shader4ComponentMapping = D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;
    srv.Texture2D.MipLevels = 1;
    g.device->CreateShaderResourceView(nullptr, &srv, SrvCpu(aIndex));
}

void WaitForGpu()
{
    if (g.fence && g.fence->GetCompletedValue() < g.fenceValue)
    {
        g.fence->SetEventOnCompletion(g.fenceValue, g.fenceEvent);
        WaitForSingleObject(g.fenceEvent, 1000);
    }
}

bool CreatePipeline(DXGI_FORMAT aFormat)
{
    if (!g.rootSig)
    {
        D3D12_ROOT_PARAMETER params[2]{};
        params[0].ParameterType = D3D12_ROOT_PARAMETER_TYPE_32BIT_CONSTANTS;
        params[0].Constants.Num32BitValues = sizeof(Constants) / 4;
        params[0].ShaderVisibility = D3D12_SHADER_VISIBILITY_ALL;
        D3D12_DESCRIPTOR_RANGE range{};
        range.RangeType = D3D12_DESCRIPTOR_RANGE_TYPE_SRV;
        range.NumDescriptors = 1;
        params[1].ParameterType = D3D12_ROOT_PARAMETER_TYPE_DESCRIPTOR_TABLE;
        params[1].DescriptorTable.NumDescriptorRanges = 1;
        params[1].DescriptorTable.pDescriptorRanges = &range;
        params[1].ShaderVisibility = D3D12_SHADER_VISIBILITY_PIXEL;

        D3D12_STATIC_SAMPLER_DESC sampler{};
        sampler.Filter = D3D12_FILTER_MIN_MAG_MIP_LINEAR;
        sampler.AddressU = sampler.AddressV = sampler.AddressW = D3D12_TEXTURE_ADDRESS_MODE_CLAMP;
        sampler.MaxLOD = D3D12_FLOAT32_MAX;
        sampler.ShaderVisibility = D3D12_SHADER_VISIBILITY_PIXEL;

        D3D12_ROOT_SIGNATURE_DESC desc{};
        desc.NumParameters = 2;
        desc.pParameters = params;
        desc.NumStaticSamplers = 1;
        desc.pStaticSamplers = &sampler;

        ComPtr<ID3DBlob> blob, error;
        HRESULT hr = D3D12SerializeRootSignature(&desc, D3D_ROOT_SIGNATURE_VERSION_1, &blob, &error);
        if (FAILED(hr))
            return Fail("D3D12SerializeRootSignature", hr);
        hr = g.device->CreateRootSignature(0, blob->GetBufferPointer(), blob->GetBufferSize(), IID_PPV_ARGS(&g.rootSig));
        if (FAILED(hr))
            return Fail("CreateRootSignature", hr);
    }

    ComPtr<ID3DBlob> vs, ps, error;
    HRESULT hr = D3DCompile(ShaderSource, sizeof(ShaderSource) - 1, "rednode-overlay", nullptr, nullptr, "vs", "vs_5_0",
                            0, 0, &vs, &error);
    if (FAILED(hr))
    {
        Log("Overlay: vertex shader: %s", error ? static_cast<const char*>(error->GetBufferPointer()) : "?");
        return Fail("D3DCompile vs", hr);
    }
    hr = D3DCompile(ShaderSource, sizeof(ShaderSource) - 1, "rednode-overlay", nullptr, nullptr, "ps", "ps_5_0", 0, 0,
                    &ps, &error);
    if (FAILED(hr))
    {
        Log("Overlay: pixel shader: %s", error ? static_cast<const char*>(error->GetBufferPointer()) : "?");
        return Fail("D3DCompile ps", hr);
    }

    D3D12_GRAPHICS_PIPELINE_STATE_DESC pso{};
    pso.pRootSignature = g.rootSig.Get();
    pso.VS = {vs->GetBufferPointer(), vs->GetBufferSize()};
    pso.PS = {ps->GetBufferPointer(), ps->GetBufferSize()};
    auto& rt = pso.BlendState.RenderTarget[0];
    rt.BlendEnable = TRUE;
    rt.SrcBlend = D3D12_BLEND_ONE; // premultiplied alpha
    rt.DestBlend = D3D12_BLEND_INV_SRC_ALPHA;
    rt.BlendOp = D3D12_BLEND_OP_ADD;
    rt.SrcBlendAlpha = D3D12_BLEND_ONE;
    rt.DestBlendAlpha = D3D12_BLEND_INV_SRC_ALPHA;
    rt.BlendOpAlpha = D3D12_BLEND_OP_ADD;
    rt.RenderTargetWriteMask = D3D12_COLOR_WRITE_ENABLE_ALL;
    pso.SampleMask = UINT_MAX;
    pso.RasterizerState.FillMode = D3D12_FILL_MODE_SOLID;
    pso.RasterizerState.CullMode = D3D12_CULL_MODE_NONE;
    pso.RasterizerState.DepthClipEnable = TRUE;
    pso.DepthStencilState.DepthEnable = FALSE;
    pso.PrimitiveTopologyType = D3D12_PRIMITIVE_TOPOLOGY_TYPE_TRIANGLE;
    pso.NumRenderTargets = 1;
    pso.RTVFormats[0] = aFormat;
    pso.SampleDesc.Count = 1;

    g.pso.Reset();
    hr = g.device->CreateGraphicsPipelineState(&pso, IID_PPV_ARGS(&g.pso));
    if (FAILED(hr))
        return Fail("CreateGraphicsPipelineState", hr);
    g.psoFormat = aFormat;
    return true;
}

bool CreateBaseResources()
{
    D3D12_DESCRIPTOR_HEAP_DESC rtv{};
    rtv.Type = D3D12_DESCRIPTOR_HEAP_TYPE_RTV;
    rtv.NumDescriptors = MaxBackBuffers;
    HRESULT hr = g.device->CreateDescriptorHeap(&rtv, IID_PPV_ARGS(&g.rtvHeap));
    if (FAILED(hr))
        return Fail("CreateDescriptorHeap rtv", hr);
    g.rtvSize = g.device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_RTV);

    D3D12_DESCRIPTOR_HEAP_DESC srv{};
    srv.Type = D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV;
    srv.NumDescriptors = MaxWindows + 1;
    srv.Flags = D3D12_DESCRIPTOR_HEAP_FLAG_SHADER_VISIBLE;
    hr = g.device->CreateDescriptorHeap(&srv, IID_PPV_ARGS(&g.srvHeap));
    if (FAILED(hr))
        return Fail("CreateDescriptorHeap srv", hr);
    g.srvSize = g.device->GetDescriptorHandleIncrementSize(D3D12_DESCRIPTOR_HEAP_TYPE_CBV_SRV_UAV);
    for (UINT i = 0; i <= MaxWindows; ++i)
        WriteNullSrv(i);

    for (auto& a : g.allocators)
    {
        hr = g.device->CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT, IID_PPV_ARGS(&a));
        if (FAILED(hr))
            return Fail("CreateCommandAllocator", hr);
    }
    hr = g.device->CreateCommandList(0, D3D12_COMMAND_LIST_TYPE_DIRECT, g.allocators[0].Get(), nullptr,
                                     IID_PPV_ARGS(&g.list));
    if (FAILED(hr))
        return Fail("CreateCommandList", hr);
    g.list->Close();

    hr = g.device->CreateFence(0, D3D12_FENCE_FLAG_NONE, IID_PPV_ARGS(&g.fence));
    if (FAILED(hr))
        return Fail("CreateFence", hr);
    g.fenceEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    return true;
}

float HdrModeFor(IDXGISwapChain* aSwapChain, DXGI_FORMAT aFormat)
{
    if (auto* data = RED4ext::GpuApi::GetDeviceData())
    {
        for (uint32_t id = 1; id <= 32; ++id)
        {
            if (data->swapChains.IsUsedID(id) && data->swapChains.GetData(id).swapChain.Get() == aSwapChain)
            {
                switch (data->swapChains.GetData(id).startupHdrMode)
                {
                case RED4ext::GpuApi::HDRMode::PQ:
                    return 2;
                case RED4ext::GpuApi::HDRMode::scRGB:
                    return 1;
                default:
                    return 0;
                }
            }
        }
    }
    return aFormat == DXGI_FORMAT_R16G16B16A16_FLOAT ? 1.0f : 0.0f;
}

bool EnsureResources(IDXGISwapChain3* aSwapChain)
{
    if (!g.rtvHeap && !CreateBaseResources())
        return false;

    DXGI_SWAP_CHAIN_DESC1 desc{};
    if (FAILED(aSwapChain->GetDesc1(&desc)) || desc.BufferCount > MaxBackBuffers)
        return false;

    if (g.swapChain != aSwapChain || desc.Format != g.format)
    {
        g.mode = HdrModeFor(aSwapChain, desc.Format);
        Log("Overlay: drawing on a %u x %u swapchain, format %d, %s", desc.Width, desc.Height,
            static_cast<int>(desc.Format), g.mode == 0 ? "SDR" : (g.mode == 1 ? "HDR scRGB" : "HDR PQ"));
    }
    g.swapChain = aSwapChain;
    g.format = desc.Format;
    g.width = desc.Width;
    g.height = desc.Height;

    if (g.psoFormat != desc.Format && !CreatePipeline(desc.Format))
        return false;
    return true;
}

// Matches the GPU windows to the registry: frees closed ones, adds new ones.
void SyncWindows(const std::vector<WindowView>& aViews)
{
    const auto isOpen = [&](uint32_t aId) {
        return std::any_of(aViews.begin(), aViews.end(), [&](const WindowView& v) { return v.id == aId; });
    };
    if (std::any_of(g.windows.begin(), g.windows.end(), [&](const GpuWindow& w) { return !isOpen(w.id); }))
    {
        WaitForGpu(); // a closed window's texture may still be in use
        for (auto it = g.windows.begin(); it != g.windows.end();)
        {
            if (isOpen(it->id))
            {
                ++it;
                continue;
            }
            g.srvUsed[it->srvIndex] = false;
            WriteNullSrv(it->srvIndex);
            it = g.windows.erase(it);
        }
    }
    for (const auto& v : aViews)
    {
        if (std::any_of(g.windows.begin(), g.windows.end(), [&](const GpuWindow& w) { return w.id == v.id; }))
            continue;
        const auto free = std::find(std::begin(g.srvUsed), std::end(g.srvUsed), false);
        if (free == std::end(g.srvUsed))
            continue;
        GpuWindow w;
        w.id = v.id;
        w.srvIndex = UINT(free - std::begin(g.srvUsed));
        *free = true;
        g.windows.push_back(std::move(w));
    }
}

GpuWindow* FindGpu(uint32_t aId)
{
    for (auto& w : g.windows)
    {
        if (w.id == aId)
            return &w;
    }
    return nullptr;
}

bool EnsureTexture(GpuWindow& aWin, UINT aWidth, UINT aHeight)
{
    if (aWin.texture && aWin.texWidth == aWidth && aWin.texHeight == aHeight)
        return true;

    WaitForGpu(); // the old texture may still be in use

    D3D12_HEAP_PROPERTIES heap{};
    heap.Type = D3D12_HEAP_TYPE_DEFAULT;
    D3D12_RESOURCE_DESC desc{};
    desc.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D;
    desc.Width = aWidth;
    desc.Height = aHeight;
    desc.DepthOrArraySize = 1;
    desc.MipLevels = 1;
    desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    desc.SampleDesc.Count = 1;
    aWin.texture.Reset();
    HRESULT hr = g.device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &desc, D3D12_RESOURCE_STATE_COPY_DEST,
                                                   nullptr, IID_PPV_ARGS(&aWin.texture));
    if (FAILED(hr))
        return Fail("CreateCommittedResource texture", hr);
    aWin.texWidth = aWidth;
    aWin.texHeight = aHeight;
    aWin.texReady = false;
    aWin.texShaderState = false; // created in COPY_DEST

    D3D12_SHADER_RESOURCE_VIEW_DESC srv{};
    srv.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    srv.ViewDimension = D3D12_SRV_DIMENSION_TEXTURE2D;
    srv.Shader4ComponentMapping = D3D12_DEFAULT_SHADER_4_COMPONENT_MAPPING;
    srv.Texture2D.MipLevels = 1;
    g.device->CreateShaderResourceView(aWin.texture.Get(), &srv, SrvCpu(aWin.srvIndex));
    return true;
}

// Copies the window's newest frame, if any, into this slot's upload buffer and records the GPU copy.
void RecordUpload(GpuWindow& aWin, UINT aSlot)
{
    WindowFrame frame;
    if (!TakeFrame(aWin.id, frame) || !EnsureTexture(aWin, frame.width, frame.height))
        return;

    D3D12_PLACED_SUBRESOURCE_FOOTPRINT footprint{};
    UINT64 total = 0;
    const D3D12_RESOURCE_DESC texDesc = aWin.texture->GetDesc();
    g.device->GetCopyableFootprints(&texDesc, 0, 1, 0, &footprint, nullptr, nullptr, &total);

    if (!aWin.upload[aSlot] || aWin.uploadSize[aSlot] < total)
    {
        D3D12_HEAP_PROPERTIES heap{};
        heap.Type = D3D12_HEAP_TYPE_UPLOAD;
        D3D12_RESOURCE_DESC buf{};
        buf.Dimension = D3D12_RESOURCE_DIMENSION_BUFFER;
        buf.Width = total;
        buf.Height = 1;
        buf.DepthOrArraySize = 1;
        buf.MipLevels = 1;
        buf.SampleDesc.Count = 1;
        buf.Layout = D3D12_TEXTURE_LAYOUT_ROW_MAJOR;
        aWin.upload[aSlot].Reset();
        HRESULT hr = g.device->CreateCommittedResource(&heap, D3D12_HEAP_FLAG_NONE, &buf,
                                                       D3D12_RESOURCE_STATE_GENERIC_READ, nullptr,
                                                       IID_PPV_ARGS(&aWin.upload[aSlot]));
        if (FAILED(hr))
        {
            Fail("CreateCommittedResource upload", hr);
            return;
        }
        aWin.uploadSize[aSlot] = total;
    }

    uint8_t* mapped = nullptr;
    D3D12_RANGE noRead{0, 0};
    if (FAILED(aWin.upload[aSlot]->Map(0, &noRead, reinterpret_cast<void**>(&mapped))))
        return;
    for (uint32_t row = 0; row < frame.height; ++row)
    {
        std::memcpy(mapped + footprint.Offset + row * footprint.Footprint.RowPitch,
                    frame.pixels.data() + size_t(row) * frame.width * 4, size_t(frame.width) * 4);
    }
    aWin.upload[aSlot]->Unmap(0, nullptr);

    if (aWin.texShaderState)
    {
        auto b = Transition(aWin.texture.Get(), D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE,
                            D3D12_RESOURCE_STATE_COPY_DEST);
        g.list->ResourceBarrier(1, &b);
    }
    D3D12_TEXTURE_COPY_LOCATION dst{};
    dst.pResource = aWin.texture.Get();
    dst.Type = D3D12_TEXTURE_COPY_TYPE_SUBRESOURCE_INDEX;
    D3D12_TEXTURE_COPY_LOCATION src{};
    src.pResource = aWin.upload[aSlot].Get();
    src.Type = D3D12_TEXTURE_COPY_TYPE_PLACED_FOOTPRINT;
    src.PlacedFootprint = footprint;
    g.list->CopyTextureRegion(&dst, 0, 0, 0, &src, nullptr);
    auto b = Transition(aWin.texture.Get(), D3D12_RESOURCE_STATE_COPY_DEST, D3D12_RESOURCE_STATE_PIXEL_SHADER_RESOURCE);
    g.list->ResourceBarrier(1, &b);
    aWin.texShaderState = true;
    aWin.texReady = true;
}

// Reference-pixel rectangle to NDC: left, top, right, bottom.
void ToNdc(float aX, float aY, float aW, float aH, float aScale, float aOut[4])
{
    aOut[0] = aX * aScale / g.width * 2 - 1;
    aOut[1] = 1 - aY * aScale / g.height * 2;
    aOut[2] = (aX + aW) * aScale / g.width * 2 - 1;
    aOut[3] = 1 - (aY + aH) * aScale / g.height * 2;
}

void Render(IDXGISwapChain* aSwapChain)
{
    std::scoped_lock renderLock(g_renderMutex);
    if (g.failed)
        return;

    ComPtr<IDXGISwapChain3> swapChain;
    if (FAILED(aSwapChain->QueryInterface(IID_PPV_ARGS(&swapChain))) || !EnsureResources(swapChain.Get()))
        return;

    const float scale = float(g.height) / ReferenceHeight;
    SetScreen({scale, float(g.width) / scale, ReferenceHeight, float(g.width), float(g.height)});

    const Mode mode = GetMode();
    const std::vector<WindowView> views = SnapshotWindows();
    SyncWindows(views);
    if (mode == Mode::Hidden || (views.empty() && mode != Mode::Interactive))
        return;

    const UINT slot = static_cast<UINT>(g.frameIndex++ % FramesInFlight);
    if (g.fence->GetCompletedValue() < g.slotFence[slot])
    {
        g.fence->SetEventOnCompletion(g.slotFence[slot], g.fenceEvent);
        WaitForSingleObject(g.fenceEvent, 100);
    }
    g.allocators[slot]->Reset();
    g.list->Reset(g.allocators[slot].Get(), g.pso.Get());

    for (const auto& v : views)
    {
        if (GpuWindow* w = FindGpu(v.id))
            RecordUpload(*w, slot);
    }
    if (g.failed)
    {
        g.list->Close();
        return;
    }

    ComPtr<ID3D12Resource> backBuffer;
    const UINT index = swapChain->GetCurrentBackBufferIndex();
    if (FAILED(swapChain->GetBuffer(index, IID_PPV_ARGS(&backBuffer))))
    {
        g.list->Close();
        return;
    }
    D3D12_CPU_DESCRIPTOR_HANDLE rtv = g.rtvHeap->GetCPUDescriptorHandleForHeapStart();
    rtv.ptr += SIZE_T(index) * g.rtvSize;
    g.device->CreateRenderTargetView(backBuffer.Get(), nullptr, rtv);

    auto toTarget = Transition(backBuffer.Get(), D3D12_RESOURCE_STATE_PRESENT, D3D12_RESOURCE_STATE_RENDER_TARGET);
    g.list->ResourceBarrier(1, &toTarget);

    D3D12_VIEWPORT viewport{0, 0, float(g.width), float(g.height), 0, 1};
    D3D12_RECT scissor{0, 0, LONG(g.width), LONG(g.height)};
    g.list->OMSetRenderTargets(1, &rtv, FALSE, nullptr);
    g.list->RSSetViewports(1, &viewport);
    g.list->RSSetScissorRects(1, &scissor);
    g.list->SetGraphicsRootSignature(g.rootSig.Get());
    ID3D12DescriptorHeap* heaps[] = {g.srvHeap.Get()};
    g.list->SetDescriptorHeaps(1, heaps);
    g.list->IASetPrimitiveTopology(D3D_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);

    Constants c{};
    c.mode = g.mode;
    c.nits = HdrPaperWhiteNits;

    // Windows, back to front. Their size comes from the frame, so a resize shows when the page repaints.
    for (const auto& v : views)
    {
        GpuWindow* w = FindGpu(v.id);
        if (!w || !w->texReady)
            continue;
        ToNdc(v.x, v.y, float(w->texWidth), float(w->texHeight), scale, c.rect);
        c.kind = 0;
        g.list->SetGraphicsRoot32BitConstants(0, sizeof(Constants) / 4, &c, 0);
        g.list->SetGraphicsRootDescriptorTable(1, SrvGpu(w->srvIndex));
        g.list->DrawInstanced(4, 1, 0, 0);
    }

    // The cursor, on top of everything.
    if (mode == Mode::Interactive)
    {
        float cx, cy;
        GetCursor(cx, cy);
        ToNdc(cx, cy, CursorWidth, CursorHeight, scale, c.rect);
        c.kind = 1;
        g.list->SetGraphicsRoot32BitConstants(0, sizeof(Constants) / 4, &c, 0);
        g.list->SetGraphicsRootDescriptorTable(1, SrvGpu(MaxWindows));
        g.list->DrawInstanced(4, 1, 0, 0);
    }

    auto toPresent = Transition(backBuffer.Get(), D3D12_RESOURCE_STATE_RENDER_TARGET, D3D12_RESOURCE_STATE_PRESENT);
    g.list->ResourceBarrier(1, &toPresent);

    if (FAILED(g.list->Close()))
    {
        Fail("Close command list", E_FAIL);
        return;
    }
    ID3D12CommandList* lists[] = {g.list.Get()};
    g.queue->ExecuteCommandLists(1, lists);
    g.queue->Signal(g.fence.Get(), ++g.fenceValue);
    g.slotFence[slot] = g.fenceValue;
}

HRESULT STDMETHODCALLTYPE HookPresent(IDXGISwapChain* aSwapChain, UINT aSync, UINT aFlags)
{
    if (!(aFlags & DXGI_PRESENT_TEST))
        Render(aSwapChain);
    return g_origPresent(aSwapChain, aSync, aFlags);
}

HRESULT STDMETHODCALLTYPE HookPresent1(IDXGISwapChain1* aSwapChain, UINT aSync, UINT aFlags,
                                       const DXGI_PRESENT_PARAMETERS* aParams)
{
    if (!(aFlags & DXGI_PRESENT_TEST))
        Render(aSwapChain);
    return g_origPresent1(aSwapChain, aSync, aFlags, aParams);
}

bool PatchSlot(size_t aSlot, void* aValue, void** aOld)
{
    DWORD protect = 0;
    if (!VirtualProtect(&g_vtable[aSlot], sizeof(void*), PAGE_READWRITE, &protect))
        return false;
    if (aOld)
        *aOld = g_vtable[aSlot];
    g_vtable[aSlot] = aValue;
    VirtualProtect(&g_vtable[aSlot], sizeof(void*), protect, &protect);
    FlushInstructionCache(GetCurrentProcess(), &g_vtable[aSlot], sizeof(void*));
    return true;
}
} // namespace

bool InstallCompositor(HWND& aWindow)
{
    if (g_vtable)
        return true;

    auto* data = RED4ext::GpuApi::GetDeviceData();
    if (!data || !data->device || !data->directCommandQueue)
    {
        Log("Overlay: the game's D3D12 device is not ready");
        return false;
    }

    IDXGISwapChain4* swapChain = nullptr;
    for (uint32_t id = 1; id <= 32 && !swapChain; ++id)
    {
        if (data->swapChains.IsUsedID(id) && data->swapChains.GetData(id).swapChain)
        {
            swapChain = data->swapChains.GetData(id).swapChain.Get();
            aWindow = data->swapChains.GetData(id).windowHandle;
        }
    }
    if (!swapChain)
    {
        Log("Overlay: no swapchain found");
        return false;
    }

    g.device = data->device;
    g.queue = data->directCommandQueue;

    g_vtable = *reinterpret_cast<void***>(swapChain);
    void* old = nullptr;
    if (!PatchSlot(PresentSlot, reinterpret_cast<void*>(&HookPresent), &old))
    {
        Log("Overlay: could not patch Present");
        g_vtable = nullptr;
        return false;
    }
    g_origPresent = reinterpret_cast<PresentFn>(old);
    if (PatchSlot(Present1Slot, reinterpret_cast<void*>(&HookPresent1), &old))
        g_origPresent1 = reinterpret_cast<Present1Fn>(old);

    Log("Overlay: Present hooked. F10 cycles passive, interactive and hidden.");
    return true;
}

void UninstallCompositor()
{
    if (!g_vtable)
        return;
    PatchSlot(PresentSlot, reinterpret_cast<void*>(g_origPresent), nullptr);
    if (g_origPresent1)
        PatchSlot(Present1Slot, reinterpret_cast<void*>(g_origPresent1), nullptr);
    g_vtable = nullptr;

    std::scoped_lock renderLock(g_renderMutex);
    WaitForGpu();
    if (g.fenceEvent)
        CloseHandle(g.fenceEvent);
    g = Gpu{};
}
} // namespace rednode::overlay::detail
