# Build verification report for this packaged source snapshot

Verification was run in the packaging environment on 2026-10-26.

## Executed successfully

- Native configure/build: CMake 3.31.6, GNU C++ 14.2.0, C++20, Debug configuration.
- Native test command: `ctest --test-dir build/native --output-on-failure` — 1/1 CTest test passed.
- Direct native test executable — all checks passed (the executable prints the assertion/check count).
- Sanitizer configure/build: AddressSanitizer + UndefinedBehaviorSanitizer enabled.
- Sanitizer test command: `ctest --test-dir build/sanitize --output-on-failure` — 1/1 CTest test passed.
- JavaScript syntax checks: `web-demo/quantumlab-api.js`, `web-demo/app.js`, and `tests/wasm_binding_smoke.mjs` passed `node --check`.

## Not executed in this environment

Emscripten was not installed (`emcmake` was not found). Therefore the `.mjs`/`.wasm` artifacts were not generated, the Emscripten C++ binding was not compiled here, the WASM CTest suite was not run, and the browser demo was not launched. Those steps are documented in [`building.md`](building.md) and should be run after activating an Emscripten SDK.

No WASM build or browser test is claimed as passing in this report.
