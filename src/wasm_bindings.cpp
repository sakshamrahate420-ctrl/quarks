#include "quantumlab/simulator.hpp"
#include "quantumlab/validation.hpp"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cmath>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <utility>

namespace {
using emscripten::val;
using quantumlab::CircuitRequest;
using quantumlab::Complex;
using quantumlab::Error;
using quantumlab::Gate;
using quantumlab::QuantumError;
using quantumlab::ResourceLimits;
using quantumlab::SimulationOptions;
using quantumlab::SimulationResult;
using quantumlab::Snapshot;

std::string jsType(const val& value) {
    return value.typeof().as<std::string>();
}

bool isArray(const val& value) {
    return val::global("Array").call<bool>("isArray", value);
}

bool isUndefined(const val& value) {
    return jsType(value) == "undefined";
}

bool isNull(const val& value) {
    return val::global("Object").call<bool>("is", value, val::null());
}

void requireObject(const val& value, const std::string& label, const std::string& error_code = "INVALID_REQUEST") {
    if (jsType(value) != "object" || isNull(value) || isArray(value)) {
        throw QuantumError(error_code, label + " must be an object.");
    }
}

double parseNumber(const val& value, const std::string& label, const std::string& error_code = "INVALID_REQUEST") {
    if (jsType(value) != "number") {
        throw QuantumError(error_code, label + " must be a number.");
    }
    const double number = value.as<double>();
    if (!std::isfinite(number)) {
        throw QuantumError(error_code, label + " must be finite.");
    }
    return number;
}

std::int64_t parseSignedInteger(const val& value, const std::string& label,
                                const std::string& error_code = "INVALID_REQUEST") {
    const double number = parseNumber(value, label, error_code);
    constexpr double max_safe_integer = 9007199254740991.0;
    if (std::floor(number) != number || number < -max_safe_integer || number > max_safe_integer) {
        throw QuantumError(error_code, label + " must be a safe integer.");
    }
    return static_cast<std::int64_t>(number);
}

std::uint64_t parseUnsignedInteger(const val& value, const std::string& label,
                                   std::uint64_t maximum,
                                   const std::string& error_code = "INVALID_REQUEST") {
    const double number = parseNumber(value, label, error_code);
    if (std::floor(number) != number || number < 0.0 || number > static_cast<double>(maximum)) {
        throw QuantumError(error_code, label + " must be a non-negative integer within its allowed range.");
    }
    return static_cast<std::uint64_t>(number);
}

bool parseBoolean(const val& value, const std::string& label,
                  const std::string& error_code = "INVALID_REQUEST") {
    if (jsType(value) != "boolean") {
        throw QuantumError(error_code, label + " must be a boolean.");
    }
    return value.as<bool>();
}

std::string parseString(const val& value, const std::string& label,
                        const std::string& error_code = "INVALID_REQUEST") {
    if (jsType(value) != "string") {
        throw QuantumError(error_code, label + " must be a string.");
    }
    return value.as<std::string>();
}

val getField(const val& object, const char* name) {
    return object[name];
}

std::optional<std::size_t> tryReportedQubits(const val& request) {
    try {
        if (jsType(request) != "object" || isNull(request) || isArray(request)) {
            return std::nullopt;
        }
        const val value = getField(request, "num_qubits");
        if (isUndefined(value) || jsType(value) != "number") {
            return std::nullopt;
        }
        const double number = value.as<double>();
        if (!std::isfinite(number) || std::floor(number) != number || number < 1.0 ||
            number > static_cast<double>(std::numeric_limits<std::size_t>::max())) {
            return std::nullopt;
        }
        return static_cast<std::size_t>(number);
    } catch (...) {
        return std::nullopt;
    }
}

ResourceLimits parseLimits(const val& config) {
    ResourceLimits limits;
    if (isUndefined(config)) {
        return limits;
    }
    requireObject(config, "config", "INVALID_CONFIG");

    val value = getField(config, "max_qubits");
    if (!isUndefined(value)) {
        const auto parsed = parseUnsignedInteger(value, "config.max_qubits",
                                                 quantumlab::kHardMaximumQubits, "INVALID_CONFIG");
        if (parsed == 0) {
            throw QuantumError("INVALID_CONFIG", "config.max_qubits must be at least 1.");
        }
        limits.max_qubits = static_cast<std::size_t>(parsed);
    }

    value = getField(config, "max_gates");
    if (!isUndefined(value)) {
        limits.max_gates = static_cast<std::size_t>(parseUnsignedInteger(
            value, "config.max_gates", quantumlab::kHardMaximumGates, "INVALID_CONFIG"));
    }

    value = getField(config, "max_measurement_shots");
    if (!isUndefined(value)) {
        limits.max_measurement_shots = parseUnsignedInteger(
            value, "config.max_measurement_shots", quantumlab::kHardMaximumShots, "INVALID_CONFIG");
    }

    value = getField(config, "max_snapshot_bytes");
    if (!isUndefined(value)) {
        limits.max_snapshot_bytes = static_cast<std::size_t>(parseUnsignedInteger(
            value, "config.max_snapshot_bytes", quantumlab::kHardMaximumSnapshotBytes, "INVALID_CONFIG"));
    }
    quantumlab::validateResourceLimits(limits);
    return limits;
}

CircuitRequest parseRequest(const val& input, std::optional<std::size_t>& reported_qubits) {
    requireObject(input, "request");
    CircuitRequest request;
    reported_qubits = tryReportedQubits(input);

    val value = getField(input, "protocol_version");
    if (isUndefined(value)) {
        throw QuantumError("INVALID_REQUEST", "protocol_version is required.");
    }
    const std::uint64_t version = parseUnsignedInteger(
        value, "protocol_version", std::numeric_limits<std::uint32_t>::max());
    request.protocol_version = static_cast<std::uint32_t>(version);

    value = getField(input, "num_qubits");
    if (isUndefined(value)) {
        throw QuantumError("INVALID_REQUEST", "num_qubits is required.");
    }
    request.num_qubits = parseSignedInteger(value, "num_qubits");
    if (request.num_qubits > 0 &&
        static_cast<std::uint64_t>(request.num_qubits) <= static_cast<std::uint64_t>(std::numeric_limits<std::size_t>::max())) {
        reported_qubits = static_cast<std::size_t>(request.num_qubits);
    } else {
        reported_qubits = std::nullopt;
    }

    value = getField(input, "num_clbits");
    if (!isUndefined(value)) {
        request.num_clbits = static_cast<std::uint32_t>(parseUnsignedInteger(
            value, "num_clbits", quantumlab::kHardMaximumClassicalBits));
    }

    value = getField(input, "gates");
    if (isUndefined(value) || !isArray(value)) {
        throw QuantumError("INVALID_REQUEST", "gates must be an array.");
    }
    const std::uint32_t gate_count = value["length"].as<std::uint32_t>();
    if (gate_count > quantumlab::kHardMaximumGates) {
        throw QuantumError("RESOURCE_LIMIT_EXCEEDED", "gates exceeds the hard maximum of 10000.");
    }
    request.gates.reserve(gate_count);
    for (std::uint32_t index = 0; index < gate_count; ++index) {
        const val item = value[index];
        requireObject(item, "gates[" + std::to_string(index) + "]");
        Gate gate;
        const val type = getField(item, "type");
        const val target = getField(item, "target");
        if (isUndefined(type) || isUndefined(target)) {
            throw QuantumError("INVALID_REQUEST", "Each gate requires type and target fields.");
        }
        gate.type = parseString(type, "gate.type");
        gate.target = parseSignedInteger(target, "gate.target");
        const val control = getField(item, "control");
        if (!isUndefined(control)) {
            gate.control = parseSignedInteger(control, "gate.control");
        }
        const val control2 = getField(item, "control2");
        if (!isUndefined(control2)) {
            gate.control2 = parseSignedInteger(control2, "gate.control2");
        }
        const val angle = getField(item, "angle");
        const bool is_rotation = gate.type == "RX" || gate.type == "RY" || gate.type == "RZ";
        if (is_rotation && isUndefined(angle)) {
            throw QuantumError("INVALID_REQUEST", "RX, RY, and RZ gates require an angle in radians.");
        }
        if (!is_rotation && !isUndefined(angle)) {
            throw QuantumError("INVALID_GATE", "Only RX, RY, and RZ gates may specify angle.");
        }
        if (!isUndefined(angle)) {
            gate.angle = parseNumber(angle, "gate.angle");
        }
        const val classical_bit = getField(item, "classical_bit");
        if (!isUndefined(classical_bit)) {
            gate.classical_bit = parseSignedInteger(classical_bit, "gate.classical_bit");
        }
        const val condition = getField(item, "condition");
        if (!isUndefined(condition)) {
            requireObject(condition, "gate.condition");
            const val condition_bit = getField(condition, "bit");
            const val condition_equals = getField(condition, "equals");
            if (isUndefined(condition_bit) || isUndefined(condition_equals)) {
                throw QuantumError("INVALID_REQUEST", "gate.condition requires bit and equals fields.");
            }
            gate.condition_bit = parseSignedInteger(condition_bit, "gate.condition.bit");
            const std::int64_t equals = parseSignedInteger(condition_equals, "gate.condition.equals");
            if (equals != 0 && equals != 1) {
                throw QuantumError("INVALID_REQUEST", "gate.condition.equals must be 0 or 1.");
            }
            gate.condition_value = equals == 1;
        }
        request.gates.push_back(std::move(gate));
    }

    value = getField(input, "options");
    if (!isUndefined(value)) {
        requireObject(value, "options");
        val option = getField(value, "include_statevector");
        if (!isUndefined(option)) {
            request.options.include_statevector = parseBoolean(option, "options.include_statevector");
        }
        option = getField(value, "include_snapshots");
        if (!isUndefined(option)) {
            request.options.include_snapshots = parseBoolean(option, "options.include_snapshots");
        }
        option = getField(value, "measurement_shots");
        if (!isUndefined(option)) {
            request.options.measurement_shots = parseUnsignedInteger(
                option, "options.measurement_shots", quantumlab::kHardMaximumShots);
        }
        option = getField(value, "seed");
        if (!isUndefined(option)) {
            request.options.seed = static_cast<std::uint32_t>(parseUnsignedInteger(
                option, "options.seed", std::numeric_limits<std::uint32_t>::max()));
        }
    }
    return request;
}

val serializeStatevector(const std::vector<Complex>& statevector) {
    val output = val::object();
    val real = val::array();
    val imag = val::array();
    for (const Complex& amplitude : statevector) {
        real.call<void>("push", val(amplitude.real()));
        imag.call<void>("push", val(amplitude.imag()));
    }
    output.set("real", real);
    output.set("imag", imag);
    return output;
}

val serializeGate(const Gate& gate) {
    val output = val::object();
    output.set("type", val(gate.type));
    output.set("target", val(static_cast<double>(gate.target)));
    if (gate.type == "CNOT" || gate.type == "CZ" || gate.type == "SWAP" || gate.type == "CCNOT") {
        output.set("control", val(static_cast<double>(gate.control)));
    }
    if (gate.type == "CCNOT") output.set("control2", val(static_cast<double>(gate.control2)));
    if (gate.type == "RX" || gate.type == "RY" || gate.type == "RZ") output.set("angle", val(gate.angle));
    if (gate.type == "MEASURE") output.set("classical_bit", val(static_cast<double>(gate.classical_bit)));
    if (gate.condition_bit >= 0) {
        val condition = val::object();
        condition.set("bit", val(static_cast<double>(gate.condition_bit)));
        condition.set("equals", val(gate.condition_value ? 1 : 0));
        output.set("condition", condition);
    }
    return output;
}

val serializeResult(const SimulationResult& result) {
    val output = val::object();
    output.set("protocol_version", val(static_cast<double>(result.protocol_version)));
    output.set("success", val(result.success));
    if (result.num_qubits.has_value()) {
        output.set("num_qubits", val(static_cast<double>(*result.num_qubits)));
    } else {
        output.set("num_qubits", val::null());
    }

    if (result.statevector.has_value()) {
        output.set("statevector", serializeStatevector(*result.statevector));
    } else {
        output.set("statevector", val::null());
    }

    val probabilities = val::array();
    for (const double probability : result.probabilities) {
        probabilities.call<void>("push", val(probability));
    }
    output.set("probabilities", probabilities);

    val counts = val::object();
    for (const auto& [bitstring, count] : result.measurement_counts) {
        counts.set(bitstring, val(static_cast<double>(count)));
    }
    output.set("measurement_counts", counts);

    val classical_counts = val::object();
    for (const auto& [bitstring, count] : result.classical_counts) {
        classical_counts.set(bitstring, val(static_cast<double>(count)));
    }
    output.set("classical_counts", classical_counts);

    val snapshots = val::array();
    for (const Snapshot& snapshot : result.snapshots) {
        val item = val::object();
        item.set("gate_index", val(static_cast<double>(snapshot.gate_index)));
        item.set("gate", serializeGate(snapshot.gate));
        item.set("statevector", serializeStatevector(snapshot.statevector));
        snapshots.call<void>("push", item);
    }
    output.set("snapshots", snapshots);

    if (result.error.has_value()) {
        val error = val::object();
        error.set("code", val(result.error->code));
        error.set("message", val(result.error->message));
        output.set("error", error);
    } else {
        output.set("error", val::null());
    }
    return output;
}

val simulateCircuitJs(const val& input, const val& config) {
    const std::optional<std::size_t> initial_qubits = tryReportedQubits(input);
    try {
        const ResourceLimits limits = parseLimits(config);
        std::optional<std::size_t> reported_qubits = initial_qubits;
        const CircuitRequest request = parseRequest(input, reported_qubits);
        return serializeResult(quantumlab::simulateCircuit(request, limits));
    } catch (const QuantumError& error) {
        return serializeResult(quantumlab::makeErrorResult(initial_qubits, error.code(), error.what()));
    } catch (const std::exception& error) {
        return serializeResult(quantumlab::makeErrorResult(initial_qubits, "INTERNAL_ERROR", error.what()));
    } catch (...) {
        return serializeResult(quantumlab::makeErrorResult(initial_qubits, "INTERNAL_ERROR", "An unknown internal error occurred."));
    }
}

std::uint32_t getProtocolVersion() { return quantumlab::kProtocolVersion; }

}  // namespace

EMSCRIPTEN_BINDINGS(quantumlab_module) {
    emscripten::function("simulateCircuit", &simulateCircuitJs);
    emscripten::function("getProtocolVersion", &getProtocolVersion);
}
