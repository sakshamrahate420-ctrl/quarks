#pragma once

#include "quantumlab/types.hpp"

namespace quantumlab {

// Runs a complete ideal state-vector circuit. Errors are returned in the result,
// never by exposing a C++ exception across the public API.
SimulationResult simulateCircuit(const CircuitRequest& request,
                                 const ResourceLimits& limits = {});

// Utility functions shared by the engine, bindings and tests.
std::vector<double> calculateProbabilities(const std::vector<Complex>& statevector);
double calculateNormSquared(const std::vector<Complex>& statevector);
std::string basisIndexToBitstring(std::size_t index, std::size_t num_qubits);

}  // namespace quantumlab
