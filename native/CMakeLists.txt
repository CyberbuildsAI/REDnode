cmake_minimum_required(VERSION 3.25)

project(REDnode VERSION 0.9.0 LANGUAGES CXX)

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
)
target_link_libraries(REDnode PRIVATE RED4ext::SDK d3d12 d3dcompiler)
target_compile_definitions(REDnode PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_compile_options(REDnode PRIVATE /W4 /utf-8 /MP)

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
