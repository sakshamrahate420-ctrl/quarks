import { createCircuit, createId, createMeasurementGate } from "./model";
import type { Circuit, CircuitGate } from "./types";

export interface CircuitExample {
  id: string;
  name: string;
  summary: string;
  difficulty: "Starter" | "Beginner" | "Intermediate";
  circuit: Circuit;
}

function makeExample(
  id: string,
  name: string,
  summary: string,
  difficulty: CircuitExample["difficulty"],
  gates: (circuit: Circuit) => CircuitGate[],
  qubits = 2,
): CircuitExample {
  const circuit = createCircuit(name, qubits, qubits);
  circuit.id = `example-${id}`;
  circuit.gates = gates(circuit);
  return { id, name, summary, difficulty, circuit };
}

function gate(
  circuit: Circuit,
  type: "X" | "Y" | "Z" | "H",
  target: number,
  column: number,
): CircuitGate {
  return { id: createId("gate"), type, target, column };
}

function measure(
  circuit: Circuit,
  qubit: number,
  classicalBit: number,
  column: number,
): CircuitGate {
  return createMeasurementGate(qubit, classicalBit, column);
}

export const CIRCUIT_EXAMPLES: CircuitExample[] = [
  makeExample(
    "x-gate",
    "A bit flip",
    "Apply X to flip |0⟩ to |1⟩.",
    "Starter",
    (circuit) => [gate(circuit, "X", 0, 0), measure(circuit, 0, 0, 1)],
    1,
  ),
  makeExample(
    "superposition",
    "First superposition",
    "H creates equal amplitudes for |0⟩ and |1⟩.",
    "Starter",
    (circuit) => [gate(circuit, "H", 0, 0), measure(circuit, 0, 0, 1)],
    1,
  ),
  makeExample(
    "bell-state",
    "Bell pair",
    "Entangle two qubits with H and CNOT.",
    "Beginner",
    (circuit) => [
      gate(circuit, "H", 0, 0),
      { id: createId("gate"), type: "CNOT", control: 0, target: 1, column: 1 },
      measure(circuit, 0, 0, 2),
      measure(circuit, 1, 1, 2),
    ],
  ),
  makeExample(
    "interference",
    "Quantum interference",
    "H–Z–H converts phase information into a bit flip.",
    "Beginner",
    (circuit) => [
      gate(circuit, "H", 0, 0),
      gate(circuit, "Z", 0, 1),
      gate(circuit, "H", 0, 2),
      measure(circuit, 0, 0, 3),
    ],
    1,
  ),
  makeExample(
    "multi-gate",
    "Circuit in motion",
    "Combine superposition, entanglement, and a second-qubit operation.",
    "Intermediate",
    (circuit) => [
      gate(circuit, "H", 0, 0),
      { id: createId("gate"), type: "CNOT", control: 0, target: 1, column: 1 },
      gate(circuit, "X", 1, 2),
      gate(circuit, "H", 0, 3),
      measure(circuit, 0, 0, 4),
      measure(circuit, 1, 1, 4),
    ],
  ),
];

export function cloneCircuit(circuit: Circuit, name = circuit.name): Circuit {
  const clone = structuredClone(circuit);
  const now = new Date().toISOString();
  clone.id = createId("circuit");
  clone.name = name;
  clone.createdAt = now;
  clone.updatedAt = now;
  clone.gates = clone.gates.map((gate) => ({ ...gate, id: createId("gate") }));
  return clone;
}
