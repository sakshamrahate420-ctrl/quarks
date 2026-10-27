import type {
  Circuit,
  CircuitGate,
  ClassicalRegister,
  GateType,
  QuantumRegister,
} from "./types";

export const MAX_QUBITS = 5;
export const MAX_CLASSICAL_BITS = 16;
export const SUPPORTED_GATES: readonly GateType[] = [
  "X",
  "Y",
  "Z",
  "H",
  "S",
  "SDG",
  "T",
  "TDG",
  "RX",
  "RY",
  "RZ",
  "CNOT",
  "CZ",
  "SWAP",
  "CCNOT",
  "MEASURE",
  "COND_X",
  "COND_Z",
];

export function createId(prefix = "id"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createCircuit(
  name = "Untitled circuit",
  numQubits = 2,
  numClassicalBits = numQubits,
): Circuit {
  const now = new Date().toISOString();
  const qubits = clampInteger(numQubits, 1, MAX_QUBITS);
  const classicalBits = clampInteger(
    numClassicalBits,
    0,
    MAX_CLASSICAL_BITS,
  );

  return {
    schemaVersion: 1,
    id: createId("circuit"),
    name,
    numQubits: qubits,
    numClassicalBits: classicalBits,
    quantumRegisters: [
      { id: createId("qreg"), name: "q", start: 0, size: qubits },
    ],
    classicalRegisters:
      classicalBits > 0
        ? [{ id: createId("creg"), name: "c", start: 0, size: classicalBits }]
        : [],
    gates: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createGate(
  type: GateType,
  target: number,
  column: number,
  angle = Math.PI / 2,
): CircuitGate {
  const base = { id: createId("gate"), column: Math.max(0, column) };
  if (type === "CNOT" || type === "CZ" || type === "SWAP" || type === "CCNOT") {
    throw new Error("Use a controlled-gate constructor to set all control qubits.");
  }
  if (type === "MEASURE") {
    throw new Error(
      "Use createMeasurementGate to set the classical-bit mapping.",
    );
  }
  if (type === "RX" || type === "RY" || type === "RZ") {
    return { ...base, type, target, angle };
  }
  if (type === "COND_X" || type === "COND_Z") {
    return { ...base, type, target, conditionBit: 0, conditionValue: 1 };
  }
  return { ...base, type, target };
}

export function createCnotGate(
  control: number,
  target: number,
  column: number,
): CircuitGate {
  if (control === target) {
    throw new Error("CNOT control and target must be different qubits.");
  }
  return {
    id: createId("gate"),
    type: "CNOT",
    control,
    target,
    column: Math.max(0, column),
  };
}

export function createControlledGate(
  type: "CZ" | "SWAP",
  control: number,
  target: number,
  column: number,
): CircuitGate {
  if (control === target) {
    throw new Error(`${type} control and target must be different qubits.`);
  }
  return { id: createId("gate"), type, control, target, column: Math.max(0, column) };
}

export function createCcnotGate(
  control1: number,
  control2: number,
  target: number,
  column: number,
): CircuitGate {
  if (new Set([control1, control2, target]).size !== 3) {
    throw new Error("CCNOT controls and target must use three different qubits.");
  }
  return { id: createId("gate"), type: "CCNOT", control1, control2, target, column: Math.max(0, column) };
}

export function createMeasurementGate(
  qubit: number,
  classicalBit: number,
  column: number,
): CircuitGate {
  return {
    id: createId("gate"),
    type: "MEASURE",
    qubit,
    classicalBit,
    column: Math.max(0, column),
  };
}

export function updateCircuit(circuit: Circuit, patch: Partial<Circuit>): Circuit {
  const updated = { ...circuit, ...patch, updatedAt: new Date().toISOString() };
  const validation = validateCircuit(updated);
  if (!validation.valid) {
    throw new Error(validation.errors.join(" "));
  }
  return updated;
}

export function addQubit(circuit: Circuit): Circuit {
  return insertQubit(circuit, circuit.numQubits);
}

export function insertQubit(
  circuit: Circuit,
  index: number,
  registerId?: string,
): Circuit {
  if (circuit.numQubits >= MAX_QUBITS) {
    throw new Error(`QUARKS supports up to ${MAX_QUBITS} active qubits.`);
  }
  if (!Number.isInteger(index) || index < 0 || index > circuit.numQubits) {
    throw new Error("Qubit insertion index is outside the circuit.");
  }
  const containing =
    circuit.quantumRegisters.find(
      (register) =>
        index >= register.start &&
        index <= register.start + register.size &&
        (!registerId || register.id === registerId),
    ) ?? undefined;
  if (registerId && !containing) {
    throw new Error("The selected quantum register does not contain that index.");
  }
  const selected =
    containing ??
    (index === circuit.numQubits
      ? circuit.quantumRegisters[circuit.quantumRegisters.length - 1]
      : undefined);
  const quantumRegisters = selected
    ? circuit.quantumRegisters.map((register) => {
        if (register.id === selected.id) {
          return { ...register, size: register.size + 1 };
        }
        if (register.start >= index) {
          return { ...register, start: register.start + 1 };
        }
        if (register.start < index && register.start + register.size > index) {
          return { ...register, size: register.size + 1 };
        }
        return register;
      })
    : [
        ...circuit.quantumRegisters.map((register) =>
          register.start >= index
            ? { ...register, start: register.start + 1 }
            : register,
        ),
        {
          id: createId("qreg"),
          name: nextRegisterName(circuit.quantumRegisters, "q"),
          start: index,
          size: 1,
        },
      ];
  const gates = circuit.gates.map((gate) => remapGateQubits(gate, index, 1));
  return updateCircuit(circuit, {
    numQubits: circuit.numQubits + 1,
    quantumRegisters,
    gates,
  });
}

export function addQuantumRegister(
  circuit: Circuit,
  size = 1,
  name = nextRegisterName(circuit.quantumRegisters, "q"),
  index = circuit.numQubits,
): Circuit {
  assertNewRegister(circuit.quantumRegisters, name, size, MAX_QUBITS - circuit.numQubits);
  if (!Number.isInteger(index) || index < 0 || index > circuit.numQubits) {
    throw new Error("Quantum register insertion index is outside the circuit.");
  }
  const quantumRegisters = insertRegisterAt(
    circuit.quantumRegisters,
    index,
    size,
    name,
    "qreg",
  ) as QuantumRegister[];
  return updateCircuit(circuit, {
    numQubits: circuit.numQubits + size,
    quantumRegisters,
    gates: circuit.gates.map((gate) => remapGateQubits(gate, index, size)),
  });
}

export function deleteQuantumRegister(
  circuit: Circuit,
  registerId: string,
): Circuit {
  const register = circuit.quantumRegisters.find(
    (candidate) => candidate.id === registerId,
  );
  if (!register) throw new Error("Quantum register could not be found.");
  if (circuit.numQubits - register.size < 1) {
    throw new Error("A circuit must contain at least one qubit.");
  }
  let next = circuit;
  for (let index = register.start + register.size - 1; index >= register.start; index -= 1) {
    next = removeQubit(next, index);
  }
  return next;
}

export function removeQubit(circuit: Circuit, qubit: number): Circuit {
  assertIndex(qubit, circuit.numQubits, "Qubit");
  if (circuit.numQubits <= 1) {
    throw new Error("A circuit must contain at least one qubit.");
  }
  const gates = circuit.gates
    .filter((gate) => !gateUsesQubit(gate, qubit))
    .map((gate) => remapGateQubits(gate, qubit + 1, -1));
  const quantumRegisters = removeRegisterIndex(circuit.quantumRegisters, qubit);
  return updateCircuit(circuit, {
    numQubits: circuit.numQubits - 1,
    quantumRegisters,
    gates,
  });
}

export function addClassicalBit(circuit: Circuit): Circuit {
  return insertClassicalBit(circuit, circuit.numClassicalBits);
}

export function insertClassicalBit(
  circuit: Circuit,
  index: number,
  registerId?: string,
): Circuit {
  if (circuit.numClassicalBits >= MAX_CLASSICAL_BITS) {
    throw new Error(
      `QUARKS supports up to ${MAX_CLASSICAL_BITS} classical bits.`,
    );
  }
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > circuit.numClassicalBits
  ) {
    throw new Error("Classical-bit insertion index is outside the circuit.");
  }
  const containing =
    circuit.classicalRegisters.find(
      (register) =>
        index >= register.start &&
        index <= register.start + register.size &&
        (!registerId || register.id === registerId),
    ) ?? undefined;
  if (registerId && !containing) {
    throw new Error("The selected classical register does not contain that index.");
  }
  const selected =
    containing ??
    (index === circuit.numClassicalBits
      ? circuit.classicalRegisters[circuit.classicalRegisters.length - 1]
      : undefined);
  const classicalRegisters = selected
    ? circuit.classicalRegisters.map((register) => {
        if (register.id === selected.id) {
          return { ...register, size: register.size + 1 };
        }
        if (register.start >= index) {
          return { ...register, start: register.start + 1 };
        }
        if (register.start < index && register.start + register.size > index) {
          return { ...register, size: register.size + 1 };
        }
        return register;
      })
    : [
        ...circuit.classicalRegisters.map((register) =>
          register.start >= index
            ? { ...register, start: register.start + 1 }
            : register,
        ),
        {
          id: createId("creg"),
          name: nextRegisterName(circuit.classicalRegisters, "c"),
          start: index,
          size: 1,
        },
      ];
  const gates = circuit.gates.map((gate) => remapGateClassicalBits(gate, index, 1));
  return updateCircuit(circuit, {
    numClassicalBits: circuit.numClassicalBits + 1,
    classicalRegisters,
    gates,
  });
}

export function addClassicalRegister(
  circuit: Circuit,
  size = 1,
  name = nextRegisterName(circuit.classicalRegisters, "c"),
  index = circuit.numClassicalBits,
): Circuit {
  assertNewRegister(
    circuit.classicalRegisters,
    name,
    size,
    MAX_CLASSICAL_BITS - circuit.numClassicalBits,
  );
  if (!Number.isInteger(index) || index < 0 || index > circuit.numClassicalBits) {
    throw new Error("Classical register insertion index is outside the circuit.");
  }
  const classicalRegisters = insertRegisterAt(
    circuit.classicalRegisters,
    index,
    size,
    name,
    "creg",
  ) as ClassicalRegister[];
  return updateCircuit(circuit, {
    numClassicalBits: circuit.numClassicalBits + size,
    classicalRegisters,
    gates: circuit.gates.map((gate) => remapGateClassicalBits(gate, index, size)),
  });
}

export function deleteClassicalRegister(
  circuit: Circuit,
  registerId: string,
): Circuit {
  const register = circuit.classicalRegisters.find(
    (candidate) => candidate.id === registerId,
  );
  if (!register) throw new Error("Classical register could not be found.");
  let next = circuit;
  for (let index = register.start + register.size - 1; index >= register.start; index -= 1) {
    next = removeClassicalBit(next, index);
  }
  return next;
}

export function removeClassicalBit(circuit: Circuit, bit: number): Circuit {
  assertIndex(bit, circuit.numClassicalBits, "Classical bit");
  const gates = circuit.gates
    .filter((gate) => !gateUsesClassicalBit(gate, bit))
    .map((gate) => remapGateClassicalBits(gate, bit + 1, -1));
  const classicalRegisters = removeRegisterIndex(
    circuit.classicalRegisters,
    bit,
  );
  return updateCircuit(circuit, {
    numClassicalBits: circuit.numClassicalBits - 1,
    classicalRegisters,
    gates,
  });
}

export function sortGates(gates: CircuitGate[]): CircuitGate[] {
  return gates
    .map((gate, position) => ({ gate, position }))
    .sort(
      (a, b) =>
        a.gate.column - b.gate.column || a.position - b.position,
    )
    .map(({ gate }) => gate);
}

export function addGate(circuit: Circuit, gate: CircuitGate): Circuit {
  return updateCircuit(circuit, { gates: [...circuit.gates, gate] });
}

export function deleteGate(circuit: Circuit, gateId: string): Circuit {
  return updateCircuit(circuit, {
    gates: circuit.gates.filter((gate) => gate.id !== gateId),
  });
}

export function moveGate(
  circuit: Circuit,
  gateId: string,
  patch: Partial<Omit<CircuitGate, "id" | "type">>,
): Circuit {
  const found = circuit.gates.some((gate) => gate.id === gateId);
  if (!found) throw new Error("Selected gate could not be found.");
  const gates = circuit.gates.map((gate) =>
    gate.id === gateId ? ({ ...gate, ...patch } as CircuitGate) : gate,
  );
  return updateCircuit(circuit, { gates });
}

export function duplicateGate(circuit: Circuit, gateId: string): Circuit {
  const gate = circuit.gates.find((candidate) => candidate.id === gateId);
  if (!gate) throw new Error("Selected gate could not be found.");
  const duplicate = { ...gate, id: createId("gate"), column: gate.column + 1 };
  return updateCircuit(circuit, { gates: [...circuit.gates, duplicate] });
}

export function renameRegister(
  circuit: Circuit,
  registerId: string,
  name: string,
  kind: "quantum" | "classical",
): Circuit {
  const normalized = name.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error("Register names must start with a letter or underscore.");
  }
  const registers =
    kind === "quantum" ? circuit.quantumRegisters : circuit.classicalRegisters;
  if (registers.some((register) => register.id !== registerId && register.name === normalized)) {
    throw new Error("Register names must be unique within their type.");
  }
  const renamed = registers.map((register) =>
    register.id === registerId ? { ...register, name: normalized } : register,
  );
  if (!registers.some((register) => register.id === registerId)) {
    throw new Error("Register could not be found.");
  }
  return updateCircuit(
    circuit,
    kind === "quantum"
      ? { quantumRegisters: renamed as QuantumRegister[] }
      : { classicalRegisters: renamed as ClassicalRegister[] },
  );
}

export function validateCircuit(circuit: unknown): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(circuit)) {
    return { valid: false, errors: ["Circuit must be an object."] };
  }
  if (circuit.schemaVersion !== 1) {
    errors.push("Unsupported circuit schema version.");
  }
  if (typeof circuit.id !== "string" || !circuit.id) {
    errors.push("Circuit id is required.");
  }
  if (typeof circuit.name !== "string" || !circuit.name.trim()) {
    errors.push("Circuit name is required.");
  }
  if (!isIntegerInRange(circuit.numQubits, 1, MAX_QUBITS)) {
    errors.push(`Circuit must contain 1–${MAX_QUBITS} qubits.`);
  }
  if (
    !isIntegerInRange(circuit.numClassicalBits, 0, MAX_CLASSICAL_BITS)
  ) {
    errors.push(
      `Circuit must contain 0–${MAX_CLASSICAL_BITS} classical bits.`,
    );
  }
  if (!Array.isArray(circuit.quantumRegisters)) {
    errors.push("Quantum registers must be an array.");
  } else {
    errors.push(
      ...validateRegisters(
        circuit.quantumRegisters,
        Number(circuit.numQubits),
        "Quantum",
      ),
    );
  }
  if (!Array.isArray(circuit.classicalRegisters)) {
    errors.push("Classical registers must be an array.");
  } else {
    errors.push(
      ...validateRegisters(
        circuit.classicalRegisters,
        Number(circuit.numClassicalBits),
        "Classical",
      ),
    );
  }
  if (!Array.isArray(circuit.gates)) {
    errors.push("Gates must be an array.");
  } else if (isIntegerInRange(circuit.numQubits, 1, MAX_QUBITS)) {
    const qubits = Number(circuit.numQubits);
    const bits = Number(circuit.numClassicalBits);
    for (const [index, value] of circuit.gates.entries()) {
      errors.push(...validateGate(value, index, qubits, bits));
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateGate(
  value: unknown,
  position: number,
  numQubits: number,
  numClassicalBits: number,
): string[] {
  const errors: string[] = [];
  const label = `Gate ${position + 1}`;
  if (!isRecord(value)) return [`${label} must be an object.`];
  if (typeof value.id !== "string" || !value.id) {
    errors.push(`${label} needs an id.`);
  }
  if (!isIntegerInRange(value.column, 0, 10000)) {
    errors.push(`${label} has an invalid column.`);
  }
  switch (value.type) {
    case "X":
    case "Y":
    case "Z":
    case "H":
    case "S":
    case "SDG":
    case "T":
    case "TDG":
      if (!isIntegerInRange(value.target, 0, numQubits - 1)) {
        errors.push(`${label} targets a qubit outside the circuit.`);
      }
      break;
    case "RX":
    case "RY":
    case "RZ":
      if (!isIntegerInRange(value.target, 0, numQubits - 1)) {
        errors.push(`${label} targets a qubit outside the circuit.`);
      }
      if (typeof value.angle !== "number" || !Number.isFinite(value.angle)) {
        errors.push(`${label} needs a finite rotation angle.`);
      }
      break;
    case "CNOT":
    case "CZ":
    case "SWAP":
      if (!isIntegerInRange(value.control, 0, numQubits - 1)) {
        errors.push(`${label} has an invalid control qubit.`);
      }
      if (!isIntegerInRange(value.target, 0, numQubits - 1)) {
        errors.push(`${label} has an invalid target qubit.`);
      }
      if (value.control === value.target) {
        errors.push(`${label} control and target must differ.`);
      }
      break;
    case "CCNOT":
      if (!isIntegerInRange(value.control1, 0, numQubits - 1)) {
        errors.push(`${label} has an invalid first control qubit.`);
      }
      if (!isIntegerInRange(value.control2, 0, numQubits - 1)) {
        errors.push(`${label} has an invalid second control qubit.`);
      }
      if (!isIntegerInRange(value.target, 0, numQubits - 1)) {
        errors.push(`${label} has an invalid target qubit.`);
      }
      if (new Set([value.control1, value.control2, value.target]).size !== 3) {
        errors.push(`${label} controls and target must be different qubits.`);
      }
      break;
    case "MEASURE":
      if (!isIntegerInRange(value.qubit, 0, numQubits - 1)) {
        errors.push(`${label} measures a qubit outside the circuit.`);
      }
      if (!isIntegerInRange(value.classicalBit, 0, numClassicalBits - 1)) {
        errors.push(`${label} maps to a classical bit outside the circuit.`);
      }
      break;
    case "COND_X":
    case "COND_Z":
      if (!isIntegerInRange(value.target, 0, numQubits - 1)) {
        errors.push(`${label} targets a qubit outside the circuit.`);
      }
      if (!isIntegerInRange(value.conditionBit, 0, numClassicalBits - 1)) {
        errors.push(`${label} uses a classical condition bit outside the circuit.`);
      }
      if (value.conditionValue !== 0 && value.conditionValue !== 1) {
        errors.push(`${label} condition value must be 0 or 1.`);
      }
      break;
    default:
      errors.push(`${label} uses an unsupported gate.`);
  }
  return errors;
}

function validateRegisters(
  value: unknown[],
  size: number,
  label: string,
): string[] {
  const errors: string[] = [];
  const occupied = new Set<number>();
  const names = new Set<string>();
  for (const [index, register] of value.entries()) {
    if (!isRecord(register)) {
      errors.push(`${label} register ${index + 1} must be an object.`);
      continue;
    }
    if (
      typeof register.id !== "string" ||
      typeof register.name !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(register.name)
    ) {
      errors.push(`${label} register ${index + 1} has an invalid id or name.`);
      continue;
    }
    if (names.has(register.name)) {
      errors.push(`${label} register names must be unique.`);
    }
    names.add(register.name);
    if (
      !isIntegerInRange(register.start, 0, Math.max(0, size)) ||
      !isIntegerInRange(register.size, 1, Math.max(1, size))
    ) {
      errors.push(`${label} register "${register.name}" has invalid bounds.`);
      continue;
    }
    for (
      let bit = Number(register.start);
      bit < Number(register.start) + Number(register.size);
      bit += 1
    ) {
      if (bit >= size) {
        errors.push(`${label} register "${register.name}" exceeds its circuit.`);
        break;
      }
      if (occupied.has(bit)) {
        errors.push(`${label} registers overlap at index ${bit}.`);
      }
      occupied.add(bit);
    }
  }
  if (occupied.size !== size) {
    errors.push(`${label} registers must cover every circuit index exactly once.`);
  }
  return errors;
}

function extendRegisters<T extends QuantumRegister | ClassicalRegister>(
  registers: T[],
  index: number,
  name: string,
  prefix: string,
): T[] {
  if (registers.length === 1 && registers[0]?.start === 0) {
    return [{ ...registers[0], size: registers[0].size + 1 }];
  }
  return [
    ...registers,
    { id: createId(prefix), name, start: index, size: 1 } as T,
  ];
}

function nextRegisterName(
  registers: (QuantumRegister | ClassicalRegister)[],
  prefix: string,
): string {
  let suffix = 0;
  let candidate = prefix;
  while (registers.some((register) => register.name === candidate)) {
    suffix += 1;
    candidate = `${prefix}${suffix}`;
  }
  return candidate;
}

function assertNewRegister(
  registers: (QuantumRegister | ClassicalRegister)[],
  name: string,
  size: number,
  remainingCapacity: number,
): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("Register names must start with a letter or underscore.");
  }
  if (registers.some((register) => register.name === name)) {
    throw new Error("Register names must be unique within their type.");
  }
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    size > remainingCapacity
  ) {
    throw new Error("Register size exceeds the available circuit capacity.");
  }
}

function removeRegisterIndex<T extends QuantumRegister | ClassicalRegister>(
  registers: T[],
  removedIndex: number,
): T[] {
  return registers.flatMap((register) => {
    const end = register.start + register.size;
    if (removedIndex < register.start) {
      return [{ ...register, start: register.start - 1 }];
    }
    if (removedIndex >= end) return [register];
    if (register.size === 1) return [];
    return [{ ...register, size: register.size - 1 }];
  });
}

function assertIndex(index: number, count: number, label: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`${label} index is outside the circuit.`);
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

function gateUsesQubit(gate: CircuitGate, qubit: number): boolean {
  if (gate.type === "MEASURE") return gate.qubit === qubit;
  if (gate.type === "CNOT" || gate.type === "CZ" || gate.type === "SWAP") {
    return gate.control === qubit || gate.target === qubit;
  }
  if (gate.type === "CCNOT") {
    return gate.control1 === qubit || gate.control2 === qubit || gate.target === qubit;
  }
  return gate.target === qubit;
}

function gateUsesClassicalBit(gate: CircuitGate, bit: number): boolean {
  return gate.type === "MEASURE"
    ? gate.classicalBit === bit
    : (gate.type === "COND_X" || gate.type === "COND_Z") && gate.conditionBit === bit;
}

function remapGateQubits(gate: CircuitGate, from: number, offset: number): CircuitGate {
  const shift = (index: number) => index >= from ? index + offset : index;
  if (gate.type === "MEASURE") return { ...gate, qubit: shift(gate.qubit) };
  if (gate.type === "CNOT" || gate.type === "CZ" || gate.type === "SWAP") {
    return { ...gate, control: shift(gate.control), target: shift(gate.target) };
  }
  if (gate.type === "CCNOT") {
    return {
      ...gate,
      control1: shift(gate.control1),
      control2: shift(gate.control2),
      target: shift(gate.target),
    };
  }
  return { ...gate, target: shift(gate.target) };
}

function remapGateClassicalBits(
  gate: CircuitGate,
  from: number,
  offset: number,
): CircuitGate {
  const shift = (index: number) => index >= from ? index + offset : index;
  if (gate.type === "MEASURE") {
    return { ...gate, classicalBit: shift(gate.classicalBit) };
  }
  if (gate.type === "COND_X" || gate.type === "COND_Z") {
    return { ...gate, conditionBit: shift(gate.conditionBit) };
  }
  return gate;
}

function insertRegisterAt<T extends QuantumRegister | ClassicalRegister>(
  registers: T[],
  index: number,
  size: number,
  name: string,
  idPrefix: "qreg" | "creg",
): Array<QuantumRegister | ClassicalRegister> {
  const next: Array<QuantumRegister | ClassicalRegister> = [];
  for (const register of registers) {
    const end = register.start + register.size;
    if (end <= index) {
      next.push(register);
    } else if (register.start >= index) {
      next.push({ ...register, start: register.start + size });
    } else {
      const leftSize = index - register.start;
      const rightSize = end - index;
      if (leftSize > 0) next.push({ ...register, size: leftSize });
      if (rightSize > 0) {
        const prefix = idPrefix === "qreg" ? "q" : "c";
        next.push({
          id: createId(idPrefix),
          name: nextRegisterName([...registers, ...next], prefix),
          start: index + size,
          size: rightSize,
        });
      }
    }
  }
  next.push({ id: createId(idPrefix), name, start: index, size });
  return next.sort((a, b) => a.start - b.start);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
