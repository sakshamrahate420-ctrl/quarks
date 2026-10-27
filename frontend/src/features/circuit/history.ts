import { validateCircuit } from "./model";
import type { Circuit } from "./types";

export interface CircuitHistory {
  past: Circuit[];
  present: Circuit;
  future: Circuit[];
  limit: number;
}

export function createCircuitHistory(
  initial: Circuit,
  limit = 100,
): CircuitHistory {
  assertCircuit(initial);
  return {
    past: [],
    present: structuredClone(initial),
    future: [],
    limit: Math.max(1, limit),
  };
}

export function commitCircuit(
  history: CircuitHistory,
  next: Circuit,
): CircuitHistory {
  assertCircuit(next);
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  const past = [...history.past, structuredClone(history.present)];
  if (past.length > history.limit) past.shift();
  return {
    ...history,
    past,
    present: structuredClone(next),
    future: [],
  };
}

export function undoCircuit(history: CircuitHistory): CircuitHistory {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: structuredClone(previous),
    future: [structuredClone(history.present), ...history.future],
  };
}

export function redoCircuit(history: CircuitHistory): CircuitHistory {
  if (history.future.length === 0) return history;
  const next = history.future[0];
  if (!next) return history;
  const past = [...history.past, structuredClone(history.present)];
  if (past.length > history.limit) past.shift();
  return {
    ...history,
    past,
    present: structuredClone(next),
    future: history.future.slice(1),
  };
}

export function canUndoCircuit(history: CircuitHistory): boolean {
  return history.past.length > 0;
}

export function canRedoCircuit(history: CircuitHistory): boolean {
  return history.future.length > 0;
}

function assertCircuit(circuit: Circuit): void {
  const validation = validateCircuit(circuit);
  if (!validation.valid) {
    throw new Error(`Invalid circuit state: ${validation.errors.join(" ")}`);
  }
}
