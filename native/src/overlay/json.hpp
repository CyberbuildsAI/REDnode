#pragma once

// Minimal readers for the flat JSON objects the overlay host sends.
// Not a general JSON parser: keys are found by text, values are not nested
// except for arrays of numbers.

#include <cstdlib>
#include <string>
#include <string_view>
#include <vector>

namespace rednode::overlay::detail::json
{
// Position just after "key": in aJson, or npos.
inline size_t After(std::string_view aJson, std::string_view aKey)
{
    std::string needle = "\"";
    needle += aKey;
    needle += "\":";
    const size_t at = aJson.find(needle);
    return at == std::string_view::npos ? at : at + needle.size();
}

inline bool Number(std::string_view aJson, std::string_view aKey, double& aOut)
{
    const size_t at = After(aJson, aKey);
    if (at == std::string_view::npos)
        return false;
    const std::string rest(aJson.substr(at, 32));
    char* end = nullptr;
    aOut = std::strtod(rest.c_str(), &end);
    return end != rest.c_str();
}

inline bool Bool(std::string_view aJson, std::string_view aKey, bool aDefault)
{
    const size_t at = After(aJson, aKey);
    if (at == std::string_view::npos)
        return aDefault;
    return aJson.substr(at, 4) == "true";
}

inline bool String(std::string_view aJson, std::string_view aKey, std::string& aOut)
{
    size_t at = After(aJson, aKey);
    if (at == std::string_view::npos || at >= aJson.size() || aJson[at] != '"')
        return false;
    const size_t end = aJson.find('"', ++at);
    if (end == std::string_view::npos)
        return false;
    aOut = std::string(aJson.substr(at, end - at));
    return true;
}

// Every number inside "key": [ ... ], flattened.
inline bool Numbers(std::string_view aJson, std::string_view aKey, std::vector<double>& aOut)
{
    size_t at = After(aJson, aKey);
    if (at == std::string_view::npos || at >= aJson.size() || aJson[at] != '[')
        return false;
    const size_t end = aJson.find(']', at);
    if (end == std::string_view::npos)
        return false;
    const std::string body(aJson.substr(at + 1, end - at - 1));
    const char* p = body.c_str();
    while (*p)
    {
        char* next = nullptr;
        const double v = std::strtod(p, &next);
        if (next == p)
        {
            ++p;
            continue;
        }
        aOut.push_back(v);
        p = next;
    }
    return true;
}
} // namespace rednode::overlay::detail::json
