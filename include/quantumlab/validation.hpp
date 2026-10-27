#pragma once

#include "quantumlab/types.hpp"

#include <stdexcept>
#include <string>

namespace quantumlab {

class QuantumError final : public std::runtime_error {
public:
    QuantumError(std::string code, std::string message);
    [[nodiscard]] const std::string& code() const noexcept;

private:
    std::string code_;
};

void validateResourceLimits(const ResourceLimits& limits);
void validateRequest(const CircuitRequest& request, const ResourceLimits& limits);
void validateStatevector(const std::vector<Complex>& statevector);

SimulationResult makeErrorResult(std::optional<std::size_t> num_qubits,
                                 std::string code,
                                 std::string message);

}  // namespace quantumlab
