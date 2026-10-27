import { sortGates, validateCircuit } from "../../features/circuit/model";
import type {
  CircuitGate,
  ComplexAmplitude,
  SimulationAdapter,
  SimulationInput,
  SimulationResult,
  SimulationSnapshot,
} from "../../features/circuit/types";
import { createSimulator } from "../../../../web-demo/quantumlab-api.js";

type WasmAmplitude = { real: number; imag: number };
type WasmSnapshot = { gate_index: number; gate: CircuitGate; statevector: WasmAmplitude[] };
type WasmResult = {
  success: boolean;
  statevector: WasmAmplitude[] | null;
  probabilities: number[];
  measurement_counts: Record<string, number>;
  classical_counts: Record<string, number>;
  snapshots: WasmSnapshot[];
  error?: { code: string; message: string };
};
type WasmSimulator = Awaited<ReturnType<typeof createSimulator>>;

let simulatorPromise: Promise<WasmSimulator> | undefined;
const loadSimulator = () => (simulatorPromise ??= createSimulator());

const toAmplitude = ({ real, imag }: WasmAmplitude): ComplexAmplitude => ({ re: real, im: imag });
const toBitstring = (index: number, qubits: number) => index.toString(2).padStart(qubits, "0");
const probabilitiesFor = (probabilities: number[], qubits: number, amplitudes: WasmAmplitude[] | null) =>
  probabilities.map((probability, index) => ({
    index,
    bitstring: toBitstring(index, qubits),
    amplitude: amplitudes ? toAmplitude(amplitudes[index]) : null,
    probability,
  }));

function toWasmGate(gate: CircuitGate) {
  if (gate.type === "MEASURE") {
    return { type: "MEASURE", target: gate.qubit, classical_bit: gate.classicalBit };
  }
  if (gate.type === "CNOT" || gate.type === "CZ" || gate.type === "SWAP") {
    return { type: gate.type, control: gate.control, target: gate.target };
  }
  if (gate.type === "CCNOT") {
    return { type: "CCNOT", control: gate.control1, control2: gate.control2, target: gate.target };
  }
  if (gate.type === "COND_X" || gate.type === "COND_Z") {
    return {
      type: gate.type === "COND_X" ? "X" : "Z",
      target: gate.target,
      condition: { bit: gate.conditionBit, equals: gate.conditionValue },
    };
  }
  if (gate.type === "RX" || gate.type === "RY" || gate.type === "RZ") {
    return { type: gate.type, target: gate.target, angle: gate.angle };
  }
  return { type: gate.type, target: gate.target };
}

export class QuantumLabWasmAdapter implements SimulationAdapter {
  readonly engineName = "QuantumLab C++ / WebAssembly";

  async simulate(input: SimulationInput): Promise<SimulationResult> {
    const started = performance.now();
    const validation = validateCircuit(input.circuit);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
    const gates = sortGates(input.circuit.gates);
    const hasMidCircuitMeasurement = gates.some((gate) => gate.type === "MEASURE");
    const simulator = await loadSimulator();
    const response = await simulator.simulateCircuit({
      protocol_version: 1,
      num_qubits: input.circuit.numQubits,
      num_clbits: input.circuit.numClassicalBits,
      gates: gates.map(toWasmGate),
      options: {
        include_statevector: true,
        include_snapshots: !hasMidCircuitMeasurement && gates.length > 0,
        measurement_shots: input.shots,
        seed: input.seed ?? 0x514b4152,
      },
    }) as unknown as WasmResult;

    if (!response.success) {
      throw new Error(response.error?.message ?? "QuantumLab could not simulate this circuit.");
    }

    const { numQubits } = input.circuit;
    const states = probabilitiesFor(response.probabilities, numQubits, response.statevector);
    const snapshots: SimulationSnapshot[] = [];
    if (response.statevector) {
      const initial = Array.from({ length: 2 ** numQubits }, (_, index) => ({ real: index === 0 ? 1 : 0, imag: 0 }));
      snapshots.push({
        afterGateId: null,
        gateIndex: -1,
        statevector: initial.map(toAmplitude),
        probabilities: initial.map(({ real }) => real * real),
      });
    }
    for (const snapshot of response.snapshots ?? []) {
      const snapshotStates = snapshot.statevector.map(toAmplitude);
      const byIndex = new Map(gates.map((gate, index) => [index, gate]));
      const gateIndex = snapshot.gate_index;
      snapshots.push({
        afterGateId: (byIndex.get(gateIndex) as CircuitGate | undefined)?.id ?? null,
        gateIndex,
        statevector: snapshotStates,
        probabilities: snapshotStates.map(({ re, im }) => re * re + im * im),
      });
    }

    return {
      status: "completed",
      engine: this.engineName,
      isMock: false,
      convention: "q[0] is the least-significant index bit. Displayed bitstrings are q[n-1]…q[0]. Mid-circuit measurements use seeded shot trajectories.",
      probabilityMode: hasMidCircuitMeasurement ? "trajectory-estimate" : "ideal-statevector",
      circuitId: input.circuit.id,
      shots: input.shots,
      statevector: response.statevector?.map(toAmplitude) ?? null,
      probabilities: states,
      measurementCounts: response.measurement_counts ?? {},
      snapshots,
      metadata: {
        executedAt: new Date().toISOString(),
        gateCount: gates.length,
        elapsedMs: performance.now() - started,
      },
    };
  }
}

export const simulationAdapter = new QuantumLabWasmAdapter();
export const simulateCircuit = (input: SimulationInput) => simulationAdapter.simulate(input);
