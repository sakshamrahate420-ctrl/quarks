#include "quantumlab/simulator.hpp"

#include <cmath>
#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

namespace {

using namespace quantumlab;
constexpr double kProbabilityTolerance = 1.0e-10;

SimulationResult runBernsteinVazirani(std::size_t input_qubits, std::uint32_t secret) {
    const auto ancilla = static_cast<std::int64_t>(input_qubits);
    CircuitRequest request;
    request.num_qubits = ancilla + 1;
    request.options.include_statevector = false;

    request.gates.push_back({"X", ancilla, -1});
    for (std::size_t qubit = 0; qubit <= input_qubits; ++qubit) {
        request.gates.push_back({"H", static_cast<std::int64_t>(qubit), -1});
    }
    for (std::size_t qubit = 0; qubit < input_qubits; ++qubit) {
        if (((secret >> qubit) & 1U) != 0U) {
            request.gates.push_back({"CNOT", ancilla, static_cast<std::int64_t>(qubit)});
        }
    }
    for (std::size_t qubit = 0; qubit < input_qubits; ++qubit) {
        request.gates.push_back({"H", static_cast<std::int64_t>(qubit), -1});
    }
    return simulateCircuit(request);
}

bool testEverySecretFromTwoThroughTenQubits() {
    std::size_t checked = 0;
    for (std::size_t input_qubits = 2; input_qubits <= 10; ++input_qubits) {
        const std::uint32_t secret_count = std::uint32_t{1} << input_qubits;
        const std::uint32_t input_mask = secret_count - 1U;
        for (std::uint32_t secret = 0; secret < secret_count; ++secret) {
            const SimulationResult result = runBernsteinVazirani(input_qubits, secret);
            if (!result.success) {
                std::cerr << "FAIL: n=" << input_qubits << " secret=" << secret
                          << " simulation failed";
                if (result.error) std::cerr << ": " << result.error->message;
                std::cerr << '\n';
                return false;
            }

            double recovered_probability = 0.0;
            for (std::size_t basis = 0; basis < result.probabilities.size(); ++basis) {
                if ((static_cast<std::uint32_t>(basis) & input_mask) == secret) {
                    recovered_probability += result.probabilities[basis];
                }
            }
            if (std::abs(recovered_probability - 1.0) > kProbabilityTolerance) {
                std::cerr << "FAIL: n=" << input_qubits << " secret=" << secret
                          << " recovered probability=" << recovered_probability
                          << " (tolerance " << kProbabilityTolerance << ")\n";
                return false;
            }
            ++checked;
        }
    }
    std::cout << "Passed all " << checked
              << " Bernstein-Vazirani secrets for n=2..10 (tolerance "
              << kProbabilityTolerance << ").\n";
    return true;
}

}  // namespace

int main() {
    return testEverySecretFromTwoThroughTenQubits() ? 0 : 1;
}
