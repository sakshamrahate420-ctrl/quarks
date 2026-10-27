export type QuantumLabResponse = {
  protocol_version: number; success: boolean; num_qubits: number | null;
  statevector: { real: number; imag: number }[] | null; probabilities: number[];
  measurement_counts: Record<string, number>; classical_counts: Record<string, number>;
  snapshots: { gate_index: number; gate: Record<string, unknown>; statevector: { real: number; imag: number }[] }[];
  error?: { code: string; message: string };
};
export function createSimulator(options?: Record<string, unknown>): Promise<{
  protocolVersion: number; simulateCircuit(request: Record<string, unknown>): Promise<QuantumLabResponse>;
}>;
export const PROTOCOL_VERSION: number;
