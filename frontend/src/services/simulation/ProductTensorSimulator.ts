import type {
  BasisStateResult,
  CircuitGate,
  ComplexAmplitude,
  SimulationInput,
  SimulationResult,
} from "../../features/circuit/types";

type Vector = [ComplexAmplitude, ComplexAmplitude];
type Matrix = readonly [ComplexAmplitude, ComplexAmplitude, ComplexAmplitude, ComplexAmplitude];

const ZERO: ComplexAmplitude = { re: 0, im: 0 };
const ONE: ComplexAmplitude = { re: 1, im: 0 };
const SQRT_HALF = Math.SQRT1_2;

function multiply(a: ComplexAmplitude, b: ComplexAmplitude): ComplexAmplitude {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function add(a: ComplexAmplitude, b: ComplexAmplitude): ComplexAmplitude {
  return { re: a.re + b.re, im: a.im + b.im };
}

function gateMatrix(gate: CircuitGate): Matrix | null {
  switch (gate.type) {
    case "X": return [ZERO, ONE, ONE, ZERO];
    case "Y": return [ZERO, { re: 0, im: -1 }, { re: 0, im: 1 }, ZERO];
    case "Z": return [ONE, ZERO, ZERO, { re: -1, im: 0 }];
    case "H": return [
      { re: SQRT_HALF, im: 0 }, { re: SQRT_HALF, im: 0 },
      { re: SQRT_HALF, im: 0 }, { re: -SQRT_HALF, im: 0 },
    ];
    case "S": return [ONE, ZERO, ZERO, { re: 0, im: 1 }];
    case "SDG": return [ONE, ZERO, ZERO, { re: 0, im: -1 }];
    case "T": return [ONE, ZERO, ZERO, { re: SQRT_HALF, im: SQRT_HALF }];
    case "TDG": return [ONE, ZERO, ZERO, { re: SQRT_HALF, im: -SQRT_HALF }];
    case "RX": {
      const c = Math.cos(gate.angle / 2); const s = Math.sin(gate.angle / 2);
      return [{ re: c, im: 0 }, { re: 0, im: -s }, { re: 0, im: -s }, { re: c, im: 0 }];
    }
    case "RY": {
      const c = Math.cos(gate.angle / 2); const s = Math.sin(gate.angle / 2);
      return [{ re: c, im: 0 }, { re: -s, im: 0 }, { re: s, im: 0 }, { re: c, im: 0 }];
    }
    case "RZ": {
      const half = gate.angle / 2;
      return [
        { re: Math.cos(half), im: -Math.sin(half) }, ZERO,
        ZERO, { re: Math.cos(half), im: Math.sin(half) },
      ];
    }
    default: return null;
  }
}

function randomFor(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function bitstring(index: bigint, qubits: number): string {
  return index.toString(2).padStart(qubits, "0");
}

function applyLocalGate(qubits: Vector[], target: number, matrix: Matrix): void {
  const state = qubits[target];
  const zero = add(multiply(matrix[0], state[0]), multiply(matrix[1], state[1]));
  const one = add(multiply(matrix[2], state[0]), multiply(matrix[3], state[1]));
  qubits[target] = [zero, one];
}

function sameComplex(a: ComplexAmplitude, b: ComplexAmplitude): boolean {
  return Math.hypot(a.re - b.re, a.im - b.im) < 1e-12;
}

function applyFactorableCnot(qubits: Vector[], control: number, target: number): boolean {
  const controlState = qubits[control];
  const targetState = qubits[target];
  const controlOneProbability = controlState[1].re ** 2 + controlState[1].im ** 2;
  if (controlOneProbability < 1e-12) return true;
  if (controlOneProbability > 1 - 1e-12) {
    applyLocalGate(qubits, target, [ZERO, ONE, ONE, ZERO]);
    return true;
  }

  const targetIsPlus = sameComplex(targetState[0], targetState[1]);
  const targetIsMinus = sameComplex(targetState[0], {
    re: -targetState[1].re,
    im: -targetState[1].im,
  });
  if (!targetIsPlus && !targetIsMinus) return false;
  if (targetIsMinus) applyLocalGate(qubits, control, [ONE, ZERO, ZERO, { re: -1, im: 0 }]);
  return true;
}

function productStateAfterCircuit(numQubits: number, gates: CircuitGate[]): Vector[] | null {
  const qubits = Array.from({ length: numQubits }, () => [ONE, ZERO] as Vector);
  let measurementsStarted = false;
  for (const gate of gates) {
    if (gate.type === "MEASURE") {
      measurementsStarted = true;
      continue;
    }
    if (measurementsStarted) return null;
    const matrix = gateMatrix(gate);
    if (matrix && "target" in gate) {
      applyLocalGate(qubits, gate.target, matrix);
      continue;
    }
    if (gate.type === "CNOT" && applyFactorableCnot(qubits, gate.control, gate.target)) continue;
    return null;
  }
  return qubits;
}

export function supportsProductTensorCircuit(numQubits: number, gates: CircuitGate[]): boolean {
  return productStateAfterCircuit(numQubits, gates) !== null;
}

/** Simulates bond-dimension-one tensor networks and samples the output distribution. */
export function simulateProductTensorCircuit(input: SimulationInput, gates: CircuitGate[]): SimulationResult {
  const started = performance.now();
  const { circuit, shots } = input;
  if (!Number.isInteger(shots) || shots < 1 || shots > 100_000) {
    throw new Error("Product tensor-network simulation requires between 1 and 100,000 shots.");
  }
  const qubits = productStateAfterCircuit(circuit.numQubits, gates);
  if (!qubits) throw new Error("Product tensor-network simulation cannot preserve this circuit as independent qubit states.");

  const random = randomFor(input.seed ?? 0x514b4152);
  const counts: Record<string, number> = {};
  const indices = new Map<string, number>();
  for (let shot = 0; shot < shots; shot += 1) {
    let index = 0n;
    for (let qubit = 0; qubit < qubits.length; qubit += 1) {
      const one = qubits[qubit][1];
      const probabilityOne = one.re * one.re + one.im * one.im;
      if (random() < probabilityOne) index |= 1n << BigInt(qubit);
    }
    const output = bitstring(index, circuit.numQubits);
    counts[output] = (counts[output] ?? 0) + 1;
    indices.set(output, Number(index));
  }

  const probabilities: BasisStateResult[] = Object.entries(counts)
    .map(([output, count]) => ({
      index: indices.get(output) ?? 0,
      bitstring: output,
      amplitude: null,
      probability: count / shots,
    }))
    .sort((a, b) => a.index - b.index);

  return {
    status: "completed",
    engine: "QuantumLab product-state tensor network / JavaScript (shot-sampled)",
    isMock: false,
    convention: "q[0] is the least-significant index bit. Displayed bitstrings are q[n-1]…q[0]. This bond-dimension-one tensor network samples output bitstrings; listed probabilities are shot-frequency estimates.",
    probabilityMode: "trajectory-estimate",
    circuitId: circuit.id,
    shots,
    statevector: null,
    probabilities,
    measurementCounts: counts,
    snapshots: [],
    metadata: {
      executedAt: new Date().toISOString(),
      gateCount: gates.length,
      elapsedMs: performance.now() - started,
    },
  };
}
