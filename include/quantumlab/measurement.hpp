#pragma once

#include "quantumlab/types.hpp"

namespace quantumlab {

class MeasurementRng {
public:
    explicit MeasurementRng(std::uint64_t seed) : state_(seed) {}
    [[nodiscard]] std::uint64_t next() noexcept;
    [[nodiscard]] double nextUnitInterval() noexcept;

private:
    std::uint64_t state_;
};

std::size_t sampleBasisIndex(const std::vector<Complex>& statevector, MeasurementRng& rng);
bool measureQubit(std::vector<Complex>& statevector, std::size_t num_qubits,
                  std::size_t qubit, MeasurementRng& rng);

std::map<std::string, std::uint64_t> sampleMeasurements(
    const std::vector<Complex>& statevector,
    std::size_t num_qubits,
    std::uint64_t shots,
    std::uint32_t seed);

}  // namespace quantumlab
