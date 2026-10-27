import createQuantumLabModule from "../build/wasm/quantumlab_wasm.mjs";

const PROTOCOL_VERSION = 1;
const HARD_MAX_QUBITS = 20;
const HARD_MAX_GATES = 10_000;
const HARD_MAX_SHOTS = 1_000_000;
const HARD_MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;

function checkedInteger(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function normaliseConfig(options) {
  return {
    max_qubits: checkedInteger(options.maxQubits ?? 16, "maxQubits", 1, HARD_MAX_QUBITS),
    max_gates: checkedInteger(options.maxGates ?? HARD_MAX_GATES, "maxGates", 0, HARD_MAX_GATES),
    max_measurement_shots: checkedInteger(
      options.maxMeasurementShots ?? 100_000,
      "maxMeasurementShots",
      0,
      HARD_MAX_SHOTS,
    ),
    max_snapshot_bytes: checkedInteger(
      options.maxSnapshotBytes ?? HARD_MAX_SNAPSHOT_BYTES,
      "maxSnapshotBytes",
      0,
      HARD_MAX_SNAPSHOT_BYTES,
    ),
  };
}

function failureResponse(request, code, message) {
  const n = request && Number.isSafeInteger(request.num_qubits) && request.num_qubits > 0
    ? request.num_qubits
    : null;
  return {
    protocol_version: PROTOCOL_VERSION,
    success: false,
    num_qubits: n,
    statevector: null,
    probabilities: [],
    measurement_counts: {},
    classical_counts: {},
    snapshots: [],
    error: { code, message },
  };
}

/**
 * Load the WebAssembly engine and return the stable QuantumLab JavaScript API.
 *
 * Options:
 *   maxQubits: 1..20 (default 16)
 *   maxGates: 0..10000 (default 10000)
 *   maxMeasurementShots: 0..1000000 (default 100000)
 *   maxSnapshotBytes: 0..33554432 (default 32 MiB)
 *   moduleFactory: optional test hook; not needed by normal website code
 */
export async function createSimulator(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("createSimulator options must be an object.");
  }
  const nativeConfig = normaliseConfig(options);
  const moduleFactory = options.moduleFactory ?? createQuantumLabModule;
  if (typeof moduleFactory !== "function") {
    throw new TypeError("moduleFactory must be a function.");
  }

  let module;
  try {
    module = await moduleFactory();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`QuantumLab WASM module could not be loaded: ${detail}`, { cause: error });
  }

  if (typeof module?.simulateCircuit !== "function" || typeof module?.getProtocolVersion !== "function") {
    throw new Error("Loaded WASM module is missing the QuantumLab protocol exports.");
  }
  if (module.getProtocolVersion() !== PROTOCOL_VERSION) {
    throw new Error(`WASM protocol mismatch. Expected version ${PROTOCOL_VERSION}.`);
  }

  return Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    /**
     * Return a version-1 response object. Circuit/request failures are represented
     * by success:false and error:{code,message}; they do not normally reject this promise.
     * Note: Promise-based does not move synchronous WASM work off the UI thread.
     */
    async simulateCircuit(request) {
      try {
        return module.simulateCircuit(request, nativeConfig);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return failureResponse(request, "INTERNAL_ERROR", detail);
      }
    },
  });
}

export { PROTOCOL_VERSION };
