// The generic game API: call any game function by name, and read properties,
// with values converted between JSON and the game's types by its RTTI data.
// Runs on the game thread, between frames, from bridge.cpp.
//
//   rtti.call     {"fn":"GetPlayer","args":[{}]}                          a global function
//                 {"class":"GameInstance","fn":"GetStatsSystem","args":[{}]}   a static function
//                 {"self":{"$ref":3},"fn":"GetWorldPosition","args":[]}    a method
//                 -> the return value, or {"result":..., "out":{name: value}} when the
//                    function has out parameters
//   rtti.get      {"self":{"$ref":3},"prop":"quickSlotsManager"}            a property's value
//   rtti.release  {"refs":[3,4]}                                           forget object references:
//                                                                         once per time each was received
//
// Values:
//   Bool, Int8 to Int32, Uint8 to Uint32, Float, Double   JSON booleans and numbers
//   Int64, Uint64, CRUID                                  strings, since JSON numbers lose precision
//   CName, String                                         strings
//   TweakDBID                                             "0x..." strings; a record path such as
//                                                         "Items.money" is accepted as input
//   enums                                                 member names, such as "Health"
//   structs                                               objects of their properties
//   arrays                                                arrays
//   handles and weak handles                              {"$ref": n, "$type": "PlayerPuppet"}, or null
// Object references point at the object weakly: a call on an object the game
// has deleted fails cleanly. They are all forgotten on every session attach.

#include "jvalue.hpp"
#include "overlay.hpp"

#include <RED4ext/Scripting/Natives/ScriptGameInstance.hpp>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <memory>
#include <new>
#include <unordered_map>

namespace rednode::overlay::detail
{
namespace
{
using namespace RED4ext;
using json::Value;
using Kind = rtti::ERTTIType;

constexpr int MaxDepth = 6;          // nested structs and arrays written to JSON
constexpr uint32_t MaxElements = 2000; // array elements written to JSON
constexpr size_t MaxRefs = 100000;

bool FillGameInstance(const rtti::IType* aType, void* aMem);

std::string Str(CName aName)
{
    const char* s = aName.ToString();
    return s ? s : std::string{};
}

CClass* ScriptableClass()
{
    static CClass* cls = CRTTISystem::Get()->GetClass("IScriptable");
    return cls;
}

bool IsScriptable(const CClass* aClass)
{
    return aClass && ScriptableClass() && aClass->IsA(ScriptableClass());
}

// ---------- object references ----------

// Each id counts how often it was handed out; rtti.release counts it down. Apps and
// mods may hold the same object, so an id lives until every holder released it.
struct Ref
{
    WeakHandle<IScriptable> object;
    uint32_t count = 0;
};
std::unordered_map<uint32_t, Ref> g_refs;
std::unordered_map<IScriptable*, uint32_t> g_refIds;
uint32_t g_nextRef = 1;

// Forgets references to objects the game has deleted.
void PruneRefs()
{
    for (auto it = g_refs.begin(); it != g_refs.end();)
        it = it->second.object.Lock() ? std::next(it) : g_refs.erase(it);
    for (auto it = g_refIds.begin(); it != g_refIds.end();)
        it = g_refs.contains(it->second) ? std::next(it) : g_refIds.erase(it);
}

uint32_t RefFor(const Handle<IScriptable>& aObject)
{
    IScriptable* raw = aObject.GetPtr();
    if (auto it = g_refIds.find(raw); it != g_refIds.end())
    {
        auto found = g_refs.find(it->second);
        if (found != g_refs.end() && found->second.object.Lock().GetPtr() == raw)
        {
            found->second.count += 1;
            return it->second;
        }
    }
    if (g_refs.size() >= MaxRefs)
        PruneRefs();
    const uint32_t id = g_nextRef++;
    g_refs[id] = Ref{WeakHandle<IScriptable>(aObject), 1};
    g_refIds[raw] = id;
    return id;
}

Handle<IScriptable> FromRef(const Value& aValue, std::string& aError)
{
    const Value* ref = aValue.Get("$ref");
    if (!ref || ref->kind != Value::Kind::Number)
    {
        aError = "expected an object reference, {\"$ref\": n}";
        return {};
    }
    auto it = g_refs.find(uint32_t(ref->number));
    Handle<IScriptable> obj = it == g_refs.end() ? Handle<IScriptable>{} : it->second.object.Lock();
    if (!obj)
        aError = "that game object no longer exists (references are dropped when a save loads)";
    return obj;
}

// ---------- game values to JSON ----------

void Number(std::string& aOut, double aValue, const char* aFormat)
{
    if (aValue != aValue || aValue > 1e308 || aValue < -1e308)
    {
        aOut += "null";
        return;
    }
    char buf[40];
    std::snprintf(buf, sizeof(buf), aFormat, aValue);
    aOut += buf;
}

void Quoted64(std::string& aOut, bool aSigned, uint64_t aValue)
{
    char buf[32];
    if (aSigned)
        std::snprintf(buf, sizeof(buf), "\"%lld\"", static_cast<long long>(aValue));
    else
        std::snprintf(buf, sizeof(buf), "\"%llu\"", static_cast<unsigned long long>(aValue));
    aOut += buf;
}

int64_t ReadSigned(const void* aMem, uint32_t aSize)
{
    switch (aSize)
    {
    case 1:
        return *static_cast<const int8_t*>(aMem);
    case 2:
        return *static_cast<const int16_t*>(aMem);
    case 4:
        return *static_cast<const int32_t*>(aMem);
    default:
        return *static_cast<const int64_t*>(aMem);
    }
}

void WriteInt(void* aMem, uint32_t aSize, uint64_t aValue)
{
    switch (aSize)
    {
    case 1:
        *static_cast<uint8_t*>(aMem) = uint8_t(aValue);
        break;
    case 2:
        *static_cast<uint16_t*>(aMem) = uint16_t(aValue);
        break;
    case 4:
        *static_cast<uint32_t*>(aMem) = uint32_t(aValue);
        break;
    default:
        *static_cast<uint64_t*>(aMem) = aValue;
        break;
    }
}

void ToJson(const rtti::IType* aType, const void* aMem, std::string& aOut, int aDepth);

void StructToJson(const CClass* aClass, const void* aMem, std::string& aOut, int aDepth)
{
    if (aDepth > MaxDepth)
    {
        aOut += "null";
        return;
    }
    // Base class properties first, as the game lays them out.
    std::vector<const CClass*> chain;
    for (const CClass* c = aClass; c; c = c->parent)
        chain.insert(chain.begin(), c);
    aOut += "{";
    bool first = true;
    for (const CClass* c : chain)
    {
        for (const CProperty* p : c->props)
        {
            aOut += first ? "" : ",";
            first = false;
            aOut += JsonString(Str(p->name)) + ":";
            ToJson(p->type, static_cast<const uint8_t*>(aMem) + p->valueOffset, aOut, aDepth + 1);
        }
    }
    aOut += "}";
}

void HandleToJson(const Handle<IScriptable>& aObject, std::string& aOut)
{
    if (!aObject)
    {
        aOut += "null";
        return;
    }
    aOut += "{\"$ref\":" + std::to_string(RefFor(aObject)) + ",\"$type\":" +
            JsonString(Str(aObject->GetType()->GetName())) + "}";
}

void ToJson(const rtti::IType* aType, const void* aMem, std::string& aOut, int aDepth)
{
    if (!aType || !aMem)
    {
        aOut += "null";
        return;
    }
    const CName name = aType->GetName();
    switch (aType->GetType())
    {
    case Kind::Fundamental:
        if (name == "Bool")
            aOut += *static_cast<const bool*>(aMem) ? "true" : "false";
        else if (name == "Float")
            Number(aOut, *static_cast<const float*>(aMem), "%.9g");
        else if (name == "Double")
            Number(aOut, *static_cast<const double*>(aMem), "%.17g");
        else if (name == "Int64")
            Quoted64(aOut, true, *static_cast<const uint64_t*>(aMem));
        else if (name == "Uint64")
            Quoted64(aOut, false, *static_cast<const uint64_t*>(aMem));
        else if (name == "Int8" || name == "Int16" || name == "Int32")
            aOut += std::to_string(ReadSigned(aMem, aType->GetSize()));
        else
        {
            uint64_t v = 0;
            std::memcpy(&v, aMem, std::min<uint32_t>(aType->GetSize(), 8));
            aOut += std::to_string(v);
        }
        return;
    case Kind::Name:
        aOut += JsonString(Str(*static_cast<const CName*>(aMem)));
        return;
    case Kind::Simple:
        if (name == "String")
        {
            aOut += JsonString(static_cast<const CString*>(aMem)->c_str());
        }
        else if (name == "TweakDBID")
        {
            char buf[24];
            std::snprintf(buf, sizeof(buf), "\"0x%016llX\"",
                          static_cast<unsigned long long>(static_cast<const TweakDBID*>(aMem)->value));
            aOut += buf;
        }
        else if (name == "CRUID")
        {
            Quoted64(aOut, false, *static_cast<const uint64_t*>(aMem));
        }
        else
        {
            CString s;
            aOut += aType->ToString(aMem, s) ? JsonString(s.c_str()) : "null";
        }
        return;
    case Kind::Enum:
    {
        const auto* e = static_cast<const CEnum*>(aType);
        const int64_t v = ReadSigned(aMem, e->actualSize);
        for (uint32_t k = 0; k < e->valueList.Size() && k < e->hashList.Size(); ++k)
        {
            if (e->valueList[k] == v)
            {
                aOut += JsonString(Str(e->hashList[k]));
                return;
            }
        }
        aOut += std::to_string(v);
        return;
    }
    case Kind::BitField:
    {
        uint64_t v = 0;
        std::memcpy(&v, aMem, std::min<uint32_t>(aType->GetSize(), 8));
        aOut += std::to_string(v);
        return;
    }
    case Kind::Class:
    {
        const auto* cls = static_cast<const CClass*>(aType);
        if (IsScriptable(cls))
            aOut += "null"; // objects travel as handles, never by value
        else
            StructToJson(cls, aMem, aOut, aDepth);
        return;
    }
    case Kind::Array:
    case Kind::StaticArray:
    case Kind::NativeArray:
    case Kind::FixedArray:
    {
        if (aDepth > MaxDepth)
        {
            aOut += "null";
            return;
        }
        const auto* arr = static_cast<const CRTTIBaseArrayType*>(aType);
        void* mem = const_cast<void*>(aMem);
        const uint32_t n = std::min(arr->GetLength(mem), MaxElements);
        aOut += "[";
        for (uint32_t k = 0; k < n; ++k)
        {
            if (k)
                aOut += ",";
            ToJson(arr->GetInnerType(), arr->GetElement(mem, k), aOut, aDepth + 1);
        }
        aOut += "]";
        return;
    }
    case Kind::Handle:
        HandleToJson(*static_cast<const Handle<IScriptable>*>(aMem), aOut);
        return;
    case Kind::WeakHandle:
        HandleToJson(static_cast<const WeakHandle<IScriptable>*>(aMem)->Lock(), aOut);
        return;
    default:
    {
        CString s;
        aOut += aType->ToString(aMem, s) ? JsonString(s.c_str()) : "null";
        return;
    }
    }
}

// ---------- JSON to game values ----------

bool FromJson(const rtti::IType* aType, void* aMem, const Value& aValue, std::string& aError, int aDepth);

std::string TypeName(const rtti::IType* aType)
{
    return aType ? Str(aType->GetName()) : std::string("?");
}

bool Expect(bool aOk, const rtti::IType* aType, const char* aWanted, std::string& aError)
{
    if (!aOk)
        aError = TypeName(aType) + " needs " + aWanted;
    return aOk;
}

bool IntFromJson(const rtti::IType* aType, void* aMem, const Value& aValue, std::string& aError)
{
    int64_t s = 0;
    uint64_t u = 0;
    bool negative = false;
    if (!json::Integer(aValue, s, u, negative))
        return Expect(false, aType, "a whole number (64-bit values as a string)", aError);
    const std::string n = TypeName(aType);
    const bool isSigned = n.starts_with("Int");
    const uint32_t bits = aType->GetSize() * 8;
    if (isSigned)
    {
        if (bits < 64)
        {
            const int64_t lo = -(int64_t(1) << (bits - 1));
            const int64_t hi = (int64_t(1) << (bits - 1)) - 1;
            if (s < lo || s > hi)
                return Expect(false, aType, "a number in range", aError);
        }
        WriteInt(aMem, aType->GetSize(), uint64_t(s));
    }
    else
    {
        if (negative || (bits < 64 && u > ((uint64_t(1) << bits) - 1)))
            return Expect(false, aType, "a number in range", aError);
        WriteInt(aMem, aType->GetSize(), u);
    }
    return true;
}

const CProperty* FindProperty(const CClass* aClass, std::string_view aName)
{
    const CName name(std::string(aName).c_str());
    for (const CClass* c = aClass; c; c = c->parent)
    {
        for (const CProperty* p : c->props)
        {
            if (p->name == name)
                return p;
        }
    }
    return nullptr;
}

bool FromJson(const rtti::IType* aType, void* aMem, const Value& aValue, std::string& aError, int aDepth)
{
    if (aDepth > 32)
    {
        aError = "value nested too deeply";
        return false;
    }
    const CName name = aType->GetName();
    switch (aType->GetType())
    {
    case Kind::Fundamental:
        if (name == "Bool")
        {
            if (!Expect(aValue.kind == Value::Kind::Bool, aType, "true or false", aError))
                return false;
            *static_cast<bool*>(aMem) = aValue.boolean;
            return true;
        }
        if (name == "Float" || name == "Double")
        {
            if (!Expect(aValue.kind == Value::Kind::Number, aType, "a number", aError))
                return false;
            if (name == "Float")
                *static_cast<float*>(aMem) = float(aValue.number);
            else
                *static_cast<double*>(aMem) = aValue.number;
            return true;
        }
        return IntFromJson(aType, aMem, aValue, aError);
    case Kind::Name:
        if (!Expect(aValue.kind == Value::Kind::String, aType, "a string", aError))
            return false;
        *static_cast<CName*>(aMem) = CName(aValue.text.c_str());
        return true;
    case Kind::Simple:
        if (name == "String")
        {
            if (!Expect(aValue.kind == Value::Kind::String, aType, "a string", aError))
                return false;
            CString s(aValue.text.c_str());
            aType->Assign(aMem, &s);
            return true;
        }
        if (name == "TweakDBID")
        {
            int64_t s = 0;
            uint64_t u = 0;
            bool negative = false;
            if (json::Integer(aValue, s, u, negative) && !negative)
            {
                static_cast<TweakDBID*>(aMem)->value = u;
                return true;
            }
            if (!Expect(aValue.kind == Value::Kind::String && !aValue.text.empty(), aType,
                        "a record path such as \"Items.money\", or a \"0x...\" id", aError))
                return false;
            *static_cast<TweakDBID*>(aMem) = TweakDBID(aValue.text.c_str());
            return true;
        }
        if (name == "CRUID")
        {
            int64_t s = 0;
            uint64_t u = 0;
            bool negative = false;
            if (!Expect(json::Integer(aValue, s, u, negative) && !negative, aType, "a whole number as a string",
                        aError))
                return false;
            *static_cast<uint64_t*>(aMem) = u;
            return true;
        }
        if (aValue.kind == Value::Kind::String && aType->FromString(aMem, CString(aValue.text.c_str())))
            return true;
        aError = TypeName(aType) + " cannot be set from JSON yet";
        return false;
    case Kind::Enum:
    {
        const auto* e = static_cast<const CEnum*>(aType);
        if (aValue.kind == Value::Kind::String)
        {
            const CName member(aValue.text.c_str());
            for (uint32_t k = 0; k < e->hashList.Size() && k < e->valueList.Size(); ++k)
            {
                if (e->hashList[k] == member)
                {
                    WriteInt(aMem, e->actualSize, uint64_t(e->valueList[k]));
                    return true;
                }
            }
            aError = TypeName(aType) + " has no member \"" + aValue.text + "\"";
            return false;
        }
        if (!Expect(aValue.kind == Value::Kind::Number, aType, "a member name", aError))
            return false;
        WriteInt(aMem, e->actualSize, uint64_t(int64_t(aValue.number)));
        return true;
    }
    case Kind::BitField:
        if (!Expect(aValue.kind == Value::Kind::Number, aType, "a number", aError))
            return false;
        WriteInt(aMem, aType->GetSize(), uint64_t(aValue.number));
        return true;
    case Kind::Class:
    {
        const auto* cls = static_cast<const CClass*>(aType);
        if (IsScriptable(cls))
        {
            aError = TypeName(aType) + " is an object: pass a reference instead";
            return false;
        }
        if (FillGameInstance(aType, aMem))
            return true; // whatever was passed, it means the running game
        if (aValue.IsNull())
            return true; // the default value
        if (!Expect(aValue.kind == Value::Kind::Object, aType, "an object of its properties", aError))
            return false;
        for (const auto& [key, v] : aValue.fields)
        {
            const CProperty* p = FindProperty(cls, key);
            if (!p)
            {
                aError = TypeName(aType) + " has no property \"" + key + "\"";
                return false;
            }
            if (!FromJson(p->type, static_cast<uint8_t*>(aMem) + p->valueOffset, v, aError, aDepth + 1))
            {
                aError = key + ": " + aError;
                return false;
            }
        }
        return true;
    }
    case Kind::Array:
    case Kind::StaticArray:
    case Kind::NativeArray:
    case Kind::FixedArray:
    {
        if (!Expect(aValue.kind == Value::Kind::Array, aType, "an array", aError))
            return false;
        auto* arr = static_cast<const CRTTIBaseArrayType*>(aType);
        const uint32_t n = uint32_t(aValue.items.size());
        if (aType->GetType() == Kind::Array)
            arr->Resize(aMem, n);
        else if (arr->GetLength(aMem) < n)
            return Expect(false, aType, "fewer elements", aError);
        for (uint32_t k = 0; k < n; ++k)
        {
            if (!FromJson(arr->GetInnerType(), arr->GetElement(aMem, k), aValue.items[k], aError, aDepth + 1))
            {
                aError = "[" + std::to_string(k) + "]: " + aError;
                return false;
            }
        }
        return true;
    }
    case Kind::Handle:
    case Kind::WeakHandle:
    {
        if (aValue.IsNull())
            return true; // an empty handle
        Handle<IScriptable> obj = FromRef(aValue, aError);
        if (!obj)
            return false;
        const auto* inner = aType->GetType() == Kind::Handle ? static_cast<const CRTTIHandleType*>(aType)->innerType
                                                              : static_cast<const CRTTIWeakHandleType*>(aType)->innerType;
        if (inner && inner->GetType() == Kind::Class && !obj->GetType()->IsA(inner))
        {
            aError = "expected " + TypeName(inner) + ", got " + Str(obj->GetType()->GetName());
            return false;
        }
        if (aType->GetType() == Kind::Handle)
            *static_cast<Handle<IScriptable>*>(aMem) = obj;
        else
            *static_cast<WeakHandle<IScriptable>*>(aMem) = obj;
        return true;
    }
    case Kind::ScriptReference:
        aError = TypeName(aType) + ": script_ref parameters are not supported yet";
        return false;
    default:
        aError = TypeName(aType) + " is not supported yet";
        return false;
    }
}

// ---------- memory for one value ----------

// A GameInstance built from the type data has no game in it, and functions given
// one answer as if nothing existed (GetPlayer returns null). The SDK's constructor
// points it at the running game. (Found in the O6b test.)
bool FillGameInstance(const rtti::IType* aType, void* aMem)
{
    if (aType->GetType() != Kind::Class || aType->GetName() != "ScriptGameInstance")
        return false;
    *static_cast<ScriptGameInstance*>(aMem) = ScriptGameInstance();
    return true;
}

struct Slot
{
    const rtti::IType* type = nullptr;
    void* mem = nullptr;
    size_t align = 8;

    explicit Slot(const rtti::IType* aType)
        : type(aType)
    {
        align = std::max<size_t>(aType->GetAlignment(), 8);
        const size_t size = std::max<size_t>(aType->GetSize(), 8);
        mem = ::operator new(size, std::align_val_t(align));
        std::memset(mem, 0, size);
        type->Construct(mem);
        FillGameInstance(type, mem);
    }
    ~Slot()
    {
        type->Destruct(mem);
        ::operator delete(mem, std::align_val_t(align));
    }
    Slot(const Slot&) = delete;
    Slot& operator=(const Slot&) = delete;
};

// ---------- finding a function ----------

bool Matches(const CBaseFunction* aFn, const std::string& aName)
{
    return Str(aFn->shortName) == aName || Str(aFn->fullName) == aName;
}

uint32_t Required(const CBaseFunction* aFn)
{
    uint32_t n = 0;
    for (uint32_t k = 0; k < aFn->params.Size(); ++k)
    {
        if (!aFn->params[k]->flags.isOptional)
            n = k + 1;
    }
    return n;
}

// Picks one function among same-named candidates by the number of arguments.
CBaseFunction* Pick(std::vector<CBaseFunction*>& aCandidates, size_t aArgs, const std::string& aName,
                    std::string& aError)
{
    std::vector<CBaseFunction*> fit;
    for (auto* f : aCandidates)
    {
        if (aArgs <= f->params.Size() && aArgs >= Required(f))
            fit.push_back(f);
    }
    if (fit.size() > 1)
    {
        std::vector<CBaseFunction*> exact;
        for (auto* f : fit)
        {
            if (f->params.Size() == aArgs)
                exact.push_back(f);
        }
        if (exact.size() == 1)
            fit = exact;
    }
    if (fit.size() == 1)
        return fit[0];
    if (aCandidates.empty())
    {
        aError = "no game function \"" + aName + "\"";
        return nullptr;
    }
    std::string names;
    for (auto* f : (fit.empty() ? aCandidates : fit))
        names += (names.empty() ? "" : ", ") + Str(f->fullName);
    aError = fit.empty() ? "\"" + aName + "\" takes a different number of arguments: " + names
                         : "\"" + aName + "\" is ambiguous; call one by its full name: " + names;
    return nullptr;
}

CClass* FindClass(const std::string& aName)
{
    auto* rtti = CRTTISystem::Get();
    const CName name(aName.c_str());
    if (auto* c = rtti->GetClass(name))
        return c;
    return rtti->GetClassByScriptName(name);
}

CBaseFunction* Resolve(const Value& aParams, Handle<IScriptable>& aSelf, size_t aArgs, std::string& aError)
{
    const Value* fn = aParams.Get("fn");
    if (!fn || fn->kind != Value::Kind::String || fn->text.empty())
    {
        aError = "fn is required: the function's name";
        return nullptr;
    }
    const std::string& name = fn->text;
    std::vector<CBaseFunction*> candidates;

    if (const Value* self = aParams.Get("self"); self && !self->IsNull())
    {
        aSelf = FromRef(*self, aError);
        if (!aSelf)
            return nullptr;
        // The most derived class that has the name wins, as in scripts.
        for (const CClass* c = aSelf->GetType(); c && candidates.empty(); c = c->parent)
        {
            for (auto* f : c->funcs)
            {
                if (Matches(f, name))
                    candidates.push_back(f);
            }
        }
        if (candidates.empty())
            aError = Str(aSelf->GetType()->GetName()) + " has no method \"" + name + "\"";
        return candidates.empty() ? nullptr : Pick(candidates, aArgs, name, aError);
    }

    auto* rtti = CRTTISystem::Get();
    if (const Value* cls = aParams.Get("class"); cls && cls->kind == Value::Kind::String)
    {
        CClass* c = FindClass(cls->text);
        if (!c)
        {
            aError = "no game class \"" + cls->text + "\"";
            return nullptr;
        }
        for (auto* f : c->staticFuncs)
        {
            if (Matches(f, name))
                candidates.push_back(f);
        }
        if (candidates.empty())
        {
            // Static functions of script classes are registered as globals named "Class::Name;...".
            const std::string native = Str(c->GetName()) + "::";
            const CName* scriptName = rtti->nativeToScript.Get(c->GetName());
            const std::string script = scriptName ? Str(*scriptName) + "::" : native;
            rtti->funcs.ForEach(
                [&](const CName&, CGlobalFunction*& aFunc)
                {
                    const std::string full = Str(aFunc->fullName);
                    if ((full.starts_with(native) || full.starts_with(script)) && Str(aFunc->shortName) == name)
                        candidates.push_back(aFunc);
                });
        }
        if (candidates.empty())
        {
            aError = cls->text + " has no static function \"" + name + "\"";
            return nullptr;
        }
        return Pick(candidates, aArgs, name, aError);
    }

    if (auto* exact = rtti->GetFunction(CName(name.c_str())))
        return exact;
    rtti->funcs.ForEach(
        [&](const CName&, CGlobalFunction*& aFunc)
        {
            if (Str(aFunc->shortName) == name && Str(aFunc->fullName).find("::") == std::string::npos)
                candidates.push_back(aFunc);
        });
    return Pick(candidates, aArgs, name, aError);
}

// ---------- calling ----------

// Runs the game function, turning a crash inside it into a failed call. No C++
// objects with destructors may live in this function, because of __try.
bool SafeExecute(void* aInstance, CBaseFunction* aFn, void* aOut, StackArgs_t* aArgs, unsigned long* aCode)
{
    __try
    {
        return ExecuteFunction(aInstance, aFn, aOut, *aArgs);
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        *aCode = GetExceptionCode();
        return false;
    }
}

std::string Call(const Value& aParams, std::string& aError)
{
    static const Value noArgs{Value::Kind::Array};
    const Value* args = aParams.Get("args");
    if (!args || args->IsNull())
        args = &noArgs;
    if (args->kind != Value::Kind::Array)
    {
        aError = "args must be an array";
        return {};
    }

    Handle<IScriptable> self;
    CBaseFunction* fn = Resolve(aParams, self, args->items.size(), aError);
    if (!fn)
        return {};
    if (!fn->flags.isStatic && !self)
    {
        aError = Str(fn->fullName) + " is a method: call it on an object";
        return {};
    }

    std::vector<std::unique_ptr<Slot>> slots;
    StackArgs_t stack;
    for (uint32_t k = 0; k < fn->params.Size(); ++k)
    {
        const CProperty* p = fn->params[k];
        auto slot = std::make_unique<Slot>(p->type);
        if (k < args->items.size() && !args->items[k].IsNull())
        {
            if (!FromJson(p->type, slot->mem, args->items[k], aError, 0))
            {
                aError = "argument " + std::to_string(k + 1) + " (" + Str(p->name) + ", " + TypeName(p->type) +
                         "): " + aError;
                return {};
            }
        }
        else if (p->type->GetType() == Kind::ScriptReference)
        {
            aError = "argument " + std::to_string(k + 1) + " (" + Str(p->name) + ") is a script_ref, not supported yet";
            return {};
        }
        stack.emplace_back(p->type, slot->mem);
        slots.push_back(std::move(slot));
    }

    std::unique_ptr<Slot> ret;
    if (fn->returnType)
        ret = std::make_unique<Slot>(fn->returnType->type);

    unsigned long code = 0;
    if (!SafeExecute(self ? self.GetPtr() : nullptr, fn, ret ? ret->mem : nullptr, &stack, &code))
    {
        if (code)
        {
            char buf[160];
            std::snprintf(buf, sizeof(buf), "%s crashed inside the game (0x%08lX); the game may be unstable now",
                          Str(fn->fullName).c_str(), code);
            Log("Overlay: rtti.call: %s", buf);
            aError = buf;
        }
        else
        {
            aError = Str(fn->fullName) + " failed";
        }
        return {};
    }

    std::string result;
    if (ret)
        ToJson(ret->type, ret->mem, result, 0);
    else
        result = "null";

    bool hasOut = false;
    std::string out = "{";
    for (uint32_t k = 0; k < fn->params.Size(); ++k)
    {
        const CProperty* p = fn->params[k];
        if (!p->flags.isOut)
            continue;
        out += hasOut ? "," : "";
        hasOut = true;
        out += JsonString(Str(p->name)) + ":";
        ToJson(p->type, slots[k]->mem, out, 0);
    }
    out += "}";
    return hasOut ? "{\"result\":" + result + ",\"out\":" + out + "}" : result;
}

std::string Get(const Value& aParams, std::string& aError)
{
    const Value* self = aParams.Get("self");
    const Value* prop = aParams.Get("prop");
    if (!self || !prop || prop->kind != Value::Kind::String)
    {
        aError = "self and prop are required";
        return {};
    }
    Handle<IScriptable> obj = FromRef(*self, aError);
    if (!obj)
        return {};
    const CProperty* p = FindProperty(obj->GetType(), prop->text);
    if (!p)
    {
        aError = Str(obj->GetType()->GetName()) + " has no property \"" + prop->text + "\"";
        return {};
    }
    std::string result;
    ToJson(p->type, p->GetValuePtr<void>(obj.GetPtr()), result, 0);
    return result;
}

std::string Release(const Value& aParams)
{
    if (const Value* refs = aParams.Get("refs"); refs && refs->kind == Value::Kind::Array)
    {
        for (const Value& r : refs->items)
        {
            auto it = g_refs.find(uint32_t(r.number));
            if (it == g_refs.end() || --it->second.count > 0)
                continue;
            for (auto id = g_refIds.begin(); id != g_refIds.end(); ++id)
            {
                if (id->second == it->first)
                {
                    g_refIds.erase(id);
                    break;
                }
            }
            g_refs.erase(it);
        }
    }
    return "{\"refs\":" + std::to_string(g_refs.size()) + "}";
}
} // namespace

bool IsReflectMethod(const std::string& aMethod)
{
    return aMethod == "rtti.call" || aMethod == "rtti.get" || aMethod == "rtti.release";
}

std::string Reflect(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    if (aMethod == "rtti.call")
        return Call(aParams, aError);
    if (aMethod == "rtti.get")
        return Get(aParams, aError);
    return Release(aParams);
}

void ClearRefs()
{
    g_refs.clear();
    g_refIds.clear();
}
} // namespace rednode::overlay::detail
