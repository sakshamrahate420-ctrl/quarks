#pragma once

#include <complex>
#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace quantumlab {

using Complex = std::complex<double>;

inline constexpr std::uint32_t kProtocolVersion = 1;
inline constexpr std::size_t kHardMaximumQubits = 20;
inline constexpr std::size_t kHardMaximumGates = 10'000;
inline constexpr std::size_t kHardMaximumClassicalBits = 64;
inline constexpr std::uint64_t kHardMaximumShots = 1'000'000;
inline constexpr std::size_t kHardMaximumSnapshotBytes = 32U * 1024U * 1024U;
inline constexpr double kNormalizationTolerance = 1.0e-10;

struct Gate {
    std::string type;
    std::int64_t target = -1;
    std::int64_t control = -1;
    std::int64_t control2 = -1;
    double angle = 0.0;
    std::int64_t classical_bit = -1;
    std::int64_t condition_bit = -1;
    bool condition_value = true;
};

struct SimulationOptions {
    bool include_statevector = true;
    bool include_snapshots = false;
    std::uint64_t measurement_shots = 0;
    std::uint32_t seed = 0;
};

struct CircuitRequest {
    std::uint32_t protocol_version = kProtocolVersion;
    std::int64_t num_qubits = 1;
    std::uint32_t num_clbits = 0;
    std::vector<Gate> gates;
    SimulationOptions options;
};

struct ResourceLimits {
    std::size_t max_qubits = 16;
    std::size_t max_gates = kHardMaximumGates;
    std::uint64_t max_measurement_shots = 100'000;
    std::size_t max_snapshot_bytes = kHardMaximumSnapshotBytes;
};

struct Error {
    std::string code;
    std::string message;
};

struct Snapshot {
    std::size_t gate_index = 0;
    Gate gate;
    std::vector<Complex> statevector;
};

struct SimulationResult {
    std::uint32_t protocol_version = kProtocolVersion;
    bool success = false;
    std::optional<std::size_t> num_qubits;
    std::optional<std::vector<Complex>> statevector;
    std::vector<double> probabilities;
    std::map<std::string, std::uint64_t> measurement_counts;
    std::map<std::string, std::uint64_t> classical_counts;
    std::vector<Snapshot> snapshots;
    std::optional<Error> error;
};

}  // namespace quantumlab
