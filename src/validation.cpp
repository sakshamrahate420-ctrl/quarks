#include "quantumlab/validation.hpp"

#include <cmath>
#include <limits>
#include <utility>

namespace quantumlab {

QuantumError::QuantumError(std::string code, std::string message)
    : std::runtime_error(std::move(message)), code_(std::move(code)) {}

const std::string& QuantumError::code() const noexcept { return code_; }

void validateResourceLimits(const ResourceLimits& limits) {
    if (limits.max_qubits == 0 || limits.max_qubits > kHardMaximumQubits) {
        throw QuantumError("INVALID_CONFIG", "max_qubits must be between 1 and the hard limit of 20.");
    }
    if (limits.max_gates > kHardMaximumGates) {
        throw QuantumError("INVALID_CONFIG", "max_gates cannot exceed the hard limit of 10000.");
    }
    if (limits.max_measurement_shots > kHardMaximumShots) {
        throw QuantumError("INVALID_CONFIG", "max_measurement_shots cannot exceed the hard limit of 1000000.");
    }
    if (limits.max_snapshot_bytes > kHardMaximumSnapshotBytes) {
        throw QuantumError("INVALID_CONFIG", "max_snapshot_bytes cannot exceed the hard limit of 32 MiB.");
    }
}

void validateRequest(const CircuitRequest& request, const ResourceLimits& limits) {
    validateResourceLimits(limits);

    if (request.protocol_version != kProtocolVersion) {
        throw QuantumError("UNSUPPORTED_PROTOCOL_VERSION", "Only protocol_version 1 is supported.");
    }
    if (request.num_qubits < 1) {
        throw QuantumError("INVALID_REQUEST", "num_qubits must be a positive integer.");
    }
    const auto qubits = static_cast<std::uint64_t>(request.num_qubits);
    if (qubits > kHardMaximumQubits || qubits > limits.max_qubits) {
        throw QuantumError("RESOURCE_LIMIT_EXCEEDED", "num_qubits exceeds the configured or hard maximum.");
    }
    if (request.gates.size() > kHardMaximumGates || request.gates.size() > limits.max_gates) {
        throw QuantumError("RESOURCE_LIMIT_EXCEEDED", "The circuit exceeds the configured gate limit.");
    }
    if (request.num_clbits > kHardMaximumClassicalBits) {
        throw QuantumError("RESOURCE_LIMIT_EXCEEDED", "num_clbits exceeds the hard maximum of 64.");
    }
    if (request.options.measurement_shots > kHardMaximumShots ||
        request.options.measurement_shots > limits.max_measurement_shots) {
        throw QuantumError("RESOURCE_LIMIT_EXCEEDED", "measurement_shots exceeds the configured or hard maximum.");
    }

    const auto n = static_cast<std::size_t>(request.num_qubits);
    bool has_mid_circuit_measurement = false;
    for (std::size_t gate_index = 0; gate_index < request.gates.size(); ++gate_index) {
        const Gate& gate = request.gates[gate_index];
        const bool is_rotation = gate.type == "RX" || gate.type == "RY" || gate.type == "RZ";
        const bool is_measurement = gate.type == "MEASURE";
        const bool is_single_qubit_gate = gate.type == "X" || gate.type == "Y" ||
            gate.type == "Z" || gate.type == "H" || gate.type == "S" || gate.type == "SDG" ||
            gate.type == "T" || gate.type == "TDG" || is_rotation;
        const bool is_two_qubit_gate = gate.type == "CNOT" || gate.type == "CZ" || gate.type == "SWAP";
        const bool is_three_qubit_gate = gate.type == "CCNOT";
        if (!is_single_qubit_gate && !is_two_qubit_gate && !is_three_qubit_gate && !is_measurement) {
            throw QuantumError("INVALID_GATE", "Unknown gate type at gate index " + std::to_string(gate_index) + ".");
        }
        if (gate.target < 0 || static_cast<std::uint64_t>(gate.target) >= n) {
            throw QuantumError("INVALID_QUBIT_INDEX", "Gate target is outside the circuit's qubit range at gate index " +
                                                        std::to_string(gate_index) + ".");
        }
        if (is_rotation && !std::isfinite(gate.angle)) {
            throw QuantumError("INVALID_GATE", "Rotation angle must be finite at gate index " +
                                                std::to_string(gate_index) + ".");
        }
        if (!is_rotation && gate.angle != 0.0) {
            throw QuantumError("INVALID_GATE", "Only RX, RY, and RZ may specify an angle.");
        }
        if (is_two_qubit_gate || is_three_qubit_gate) {
            if (gate.control < 0 || static_cast<std::uint64_t>(gate.control) >= n) {
                throw QuantumError("INVALID_QUBIT_INDEX", "Gate control is outside the circuit's qubit range at gate index " +
                                                            std::to_string(gate_index) + ".");
            }
            if (gate.control == gate.target) {
                throw QuantumError(gate.type == "CNOT" ? "INVALID_CNOT" : "INVALID_GATE",
                                   "Gate controls and target must be different qubits.");
            }
        } else if (gate.control != -1 || gate.control2 != -1) {
            throw QuantumError("INVALID_GATE", "Single-qubit gates cannot specify control qubits.");
        }
        if (is_three_qubit_gate) {
            if (gate.control2 < 0 || static_cast<std::uint64_t>(gate.control2) >= n) {
                throw QuantumError("INVALID_QUBIT_INDEX", "Second gate control is outside the circuit's qubit range.");
            }
            if (gate.control2 == gate.target || gate.control2 == gate.control) {
                throw QuantumError("INVALID_GATE", "CCNOT controls and target must be different qubits.");
            }
        } else if (gate.control2 != -1) {
            throw QuantumError("INVALID_GATE", "Only CCNOT may specify control2.");
        }

        if (is_measurement) {
            has_mid_circuit_measurement = true;
            if (gate.classical_bit < 0 || static_cast<std::uint64_t>(gate.classical_bit) >= request.num_clbits) {
                throw QuantumError("INVALID_CLASSICAL_BIT", "Measurement classical_bit is outside num_clbits.");
            }
            if (gate.condition_bit != -1) {
                throw QuantumError("INVALID_GATE", "MEASURE cannot have a classical condition.");
            }
        } else if (gate.classical_bit != -1) {
            throw QuantumError("INVALID_GATE", "Only MEASURE may specify classical_bit.");
        }

        if (gate.condition_bit != -1) {
            if (gate.type != "X" && gate.type != "Z") {
                throw QuantumError("INVALID_GATE", "Classical conditions are supported on X and Z gates only.");
            }
            if (gate.condition_bit < 0 || static_cast<std::uint64_t>(gate.condition_bit) >= request.num_clbits) {
                throw QuantumError("INVALID_CLASSICAL_BIT", "Condition bit is outside num_clbits.");
            }
        }
    }

    if (has_mid_circuit_measurement && request.options.measurement_shots == 0) {
        throw QuantumError("INVALID_REQUEST", "Mid-circuit measurement requires measurement_shots greater than zero.");
    }
    if (has_mid_circuit_measurement && request.options.include_snapshots) {
        throw QuantumError("INVALID_REQUEST", "Statevector snapshots are not supported for circuits with mid-circuit measurement.");
    }

    if (request.options.include_snapshots && !request.gates.empty()) {
        const std::size_t states = std::size_t{1} << n;
        constexpr std::size_t bytes_per_amplitude = sizeof(Complex);
        // Division-first check avoids integer overflow in gate_count * states * bytes.
        const std::size_t bytes_per_snapshot = states * bytes_per_amplitude;
        if (bytes_per_snapshot > limits.max_snapshot_bytes ||
            request.gates.size() > limits.max_snapshot_bytes / bytes_per_snapshot) {
            throw QuantumError("RESOURCE_LIMIT_EXCEEDED", "Requested gate snapshots exceed the configured snapshot memory budget.");
        }
    }
}

void validateStatevector(const std::vector<Complex>& statevector) {
    if (statevector.empty()) {
        throw QuantumError("NUMERICAL_ERROR", "Internal state vector is empty.");
    }

    long double norm_squared = 0.0L;
    for (const Complex& amplitude : statevector) {
        if (!std::isfinite(amplitude.real()) || !std::isfinite(amplitude.imag())) {
            throw QuantumError("NUMERICAL_ERROR", "A quantum amplitude is not finite.");
        }
        const long double real = static_cast<long double>(amplitude.real());
        const long double imag = static_cast<long double>(amplitude.imag());
        norm_squared += real * real + imag * imag;
    }
    if (!std::isfinite(norm_squared) ||
        std::abs(norm_squared - 1.0L) > static_cast<long double>(kNormalizationTolerance)) {
        throw QuantumError("NUMERICAL_ERROR", "State-vector normalization drift exceeded the allowed tolerance.");
    }
}

SimulationResult makeErrorResult(std::optional<std::size_t> num_qubits,
                                 std::string code,
                                 std::string message) {
    SimulationResult result;
    result.success = false;
    result.num_qubits = num_qubits;
    result.error = Error{std::move(code), std::move(message)};
    return result;
}

}  // namespace quantumlab
