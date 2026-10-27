#include "quantumlab/simulator.hpp"

#include "quantumlab/validation.hpp"
#include "quantumlab/measurement.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <new>
#include <utility>

namespace quantumlab {
namespace {

void applyGate(std::vector<Complex>& state, const Gate& gate, std::size_t num_qubits) {
    const std::size_t target_mask = std::size_t{1} << static_cast<std::size_t>(gate.target);
    const std::size_t state_count = state.size();
    const Complex imaginary_unit{0.0, 1.0};

    if (gate.type == "RX" || gate.type == "RY" || gate.type == "RZ") {
        const double half_angle = gate.angle * 0.5;
        const double cosine = std::cos(half_angle);
        const double sine = std::sin(half_angle);
        for (std::size_t index = 0; index < state_count; ++index) {
            const bool target_is_one = (index & target_mask) != 0;
            if (gate.type == "RZ") {
                state[index] *= target_is_one
                    ? Complex{cosine, sine}
                    : Complex{cosine, -sine};
            } else if (!target_is_one) {
                const std::size_t partner = index | target_mask;
                const Complex zero_amplitude = state[index];
                const Complex one_amplitude = state[partner];
                if (gate.type == "RX") {
                    state[index] = cosine * zero_amplitude - imaginary_unit * sine * one_amplitude;
                    state[partner] = -imaginary_unit * sine * zero_amplitude + cosine * one_amplitude;
                } else {
                    state[index] = cosine * zero_amplitude - sine * one_amplitude;
                    state[partner] = sine * zero_amplitude + cosine * one_amplitude;
                }
            }
        }
        return;
    }

    if (gate.type == "S" || gate.type == "SDG" || gate.type == "T" || gate.type == "TDG") {
        const double phase = gate.type == "S" ? 1.57079632679489661923
            : gate.type == "SDG" ? -1.57079632679489661923
            : gate.type == "T" ? 0.785398163397448309616
            : -0.785398163397448309616;
        const Complex phase_factor{std::cos(phase), std::sin(phase)};
        for (std::size_t index = 0; index < state_count; ++index) {
            if ((index & target_mask) != 0) state[index] *= phase_factor;
        }
        return;
    }

    if (gate.type == "X") {
        for (std::size_t index = 0; index < state_count; ++index) {
            if ((index & target_mask) == 0) {
                std::swap(state[index], state[index | target_mask]);
            }
        }
        return;
    }

    if (gate.type == "Y") {
        for (std::size_t index = 0; index < state_count; ++index) {
            if ((index & target_mask) == 0) {
                const std::size_t partner = index | target_mask;
                const Complex zero_amplitude = state[index];
                const Complex one_amplitude = state[partner];
                state[index] = -imaginary_unit * one_amplitude;
                state[partner] = imaginary_unit * zero_amplitude;
            }
        }
        return;
    }

    if (gate.type == "Z") {
        for (std::size_t index = 0; index < state_count; ++index) {
            if ((index & target_mask) != 0) {
                state[index] = -state[index];
            }
        }
        return;
    }

    if (gate.type == "H") {
        constexpr double inverse_sqrt_two = 0.707106781186547524400844362104849039;
        for (std::size_t index = 0; index < state_count; ++index) {
            if ((index & target_mask) == 0) {
                const std::size_t partner = index | target_mask;
                const Complex zero_amplitude = state[index];
                const Complex one_amplitude = state[partner];
                state[index] = (zero_amplitude + one_amplitude) * inverse_sqrt_two;
                state[partner] = (zero_amplitude - one_amplitude) * inverse_sqrt_two;
            }
        }
        return;
    }

    if (gate.type == "CNOT" || gate.type == "CZ" || gate.type == "SWAP") {
        const std::size_t control_mask = std::size_t{1} << static_cast<std::size_t>(gate.control);
        for (std::size_t index = 0; index < state_count; ++index) {
            const bool control_is_one = (index & control_mask) != 0;
            const bool target_is_zero = (index & target_mask) == 0;
            if (gate.type == "CZ" && control_is_one && !target_is_zero) {
                state[index] = -state[index];
            } else if (gate.type == "SWAP" && control_is_one && target_is_zero) {
                std::swap(state[index], state[index | target_mask]);
            } else if (gate.type == "CNOT" && control_is_one && target_is_zero) {
                std::swap(state[index], state[index | target_mask]);
            }
        }
        return;
    }

    if (gate.type == "CCNOT") {
        const std::size_t control_mask = std::size_t{1} << static_cast<std::size_t>(gate.control);
        const std::size_t control2_mask = std::size_t{1} << static_cast<std::size_t>(gate.control2);
        for (std::size_t index = 0; index < state_count; ++index) {
            if ((index & control_mask) != 0 && (index & control2_mask) != 0 &&
                (index & target_mask) == 0) {
                std::swap(state[index], state[index | target_mask]);
            }
        }
        return;
    }

    // Validation rejects unknown gate types before state allocation.
    (void)num_qubits;
    throw QuantumError("INVALID_GATE", "Unknown gate type encountered by the simulation engine.");
}

SimulationResult simulateMeasuredCircuit(const CircuitRequest& request, std::size_t num_qubits) {
    const std::size_t state_count = std::size_t{1} << num_qubits;
    const std::uint64_t shots = request.options.measurement_shots;
    MeasurementRng rng(static_cast<std::uint64_t>(request.options.seed));
    std::vector<long double> probability_sums(state_count, 0.0L);
    SimulationResult result;
    result.success = true;
    result.num_qubits = num_qubits;

    for (std::uint64_t shot = 0; shot < shots; ++shot) {
        std::vector<Complex> state(state_count, Complex{0.0, 0.0});
        state[0] = Complex{1.0, 0.0};
        std::vector<std::uint8_t> classical_bits(request.num_clbits, 0U);

        for (const Gate& gate : request.gates) {
            if (gate.type == "MEASURE") {
                const bool outcome = measureQubit(state, num_qubits,
                    static_cast<std::size_t>(gate.target), rng);
                classical_bits[static_cast<std::size_t>(gate.classical_bit)] = outcome ? 1U : 0U;
                continue;
            }
            if (gate.condition_bit >= 0 &&
                (classical_bits[static_cast<std::size_t>(gate.condition_bit)] != 0U) != gate.condition_value) {
                continue;
            }
            applyGate(state, gate, num_qubits);
            validateStatevector(state);
        }

        for (std::size_t index = 0; index < state_count; ++index) {
            probability_sums[index] += static_cast<long double>(std::norm(state[index]));
        }
        const std::size_t final_index = sampleBasisIndex(state, rng);
        ++result.measurement_counts[basisIndexToBitstring(final_index, num_qubits)];

        std::string classical_string;
        classical_string.reserve(request.num_clbits);
        for (std::size_t bit = request.num_clbits; bit > 0; --bit) {
            classical_string.push_back(classical_bits[bit - 1U] != 0U ? '1' : '0');
        }
        ++result.classical_counts[classical_string];
    }

    result.probabilities.reserve(state_count);
    const long double divisor = static_cast<long double>(shots);
    for (const long double sum : probability_sums) {
        result.probabilities.push_back(static_cast<double>(sum / divisor));
    }
    // A measured circuit produces an ensemble of collapsed states, not one pure
    // statevector that could be returned as the result.
    result.statevector = std::nullopt;
    return result;
}

}  // namespace

SimulationResult simulateCircuit(const CircuitRequest& request, const ResourceLimits& limits) {
    std::optional<std::size_t> reported_qubits;
    if (request.num_qubits >= 1 &&
        static_cast<std::uint64_t>(request.num_qubits) <= static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
        reported_qubits = static_cast<std::size_t>(request.num_qubits);
    }

    try {
        validateRequest(request, limits);
        const std::size_t num_qubits = static_cast<std::size_t>(request.num_qubits);
        const bool has_mid_circuit_measurement = std::any_of(
            request.gates.begin(), request.gates.end(),
            [](const Gate& gate) { return gate.type == "MEASURE"; });
        if (has_mid_circuit_measurement) {
            return simulateMeasuredCircuit(request, num_qubits);
        }
        const std::size_t state_count = std::size_t{1} << num_qubits;
        std::vector<Complex> state(state_count, Complex{0.0, 0.0});
        state[0] = Complex{1.0, 0.0};

        std::vector<Snapshot> snapshots;
        if (request.options.include_snapshots) {
            snapshots.reserve(request.gates.size());
        }

        for (std::size_t index = 0; index < request.gates.size(); ++index) {
            const Gate& gate = request.gates[index];
            if (gate.condition_bit >= 0 && gate.condition_value) continue;
            applyGate(state, gate, num_qubits);
            validateStatevector(state);
            if (request.options.include_snapshots) {
                snapshots.push_back(Snapshot{index, request.gates[index], state});
            }
        }

        SimulationResult result;
        result.success = true;
        result.num_qubits = num_qubits;
        result.probabilities = calculateProbabilities(state);
        result.snapshots = std::move(snapshots);
        if (request.options.include_statevector) {
            result.statevector = state;
        }
        if (request.options.measurement_shots > 0) {
            result.measurement_counts = sampleMeasurements(state, num_qubits,
                                                           request.options.measurement_shots,
                                                           request.options.seed);
        }
        return result;
    } catch (const QuantumError& error) {
        return makeErrorResult(reported_qubits, error.code(), error.what());
    } catch (const std::bad_alloc&) {
        return makeErrorResult(reported_qubits, "RESOURCE_LIMIT_EXCEEDED", "Memory allocation failed for this simulation request.");
    } catch (const std::exception& error) {
        return makeErrorResult(reported_qubits, "INTERNAL_ERROR", error.what());
    } catch (...) {
        return makeErrorResult(reported_qubits, "INTERNAL_ERROR", "An unknown internal error occurred.");
    }
}

double calculateNormSquared(const std::vector<Complex>& statevector) {
    long double total = 0.0L;
    for (const Complex& amplitude : statevector) {
        const long double real = static_cast<long double>(amplitude.real());
        const long double imag = static_cast<long double>(amplitude.imag());
        total += real * real + imag * imag;
    }
    return static_cast<double>(total);
}

std::vector<double> calculateProbabilities(const std::vector<Complex>& statevector) {
    std::vector<double> probabilities;
    probabilities.reserve(statevector.size());
    for (const Complex& amplitude : statevector) {
        const double probability = std::norm(amplitude);
        if (!std::isfinite(probability) || probability < 0.0) {
            throw QuantumError("NUMERICAL_ERROR", "A calculated probability is invalid.");
        }
        probabilities.push_back(probability);
    }
    return probabilities;
}

std::string basisIndexToBitstring(std::size_t index, std::size_t num_qubits) {
    if (num_qubits > kHardMaximumQubits) {
        throw QuantumError("RESOURCE_LIMIT_EXCEEDED", "Cannot format a basis state above the hard qubit limit.");
    }
    const std::size_t state_count = std::size_t{1} << num_qubits;
    if (index >= state_count) {
        throw QuantumError("INVALID_QUBIT_INDEX", "Basis-state index is outside the state-vector range.");
    }
    std::string bits;
    bits.reserve(num_qubits);
    for (std::size_t bit = num_qubits; bit > 0; --bit) {
        bits.push_back(((index >> (bit - 1U)) & std::size_t{1}) != 0 ? '1' : '0');
    }
    return bits;
}

}  // namespace quantumlab
