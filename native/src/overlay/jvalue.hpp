#pragma once

// A small JSON parser for bridge requests that carry nested values, such as the
// arguments of rtti.call. Keeps a number's text as well as its value, so 64-bit
// integers can be read without the precision a double loses above 2^53.

#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace rednode::overlay::detail::json
{
struct Value
{
    enum class Kind
    {
        Null,
        Bool,
        Number,
        String,
        Array,
        Object
    };

    Kind kind = Kind::Null;
    bool boolean = false;
    double number = 0;
    std::string text; // a string's value, or a number as written
    std::vector<Value> items;
    std::vector<std::pair<std::string, Value>> fields;

    bool IsNull() const
    {
        return kind == Kind::Null;
    }

    // A field of an object, or nullptr.
    const Value* Get(std::string_view aKey) const
    {
        if (kind != Kind::Object)
            return nullptr;
        for (const auto& [k, v] : fields)
        {
            if (k == aKey)
                return &v;
        }
        return nullptr;
    }
};

namespace parse
{
constexpr int MaxDepth = 32;

struct Parser
{
    std::string_view s;
    size_t i = 0;
    std::string error;

    void Space()
    {
        while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r'))
            ++i;
    }

    bool Fail(const char* aWhat)
    {
        if (error.empty())
            error = std::string(aWhat) + " at character " + std::to_string(i);
        return false;
    }

    static void Utf8(std::string& aOut, uint32_t aCode)
    {
        if (aCode < 0x80)
            aOut += char(aCode);
        else if (aCode < 0x800)
        {
            aOut += char(0xC0 | (aCode >> 6));
            aOut += char(0x80 | (aCode & 0x3F));
        }
        else if (aCode < 0x10000)
        {
            aOut += char(0xE0 | (aCode >> 12));
            aOut += char(0x80 | ((aCode >> 6) & 0x3F));
            aOut += char(0x80 | (aCode & 0x3F));
        }
        else
        {
            aOut += char(0xF0 | (aCode >> 18));
            aOut += char(0x80 | ((aCode >> 12) & 0x3F));
            aOut += char(0x80 | ((aCode >> 6) & 0x3F));
            aOut += char(0x80 | (aCode & 0x3F));
        }
    }

    bool Hex4(uint32_t& aOut)
    {
        if (i + 4 > s.size())
            return Fail("short \\u escape");
        aOut = 0;
        for (int k = 0; k < 4; ++k)
        {
            const char c = s[i++];
            aOut <<= 4;
            if (c >= '0' && c <= '9')
                aOut |= uint32_t(c - '0');
            else if (c >= 'a' && c <= 'f')
                aOut |= uint32_t(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F')
                aOut |= uint32_t(c - 'A' + 10);
            else
                return Fail("bad \\u escape");
        }
        return true;
    }

    bool String(std::string& aOut)
    {
        ++i; // opening quote
        while (i < s.size())
        {
            const char c = s[i++];
            if (c == '"')
                return true;
            if (static_cast<unsigned char>(c) < 0x20)
                return Fail("control character in a string");
            if (c != '\\')
            {
                aOut += c;
                continue;
            }
            if (i >= s.size())
                break;
            switch (s[i++])
            {
            case '"':
                aOut += '"';
                break;
            case '\\':
                aOut += '\\';
                break;
            case '/':
                aOut += '/';
                break;
            case 'b':
                aOut += '\b';
                break;
            case 'f':
                aOut += '\f';
                break;
            case 'n':
                aOut += '\n';
                break;
            case 'r':
                aOut += '\r';
                break;
            case 't':
                aOut += '\t';
                break;
            case 'u':
            {
                uint32_t code = 0;
                if (!Hex4(code))
                    return false;
                if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.size() && s[i] == '\\' && s[i + 1] == 'u')
                {
                    i += 2;
                    uint32_t low = 0;
                    if (!Hex4(low))
                        return false;
                    if (low >= 0xDC00 && low <= 0xDFFF)
                        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                }
                Utf8(aOut, code);
                break;
            }
            default:
                return Fail("bad escape");
            }
        }
        return Fail("unterminated string");
    }

    bool Literal(std::string_view aWord)
    {
        if (s.substr(i, aWord.size()) != aWord)
            return Fail("unexpected text");
        i += aWord.size();
        return true;
    }

    bool Parse(Value& aOut, int aDepth)
    {
        if (aDepth > MaxDepth)
            return Fail("nested too deeply");
        Space();
        if (i >= s.size())
            return Fail("unexpected end");
        const char c = s[i];
        if (c == '{')
        {
            aOut.kind = Value::Kind::Object;
            ++i;
            Space();
            if (i < s.size() && s[i] == '}')
            {
                ++i;
                return true;
            }
            for (;;)
            {
                Space();
                if (i >= s.size() || s[i] != '"')
                    return Fail("expected a key");
                std::string key;
                if (!String(key))
                    return false;
                Space();
                if (i >= s.size() || s[i] != ':')
                    return Fail("expected ':'");
                ++i;
                Value v;
                if (!Parse(v, aDepth + 1))
                    return false;
                aOut.fields.emplace_back(std::move(key), std::move(v));
                Space();
                if (i < s.size() && s[i] == ',')
                {
                    ++i;
                    continue;
                }
                if (i < s.size() && s[i] == '}')
                {
                    ++i;
                    return true;
                }
                return Fail("expected ',' or '}'");
            }
        }
        if (c == '[')
        {
            aOut.kind = Value::Kind::Array;
            ++i;
            Space();
            if (i < s.size() && s[i] == ']')
            {
                ++i;
                return true;
            }
            for (;;)
            {
                Value v;
                if (!Parse(v, aDepth + 1))
                    return false;
                aOut.items.push_back(std::move(v));
                Space();
                if (i < s.size() && s[i] == ',')
                {
                    ++i;
                    continue;
                }
                if (i < s.size() && s[i] == ']')
                {
                    ++i;
                    return true;
                }
                return Fail("expected ',' or ']'");
            }
        }
        if (c == '"')
        {
            aOut.kind = Value::Kind::String;
            return String(aOut.text);
        }
        if (c == 't')
        {
            aOut.kind = Value::Kind::Bool;
            aOut.boolean = true;
            return Literal("true");
        }
        if (c == 'f')
        {
            aOut.kind = Value::Kind::Bool;
            return Literal("false");
        }
        if (c == 'n')
            return Literal("null");
        if (c == '-' || (c >= '0' && c <= '9'))
        {
            const size_t start = i;
            ++i;
            while (i < s.size() && ((s[i] >= '0' && s[i] <= '9') || s[i] == '.' || s[i] == 'e' || s[i] == 'E' ||
                                    s[i] == '+' || s[i] == '-'))
                ++i;
            aOut.kind = Value::Kind::Number;
            aOut.text = std::string(s.substr(start, i - start));
            char* end = nullptr;
            aOut.number = std::strtod(aOut.text.c_str(), &end);
            if (end != aOut.text.c_str() + aOut.text.size())
                return Fail("bad number");
            return true;
        }
        return Fail("unexpected character");
    }
};
} // namespace parse

// Parses a whole JSON document. On failure, aError says where.
inline bool Parse(std::string_view aText, Value& aOut, std::string& aError)
{
    parse::Parser p{aText};
    aOut = Value{};
    if (!p.Parse(aOut, 0))
    {
        aError = p.error;
        return false;
    }
    p.Space();
    if (p.i != aText.size())
    {
        aError = "extra text after the value at character " + std::to_string(p.i);
        return false;
    }
    return true;
}

// A whole number from a number or a string, for 64-bit values. Accepts "0x" hex in strings.
inline bool Integer(const Value& aValue, int64_t& aSigned, uint64_t& aUnsigned, bool& aNegative)
{
    std::string t;
    if (aValue.kind == Value::Kind::Number || aValue.kind == Value::Kind::String)
        t = aValue.text;
    else
        return false;
    const bool hex = t.size() > 2 && t[0] == '0' && (t[1] == 'x' || t[1] == 'X');
    if (t.empty() || (!hex && t.find_first_of(".eE") != std::string::npos))
        return false;
    aNegative = t[0] == '-';
    char* end = nullptr;
    errno = 0;
    if (aNegative)
    {
        aSigned = std::strtoll(t.c_str(), &end, 10);
        aUnsigned = uint64_t(aSigned);
    }
    else
    {
        aUnsigned = std::strtoull(t.c_str(), &end, hex ? 16 : 10);
        aSigned = int64_t(aUnsigned);
    }
    return errno == 0 && end == t.c_str() + t.size();
}
} // namespace rednode::overlay::detail::json
