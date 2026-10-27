export type SingleQubitGateType =
  | "X" | "Y" | "Z" | "H" | "S" | "SDG" | "T" | "TDG";
export type RotationGateType = "RX" | "RY" | "RZ";
export type GateType =
  | SingleQubitGateType
  | RotationGateType
  | "CNOT"
  | "CZ"
  | "SWAP"
  | "CCNOT"
  | "MEASURE"
  | "COND_X"
  | "COND_Z";

export interface QuantumRegister {
  id: string;
  name: string;
  start: number;
  size: number;
}

export interface ClassicalRegister {
  id: string;
  name: string;
  start: number;
  size: number;
}

interface GateBase {
  id: string;
  column: number;
}

export interface SingleQubitGate extends GateBase {
  type: SingleQubitGateType;
  target: number;
}

export interface RotationGate extends GateBase {
  type: RotationGateType;
  target: number;
  angle: number;
}

export interface CnotGate extends GateBase {
  type: "CNOT";
  control: number;
  target: number;
}

export interface ControlledGate extends GateBase {
  type: "CZ" | "SWAP";
  control: number;
  target: number;
}

export interface CcnotGate extends GateBase {
  type: "CCNOT";
  control1: number;
  control2: number;
  target: number;
}

export interface MeasurementGate extends GateBase {
  type: "MEASURE";
  qubit: number;
  classicalBit: number;
}

export interface ConditionalGate extends GateBase {
  type: "COND_X" | "COND_Z";
  target: number;
  conditionBit: number;
  conditionValue: 0 | 1;
}

export type CircuitGate =
  | SingleQubitGate
  | RotationGate
  | CnotGate
  | ControlledGate
  | CcnotGate
  | MeasurementGate
  | ConditionalGate;

export interface Circuit {
  schemaVersion: 1;
  id: string;
  name: string;
  numQubits: number;
  numClassicalBits: number;
  quantumRegisters: QuantumRegister[];
  classicalRegisters: ClassicalRegister[];
  gates: CircuitGate[];
  createdAt: string;
  updatedAt: string;
}

export interface ComplexAmplitude {
  re: number;
  im: number;
}

export interface BasisStateResult {
  index: number;
  bitstring: string;
  amplitude: ComplexAmplitude | null;
  probability: number;
}

export interface SimulationSnapshot {
  afterGateId: string | null;
  gateIndex: number;
  statevector: ComplexAmplitude[];
  probabilities: number[];
}

export interface SimulationInput {
  circuit: Circuit;
  shots: number;
  seed?: number;
}

export interface SimulationResult {
  status: "completed";
  engine: string;
  isMock: boolean;
  convention: string;
  probabilityMode: "ideal-statevector" | "trajectory-estimate";
  circuitId: string;
  shots: number;
  statevector: ComplexAmplitude[] | null;
  probabilities: BasisStateResult[];
  measurementCounts: Record<string, number>;
  snapshots: SimulationSnapshot[];
  metadata: {
    executedAt: string;
    gateCount: number;
    elapsedMs: number;
  };
}

export interface SimulationAdapter {
  readonly engineName: string;
  simulate(input: SimulationInput): Promise<SimulationResult>;
}
