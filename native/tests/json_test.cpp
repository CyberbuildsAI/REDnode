// Tests for the JSON parser used by the generic game API (src/overlay/jvalue.hpp).
// Runs without the game.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/jvalue.hpp"

#include <cstdio>
#include <cstdlib>

using rednode::overlay::detail::json::Integer;
using rednode::overlay::detail::json::Parse;
using rednode::overlay::detail::json::Value;
using Kind = Value::Kind;

namespace
{
int g_failures = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s  %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failures;
}

Value P(const char* aText)
{
    Value v;
    std::string error;
    if (!Parse(aText, v, error))
        std::printf("      parse error: %s\n", error.c_str());
    return v;
}

bool Fails(const char* aText)
{
    Value v;
    std::string error;
    return !Parse(aText, v, error) && !error.empty();
}
} // namespace

int main()
{
    const Value req = P(R"({"id":7,"method":"rtti.call","params":{"fn":"GetPlayer","args":[{}]}})");
    Check(req.kind == Kind::Object && req.Get("id") && req.Get("id")->number == 7, "an object with a number");
    const Value* params = req.Get("params");
    Check(params && params->Get("fn") && params->Get("fn")->text == "GetPlayer", "a nested object and a string");
    const Value* args = params ? params->Get("args") : nullptr;
    Check(args && args->kind == Kind::Array && args->items.size() == 1 && args->items[0].kind == Kind::Object &&
              args->items[0].fields.empty(),
          "an array holding an empty object");

    const Value mix = P(R"( [ true , false , null , -12.5e1 , "x" , [] ] )");
    Check(mix.items.size() == 6 && mix.items[0].boolean && !mix.items[1].boolean && mix.items[2].IsNull() &&
              mix.items[3].number == -125 && mix.items[4].text == "x" && mix.items[5].items.empty(),
          "booleans, null, an exponent, whitespace");

    const Value esc = P(R"("a\"b\\c\/d\né€😀")");
    Check(esc.text == "a\"b\\c/d\n\xC3\xA9\xE2\x82\xAC\xF0\x9F\x98\x80", "escapes, two- and three-byte UTF-8, a surrogate pair");

    int64_t s = 0;
    uint64_t u = 0;
    bool negative = false;
    const Value big = P(R"(["18446744073709551615", 9007199254740993, "-42", "0x00000000CAFEBABE", 1.5])");
    Check(Integer(big.items[0], s, u, negative) && u == 18446744073709551615ull && !negative,
          "the largest Uint64 from a string");
    Check(Integer(big.items[1], s, u, negative) && u == 9007199254740993ull,
          "a number above 2^53 keeps its exact digits");
    Check(Integer(big.items[2], s, u, negative) && s == -42 && negative, "a negative whole number from a string");
    Check(Integer(big.items[3], s, u, negative) && u == 0xCAFEBABEull, "a 0x hex string");
    Check(!Integer(big.items[4], s, u, negative), "1.5 is not a whole number");

    Check(Fails(R"({"a":1,})"), "a trailing comma fails");
    Check(Fails(R"({"a" 1})"), "a missing colon fails");
    Check(Fails(R"("open)"), "an unterminated string fails");
    Check(Fails(R"([1] 2)"), "text after the value fails");
    Check(Fails(R"(tru)"), "a bad literal fails");
    std::string deep(40, '[');
    deep += std::string(40, ']');
    Check(Fails(deep.c_str()), "nesting deeper than 32 levels fails");

    std::printf("\n%s: %d failure(s)\n", g_failures ? "FAILED" : "PASSED", g_failures);
    return g_failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
