import type {
  BasisStateResult,
  CircuitGate,
  ComplexAmplitude,
  SimulationInput,
  SimulationResult,
} from "../../features/circuit/types";

export const MAX_SPARSE_QUBITS = 28;
export const MAX_SPARSE_AMPLITUDES = 65_536;
const MAX_SPARSE_WORK = 20_000_000;
const EPSILON = 1e-15;

type SparseState = Map<bigint, ComplexAmplitude>;
type WorkMeter = { used: number };
type Matrix2 = readonly [ComplexAmplitude, ComplexAmplitude, ComplexAmplitude, ComplexAmplitude];
const ZERO: ComplexAmplitude = { re: 0, im: 0 };
const ONE: ComplexAmplitude = { re: 1, im: 0 };
const SQRT_HALF = Math.SQRT1_2;

const add = (a: ComplexAmplitude, b: ComplexAmplitude): ComplexAmplitude => ({ re: a.re + b.re, im: a.im + b.im });
const multiply = (a: ComplexAmplitude, b: ComplexAmplitude): ComplexAmplitude => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const magnitudeSquared = (value: ComplexAmplitude) => value.re * value.re + value.im * value.im;
const bitMask = (qubit: number) => 1n << BigInt(qubit);
const bitIsOne = (index: bigint, qubit: number) => (index & bitMask(qubit)) !== 0n;
const bitstring = (index: bigint, qubits: number) => index.toString(2).padStart(qubits, "0");

function spendWork(meter: WorkMeter, amount: number) {
  meter.used += amount;
  if (meter.used > MAX_SPARSE_WORK) {
    throw new Error(`Sparse simulation exceeded its ${MAX_SPARSE_WORK.toLocaleString()} state-operation budget. Reduce gate count or use 16 or fewer qubits for dense simulation.`);
  }
}

function setIfNonzero(state: SparseState, index: bigint, value: ComplexAmplitude) {
  if (magnitudeSquared(value) > EPSILON * EPSILON) state.set(index, value);
}

function applySingleQubit(state: SparseState, target: number, matrix: Matrix2, meter: WorkMeter): SparseState {
  spendWork(meter, state.size);
  const mask = bitMask(target);
  const visited = new Set<bigint>();
  const output: SparseState = new Map();
  for (const index of state.keys()) {
    const base = index & ~mask;
    if (visited.has(base)) continue;
    visited.add(base);
    const zero = state.get(base) ?? ZERO;
    const one = state.get(base | mask) ?? ZERO;
    const nextZero = add(multiply(matrix[0], zero), multiply(matrix[1], one));
    const nextOne = add(multiply(matrix[2], zero), multiply(matrix[3], one));
    setIfNonzero(output, base, nextZero);
    setIfNonzero(output, base | mask, nextOne);
    if (output.size > MAX_SPARSE_AMPLITUDES) {
      throw new Error(`Sparse state grew beyond ${MAX_SPARSE_AMPLITUDES.toLocaleString()} occupied basis states. Reduce superposition growth or use 16 or fewer qubits for dense simulation.`);
    }
  }
  return output;
}

function applyDiagonal(state: SparseState, target: number, phase: ComplexAmplitude, meter: WorkMeter): SparseState {
  spendWork(meter, state.size);
  for (const [index, amplitude] of state) {
    if (bitIsOne(index, target)) state.set(index, multiply(phase, amplitude));
  }
  return state;
}

function applyControlledX(state: SparseState, control: number, target: number, meter: WorkMeter): SparseState {
  spendWork(meter, state.size);
  const targetMask = bitMask(target);
  const output: SparseState = new Map();
  for (const [index, amplitude] of state) output.set(bitIsOne(index, control) ? index ^ targetMask : index, amplitude);
  return output;
}

function applyGate(state: SparseState, gate: Exclude<CircuitGate, { type: "MEASURE" }>, classical: number, meter: WorkMeter): SparseState {
  switch (gate.type) {
    case "X": return applySingleQubit(state, gate.target, [ZERO, ONE, ONE, ZERO], meter);
    case "Y": return applySingleQubit(state, gate.target, [ZERO, { re: 0, im: -1 }, { re: 0, im: 1 }, ZERO], meter);
    case "Z": return applyDiagonal(state, gate.target, { re: -1, im: 0 }, meter);
    case "H": return applySingleQubit(state, gate.target, [
      { re: SQRT_HALF, im: 0 }, { re: SQRT_HALF, im: 0 },
      { re: SQRT_HALF, im: 0 }, { re: -SQRT_HALF, im: 0 },
    ], meter);
    case "S": return applyDiagonal(state, gate.target, { re: 0, im: 1 }, meter);
    case "SDG": return applyDiagonal(state, gate.target, { re: 0, im: -1 }, meter);
    case "T": return applyDiagonal(state, gate.target, { re: SQRT_HALF, im: SQRT_HALF }, meter);
    case "TDG": return applyDiagonal(state, gate.target, { re: SQRT_HALF, im: -SQRT_HALF }, meter);
    case "RX": {
      const c = Math.cos(gate.angle / 2); const s = Math.sin(gate.angle / 2);
      return applySingleQubit(state, gate.target, [
        { re: c, im: 0 }, { re: 0, im: -s }, { re: 0, im: -s }, { re: c, im: 0 },
      ], meter);
    }
    case "RY": {
      const c = Math.cos(gate.angle / 2); const s = Math.sin(gate.angle / 2);
      return applySingleQubit(state, gate.target, [
        { re: c, im: 0 }, { re: -s, im: 0 }, { re: s, im: 0 }, { re: c, im: 0 },
      ], meter);
    }
    case "RZ": {
      const half = gate.angle / 2;
      spendWork(meter, state.size);
      for (const [index, amplitude] of state) {
        const angle = bitIsOne(index, gate.target) ? half : -half;
        state.set(index, multiply({ re: Math.cos(angle), im: Math.sin(angle) }, amplitude));
      }
      return state;
    }
    case "CNOT": return applyControlledX(state, gate.control, gate.target, meter);
    case "CZ": {
      spendWork(meter, state.size);
      for (const [index, amplitude] of state) {
        if (bitIsOne(index, gate.control) && bitIsOne(index, gate.target)) state.set(index, { re: -amplitude.re, im: -amplitude.im });
      }
      return state;
    }
    case "SWAP": {
      spendWork(meter, state.size);
      const output: SparseState = new Map();
      for (const [index, amplitude] of state) {
        const differs = bitIsOne(index, gate.control) !== bitIsOne(index, gate.target);
        output.set(differs ? index ^ bitMask(gate.control) ^ bitMask(gate.target) : index, amplitude);
      }
      return output;
    }
    case "CCNOT": {
      spendWork(meter, state.size);
      const targetMask = bitMask(gate.target);
      const output: SparseState = new Map();
      for (const [index, amplitude] of state) {
        const enabled = bitIsOne(index, gate.control1) && bitIsOne(index, gate.control2);
        output.set(enabled ? index ^ targetMask : index, amplitude);
      }
      return output;
    }
    case "COND_X":
      return ((classical >> gate.conditionBit) & 1) === gate.conditionValue
        ? applySingleQubit(state, gate.target, [ZERO, ONE, ONE, ZERO], meter)
        : state;
    case "COND_Z":
      return ((classical >> gate.conditionBit) & 1) === gate.conditionValue
        ? applyDiagonal(state, gate.target, { re: -1, im: 0 }, meter)
        : state;
  }
}

function measureQubit(state: SparseState, qubit: number, random: () => number, meter: WorkMeter): { state: SparseState; outcome: 0 | 1 } {
  spendWork(meter, state.size);
  let probabilityOne = 0;
  for (const [index, amplitude] of state) if (bitIsOne(index, qubit)) probabilityOne += magnitudeSquared(amplitude);
  const outcome: 0 | 1 = random() < probabilityOne ? 1 : 0;
  const probability = outcome ? probabilityOne : 1 - probabilityOne;
  const scale = probability > 0 ? 1 / Math.sqrt(probability) : 1;
  const mask = bitMask(qubit);
  const collapsed: SparseState = new Map();
  for (const [index, amplitude] of state) {
    if (Number((index & mask) !== 0n) === outcome) collapsed.set(index, { re: amplitude.re * scale, im: amplitude.im * scale });
  }
  return { state: collapsed, outcome };
}

function sampleIndex(state: SparseState, random: () => number): bigint {
  let remaining = random();
  let last = 0n;
  for (const [index, amplitude] of state) {
    last = index;
    remaining -= magnitudeSquared(amplitude);
    if (remaining <= 0) return index;
  }
  return last;
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function toBasisStates(state: SparseState, qubits: number, includeAmplitudes: boolean): BasisStateResult[] {
  return [...state.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([index, amplitude]) => ({
      index: Number(index),
      bitstring: bitstring(index, qubits),
      amplitude: includeAmplitudes ? amplitude : null,
      probability: magnitudeSquared(amplitude),
    }));
}

function addCounts(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

export function simulateSparseCircuit(input: SimulationInput, gates: CircuitGate[]): SimulationResult {
  const started = performance.now();
  const { circuit, shots } = input;
  if (circuit.numQubits > MAX_SPARSE_QUBITS) throw new Error(`Sparse simulation supports up to ${MAX_SPARSE_QUBITS} qubits.`);
  if (!Number.isInteger(shots) || shots < 1) throw new Error("Measurement shots must be a positive integer.");
  const random = seededRandom(input.seed ?? 0x514b4152);
  const meter: WorkMeter = { used: 0 };
  const hasMidCircuitMeasurement = gates.some((gate) => gate.type === "MEASURE");
  const measurementCounts: Record<string, number> = {};
  const probabilityTotals: Map<bigint, number> = new Map();
  let finalState: SparseState = new Map([[0n, ONE]]);
  let statevector: ComplexAmplitude[] | null = null;

  if (!hasMidCircuitMeasurement) {
    for (const gate of gates) finalState = applyGate(finalState, gate as Exclude<CircuitGate, { type: "MEASURE" }>, 0, meter);
    for (const [index, amplitude] of finalState) probabilityTotals.set(index, magnitudeSquared(amplitude));
    statevector = [...finalState.values()];
    for (let shot = 0; shot < shots; shot += 1) {
      addCounts(measurementCounts, bitstring(sampleIndex(finalState, random), circuit.numQubits));
    }
  } else {
    for (let shot = 0; shot < shots; shot += 1) {
      let trajectory: SparseState = new Map([[0n, ONE]]);
      let classical = 0;
      for (const gate of gates) {
        if (gate.type === "MEASURE") {
          const measured = measureQubit(trajectory, gate.qubit, random, meter);
          trajectory = measured.state;
          if (measured.outcome) classical |= 1 << gate.classicalBit;
          else classical &= ~(1 << gate.classicalBit);
        } else {
          trajectory = applyGate(trajectory, gate, classical, meter);
        }
      }
      for (const [index, amplitude] of trajectory) {
        probabilityTotals.set(index, (probabilityTotals.get(index) ?? 0) + magnitudeSquared(amplitude) / shots);
      }
      addCounts(measurementCounts, bitstring(sampleIndex(trajectory, random), circuit.numQubits));
    }
  }

  if (probabilityTotals.size > MAX_SPARSE_AMPLITUDES) {
    throw new Error(`Sparse simulation produced more than ${MAX_SPARSE_AMPLITUDES.toLocaleString()} occupied basis states. Reduce superposition growth.`);
  }
  const probabilities: BasisStateResult[] = [...probabilityTotals.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([index, probability]) => {
      const amplitude = hasMidCircuitMeasurement ? null : finalState.get(index) ?? null;
      return { index: Number(index), bitstring: bitstring(index, circuit.numQubits), amplitude, probability };
    });

  return {
    status: "completed",
    engine: "QuantumLab sparse statevector / JavaScript",
    isMock: false,
    convention: "q[0] is the least-significant index bit. Displayed bitstrings are q[n-1]…q[0]. Sparse results contain occupied basis states only; gate snapshots are unavailable in sparse mode.",
    probabilityMode: hasMidCircuitMeasurement ? "trajectory-estimate" : "ideal-statevector",
    circuitId: circuit.id,
    shots,
    statevector,
    probabilities,
    measurementCounts,
    snapshots: [],
    metadata: {
      executedAt: new Date().toISOString(),
      gateCount: gates.length,
      elapsedMs: performance.now() - started,
    },
  };
}
