import {
  createCircuit,
  createCnotGate,
  createGate,
  createMeasurementGate,
  MAX_QUBITS,
} from "./model";
import type { Circuit } from "./types";

export function createBernsteinVaziraniCircuit(secret: string): Circuit {
  if (!/^[01]+$/.test(secret) || secret.length < 2 || secret.length >= MAX_QUBITS) {
    throw new Error(`Secret must contain 2 to ${MAX_QUBITS - 1} binary digits.`);
  }

  const inputQubits = secret.length;
  const ancilla = inputQubits;
  const circuit = createCircuit(`Bernstein-Vazirani (s=${secret})`, inputQubits + 1, inputQubits);
  const gates = [createGate("X", ancilla, 0)];

  for (let qubit = 0; qubit <= inputQubits; qubit += 1) {
    gates.push(createGate("H", qubit, 1));
  }

  for (let qubit = 0; qubit < inputQubits; qubit += 1) {
    if (secret[inputQubits - qubit - 1] === "1") {
      gates.push(createCnotGate(qubit, ancilla, 2 + qubit));
    }
  }

  for (let qubit = 0; qubit < inputQubits; qubit += 1) {
    gates.push(createGate("H", qubit, 2 + inputQubits));
  }
  for (let qubit = 0; qubit < inputQubits; qubit += 1) {
    gates.push(createMeasurementGate(qubit, qubit, 3 + inputQubits));
  }

  circuit.gates = gates;
  return circuit;
}
