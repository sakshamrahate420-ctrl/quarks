cmake_minimum_required(VERSION 3.20)
project(QuantumLab VERSION 1.0.0 LANGUAGES CXX)

option(QUANTUMLAB_BUILD_TESTS "Build unit tests (native or run under Node after WASM compilation)" ON)
option(QUANTUMLAB_BUILD_WASM "Build the Emscripten WebAssembly module" OFF)
option(QUANTUMLAB_ENABLE_SANITIZERS "Enable AddressSanitizer and UBSan on supported native compilers" OFF)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(QUANTUMLAB_CORE_SOURCES
    src/simulator.cpp
    src/measurement.cpp
    src/validation.cpp
)

add_library(quantumlab_core STATIC ${QUANTUMLAB_CORE_SOURCES})
target_include_directories(quantumlab_core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}/include")
target_compile_features(quantumlab_core PUBLIC cxx_std_20)

if(MSVC)
    target_compile_options(quantumlab_core PRIVATE /W4 /permissive-)
else()
    target_compile_options(quantumlab_core PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion)
endif()

if(EMSCRIPTEN)
    # Catching C++ exceptions is part of the error protocol, so enable it in
    # both compilation and linking for every Emscripten target.
    target_compile_options(quantumlab_core PRIVATE -fexceptions)
endif()

if(QUANTUMLAB_ENABLE_SANITIZERS AND NOT EMSCRIPTEN AND NOT MSVC)
    target_compile_options(quantumlab_core PUBLIC -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(quantumlab_core PUBLIC -fsanitize=address,undefined)
endif()

if(QUANTUMLAB_BUILD_TESTS)
    enable_testing()
    if(EMSCRIPTEN)
        add_executable(quantumlab_core_tests_wasm tests/test_quantum.cpp)
        target_link_libraries(quantumlab_core_tests_wasm PRIVATE quantumlab_core)
        target_link_options(quantumlab_core_tests_wasm PRIVATE "-fexceptions" "-sENVIRONMENT=node" "-sEXIT_RUNTIME=1")
        find_program(QUANTUMLAB_NODE_EXECUTABLE node)
        if(QUANTUMLAB_NODE_EXECUTABLE)
            add_test(NAME quantumlab_wasm_core_tests
                     COMMAND "${QUANTUMLAB_NODE_EXECUTABLE}" "$<TARGET_FILE:quantumlab_core_tests_wasm>")
        else()
            message(WARNING "Node.js not found; quantumlab_core_tests_wasm will build but CTest cannot run it.")
        endif()
    else()
        add_executable(quantumlab_tests tests/test_quantum.cpp)
        target_link_libraries(quantumlab_tests PRIVATE quantumlab_core)
        if(MSVC)
            target_compile_options(quantumlab_tests PRIVATE /W4 /permissive-)
        else()
            target_compile_options(quantumlab_tests PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wsign-conversion)
        endif()
        add_test(NAME quantumlab_native_tests COMMAND quantumlab_tests)
    endif()
endif()

if(QUANTUMLAB_BUILD_WASM)
    if(NOT EMSCRIPTEN)
        message(FATAL_ERROR "QUANTUMLAB_BUILD_WASM=ON requires the Emscripten toolchain. Configure with emcmake.")
    endif()
    add_executable(quantumlab_wasm src/wasm_bindings.cpp)
    target_link_libraries(quantumlab_wasm PRIVATE quantumlab_core)
    target_compile_options(quantumlab_wasm PRIVATE -Wall -Wextra -Wpedantic -fexceptions)
    set_target_properties(quantumlab_wasm PROPERTIES
        OUTPUT_NAME "quantumlab_wasm"
        SUFFIX ".mjs"
    )
    target_link_options(quantumlab_wasm PRIVATE
        "--bind"
        "--no-entry"
        "-fexceptions"
        "-sMODULARIZE=1"
        "-sEXPORT_ES6=1"
        "-sEXPORT_NAME=createQuantumLabModule"
        "-sENVIRONMENT=web,worker,node"
        "-sALLOW_MEMORY_GROWTH=1"
        "-sFILESYSTEM=0"
        "-sASSERTIONS=1"
    )
    if(QUANTUMLAB_BUILD_TESTS)
        find_program(QUANTUMLAB_NODE_EXECUTABLE node)
        if(QUANTUMLAB_NODE_EXECUTABLE)
            add_test(NAME quantumlab_wasm_binding_smoke
                COMMAND "${QUANTUMLAB_NODE_EXECUTABLE}"
                        "${CMAKE_CURRENT_SOURCE_DIR}/tests/wasm_binding_smoke.mjs"
                        "$<TARGET_FILE:quantumlab_wasm>")
        endif()
    endif()
elseif(EMSCRIPTEN)
    message(FATAL_ERROR "Emscripten toolchain detected, but QUANTUMLAB_BUILD_WASM is OFF. Reconfigure with -DQUANTUMLAB_BUILD_WASM=ON.")
endif()
