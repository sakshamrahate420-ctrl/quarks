import { validateCircuit } from "../../features/circuit/model";
import type { Circuit } from "../../features/circuit/types";

const STORAGE_KEY = "quarks.local-circuits.v1";
const CURRENT_VERSION = 1;

export interface SavedCircuit {
  circuit: Circuit;
  savedAt: string;
}

interface StoredCircuitCollection {
  schemaVersion: typeof CURRENT_VERSION;
  circuits: SavedCircuit[];
}

export interface CircuitRepository {
  list(): SavedCircuit[];
  get(id: string): SavedCircuit | undefined;
  save(circuit: Circuit): SavedCircuit;
  rename(id: string, name: string): SavedCircuit;
  delete(id: string): void;
  clear(): void;
}

/**
 * Browser localStorage repository. No credentials or account data are stored.
 * Invalid/corrupt stored data is surfaced to the caller; it is never silently
 * replaced with an empty collection.
 */
export class LocalCircuitRepository implements CircuitRepository {
  constructor(private readonly storage: Storage = window.localStorage) {}

  list(): SavedCircuit[] {
    return this.read().circuits.map((entry) => structuredClone(entry));
  }

  get(id: string): SavedCircuit | undefined {
    const match = this.read().circuits.find((entry) => entry.circuit.id === id);
    return match ? structuredClone(match) : undefined;
  }

  save(circuit: Circuit): SavedCircuit {
    assertCircuit(circuit);
    const collection = this.read();
    const saved: SavedCircuit = {
      circuit: structuredClone(circuit),
      savedAt: new Date().toISOString(),
    };
    const existingIndex = collection.circuits.findIndex(
      (entry) => entry.circuit.id === circuit.id,
    );
    if (existingIndex < 0) {
      collection.circuits.unshift(saved);
    } else {
      collection.circuits[existingIndex] = saved;
    }
    this.write(collection);
    return structuredClone(saved);
  }

  rename(id: string, name: string): SavedCircuit {
    const normalized = name.trim();
    if (!normalized) throw new Error("Circuit name cannot be empty.");
    const collection = this.read();
    const entry = collection.circuits.find(
      (candidate) => candidate.circuit.id === id,
    );
    if (!entry) throw new Error("That local circuit could not be found.");
    entry.circuit = {
      ...entry.circuit,
      name: normalized,
      updatedAt: new Date().toISOString(),
    };
    entry.savedAt = new Date().toISOString();
    this.write(collection);
    return structuredClone(entry);
  }

  delete(id: string): void {
    const collection = this.read();
    this.write({
      ...collection,
      circuits: collection.circuits.filter(
        (entry) => entry.circuit.id !== id,
      ),
    });
  }

  clear(): void {
    this.storage.removeItem(STORAGE_KEY);
  }

  private read(): StoredCircuitCollection {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return { schemaVersion: CURRENT_VERSION, circuits: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "Saved circuits could not be read because local storage contains invalid data.",
      );
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== CURRENT_VERSION) {
      throw new Error(
        "Saved circuits use an unsupported format. Export a backup before clearing browser data.",
      );
    }
    if (!Array.isArray(parsed.circuits)) {
      throw new Error("Saved circuit collection is malformed.");
    }
    const circuits: SavedCircuit[] = [];
    for (const entry of parsed.circuits) {
      if (
        !isRecord(entry) ||
        typeof entry.savedAt !== "string" ||
        !isRecord(entry.circuit)
      ) {
        throw new Error("A saved circuit entry is malformed.");
      }
      assertCircuit(entry.circuit);
      circuits.push({
        circuit: structuredClone(entry.circuit as unknown as Circuit),
        savedAt: entry.savedAt,
      });
    }
    return { schemaVersion: CURRENT_VERSION, circuits };
  }

  private write(collection: StoredCircuitCollection): void {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(collection));
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        throw new Error("Browser storage is full. Export or remove old circuits.");
      }
      throw new Error("Could not save the circuit to browser storage.");
    }
  }
}

export const localCircuitRepository = new LocalCircuitRepository();

function assertCircuit(value: unknown): asserts value is Circuit {
  const result = validateCircuit(value);
  if (!result.valid) {
    throw new Error(`Invalid circuit: ${result.errors.join(" ")}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
