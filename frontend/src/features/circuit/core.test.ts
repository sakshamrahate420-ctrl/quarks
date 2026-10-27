import { describe, expect, it } from "vitest";
import {
  addClassicalBit,
  addQubit,
  createCircuit,
  createCnotGate,
  createGate,
  createMeasurementGate,
  removeClassicalBit,
  removeQubit,
  validateCircuit,
} from "./model";
import { CIRCUIT_EXAMPLES } from "./examples";
import {
  canRedoCircuit,
  canUndoCircuit,
  commitCircuit,
  createCircuitHistory,
  redoCircuit,
  undoCircuit,
} from "./history";
import { generateOpenQasm, generateQiskitPython } from "../../services/codegen/circuitCode";
import { parseCircuitFile, buildCircuitExportRows } from "../../services/storage/circuitFiles";
import { simulateCircuit } from "../../services/simulation/SimulationAdapter";

function near(actual: number, expected: number, precision = 10): void {
  expect(actual).toBeCloseTo(expected, precision);
}

describe("QUARKS circuit model", () => {
  it("accepts the five gates and rejects invalid CNOT placement", () => {
    const circuit = createCircuit("Gate coverage", 2, 2);
    circuit.gates = [
      createGate("X", 0, 0),
      createGate("Y", 0, 1),
      createGate("Z", 0, 2),
      createGate("H", 0, 3),
      createCnotGate(0, 1, 4),
      createMeasurementGate(1, 1, 5),
    ];
    expect(validateCircuit(circuit).valid).toBe(true);
    expect(() => createCnotGate(1, 1, 1)).toThrow(/different qubits/);
  });

  it("adds and removes qubits while remapping surviving gate references", () => {
    let circuit = createCircuit("Remapping", 3, 3);
    circuit.gates = [
      createGate("X", 2, 0),
      createCnotGate(0, 2, 1),
      createMeasurementGate(2, 2, 2),
    ];
    circuit = removeQubit(circuit, 1);
    expect(circuit.numQubits).toBe(2);
    expect(circuit.gates).toEqual([
      expect.objectContaining({ type: "X", target: 1 }),
      expect.objectContaining({ type: "CNOT", control: 0, target: 1 }),
      expect.objectContaining({ type: "MEASURE", qubit: 1 }),
    ]);
    expect(validateCircuit(circuit).valid).toBe(true);
    expect(addQubit(circuit).numQubits).toBe(3);
  });

  it("removes measured classical bits and adjusts later mappings", () => {
    let circuit = createCircuit("Classical remapping", 2, 3);
    circuit.gates = [
      createMeasurementGate(0, 0, 0),
      createMeasurementGate(1, 2, 1),
    ];
    circuit = removeClassicalBit(circuit, 0);
    expect(circuit.numClassicalBits).toBe(2);
    expect(circuit.gates).toEqual([
      expect.objectContaining({ type: "MEASURE", qubit: 1, classicalBit: 1 }),
    ]);
    expect(addClassicalBit(circuit).numClassicalBits).toBe(3);
  });

  it("restores snapshots with undo and redo", () => {
    const first = createCircuit("History");
    const initial = createCircuitHistory(first);
    const changed = { ...first, name: "Changed" };
    const afterEdit = commitCircuit(initial, changed);
    expect(canUndoCircuit(afterEdit)).toBe(true);
    const undone = undoCircuit(afterEdit);
    expect(undone.present.name).toBe("History");
    expect(canRedoCircuit(undone)).toBe(true);
    expect(redoCircuit(undone).present.name).toBe("Changed");
  });
});

describe("QUARKS code generation and circuit files", () => {
  it("updates generated OpenQASM and Python from the current ordered gates", () => {
    const circuit = createCircuit("Generated code", 2, 2);
    circuit.gates = [
      createGate("H", 0, 0),
      createCnotGate(0, 1, 1),
      createMeasurementGate(0, 0, 2),
      createMeasurementGate(1, 1, 2),
    ];
    const qasm = generateOpenQasm(circuit);
    const python = generateQiskitPython(circuit);
    expect(qasm).toContain("OPENQASM 3.0;");
    expect(qasm).toContain("h(q[0]);");
    expect(qasm).toContain("cx(q[0], q[1]);");
    expect(qasm).toContain("c[1] = measure q[1];");
    expect(python).toContain("qc.h(q[0])");
    expect(python).toContain("qc.cx(q[0], q[1])");
    expect(python).toContain("qc.measure(q[1], c[1])");
  });

  it("round-trips versioned circuit JSON and rejects malformed content", () => {
    const circuit = createCircuit("Round trip");
    const contents = buildCircuitExportRows(circuit);
    expect(parseCircuitFile(contents)).toEqual(circuit);
    expect(() => parseCircuitFile("{broken")).toThrow(/valid JSON/);
    expect(() => parseCircuitFile(JSON.stringify({ schemaVersion: 9 }))).toThrow(
      /supported QUARKS circuit file/,
    );
  });
});

describe("QUARKS statevector simulator", () => {
  it("simulates X, Z, H, interference, and Bell-state probabilities", async () => {
    const x = CIRCUIT_EXAMPLES.find((example) => example.id === "x-gate");
    const h = CIRCUIT_EXAMPLES.find((example) => example.id === "superposition");
    const bell = CIRCUIT_EXAMPLES.find((example) => example.id === "bell-state");
    const interference = CIRCUIT_EXAMPLES.find(
      (example) => example.id === "interference",
    );
    if (!x || !h || !bell || !interference) throw new Error("Missing examples.");

    const xResult = await simulateCircuit({ circuit: x.circuit, shots: 128 });
    expect(xResult.probabilities[0]?.probability).toBe(0);
    expect(xResult.probabilities[1]?.probability).toBe(1);
    expect(xResult.isMock).toBe(true);

    const hResult = await simulateCircuit({ circuit: h.circuit, shots: 128 });
    near(hResult.probabilities[0]?.probability ?? 0, 0.5);
    near(hResult.probabilities[1]?.probability ?? 0, 0.5);
    expect(Object.values(hResult.measurementCounts).reduce((a, b) => a + b, 0)).toBe(128);

    const bellResult = await simulateCircuit({ circuit: bell.circuit, shots: 1000 });
    near(bellResult.probabilities[0]?.probability ?? 0, 0.5);
    near(bellResult.probabilities[1]?.probability ?? 0, 0);
    near(bellResult.probabilities[2]?.probability ?? 0, 0);
    near(bellResult.probabilities[3]?.probability ?? 0, 0.5);
    near(
      bellResult.probabilities.reduce((sum, item) => sum + item.probability, 0),
      1,
    );
    expect(Object.keys(bellResult.measurementCounts).every((bits) => bits === "00" || bits === "11")).toBe(true);

    const interferenceResult = await simulateCircuit({
      circuit: interference.circuit,
      shots: 100,
    });
    near(interferenceResult.probabilities[0]?.probability ?? 0, 0);
    near(interferenceResult.probabilities[1]?.probability ?? 0, 1);
  });

  it("returns deterministic counts for a fixed seed", async () => {
    const example = CIRCUIT_EXAMPLES.find(
      (entry) => entry.id === "superposition",
    );
    if (!example) throw new Error("Missing superposition example.");
    const first = await simulateCircuit({
      circuit: example.circuit,
      shots: 200,
      seed: 1234,
    });
    const second = await simulateCircuit({
      circuit: example.circuit,
      shots: 200,
      seed: 1234,
    });
    expect(first.measurementCounts).toEqual(second.measurementCounts);
  });
});
