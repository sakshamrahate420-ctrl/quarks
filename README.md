# QuantumLab

QuantumLab is a small state-vector quantum circuit simulator. Its simulation engine is written in C++20 and can be compiled both as a native library for testing and as WebAssembly for in-browser execution. The website is a separate static HTML/CSS/JavaScript client.

**There is no server-side simulation.** The browser calls a thin Embind API, which calls the same C++ engine used by native tests. JavaScript does not implement quantum gates.

## Features

- X, Y, Z, H, S, T and inverse phase gates; parameterized RX/RY/RZ rotations; CNOT, CZ, SWAP and Toffoli gates.
- Complex double-precision state-vector amplitudes.
- Final basis-state probabilities.
- Seeded terminal-measurement sampling.
- Per-shot mid-circuit measurement, state collapse, classical-bit output, and conditional X/Z feed-forward.
- Optional post-gate state-vector snapshots.
- Versioned request/response protocol with structured error codes.
- Configurable runtime limits with hard safety ceilings.
- Parameterized and controlled multi-qubit gates used in common quantum circuit workflows.
- Native CMake/CTest tests and an Emscripten target.

## Quick start: native build

Requirements: CMake 3.20+, a C++20 compiler, and a supported native build tool.

```bash
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Debug -DQUANTUMLAB_BUILD_TESTS=ON
cmake --build build/native --parallel
ctest --test-dir build/native --output-on-failure
```

## WebAssembly build

Install and activate the Emscripten SDK (`emsdk`) first. Follow the official [Emscripten installation instructions](https://emscripten.org/docs/getting_started/downloads.html). From the activated SDK shell, run:

```bash
emcmake cmake -S . -B build/wasm -DCMAKE_BUILD_TYPE=Release -DQUANTUMLAB_BUILD_WASM=ON -DQUANTUMLAB_BUILD_TESTS=ON
cmake --build build/wasm --parallel
```

The WASM target should emit `build/wasm/quantumlab_wasm.mjs` and its companion `build/wasm/quantumlab_wasm.wasm`. The generated output is not checked into source control.

If you want to run the optional Emscripten binding smoke test under Node.js, use the instructions in [`docs/building.md`](docs/building.md). Node.js is only used as a test runner or, optionally, for local static preview; it is not an application backend.

## Browser demo

After building WASM, serve the **repository root** through a static HTTP server and open `web-demo/index.html`. For example, open the project folder in VS Code and use a static Live Server extension. Keep the `build/wasm/` directory at the expected relative path, or adjust the import in `web-demo/quantumlab-api.js` to match your website's asset layout.

Do not open the page via `file://`: ES module imports and fetching the WASM asset require a local or hosted HTTP(S) origin.

### Windows quick start in this workspace

Double-click [`run-demo.bat`](run-demo.bat). It rebuilds the WebAssembly module, copies the generated files to `build/wasm/`, and starts a local-only web server. Open <http://127.0.0.1:8000/web-demo/> in your browser. Keep the command window open while using the demo and press Ctrl+C there to stop the server.

This launcher uses the Emscripten SDK in the workspace's sibling `emsdk/` folder and the prepared Ninja executable in `.tools/pythonpkgs/bin/`. The standard build commands above remain available for other platforms.

## Public JavaScript API

```js
import { createSimulator } from "./quantumlab-api.js";
const simulator = await createSimulator();
const result = await simulator.simulateCircuit(request);
```

- Successful simulations resolve to `{ success: true, ... }`.
- Invalid circuits resolve to `{ success: false, error: { code, message }, ... }`.
- Module loading and configuration errors reject `createSimulator()`.
- The API returns plain JavaScript values, not exposed C++ pointers or raw memory views.

See [`docs/protocol-v1.md`](docs/protocol-v1.md), [`docs/architecture.md`](docs/architecture.md), and [`docs/building.md`](docs/building.md) for the contract and build details.

## Scope and limitations

This is an ideal state-vector simulator. It does not model hardware noise, density matrices, reset, arbitrary classical expressions, quantum hardware, or fault tolerance. Mid-circuit measurements run as independent shot trajectories; conditional X/Z gates can read the classical bits written by those measurements. Dense state-vector simulation grows exponentially with qubit count; resource limits are part of the safety model, not an optional optimization. No performance claims are made without benchmarks on the target machine/browser.

## Status

The source is designed for native testing and Emscripten compilation. Run the commands above and consult the build report for the environment-specific verification performed when this project was packaged. A WASM artifact must be built with an installed Emscripten SDK before the browser demo can run.


## QUARKS Circuit IDE frontend

The project includes the QUARKS drag-and-drop circuit composer in `frontend/`. It uses the existing QuantumLab C++/WebAssembly engine through the stable protocol adapter in `web-demo/quantumlab-api.js`; circuits and simulation stay local in the browser.

### Launch on Windows

Run `run-demo.bat` from File Explorer or a terminal. The script builds the WASM engine, installs the frontend packages on first launch, and starts Vite at <http://127.0.0.1:5173/>. Keep the terminal open while using the IDE. In the editor, **Focus canvas** hides the gate palette and inspector; **Show panels** brings them back.

### Launch from VS Code

Open the `quantumlab` folder in VS Code and run `run-demo.bat` in the integrated terminal. For frontend-only work after the WASM files have been built, open a terminal in `frontend/`, run `npm install` once, then `npm run dev`.
