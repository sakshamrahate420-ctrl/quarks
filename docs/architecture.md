# Architecture and implementation notes

## Components

1. `quantumlab_core` is a standard C++20 static library. It owns all quantum gate operations, validation, probability calculation, random measurement sampling, state snapshots, and numerical checks.
2. `wasm_bindings.cpp` adapts plain JavaScript objects to C++ request types using Emscripten `val`, invokes the same engine, and returns plain JavaScript objects. No pointers or buffers escape to application code.
3. `web-demo/quantumlab-api.js` loads the generated ESM module and exposes `createSimulator()` and `simulateCircuit(request)`.
4. `web-demo/app.js` and the accompanying HTML/CSS provide a minimal static-page example.
5. `tests/test_quantum.cpp` tests the core. `tests/wasm_binding_smoke.mjs` checks that the exported WASM bindings preserve the protocol.

## Simulation algorithm

A circuit with `n` qubits has `2^n` complex amplitudes, initially `[1+0i, 0+0i, ...]`. Qubit `q` maps to bit `q` of a state-vector index. Fixed and parameterized one-qubit gates update amplitude pairs whose indices differ by `1 << q`; controlled gates operate only on basis states matching their control bits. The gate set includes common phase and rotation gates, CNOT, CZ, SWAP, CCNOT, mid-circuit measurement, and conditional X/Z feed-forward.

Circuits with measurement are simulated as independent shot trajectories. Each trajectory starts in `|0...0⟩`, collapses at every measurement, updates its classical register, and evaluates later conditional gates using that register. Final probabilities are averaged over trajectories, while measurement and classical-register outcomes are counted separately. A single statevector is not returned for this mixed ensemble.

After each gate, the engine checks for finite amplitudes and verifies the state norm is within `1e-10` of one. The final probability at index `i` is `std::norm(amplitude[i])`.

## Memory model and hard limits

Raw state-vector memory is `16 * 2^n` bytes. The default runtime cap is 16 qubits, with a hard cap of 20. The engine also caps gates at 10,000, measurement shots at 1,000,000 (default 100,000), and the estimated raw amplitude memory stored in snapshots at 32 MiB. A browser can consume substantially more memory than the raw state storage because JavaScript arrays and objects add overhead. Snapshot preflight must run before allocation.

Configuration may lower defaults or raise a default up to a documented hard cap; it cannot exceed hard caps. These caps are safety limits, not benchmark-backed claims of performance.

## Error boundary

The public API converts validation and simulation errors into a stable response object. Module loading failure is distinct: `createSimulator()` rejects if its WASM asset cannot load or its exports do not match protocol v1. The core library uses `QuantumError` internally; errors do not expose native pointers or buffers.

## Browser responsiveness

WASM execution is synchronous on the calling thread in this initial design. A promise-returning wrapper does not offload the computation. Large circuits may block the page, so the initial caps and disabled-by-default snapshots are important. A future Web Worker can import the same ESM factory and exchange versioned request/response objects; the core need not be rewritten. Pthreads are intentionally not enabled because they add browser deployment requirements.
