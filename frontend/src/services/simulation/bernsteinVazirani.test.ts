import { describe, expect, it } from "vitest";
import { createBernsteinVaziraniCircuit } from "../../features/circuit/bernsteinVazirani";
import {
  simulateProductTensorCircuit,
  supportsProductTensorCircuit,
} from "./ProductTensorSimulator";

function recoveredInputProbability(counts: Record<string, number>, secret: string, shots: number): number {
  const recovered = Object.entries(counts)
    .filter(([bits]) => bits.slice(-secret.length) === secret)
    .reduce((total, [, count]) => total + count, 0);
  return recovered / shots;
}

describe("Bernstein-Vazirani circuit", () => {
  it("recovers every secret for n=2 through n=10 with probability one", () => {
    const shots = 8;
    let testedSecrets = 0;
    for (let n = 2; n <= 10; n += 1) {
      for (let value = 0; value < 2 ** n; value += 1) {
        const secret = value.toString(2).padStart(n, "0");
        const circuit = createBernsteinVaziraniCircuit(secret);
        expect(supportsProductTensorCircuit(circuit.numQubits, circuit.gates)).toBe(true);
        const result = simulateProductTensorCircuit({ circuit, shots, seed: value + n }, circuit.gates);
        expect(recoveredInputProbability(result.measurementCounts, secret, shots)).toBeCloseTo(1, 12);
        testedSecrets += 1;
      }
    }
    expect(testedSecrets).toBe(2044);
  }, 30_000);

  it("runs a random secret at the editor maximum and reports elapsed time", () => {
    const inputQubits = 27;
    const secret = Array.from({ length: inputQubits }, () => Math.random() < 0.5 ? "0" : "1").join("");
    const circuit = createBernsteinVaziraniCircuit(secret);
    const shots = 1024;
    const started = performance.now();
    const result = simulateProductTensorCircuit({ circuit, shots, seed: 0xB37E57 }, circuit.gates);
    const elapsedMs = performance.now() - started;

    expect(circuit.numQubits).toBe(28);
    expect(recoveredInputProbability(result.measurementCounts, secret, shots)).toBeCloseTo(1, 12);
    console.info(`Bernstein-Vazirani max run: n=${inputQubits}, total qubits=${circuit.numQubits}, secret=${secret}, shots=${shots}, elapsed=${elapsedMs.toFixed(2)} ms`);
  }, 10_000);
});
