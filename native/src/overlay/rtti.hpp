#pragma once

// Small helpers for calling game functions and reading properties through RTTI.
// Call them on the game thread.

#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Scripting/Natives/ScriptGameInstance.hpp>

namespace rednode::overlay::detail::rtti
{
using Handle = RED4ext::Handle<RED4ext::IScriptable>;

// An instance method by short name, searching base classes too.
inline RED4ext::CBaseFunction* Method(RED4ext::CClass* aClass, const char* aName)
{
    for (auto* c = aClass; c; c = c->parent)
    {
        if (auto* f = c->GetFunction(aName))
            return f;
    }
    return nullptr;
}

// A static method of a class by short name.
inline RED4ext::CBaseFunction* Static(RED4ext::CClass* aClass, const char* aName)
{
    if (!aClass)
        return nullptr;
    for (auto* f : aClass->staticFuncs)
    {
        if (f->shortName == RED4ext::CName(aName))
            return f;
    }
    return nullptr;
}

// GameInstance.<aGetter>(), for example GetPhotoModeSystem. Empty handle on failure.
inline Handle GameSystem(const char* aGetter)
{
    auto* fn = Static(RED4ext::CRTTISystem::Get()->GetClass("ScriptGameInstance"), aGetter);
    Handle out;
    if (!fn)
        return out;
    RED4ext::ScriptGameInstance game;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &game);
    RED4ext::ExecuteFunction(static_cast<void*>(nullptr), fn, &out, args);
    return out;
}

// The player, or an empty handle at the main menu and on loading screens.
inline Handle Player()
{
    auto* fn = RED4ext::CRTTISystem::Get()->GetFunction("GetPlayer;GameInstance");
    Handle out;
    if (!fn)
        return out;
    RED4ext::ScriptGameInstance game;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &game);
    RED4ext::ExecuteFunction(static_cast<void*>(nullptr), fn, &out, args);
    return out;
}

// Calls a method on an object with arguments already in aArgs.
template<typename T>
bool Call(const Handle& aObject, const char* aMethod, T* aOut, RED4ext::StackArgs_t& aArgs)
{
    if (!aObject)
        return false;
    auto* fn = Method(aObject->GetType(), aMethod);
    return fn && RED4ext::ExecuteFunction(aObject.GetPtr(), fn, aOut, aArgs);
}

template<typename T>
bool Call(const Handle& aObject, const char* aMethod, T* aOut)
{
    RED4ext::StackArgs_t none;
    return Call(aObject, aMethod, aOut, none);
}

// Pointer to a property's value inside an object, or nullptr.
inline void* Property(const Handle& aObject, const char* aName)
{
    if (!aObject)
        return nullptr;
    auto* prop = aObject->GetType()->GetProperty(aName);
    return prop ? prop->GetValuePtr<void>(aObject.GetPtr()) : nullptr;
}
} // namespace rednode::overlay::detail::rtti
