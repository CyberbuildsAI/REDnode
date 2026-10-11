// RTTI dump for the game API reference.
//
// Output format (version 1), arrays sorted by name so dumps diff cleanly:
//   {
//     "format": 1, "game": "2.31.0", "dumper": "REDnode 0.5.0",
//     "classes":   [{ name, scriptName?, parent?, flags[], props[], funcs[] }],
//     "enums":     [{ name, scriptName?, flags[], size, members[{ name, value }] }],
//     "bitfields": [{ name, scriptName?, flags[], size, bits[{ name, bit }] }],
//     "functions": [{ name, fullName, flags[], params[], returns? }]
//   }
// Type names are RTTI names, e.g. "handle:PlayerPuppet" or "array:Int32".

#include "dump.hpp"

#include <RED4ext/RED4ext.hpp>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>
#include <string_view>
#include <vector>

namespace
{
using namespace RED4ext;

// Names of functions REDnode registers itself. They are not part of the game.
constexpr std::string_view OwnPrefix = "REDnode_";

// "None" is a real name in the game data, e.g. enum members and
// gameuiMappinUIProfile.None. Absent values are handled by the callers.
std::string Str(CName aName)
{
    if (aName.IsNone())
    {
        return "None";
    }
    const char* text = aName.ToString();
    return text ? text : std::to_string(aName.hash);
}

class Json
{
public:
    explicit Json(std::ofstream& aOut)
        : m_out(aOut)
    {
    }

    void Raw(std::string_view aText)
    {
        m_out << aText;
    }

    void String(std::string_view aText)
    {
        m_out << '"';
        for (const char c : aText)
        {
            switch (c)
            {
            case '"':
                m_out << "\\\"";
                break;
            case '\\':
                m_out << "\\\\";
                break;
            case '\n':
                m_out << "\\n";
                break;
            case '\r':
                m_out << "\\r";
                break;
            case '\t':
                m_out << "\\t";
                break;
            default:
                if (static_cast<unsigned char>(c) < 0x20)
                {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    m_out << buf;
                }
                else
                {
                    m_out << c;
                }
            }
        }
        m_out << '"';
    }

    void Key(std::string_view aKey)
    {
        String(aKey);
        m_out << ':';
    }

    void Field(std::string_view aKey, std::string_view aValue)
    {
        Key(aKey);
        String(aValue);
    }

    void Field(std::string_view aKey, int64_t aValue)
    {
        Key(aKey);
        m_out << aValue;
    }

    void Flags(const std::vector<std::string_view>& aFlags)
    {
        Key("flags");
        m_out << '[';
        for (size_t i = 0; i < aFlags.size(); ++i)
        {
            if (i)
            {
                m_out << ',';
            }
            String(aFlags[i]);
        }
        m_out << ']';
    }

private:
    std::ofstream& m_out;
};

std::string ScriptName(const CRTTISystem* aRtti, CName aNative)
{
    const auto* script = aRtti->nativeToScript.Get(aNative);
    if (!script || *script == aNative)
    {
        return {};
    }
    return Str(*script);
}

std::string TypeName(const rtti::IType* aType)
{
    return aType ? Str(aType->GetName()) : std::string{};
}

std::vector<std::string_view> ClassFlags(const CClass::Flags& f)
{
    std::vector<std::string_view> out;
    if (f.isAbstract) out.push_back("abstract");
    if (f.isNative) out.push_back("native");
    if (f.isScriptedClass) out.push_back("scriptedClass");
    if (f.isScriptedStruct) out.push_back("scriptedStruct");
    if (f.isImportOnly) out.push_back("importOnly");
    if (f.isPrivate) out.push_back("private");
    if (f.isProtected) out.push_back("protected");
    if (f.isTestOnly) out.push_back("testOnly");
    if (f.isSavable) out.push_back("savable");
    if (f.isAlwaysTransient) out.push_back("alwaysTransient");
    return out;
}

std::vector<std::string_view> PropFlags(const CProperty::Flags& f)
{
    std::vector<std::string_view> out;
    if (f.isScripted) out.push_back("scripted");
    if (f.isOut) out.push_back("out");
    if (f.isOptional) out.push_back("optional");
    if (f.isOverriding) out.push_back("overriding");
    if (f.isPrivate) out.push_back("private");
    if (f.isProtected) out.push_back("protected");
    if (f.isPublic) out.push_back("public");
    if (f.isHandle) out.push_back("handle");
    if (f.isPersistent) out.push_back("persistent");
    if (f.isSavable) out.push_back("savable");
    return out;
}

std::vector<std::string_view> FuncFlags(const CBaseFunction::Flags& f)
{
    std::vector<std::string_view> out;
    if (f.isNative) out.push_back("native");
    if (f.isStatic) out.push_back("static");
    if (f.isFinal) out.push_back("final");
    if (f.isEvent) out.push_back("event");
    if (f.isExec) out.push_back("exec");
    if (f.isPrivate) out.push_back("private");
    if (f.isProtected) out.push_back("protected");
    if (f.isPublic) out.push_back("public");
    if (f.isConst) out.push_back("const");
    if (f.isQuest) out.push_back("quest");
    // The SDK calls bit 0x0F isThreadsafe, but on 2.31 it is set on every
    // script-defined function and on no native one, so it marks scripted code.
    if (f.isThreadsafe) out.push_back("scripted");
    return out;
}

void WriteProp(Json& j, const CProperty* p)
{
    j.Raw("{");
    j.Field("name", Str(p->name));
    j.Raw(",");
    j.Field("type", TypeName(p->type));
    j.Raw(",");
    j.Flags(PropFlags(p->flags));
    j.Raw("}");
}

void WriteFunc(Json& j, const CBaseFunction* f)
{
    j.Raw("{");
    j.Field("name", Str(f->shortName));
    j.Raw(",");
    j.Field("fullName", Str(f->fullName));
    j.Raw(",");
    j.Flags(FuncFlags(f->flags));
    j.Raw(",");
    j.Key("params");
    j.Raw("[");
    bool first = true;
    for (const CProperty* p : f->params)
    {
        if (!first) j.Raw(",");
        first = false;
        WriteProp(j, p);
    }
    j.Raw("]");
    if (f->returnType && f->returnType->type)
    {
        j.Raw(",");
        j.Field("returns", TypeName(f->returnType->type));
    }
    j.Raw("}");
}

template<typename T>
void SortByName(std::vector<T*>& aItems)
{
    std::sort(aItems.begin(), aItems.end(),
              [](const T* a, const T* b) { return Str(a->GetName()) < Str(b->GetName()); });
}

template<typename F>
void SortFuncs(std::vector<F*>& aFuncs)
{
    std::sort(aFuncs.begin(), aFuncs.end(),
              [](const F* a, const F* b) { return Str(a->fullName) < Str(b->fullName); });
}
} // namespace

bool rednode::DumpRtti(const std::filesystem::path& aFile, const std::string& aGameVersion, std::string& aError)
{
    auto* system = CRTTISystem::Get();
    if (!system)
    {
        aError = "RTTI system not available";
        return false;
    }

    std::vector<CClass*> classes;
    std::vector<CEnum*> enums;
    std::vector<CBitfield*> bitfields;
    system->types.ForEach(
        [&](const CName&, rtti::IType*& aType)
        {
            switch (aType->GetType())
            {
            case rtti::ERTTIType::Class:
                classes.push_back(static_cast<CClass*>(aType));
                break;
            case rtti::ERTTIType::Enum:
                enums.push_back(static_cast<CEnum*>(aType));
                break;
            case rtti::ERTTIType::BitField:
                bitfields.push_back(static_cast<CBitfield*>(aType));
                break;
            default:
                break;
            }
        });

    std::vector<CGlobalFunction*> functions;
    system->funcs.ForEach(
        [&](const CName&, CGlobalFunction*& aFunc)
        {
            if (!Str(aFunc->shortName).starts_with(OwnPrefix))
            {
                functions.push_back(aFunc);
            }
        });

    SortByName(classes);
    SortByName(enums);
    SortByName(bitfields);
    SortFuncs(functions);

    std::ofstream out(aFile, std::ios::binary | std::ios::trunc);
    if (!out)
    {
        aError = "cannot open " + aFile.string();
        return false;
    }

    Json j(out);
    j.Raw("{");
    j.Field("format", 1);
    j.Raw(",");
    j.Field("game", aGameVersion);
    j.Raw(",");
    j.Field("dumper", "REDnode 0.7.0");

    // Classes and structs.
    j.Raw(",\n");
    j.Key("classes");
    j.Raw("[\n");
    for (size_t i = 0; i < classes.size(); ++i)
    {
        const CClass* c = classes[i];
        if (i) j.Raw(",\n");
        j.Raw("{");
        j.Field("name", Str(c->name));
        if (const auto script = ScriptName(system, c->name); !script.empty())
        {
            j.Raw(",");
            j.Field("scriptName", script);
        }
        if (c->parent)
        {
            j.Raw(",");
            j.Field("parent", Str(c->parent->name));
        }
        j.Raw(",");
        j.Flags(ClassFlags(c->flags));

        j.Raw(",");
        j.Key("props");
        j.Raw("[");
        bool first = true;
        for (const CProperty* p : c->props)
        {
            if (!first) j.Raw(",");
            first = false;
            WriteProp(j, p);
        }
        j.Raw("]");

        std::vector<CBaseFunction*> funcs;
        for (auto* f : c->funcs) funcs.push_back(f);
        for (auto* f : c->staticFuncs) funcs.push_back(f);
        SortFuncs(funcs);
        j.Raw(",");
        j.Key("funcs");
        j.Raw("[");
        for (size_t k = 0; k < funcs.size(); ++k)
        {
            if (k) j.Raw(",");
            WriteFunc(j, funcs[k]);
        }
        j.Raw("]}");
    }
    j.Raw("\n]");

    // Enums.
    j.Raw(",\n");
    j.Key("enums");
    j.Raw("[\n");
    for (size_t i = 0; i < enums.size(); ++i)
    {
        const CEnum* e = enums[i];
        if (i) j.Raw(",\n");
        j.Raw("{");
        j.Field("name", Str(e->name));
        if (const auto script = ScriptName(system, e->name); !script.empty())
        {
            j.Raw(",");
            j.Field("scriptName", script);
        }
        j.Raw(",");
        j.Flags(e->flags.isScripted ? std::vector<std::string_view>{"scripted"} : std::vector<std::string_view>{});
        j.Raw(",");
        j.Field("size", e->actualSize);
        j.Raw(",");
        j.Key("members");
        j.Raw("[");
        const auto count = std::min(e->hashList.size(), e->valueList.size());
        for (uint32_t k = 0; k < count; ++k)
        {
            if (k) j.Raw(",");
            j.Raw("{");
            j.Field("name", Str(e->hashList[k]));
            j.Raw(",");
            j.Field("value", e->valueList[k]);
            j.Raw("}");
        }
        j.Raw("]}");
    }
    j.Raw("\n]");

    // Bitfields.
    j.Raw(",\n");
    j.Key("bitfields");
    j.Raw("[\n");
    for (size_t i = 0; i < bitfields.size(); ++i)
    {
        const CBitfield* b = bitfields[i];
        if (i) j.Raw(",\n");
        j.Raw("{");
        j.Field("name", Str(b->name));
        if (const auto script = ScriptName(system, b->name); !script.empty())
        {
            j.Raw(",");
            j.Field("scriptName", script);
        }
        j.Raw(",");
        j.Flags(b->flags.isScripted ? std::vector<std::string_view>{"scripted"} : std::vector<std::string_view>{});
        j.Raw(",");
        j.Field("size", b->actualSize);
        j.Raw(",");
        j.Key("bits");
        j.Raw("[");
        bool first = true;
        for (int bit = 0; bit < 64; ++bit)
        {
            if (!(b->validBits & (1ull << bit)))
            {
                continue;
            }
            if (!first) j.Raw(",");
            first = false;
            j.Raw("{");
            j.Field("name", Str(b->bitNames[bit]));
            j.Raw(",");
            j.Field("bit", bit);
            j.Raw("}");
        }
        j.Raw("]}");
    }
    j.Raw("\n]");

    // Global functions.
    j.Raw(",\n");
    j.Key("functions");
    j.Raw("[\n");
    for (size_t i = 0; i < functions.size(); ++i)
    {
        if (i) j.Raw(",\n");
        WriteFunc(j, functions[i]);
    }
    j.Raw("\n]}\n");

    out.close();
    if (!out)
    {
        aError = "write failed for " + aFile.string();
        return false;
    }
    return true;
}
