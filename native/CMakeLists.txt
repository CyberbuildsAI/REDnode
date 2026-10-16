cmake_minimum_required(VERSION 3.25)

# REDnode's one version, shared by every part, is in VERSION at the repo root
# (tools/version.mjs sets it). The plugin reports it in its log and to RED4ext.
file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/../VERSION" REDNODE_VERSION LIMIT_COUNT 1)
string(STRIP "${REDNODE_VERSION}" REDNODE_VERSION) # a checkout may give it a CR
project(REDnode VERSION ${REDNODE_VERSION} LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# RED4ext.SDK (MIT), pinned to the revision studied in P0.
# Header-only, so the plugin builds from a single translation unit.
set(RED4EXT_HEADER_ONLY ON CACHE BOOL "" FORCE)
FetchContent_Declare(
  red4ext_sdk
  GIT_REPOSITORY https://github.com/WopsS/RED4ext.SDK.git
  GIT_TAG ad7277714ad30d6885d7050c5ba24fa0102f6920
  SYSTEM
)
FetchContent_MakeAvailable(red4ext_sdk)

# miniaudio 0.11.25 (public domain or MIT-0), REDnode's own audio output (Sound API).
# One header; its own CMake project (tests, examples) is not built.
FetchContent_Declare(
  miniaudio
  GIT_REPOSITORY https://github.com/mackron/miniaudio.git
  GIT_TAG 9634bedb5b5a2ca38c1ee7108a9358a4e233f14d
  SOURCE_SUBDIR do-not-build
  SYSTEM
)
FetchContent_MakeAvailable(miniaudio)

add_library(REDnode SHARED
  src/main.cpp
  src/dump.cpp
  src/overlay/overlay.cpp
  src/overlay/link.cpp
  src/overlay/compositor.cpp
  src/overlay/input.cpp
  src/overlay/bridge.cpp
  src/overlay/reflect.cpp
  src/overlay/windows.cpp
  src/overlay/host.cpp
  src/overlay/gamestate.cpp
  src/overlay/audio.cpp
)
target_link_libraries(REDnode PRIVATE RED4ext::SDK d3d12 d3dcompiler)
target_include_directories(REDnode SYSTEM PRIVATE ${miniaudio_SOURCE_DIR})
target_compile_definitions(REDnode PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(REDnode PRIVATE /W4 /utf-8 /MP)
target_compile_definitions(REDnode PRIVATE
  REDNODE_VERSION="${PROJECT_VERSION}"
  REDNODE_VERSION_MAJOR=${PROJECT_VERSION_MAJOR}
  REDNODE_VERSION_MINOR=${PROJECT_VERSION_MINOR}
  REDNODE_VERSION_PATCH=${PROJECT_VERSION_PATCH})

# Stage the plugin with the same layout it has in the game folder:
# red4ext/plugins/REDnode/REDnode.dll and red4ext/plugins/REDnode/Scripts/*.reds
set(REDNODE_STAGE_DIR "${CMAKE_BINARY_DIR}/dist/red4ext/plugins/REDnode")
add_custom_command(
  TARGET REDnode POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${REDNODE_STAGE_DIR}/Scripts"
  COMMAND ${CMAKE_COMMAND} -E copy_if_different "$<TARGET_FILE:REDnode>" "${REDNODE_STAGE_DIR}/"
  COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/scripts" "${REDNODE_STAGE_DIR}/Scripts"
)

# Unit tests for code that does not need the game. Run by tools/build-native.ps1.
add_executable(REDnode_tests tests/windows_test.cpp src/overlay/windows.cpp)
target_link_libraries(REDnode_tests PRIVATE RED4ext::SDK)
target_compile_definitions(REDnode_tests PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(REDnode_tests PRIVATE /W4 /utf-8)

add_executable(REDnode_json_tests tests/json_test.cpp)
target_compile_options(REDnode_json_tests PRIVATE /W4 /utf-8)

add_executable(REDnode_audio_tests tests/audio_test.cpp)
target_include_directories(REDnode_audio_tests SYSTEM PRIVATE ${miniaudio_SOURCE_DIR})
target_compile_definitions(REDnode_audio_tests PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX
  REDNODE_SOUNDS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../packages/overlay/apps/sound-test/sounds")
target_compile_options(REDnode_audio_tests PRIVATE /W4 /utf-8)

add_executable(REDnode_capture_tests tests/capture_test.cpp)
target_compile_definitions(REDnode_capture_tests PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(REDnode_capture_tests PRIVATE /W4 /utf-8)
