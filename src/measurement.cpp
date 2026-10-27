#include "quantumlab/measurement.hpp"

#include "quantumlab/simulator.hpp"
#include "quantumlab/validation.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

namespace quantumlab {

std::uint64_t MeasurementRng::next() noexcept {
    std::uint64_t z = (state_ += 0x9E3779B97F4A7C15ULL);
    z = (z ^ (z >> 30U)) * 0xBF58476D1CE4E5B9ULL;
    z = (z ^ (z >> 27U)) * 0x94D049BB133111EBULL;
    return z ^ (z >> 31U);
}

double MeasurementRng::nextUnitInterval() noexcept {
    constexpr double scale = 1.0 / 9007199254740992.0; // 2^53
    return static_cast<double>(next() >> 11U) * scale;
}

std::size_t sampleBasisIndex(const std::vector<Complex>& statevector, MeasurementRng& rng) {
    validateStatevector(statevector);
    long double sample = static_cast<long double>(rng.nextUnitInterval());
    for (std::size_t index = 0; index < statevector.size(); ++index) {
        sample -= static_cast<long double>(std::norm(statevector[index]));
        if (sample < 0.0L) return index;
    }
    for (std::size_t index = statevector.size(); index > 0; --index) {
        if (std::norm(statevector[index - 1U]) > 0.0) return index - 1U;
    }
    throw QuantumError("NUMERICAL_ERROR", "Cannot sample a state with no probability mass.");
}

bool measureQubit(std::vector<Complex>& statevector, std::size_t num_qubits,
                  std::size_t qubit, MeasurementRng& rng) {
    if (num_qubits > kHardMaximumQubits || qubit >= num_qubits ||
        statevector.size() != (std::size_t{1} << num_qubits)) {
        throw QuantumError("INVALID_QUBIT_INDEX", "Measurement qubit is outside the state-vector range.");
    }
    validateStatevector(statevector);
    const std::size_t mask = std::size_t{1} << qubit;
    long double probability_one = 0.0L;
    for (std::size_t index = 0; index < statevector.size(); ++index) {
        if ((index & mask) != 0) probability_one += static_cast<long double>(std::norm(statevector[index]));
    }
    const long double draw = static_cast<long double>(rng.nextUnitInterval());
    const bool outcome = draw < probability_one;
    const long double selected_probability = outcome ? probability_one : 1.0L - probability_one;
    if (selected_probability <= 0.0L) {
        throw QuantumError("NUMERICAL_ERROR", "Measurement selected an impossible outcome.");
    }
    const double scale = 1.0 / std::sqrt(static_cast<double>(selected_probability));
    for (std::size_t index = 0; index < statevector.size(); ++index) {
        const bool bit_is_one = (index & mask) != 0;
        if (bit_is_one != outcome) statevector[index] = Complex{0.0, 0.0};
        else statevector[index] *= scale;
    }
    validateStatevector(statevector);
    return outcome;
}

std::map<std::string, std::uint64_t> sampleMeasurements(
    const std::vector<Complex>& statevector,
    std::size_t num_qubits,
    std::uint64_t shots,
    std::uint32_t seed) {
    if (shots == 0) {
        return {};
    }
    if (num_qubits > kHardMaximumQubits || statevector.size() != (std::size_t{1} << num_qubits)) {
        throw QuantumError("NUMERICAL_ERROR", "State-vector size does not match num_qubits for measurement.");
    }
    validateStatevector(statevector);

    const std::vector<double> probabilities = calculateProbabilities(statevector);
    std::vector<long double> cumulative;
    cumulative.reserve(probabilities.size());
    long double sum = 0.0L;
    std::size_t last_nonzero = 0;
    for (std::size_t index = 0; index < probabilities.size(); ++index) {
        sum += static_cast<long double>(probabilities[index]);
        cumulative.push_back(sum);
        if (probabilities[index] > 0.0) {
            last_nonzero = index;
        }
    }
    if (!std::isfinite(sum) || std::abs(sum - 1.0L) > static_cast<long double>(kNormalizationTolerance)) {
        throw QuantumError("NUMERICAL_ERROR", "Probability sum is outside the normalization tolerance.");
    }

    MeasurementRng rng(static_cast<std::uint64_t>(seed));
    std::map<std::string, std::uint64_t> counts;
    for (std::uint64_t shot = 0; shot < shots; ++shot) {
        const long double sample = static_cast<long double>(rng.nextUnitInterval());
        const auto found = std::upper_bound(cumulative.begin(), cumulative.end(), sample,
            [](long double value, long double cumulative_probability) {
                return value < cumulative_probability;
            });
        std::size_t selected = static_cast<std::size_t>(found - cumulative.begin());
        if (selected >= probabilities.size()) {
            selected = last_nonzero;
        }
        ++counts[basisIndexToBitstring(selected, num_qubits)];
    }
    return counts;
}

}  // namespace quantumlab
