# QuantumLab protocol v1

This document is the contract between the separate website and the C++ simulation engine. Field names are case-sensitive. JSON examples use standard JSON syntax.

## Qubit ordering

- Qubit indices are zero-based.
- `q0` is the least-significant bit (LSB): bit `q` of a basis index is `(index >> q) & 1`.
- State-vector index `i` corresponds to the displayed string `q(n-1)...q1q0`.
- For two qubits, index 1 is `01` and index 2 is `10`.
- CNOT flips `target` only when `control` is 1. `control` and `target` must be different.

## Request

```json
{
  "protocol_version": 1,
  "num_qubits": 2,
  "num_clbits": 0,
  "gates": [
    { "type": "H", "target": 0 },
    { "type": "CNOT", "control": 0, "target": 1 }
  ],
  "options": {
    "include_statevector": true,
    "include_snapshots": true,
    "measurement_shots": 1000,
    "seed": 42
  }
}
```

`protocol_version`, `num_qubits`, and `gates` are required. `options` can be omitted, in which case its defaults apply.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `protocol_version` | integer | required | Must be `1`. |
| `num_qubits` | integer | required | Positive qubit count; at most 16 by default, never above 20. |
| `num_clbits` | integer | `0` | Classical register size; at most 64. Required by measurement and conditional operations. |
| `gates` | array | required | Operations executed in order. |
| `options.include_statevector` | boolean | `true` | Include final amplitudes. |
| `options.include_snapshots` | boolean | `false` | Include state after every gate. |
| `options.measurement_shots` | integer | `0` | Number of terminal samples; zero disables sampling. |
| `options.seed` | unsigned 32-bit integer | `0` | Seed for reproducible measurement sampling. |

Gate schema:

- Fixed one-qubit gates `X`, `Y`, `Z`, `H`, `S`, `SDG`, `T`, `TDG`: `{ "type": "H", "target": 0 }`.
- Rotations `RX`, `RY`, `RZ`: `{ "type": "RY", "target": 0, "angle": 1.5707963267948966 }`. The angle is in radians.
- Controlled-NOT and controlled-Z: `{ "type": "CNOT", "control": 0, "target": 1 }` or `{ "type": "CZ", "control": 0, "target": 1 }`.
- Swap: `{ "type": "SWAP", "control": 0, "target": 1 }`. Here `control` is the other qubit operand; it is not a conditional control.
- Toffoli / controlled-controlled-NOT: `{ "type": "CCNOT", "control": 0, "control2": 1, "target": 2 }`.
- Measurement: `{ "type": "MEASURE", "target": 0, "classical_bit": 0 }`. It measures the qubit during each shot, collapses that shot's state, and writes the result to the selected classical bit.
- Conditional X/Z: `{ "type": "X", "target": 2, "condition": { "bit": 1, "equals": 1 } }`. The gate runs only when the stored classical bit matches `equals` (0 or 1). Conditions are currently supported on X and Z only.

Gate names are uppercase and exact. Only rotation gates accept `angle`. One-qubit gates must not specify controls; two-qubit gates need distinct `control` and `target` indices; `CCNOT` needs three distinct indices. Extra unrelated properties are ignored by version 1; required property types and values are validated.

See [`examples/advanced-circuit.json`](../examples/advanced-circuit.json) for a complete circuit using rotations, entangling gates, Toffoli, and measurement sampling.
See [`examples/measurement-feed-forward.json`](../examples/measurement-feed-forward.json) for two mid-circuit measurements followed by classically controlled X and Z corrections.

## Response

All responses contain the following fields, including errors:

```json
{
  "protocol_version": 1,
  "success": true,
  "num_qubits": 2,
  "statevector": {
    "real": [0.7071067811865476, 0, 0, 0.7071067811865476],
    "imag": [0, 0, 0, 0]
  },
  "probabilities": [0.5, 0, 0, 0.5],
  "measurement_counts": { "00": 503, "11": 497 },
  "classical_counts": {},
  "snapshots": [],
  "error": null
}
```

The counts above illustrate structure only; counts depend on the selected seed and the sampling implementation.

- `protocol_version`: response schema version (`1`).
- `success`: true only when validation and simulation finish.
- `num_qubits`: requested positive qubit count when known, otherwise `null`.
- `statevector`: `{real: number[], imag: number[]}` or `null`. Both arrays are indexed by basis index.
- `probabilities`: one final-state probability per basis index. This is always present on success.
- `measurement_counts`: object mapping displayed bitstrings to integer counts. Counts sum to `measurement_shots` when shots are nonzero; otherwise it is empty.
- `classical_counts`: object mapping measured classical-register bitstrings to shot counts. Bitstrings are displayed as `c(n-1)...c1c0`; it is empty when the circuit has no mid-circuit measurements.
- `snapshots`: one entry per gate when snapshots are enabled, otherwise empty. Each entry has `gate_index` (zero-based), `gate`, and `statevector` representing the state immediately after that gate. Each snapshot's statevector uses split real/imaginary arrays.
- `error`: `null` on success; an object `{code, message}` on failure.

On a failed request, `statevector` is `null`, while probabilities, counts and snapshots are empty. `num_qubits` is retained when the request contained a valid positive integer.

## Error codes

| Code | Meaning |
|---|---|
| `INVALID_REQUEST` | Missing/wrong type or malformed protocol field. |
| `UNSUPPORTED_PROTOCOL_VERSION` | `protocol_version` is not 1. |
| `INVALID_GATE` | Unknown gate or control supplied to a single-qubit gate. |
| `INVALID_QUBIT_INDEX` | Target/control index is out of range. |
| `INVALID_CNOT` | CNOT control equals target. |
| `INVALID_CLASSICAL_BIT` | Measurement destination or conditional read bit is outside `num_clbits`. |
| `INVALID_CONFIG` | An engine resource limit is malformed or exceeds a hard cap. |
| `RESOURCE_LIMIT_EXCEEDED` | Qubit, gate, shot, snapshot or memory limit exceeded. |
| `NUMERICAL_ERROR` | Non-finite amplitude/probability or normalization drift. |
| `INTERNAL_ERROR` | Unexpected implementation failure. |

## Measurement and randomness

Without `MEASURE` operations, sampling remains terminal and is drawn from the final state's probability distribution. With mid-circuit measurement, the engine runs one collapsed state trajectory per shot, applies later conditional gates using that shot's classical bits, and then samples all qubits at the end. `measurement_counts` reports final qubit outcomes; `classical_counts` reports the explicitly measured classical register. For measured circuits, `statevector` is `null` because the shots produce an ensemble of collapsed states, and `probabilities` is the average final probability distribution across those trajectories. Mid-circuit measurement requires `measurement_shots` greater than zero and does not support statevector snapshots. `seed` uses a fixed SplitMix64 integer generator.

## Scope compared with IBM Quantum

This engine supports mid-circuit measurements and classical feed-forward for conditional X and Z gates. It remains an ideal state-vector simulator: it does not yet implement reset, arbitrary classical expressions, hardware calibration/noise models, transpilation to a device's native gates, or submission to IBM quantum hardware. IBM's Aer simulator supports configurable noise models, including gate and readout errors; this project does not claim hardware-equivalent results.

## Snapshots

Each snapshot stores the full state vector. The estimated raw-amplitude snapshot budget is `gate_count * 2^num_qubits * sizeof(std::complex<double>)`, capped by a configurable limit that may not exceed 32 MiB. This excludes JavaScript object overhead, so it is a conservative preflight for amplitude payloads, not a total browser-memory guarantee. Snapshots are disabled by default.
