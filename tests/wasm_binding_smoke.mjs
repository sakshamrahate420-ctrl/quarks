import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2] ?? path.resolve("build/wasm/quantumlab_wasm.mjs");
const { default: createQuantumLabModule } = await import(pathToFileURL(path.resolve(modulePath)).href);
const module = await createQuantumLabModule();
assert.equal(module.getProtocolVersion(), 1, "protocol version export");

const bellRequest = {
  protocol_version: 1,
  num_qubits: 2,
  gates: [
    { type: "H", target: 0 },
    { type: "CNOT", control: 0, target: 1 },
  ],
  options: { include_statevector: true, include_snapshots: true, measurement_shots: 100, seed: 7 },
};
const bell = module.simulateCircuit(bellRequest, {});
assert.equal(bell.success, true, "Bell circuit succeeds");
assert.equal(bell.protocol_version, 1);
assert.deepEqual(bell.probabilities.map((p) => Math.round(p * 1e10) / 1e10), [0.5, 0, 0, 0.5]);
assert.deepEqual(bell.statevector.real.map((a) => Math.round(a * 1e10) / 1e10), [0.7071067812, 0, 0, 0.7071067812]);
assert.deepEqual(bell.statevector.imag.map((a) => Math.round(a * 1e10) / 1e10), [0, 0, 0, 0]);
assert.equal(bell.snapshots.length, 2);
assert.deepEqual(bell.measurement_counts, { "00": 51, "11": 49 }, "seeded WASM measurement golden result");
assert.equal(Object.values(bell.measurement_counts).reduce((sum, count) => sum + count, 0), 100);

const badGate = module.simulateCircuit({ protocol_version: 1, num_qubits: 1, gates: [{ type: "BOGUS", target: 0 }] }, {});
assert.equal(badGate.success, false);
assert.equal(badGate.error.code, "INVALID_GATE");

const badCnot = module.simulateCircuit({ protocol_version: 1, num_qubits: 2, gates: [{ type: "CNOT", control: 0, target: 0 }] }, {});
assert.equal(badCnot.success, false);
assert.equal(badCnot.error.code, "INVALID_CNOT");

console.log("QuantumLab WASM binding smoke tests passed.");
