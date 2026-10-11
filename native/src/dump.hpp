#pragma once

#include <filesystem>
#include <string>

namespace rednode
{
// Writes every class, enum, bitfield and global function in the game's RTTI
// to a JSON file. Signatures only: names, types, flags and enum values.
// Call it on the game thread once scripts are loaded.
// Returns false and fills aError on failure.
bool DumpRtti(const std::filesystem::path& aFile, const std::string& aGameVersion, std::string& aError);
} // namespace rednode
