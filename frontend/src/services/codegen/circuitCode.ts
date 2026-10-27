import { sortGates, validateCircuit } from "../../features/circuit/model";
import type {
  Circuit,
  CircuitGate,
  ClassicalRegister,
  QuantumRegister,
} from "../../features/circuit/types";

export function generateOpenQasm(circuit: Circuit): string {
  ensureValid(circuit);
  const qRegisters = normalizeQuantumRegisters(circuit);
  const cRegisters = normalizeClassicalRegisters(circuit);
  const lines = ["OPENQASM 3.0;", 'include "stdgates.inc";'];
  for (const register of qRegisters) {
    lines.push(`qubit[${register.size}] ${register.name};`);
  }
  for (const register of cRegisters) {
    lines.push(`bit[${register.size}] ${register.name};`);
  }
  if (circuit.gates.length > 0) lines.push("");
  for (const gate of sortGates(circuit.gates)) {
    lines.push(openQasmOperation(gate, qRegisters, cRegisters));
  }
  return lines.join("\n");
}

export function generateQiskitPython(circuit: Circuit): string {
  ensureValid(circuit);
  const qRegisters = normalizeQuantumRegisters(circuit);
  const cRegisters = normalizeClassicalRegisters(circuit);
  const lines = ["from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister", ""];
  for (const register of qRegisters) {
    lines.push(`${register.name} = QuantumRegister(${register.size}, "${register.name}")`);
  }
  for (const register of cRegisters) {
    lines.push(`${register.name} = ClassicalRegister(${register.size}, "${register.name}")`);
  }
  const registers = [...qRegisters, ...cRegisters].map((register) => register.name);
  lines.push(`qc = QuantumCircuit(${registers.join(", ")})`);
  lines.push("");
  for (const gate of sortGates(circuit.gates)) {
    lines.push(pythonOperation(gate, qRegisters, cRegisters));
  }
  lines.push("");
  lines.push("print(qc.draw())");
  return lines.join("\n");
}

function openQasmOperation(
  gate: CircuitGate,
  qRegisters: QuantumRegister[],
  cRegisters: ClassicalRegister[],
): string {
  switch (gate.type) {
    case "X":
    case "Y":
    case "Z":
    case "H":
    case "S":
    case "SDG":
    case "T":
    case "TDG":
      return `${gate.type.toLowerCase()}(${quantumRef(gate.target, qRegisters)});`;
    case "RX":
    case "RY":
    case "RZ":
      return `${gate.type.toLowerCase()}(${formatNumber(gate.angle)}, ${quantumRef(gate.target, qRegisters)});`;
    case "CNOT":
      return `cx(${quantumRef(gate.control, qRegisters)}, ${quantumRef(gate.target, qRegisters)});`;
    case "CZ":
      return `cz(${quantumRef(gate.control, qRegisters)}, ${quantumRef(gate.target, qRegisters)});`;
    case "SWAP":
      return `swap(${quantumRef(gate.control, qRegisters)}, ${quantumRef(gate.target, qRegisters)});`;
    case "CCNOT":
      return `ccx(${quantumRef(gate.control1, qRegisters)}, ${quantumRef(gate.control2, qRegisters)}, ${quantumRef(gate.target, qRegisters)});`;
    case "MEASURE":
      return `${classicalRef(gate.classicalBit, cRegisters)} = measure ${quantumRef(gate.qubit, qRegisters)};`;
    case "COND_X":
    case "COND_Z":
      return `if (${classicalRef(gate.conditionBit, cRegisters)} == ${gate.conditionValue}) { ${gate.type === "COND_X" ? "x" : "z"}(${quantumRef(gate.target, qRegisters)}); }`;
  }
}

function pythonOperation(
  gate: CircuitGate,
  qRegisters: QuantumRegister[],
  cRegisters: ClassicalRegister[],
): string {
  switch (gate.type) {
    case "X":
    case "Y":
    case "Z":
    case "H":
    case "S":
    case "SDG":
    case "T":
    case "TDG":
      return `qc.${gate.type.toLowerCase()}(${pythonQuantumRef(gate.target, qRegisters)})`;
    case "RX":
    case "RY":
    case "RZ":
      return `qc.${gate.type.toLowerCase()}(${formatNumber(gate.angle)}, ${pythonQuantumRef(gate.target, qRegisters)})`;
    case "CNOT":
      return `qc.cx(${pythonQuantumRef(gate.control, qRegisters)}, ${pythonQuantumRef(gate.target, qRegisters)})`;
    case "CZ":
      return `qc.cz(${pythonQuantumRef(gate.control, qRegisters)}, ${pythonQuantumRef(gate.target, qRegisters)})`;
    case "SWAP":
      return `qc.swap(${pythonQuantumRef(gate.control, qRegisters)}, ${pythonQuantumRef(gate.target, qRegisters)})`;
    case "CCNOT":
      return `qc.ccx(${pythonQuantumRef(gate.control1, qRegisters)}, ${pythonQuantumRef(gate.control2, qRegisters)}, ${pythonQuantumRef(gate.target, qRegisters)})`;
    case "MEASURE":
      return `qc.measure(${pythonQuantumRef(gate.qubit, qRegisters)}, ${pythonClassicalRef(gate.classicalBit, cRegisters)})`;
    case "COND_X":
    case "COND_Z":
      return `with qc.if_test((${pythonClassicalRef(gate.conditionBit, cRegisters)}, ${gate.conditionValue})):\n    qc.${gate.type === "COND_X" ? "x" : "z"}(${pythonQuantumRef(gate.target, qRegisters)})`;
  }
}

function normalizeQuantumRegisters(circuit: Circuit): QuantumRegister[] {
  return circuit.quantumRegisters.length
    ? circuit.quantumRegisters
    : [{ id: "qreg-fallback", name: "q", start: 0, size: circuit.numQubits }];
}

function normalizeClassicalRegisters(circuit: Circuit): ClassicalRegister[] {
  return circuit.classicalRegisters.length
    ? circuit.classicalRegisters
    : circuit.numClassicalBits > 0
      ? [{ id: "creg-fallback", name: "c", start: 0, size: circuit.numClassicalBits }]
      : [];
}

function quantumRef(index: number, registers: QuantumRegister[]): string {
  const register = findRegister(index, registers);
  return `${register.name}[${index - register.start}]`;
}

function classicalRef(index: number, registers: ClassicalRegister[]): string {
  const register = findRegister(index, registers);
  return `${register.name}[${index - register.start}]`;
}

function pythonQuantumRef(index: number, registers: QuantumRegister[]): string {
  const register = findRegister(index, registers);
  return `${register.name}[${index - register.start}]`;
}

function pythonClassicalRef(
  index: number,
  registers: ClassicalRegister[],
): string {
  const register = findRegister(index, registers);
  return `${register.name}[${index - register.start}]`;
}

function findRegister<T extends QuantumRegister | ClassicalRegister>(
  index: number,
  registers: T[],
): T {
  const register = registers.find(
    (candidate) => index >= candidate.start && index < candidate.start + candidate.size,
  );
  if (!register) {
    throw new Error(`No register contains index ${index}.`);
  }
  return register;
}

function ensureValid(circuit: Circuit): void {
  const validation = validateCircuit(circuit);
  if (!validation.valid) {
    throw new Error(`Cannot generate code: ${validation.errors.join(" ")}`);
  }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : Number(value.toPrecision(10)).toString();
}
