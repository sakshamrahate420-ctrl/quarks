# Build, run and verify QuantumLab

## Native build: Linux/macOS

Requirements: CMake 3.20+ and a C++20 compiler.

```bash
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Debug -DQUANTUMLAB_BUILD_TESTS=ON
cmake --build build/native --parallel
ctest --test-dir build/native --output-on-failure
```

Run the test executable directly if desired:

```bash
./build/native/quantumlab_tests
```

Windows (Visual Studio generator) example:

```powershell
cmake -S . -B build/native -DQUANTUMLAB_BUILD_TESTS=ON
cmake --build build/native --config Debug
ctest --test-dir build/native -C Debug --output-on-failure
```

Optional AddressSanitizer/UBSan build on a supported native compiler:

```bash
cmake -S . -B build/sanitize -DCMAKE_BUILD_TYPE=Debug -DQUANTUMLAB_BUILD_TESTS=ON -DQUANTUMLAB_ENABLE_SANITIZERS=ON
cmake --build build/sanitize --parallel
ctest --test-dir build/sanitize --output-on-failure
```

## Emscripten install and build

Install the official Emscripten SDK and activate its environment in the current terminal. Follow the [official setup documentation](https://emscripten.org/docs/getting_started/downloads.html). `emcmake` provides the CMake toolchain integration.

```bash
emcmake cmake -S . -B build/wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DQUANTUMLAB_BUILD_WASM=ON \
  -DQUANTUMLAB_BUILD_TESTS=ON
cmake --build build/wasm --parallel
ctest --test-dir build/wasm --output-on-failure
```

With Node.js installed, CTest runs the same C++ core test suite compiled to WASM and the Embind binding smoke test. Expected generated module:

- `build/wasm/quantumlab_wasm.mjs`
- `build/wasm/quantumlab_wasm.wasm`

These generated files are not committed. Emscripten, the generated module and browser tooling are separate from the runtime simulation: the browser executes the WASM locally.

## WASM binding smoke test

The module was configured to support browser use and the Node.js test runtime. Node is a test runner here, not a server/backend. After the WASM build:

```bash
node tests/wasm_binding_smoke.mjs build/wasm/quantumlab_wasm.mjs
```

This verifies the Embind exports, Bell-state probabilities, snapshot count, measurement-count totals, and invalid-gate/CNOT errors.

## Browser demo

1. Build the WASM target successfully.
2. Serve the repository root with any static HTTP server or your IDE's static Live Server tool.
3. Open `web-demo/index.html` on that HTTP origin.
4. Click **Simulate circuit**. The result object should show a Bell state with probabilities `[0.5, 0, 0, 0.5]`, two snapshots and 1,000 measurements when the default request is used.

The server must expose `build/wasm/quantumlab_wasm.mjs` and `build/wasm/quantumlab_wasm.wasm` as static files. Do not use `file://` because modern browsers restrict module imports and WASM fetching from local file URLs.

For an existing separate website, copy `web-demo/quantumlab-api.js` and the generated `.mjs`/`.wasm` pair into that site's static assets, then update the import path at the top of `quantumlab-api.js`. The website should call the API rather than implementing gate operations itself.

## Troubleshooting

- **`emcmake` not found:** activate the Emscripten SDK in the current shell and verify `emcc --version` and `emcmake --version`.
- **CMake says Emscripten is required:** configure with `emcmake cmake ... -DQUANTUMLAB_BUILD_WASM=ON`; do not reuse a native build directory.
- **404 while loading `.wasm`:** serve from the repository root or fix the module's relative path. Confirm both generated files are reachable over HTTP.
- **MIME or fetch errors:** use a proper local static server and ensure `.wasm` is served as `application/wasm` when possible.
- **`module exports missing`:** ensure the JavaScript wrapper is importing the generated file from this version of the project and that CMake built with `--bind`.
- **Resource-limit error:** lower qubit count, measurement shots or number of snapshots. Snapshot budget applies to full amplitude vectors after each gate.
- **Main thread pauses:** expected for synchronous heavy WASM work; use smaller circuits or move the same module into a Web Worker in a future version.
- **Native tests pass but WASM tests fail:** first confirm the same revision and protocol are used, then inspect compiler flags, module paths and floating-point tolerance. Do not simply widen numerical tolerances without investigating.

## Build verification reporting

Record the exact compiler/CMake/Emscripten versions and command output for each release. A source checkout is not proof that the WASM target was built. Do not label a WASM artifact verified unless it was produced and the smoke test passed.
