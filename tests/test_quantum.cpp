#include "quantumlab/measurement.hpp"
#include "quantumlab/simulator.hpp"
#include "quantumlab/validation.hpp"

#include <cmath>
#include <complex>
#include <cstdint>
#include <functional>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {
using namespace quantumlab;
constexpr double kTestTolerance = 1.0e-10;
int failures = 0;
int checks = 0;

void check(bool condition, const std::string& message) {
    ++checks;
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}

void checkNear(double actual, double expected, const std::string& message,
               double tolerance = kTestTolerance) {
    check(std::abs(actual - expected) <= tolerance,
          message + " (actual=" + std::to_string(actual) + ", expected=" + std::to_string(expected) + ")");
}

void checkComplex(const Complex& actual, const Complex& expected, const std::string& message,
                  double tolerance = kTestTolerance) {
    check(std::abs(actual - expected) <= tolerance,
          message + " (actual=" + std::to_string(actual.real()) + "+" +
          std::to_string(actual.imag()) + "i)");
}

SimulationResult run(std::int64_t qubits, std::vector<Gate> gates = {},
                     SimulationOptions options = {}, ResourceLimits limits = {}) {
    CircuitRequest request;
    request.num_qubits = qubits;
    request.gates = std::move(gates);
    request.options = options;
    return simulateCircuit(request, limits);
}

void testInitialState() {
    const auto result = run(3);
    check(result.success, "initial state request succeeds");
    check(result.statevector.has_value(), "initial statevector is present by default");
    if (!result.statevector) return;
    check(result.statevector->size() == 8, "three qubits have eight amplitudes");
    checkComplex((*result.statevector)[0], Complex{1.0, 0.0}, "initial amplitude is one at index 0");
    for (std::size_t i = 1; i < result.statevector->size(); ++i) {
        checkComplex((*result.statevector)[i], Complex{0.0, 0.0}, "other initial amplitudes are zero");
    }
    checkNear(result.probabilities[0], 1.0, "initial |000> probability is one");
}

void testXGate() {
    const auto result = run(1, {{"X", 0, -1}});
    check(result.success, "X gate succeeds");
    if (!result.statevector) return;
    checkComplex((*result.statevector)[0], Complex{0.0, 0.0}, "X maps |0> amplitude away from index 0");
    checkComplex((*result.statevector)[1], Complex{1.0, 0.0}, "X maps |0> to |1>");
    checkNear(result.probabilities[1], 1.0, "X output probability is one at index 1");
}

void testHGate() {
    const auto result = run(1, {{"H", 0, -1}});
    check(result.success, "H gate succeeds");
    if (!result.statevector) return;
    const double amp = std::sqrt(0.5);
    checkComplex((*result.statevector)[0], Complex{amp, 0.0}, "H creates positive |0> amplitude");
    checkComplex((*result.statevector)[1], Complex{amp, 0.0}, "H creates positive |1> amplitude");
    checkNear(result.probabilities[0], 0.5, "H probability for |0> is one half");
    checkNear(result.probabilities[1], 0.5, "H probability for |1> is one half");
}

void testZAndYComplexBehaviour() {
    const auto z_result = run(1, {{"H", 0, -1}, {"Z", 0, -1}});
    check(z_result.success, "Z after H succeeds");
    if (z_result.statevector) {
        const double amp = std::sqrt(0.5);
        checkComplex((*z_result.statevector)[0], Complex{amp, 0.0}, "Z preserves |0> amplitude");
        checkComplex((*z_result.statevector)[1], Complex{-amp, 0.0}, "Z flips the phase of |1>");
    }

    const auto y_result = run(1, {{"Y", 0, -1}});
    check(y_result.success, "Y gate succeeds");
    if (y_result.statevector) {
        checkComplex((*y_result.statevector)[0], Complex{0.0, 0.0}, "Y|0> has zero |0> amplitude");
        checkComplex((*y_result.statevector)[1], Complex{0.0, 1.0}, "Y|0> equals i|1>");
    }

    const auto y_twice = run(1, {{"Y", 0, -1}, {"Y", 0, -1}});
    check(y_twice.success, "two Y gates succeed");
    if (y_twice.statevector) {
        checkComplex((*y_twice.statevector)[0], Complex{1.0, 0.0}, "Y squared equals I on |0>");
        checkComplex((*y_twice.statevector)[1], Complex{0.0, 0.0}, "Y squared returns state to |0>");
    }
}

void testCnotControlTargetSemantics() {
    // X(q0) makes |01>; CNOT(0 -> 1) must flip q1, producing |11>.
    const auto q0_control = run(2, {{"X", 0, -1}, {"CNOT", 1, 0}});
    check(q0_control.success, "CNOT with control q0 succeeds");
    if (q0_control.statevector) {
        checkNear(q0_control.probabilities[3], 1.0, "control q0 flips target q1 from |01> to |11>");
    }

    // X(q1) makes |10>; control q0 is zero so the gate must not fire.
    const auto not_triggered = run(2, {{"X", 1, -1}, {"CNOT", 1, 0}});
    check(not_triggered.success, "CNOT with zero control succeeds");
    if (not_triggered.statevector) {
        checkNear(not_triggered.probabilities[2], 1.0, "CNOT leaves |10> unchanged when control q0 is zero");
    }

    // With control q1 and target q0, |10> becomes |11>.
    const auto reverse_control = run(2, {{"X", 1, -1}, {"CNOT", 0, 1}});
    check(reverse_control.success, "reverse-control CNOT succeeds");
    if (reverse_control.statevector) {
        checkNear(reverse_control.probabilities[3], 1.0, "control q1 flips target q0");
    }
}

void testBellState() {
    SimulationOptions options;
    options.include_snapshots = true;
    const auto result = run(2, {{"H", 0, -1}, {"CNOT", 1, 0}}, options);
    check(result.success, "Bell-state circuit succeeds");
    check(result.snapshots.size() == 2, "Bell-state snapshots contain one item per gate");
    if (result.statevector) {
        const double amp = std::sqrt(0.5);
        checkComplex((*result.statevector)[0], Complex{amp, 0.0}, "Bell amplitude |00>");
        checkComplex((*result.statevector)[1], Complex{0.0, 0.0}, "Bell amplitude |01> is zero");
        checkComplex((*result.statevector)[2], Complex{0.0, 0.0}, "Bell amplitude |10> is zero");
        checkComplex((*result.statevector)[3], Complex{amp, 0.0}, "Bell amplitude |11>");
    }
    checkNear(result.probabilities[0], 0.5, "Bell P(00) is one half");
    checkNear(result.probabilities[1], 0.0, "Bell P(01) is zero");
    checkNear(result.probabilities[2], 0.0, "Bell P(10) is zero");
    checkNear(result.probabilities[3], 0.5, "Bell P(11) is one half");
}

void testNormalizationAndProbabilitySum() {
    const auto result = run(4, {{"H", 0, -1}, {"H", 2, -1}, {"Y", 3, -1}, {"CNOT", 1, 0}, {"Z", 2, -1}});
    check(result.success, "mixed gate circuit succeeds normalization checks");
    checkNear(calculateNormSquared(*result.statevector), 1.0, "state norm squared is one");
    double sum = 0.0;
    for (const double probability : result.probabilities) {
        check(probability >= 0.0 && std::isfinite(probability), "probability is finite and nonnegative");
        sum += probability;
    }
    checkNear(sum, 1.0, "probabilities sum to one", 1.0e-9);
}

void testDeterministicMeasurements() {
    SimulationOptions options;
    options.measurement_shots = 4096;
    options.seed = 123456U;
    const std::vector<Gate> bell{{"H", 0, -1}, {"CNOT", 1, 0}};
    const auto first = run(2, bell, options);
    const auto second = run(2, bell, options);
    check(first.success && second.success, "seeded measurements succeed");
    check(first.measurement_counts == second.measurement_counts, "fixed seed produces identical count maps");
    check(first.measurement_counts.at("00") == 2067 && first.measurement_counts.at("11") == 2029,
          "fixed SplitMix64 seed has a cross-build golden count result");
    std::uint64_t total = 0;
    for (const auto& [bitstring, count] : first.measurement_counts) {
        check(bitstring == "00" || bitstring == "11", "Bell measurements only produce correlated outcomes");
        total += count;
    }
    check(total == options.measurement_shots, "measurement counts add up to requested shots");
    check(first.measurement_counts.size() == 2, "both Bell outcomes occur for this fixed sample");

    const auto no_sampling = run(1);
    check(no_sampling.measurement_counts.empty(), "zero shots disables sampling");
}

void testBitstringOrdering() {
    check(basisIndexToBitstring(0, 2) == "00", "index 0 displays as 00");
    check(basisIndexToBitstring(1, 2) == "01", "q0 is the rightmost displayed bit");
    check(basisIndexToBitstring(2, 2) == "10", "q1 is the leftmost displayed bit");
    check(basisIndexToBitstring(3, 2) == "11", "index 3 displays as 11");
}

void testOptionsAndSnapshots() {
    SimulationOptions options;
    options.include_statevector = false;
    options.include_snapshots = true;
    const auto result = run(1, {{"H", 0, -1}, {"Z", 0, -1}}, options);
    check(result.success, "snapshot-only state output succeeds");
    check(!result.statevector.has_value(), "final statevector omitted when disabled");
    check(result.snapshots.size() == 2, "snapshots are still emitted when final statevector output is disabled");
    if (!result.snapshots.empty()) {
        check(result.snapshots[0].gate_index == 0, "snapshot gate indices are zero-based");
        checkComplex(result.snapshots[0].statevector[0], Complex{std::sqrt(0.5), 0.0}, "first snapshot records post-H state");
    }
}

void testInvalidInputs() {
    auto result = run(1, {{"FOO", 0, -1}});
    check(!result.success && result.error && result.error->code == "INVALID_GATE", "unknown gate is rejected");

    result = run(1, {{"X", 1, -1}});
    check(!result.success && result.error && result.error->code == "INVALID_QUBIT_INDEX", "out-of-range target is rejected");

    result = run(2, {{"CNOT", 0, 0}});
    check(!result.success && result.error && result.error->code == "INVALID_CNOT", "same CNOT control and target is rejected");

    result = run(2, {{"CNOT", 2, 0}});
    check(!result.success && result.error && result.error->code == "INVALID_QUBIT_INDEX", "out-of-range CNOT control is rejected");

    result = run(1, {{"H", 0, 0}});
    check(!result.success && result.error && result.error->code == "INVALID_GATE", "control is rejected on single-qubit gates");

    result = run(0);
    check(!result.success && result.error && result.error->code == "INVALID_REQUEST", "zero qubits is rejected");

    CircuitRequest unsupported;
    unsupported.protocol_version = 99;
    const auto version_result = simulateCircuit(unsupported);
    check(!version_result.success && version_result.error &&
          version_result.error->code == "UNSUPPORTED_PROTOCOL_VERSION", "unsupported protocol version is rejected");
}

void testResourceLimits() {
    ResourceLimits limits;
    limits.max_qubits = 1;
    auto result = run(2, {}, {}, limits);
    check(!result.success && result.error && result.error->code == "RESOURCE_LIMIT_EXCEEDED", "configured qubit limit is enforced");

    limits = ResourceLimits{};
    limits.max_measurement_shots = 2;
    SimulationOptions options;
    options.measurement_shots = 3;
    result = run(1, {}, options, limits);
    check(!result.success && result.error && result.error->code == "RESOURCE_LIMIT_EXCEEDED", "configured shot limit is enforced");

    limits = ResourceLimits{};
    limits.max_snapshot_bytes = 16;
    options = SimulationOptions{};
    options.include_snapshots = true;
    result = run(2, {{"H", 0, -1}}, options, limits);
    check(!result.success && result.error && result.error->code == "RESOURCE_LIMIT_EXCEEDED", "snapshot memory budget is enforced");

    result = run(static_cast<std::int64_t>(kHardMaximumQubits + 1));
    check(!result.success && result.error && result.error->code == "RESOURCE_LIMIT_EXCEEDED", "hard qubit limit is enforced");

    ResourceLimits invalid;
    invalid.max_qubits = kHardMaximumQubits + 1;
    result = run(1, {}, {}, invalid);
    check(!result.success && result.error && result.error->code == "INVALID_CONFIG", "unsafe resource configuration is rejected");
}

}  // namespace

int main() {
    testInitialState();
    testXGate();
    testHGate();
    testZAndYComplexBehaviour();
    testCnotControlTargetSemantics();
    testBellState();
    testNormalizationAndProbabilitySum();
    testDeterministicMeasurements();
    testBitstringOrdering();
    testOptionsAndSnapshots();
    testInvalidInputs();
    testResourceLimits();

    if (failures != 0) {
        std::cerr << "QuantumLab tests: " << failures << " failure(s) across " << checks << " checks.\n";
        return 1;
    }
    std::cout << "QuantumLab tests: all " << checks << " checks passed.\n";
    return 0;
}
