# QuantumLab

QUARKS is a quantum circuit composer and simulator powered by a self-built C++ engine.

QuantumLab is a small state-vector quantum circuit simulator. Its simulation engine is written in C++20 and can be compiled both as a native library for testing and as WebAssembly for in-browser execution. The website is a separate static HTML/CSS/JavaScript client.

**There is no server-side simulation.** Circuits of up to 16 qubits in the editor use the C++20 engine compiled to WebAssembly. Selected larger circuits use bounded TypeScript fallbacks: a sparse state map, or a product-state tensor representation that samples outcomes without expanding the full basis.

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

The composer supports up to 28 qubits for building and exporting circuits. The dense C++/WebAssembly simulator is capped at 16 qubits in the editor. Above that, circuits which remain factorizable into independent qubit states use a bond-dimension-one tensor-network representation and sample the output distribution without expanding the full basis. This includes Bernstein-Vazirani's CNOT oracle when its target ancilla is in an X eigenstate. Other circuits use a sparse state-vector path for at most 65,536 occupied basis states, with a resource message above that limit. These large-circuit modes omit per-gate snapshots; tensor-network graphs show sampled outcomes rather than every possible basis state. A dense 28-qubit statevector alone needs about 4 GiB for complex amplitudes, before simulator snapshots and browser-side data.

### Bernstein-Vazirani example and tests

The Dashboard includes a changeable secret input (2 to 27 bits). **Open Bernstein-Vazirani circuit** creates an editable circuit with one extra ancilla qubit, so a 27-bit secret uses the editor's maximum of 28 qubits. The circuit prepares the ancilla in `|->`, applies an oracle CNOT for each `1` in the secret, applies Hadamards to the input register, and measures the input qubits. The measured input bitstring is the secret. At 28 qubits, the product-state tensor path recognizes that the ancilla is an X eigenstate and applies each CNOT as a phase on its control, preserving the factorized representation.

The native test `tests/test_bernstein_vazirani.cpp` runs every secret for `n=2..10` through the C++ state-vector simulator and asserts that total probability on the secret input is 1 within `1e-10`. The frontend test `frontend/src/services/simulation/bernsteinVazirani.test.ts` exercises the large product-state route for all the same secrets, then benchmarks a random 27-bit secret (28 total qubits, 1024 shots) and prints the elapsed time.

Run the native checks with `cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release -DQUANTUMLAB_BUILD_TESTS=ON`, `cmake --build build/native --parallel`, and `ctest --test-dir build/native --output-on-failure`. Run the focused frontend Bernstein-Vazirani tests with `npm test --prefix frontend -- src/services/simulation/bernsteinVazirani.test.ts --reporter=verbose --silent=false`.

### Launch on Windows

Run `run-demo.bat` from File Explorer or a terminal. The script builds the WASM engine, installs the frontend packages on first launch, and starts Vite at <http://127.0.0.1:5173/>. Keep the terminal open while using the IDE. In the editor, **Focus canvas** hides the gate palette and inspector; **Show panels** brings them back.

### Launch from VS Code

Open the `quantumlab` folder in VS Code and run `run-demo.bat` in the integrated terminal. For frontend-only work after the WASM files have been built, open a terminal in `frontend/`, run `npm install` once, then `npm run dev`.


## Publish the public website

A GitHub Actions workflow builds the C++ engine to WebAssembly, builds the QUARKS frontend, and deploys it to GitHub Pages whenever changes reach `main`. To turn on the public site, open the repository's **Settings → Pages**, set **Source** to **GitHub Actions**, and wait for the workflow in the **Actions** tab to finish.

For this repository, the Pages URL is `https://sakshamrahate420-ctrl.github.io/quarks/`. The site runs circuits locally in each visitor's browser; it does not require user accounts or a simulation server.
