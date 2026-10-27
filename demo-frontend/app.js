import { createSimulator } from "../web-demo/quantumlab-api.js";

const MAX_QUBITS = 16;
const MAX_CLASSICAL_BITS = 64;
const ROW_HEIGHT = 64;
const DEFAULT_SHOTS = 1000;
const gateInfo = {
  H: { label: "H", name: "Hadamard", kind: "single" },
  X: { label: "X", name: "NOT / Pauli X", kind: "single" },
  Y: { label: "Y", name: "Pauli Y", kind: "single" },
  Z: { label: "Z", name: "Pauli Z", kind: "single" },
  S: { label: "S", name: "S phase", kind: "single" },
  T: { label: "T", name: "T phase", kind: "single" },
  RX: { label: "Rx", name: "X rotation", kind: "rotation" },
  RY: { label: "Ry", name: "Y rotation", kind: "rotation" },
  RZ: { label: "Rz", name: "Z rotation", kind: "rotation" },
  CNOT: { label: "⊕", name: "Controlled NOT", kind: "two" },
  CZ: { label: "Z", name: "Controlled Z", kind: "two" },
  SWAP: { label: "×", name: "Swap", kind: "two" },
  CCNOT: { label: "⊕", name: "Toffoli", kind: "three" },
  MEASURE: { label: "M", name: "Measurement", kind: "measurement" },
  IFX: { label: "X", name: "Conditional X", kind: "conditional", engineType: "X" },
  IFZ: { label: "Z", name: "Conditional Z", kind: "conditional", engineType: "Z" },
};

const $ = (selector) => document.querySelector(selector);
const circuitGrid = $("#circuit-grid");
const statusBox = $("#engine-status");
const runButton = $("#run-circuit");
const requestError = $("#request-error");
const requestJson = $("#request-json");
const responseJson = $("#response-json");
const resultContent = $("#result-content");
const resultPlaceholder = $("#result-placeholder");
const inspectorFields = $("#inspector-fields");
const inspectorEmpty = $("#inspector-empty");
const deleteButton = $("#delete-gate");

let simulator;
let qubits = 3;
let classicalBits = 2;
let nextId = 1;
let operations = [];
let selectedTool = null;
let selectedOperation = null;

function makeOperation(type, target, column) {
  const operation = { id: nextId++, type, target, column };
  if (gateInfo[type].kind === "two") operation.control = target === 0 ? 1 : 0;
  if (gateInfo[type].kind === "three") {
    const otherQubits = Array.from({ length: qubits }, (_, index) => index).filter((index) => index !== target);
    [operation.control, operation.control2] = otherQubits;
  }
  if (gateInfo[type].kind === "measurement") operation.classical_bit = Math.min(target, classicalBits - 1);
  if (gateInfo[type].kind === "conditional") {
    operation.condition_bit = 0;
    operation.condition_value = 1;
  }
  if (gateInfo[type].kind === "rotation") operation.angle = Math.PI / 2;
  return operation;
}

function loadExample() {
  qubits = 3;
  classicalBits = 2;
  operations = [
    Object.assign(makeOperation("RY", 0, 0), { id: nextId++, angle: Math.PI / 3 }),
    Object.assign(makeOperation("H", 1, 0), { id: nextId++ }),
    Object.assign(makeOperation("CNOT", 2, 1), { id: nextId++, control: 1 }),
    Object.assign(makeOperation("CNOT", 1, 2), { id: nextId++, control: 0 }),
    Object.assign(makeOperation("H", 0, 3), { id: nextId++ }),
    Object.assign(makeOperation("MEASURE", 0, 4), { id: nextId++, classical_bit: 0 }),
    Object.assign(makeOperation("MEASURE", 1, 5), { id: nextId++, classical_bit: 1 }),
    Object.assign(makeOperation("IFX", 2, 6), { id: nextId++, condition_bit: 1, condition_value: 1 }),
    Object.assign(makeOperation("IFZ", 2, 7), { id: nextId++, condition_bit: 0, condition_value: 1 }),
  ];
  selectedOperation = null;
  selectedTool = null;
  render();
}

function showStatus(message, state = "") {
  statusBox.className = `header-status ${state}`;
  statusBox.querySelector("span").textContent = message;
}

function occupiedRows(operation) {
  const kind = gateInfo[operation.type].kind;
  if (kind === "single") return [operation.target];
  if (kind === "two") return [operation.target, operation.control];
  if (kind === "three") return [operation.target, operation.control, operation.control2];
  if (kind === "measurement") return [operation.target, qubits + operation.classical_bit];
  if (kind === "conditional") return [operation.target, qubits + operation.condition_bit];
  return [];
}

function canPlace(operation, column, ignoreId = null) {
  const rows = occupiedRows(operation);
  if (new Set(rows).size !== rows.length || rows.some((row) => row < 0 || row >= qubits + classicalBits)) {
    return "Choose different, existing qubits for every gate operand.";
  }
  const overlaps = operations.some((other) => other.id !== ignoreId && other.column === column &&
    occupiedRows(other).some((row) => rows.includes(row)));
  return overlaps ? "That circuit step already uses one of these qubits." : "";
}

function placeGate(type, target, column) {
  if (gateInfo[type].kind === "three" && qubits < 3) {
    showError("Toffoli needs three qubits. Add another qubit first.");
    return;
  }
  const operation = makeOperation(type, target, column);
  const problem = canPlace(operation, column);
  if (problem) {
    showError(problem);
    return;
  }
  operations.push(operation);
  selectedOperation = operation.id;
  requestError.hidden = true;
  render();
}

function showError(message) {
  requestError.hidden = false;
  requestError.textContent = message;
  showStatus("Check the circuit", "error-state");
}

function operationRequest(operation) {
  const info = gateInfo[operation.type];
  const result = { type: info.engineType || operation.type, target: operation.target };
  if (info.kind === "measurement") result.classical_bit = operation.classical_bit;
  if (info.kind === "conditional") {
    result.condition = { bit: operation.condition_bit, equals: operation.condition_value };
  }
  if (info.kind === "two" || info.kind === "three") {
    result.control = operation.control;
  }
  if (info.kind === "three") result.control2 = operation.control2;
  if (info.kind === "rotation") result.angle = operation.angle;
  return result;
}

function buildRequest() {
  return {
    protocol_version: 1,
    num_qubits: qubits,
    num_clbits: classicalBits,
    gates: [...operations]
      .sort((left, right) => left.column - right.column || left.id - right.id)
      .map(operationRequest),
    options: {
      include_statevector: true,
      include_snapshots: false,
      measurement_shots: Number($("#shots-input").value) || DEFAULT_SHOTS,
      seed: 42,
    },
  };
}

function makeCell(operation, row, column) {
  const isClassicalRow = row >= qubits;
  const bit = row - qubits;
  const cell = document.createElement(isClassicalRow ? "div" : "button");
  if (!isClassicalRow) {
    cell.type = "button";
    cell.className = "wire-cell";
    cell.dataset.row = row;
    cell.dataset.column = column;
    cell.setAttribute("aria-label", `Qubit ${row}, step ${column + 1}`);
    cell.addEventListener("dragover", (event) => {
      event.preventDefault();
      cell.classList.add("drop-ready");
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("drop-ready"));
    cell.addEventListener("drop", (event) => {
      event.preventDefault();
      cell.classList.remove("drop-ready");
      const type = event.dataTransfer.getData("text/plain");
      if (gateInfo[type]) placeGate(type, row, column);
    });
    cell.addEventListener("click", () => {
      if (operation) {
        selectedOperation = operation.id;
        render();
      } else if (selectedTool) {
        placeGate(selectedTool, row, column);
      } else {
        showStatus("Choose a gate from the palette", "");
      }
    });
  } else {
    cell.className = "wire-cell classical-cell";
    if (operation) {
      cell.setAttribute("role", "button");
      cell.tabIndex = 0;
      cell.setAttribute("aria-label", `Classical bit ${bit}, step ${column + 1}`);
      cell.addEventListener("click", () => { selectedOperation = operation.id; render(); });
    }
  }

  if (operation && !isClassicalRow && operation.target === row) {
    const node = document.createElement("span");
    node.className = `placed-gate ${selectedOperation === operation.id ? "selected" : ""}`;
    node.textContent = operation.type === "IFX" || operation.type === "IFZ"
      ? `${gateInfo[operation.type].label}${operation.condition_value}`
      : gateInfo[operation.type].label;
    node.title = operation.type === "IFX" || operation.type === "IFZ"
      ? `${gateInfo[operation.type].name} when c${operation.condition_bit} = ${operation.condition_value}`
      : gateInfo[operation.type].name;
    cell.append(node);
  } else if (operation && isClassicalRow && operation.type === "MEASURE" && operation.classical_bit === bit) {
    const marker = document.createElement("span");
    marker.className = "classical-marker";
    marker.textContent = "M";
    marker.title = `Measurement result stored in c${bit}`;
    cell.append(marker);
  } else if (operation && isClassicalRow && (operation.type === "IFX" || operation.type === "IFZ") && operation.condition_bit === bit) {
    const marker = document.createElement("span");
    marker.className = "classical-condition-marker";
    marker.textContent = String(operation.condition_value);
    marker.title = `Run gate when c${bit} = ${operation.condition_value}`;
    cell.append(marker);
  } else if (operation && !isClassicalRow && occupiedRows(operation).includes(row)) {
    const marker = document.createElement("span");
    marker.className = operation.type === "SWAP" ? "swap-marker" : "control-marker";
    marker.textContent = operation.type === "SWAP" ? "×" : "●";
    cell.append(marker);
  }
  return cell;
}

function makeStep(column, stepsCount) {
  const step = document.createElement("div");
  step.className = "step-column";
  step.style.height = `${(qubits + classicalBits) * ROW_HEIGHT}px`;
  const stepOperations = operations.filter((operation) => operation.column === column);
  for (let row = 0; row < qubits + classicalBits; row += 1) {
    const rowOperation = stepOperations.find((operation) => occupiedRows(operation).includes(row));
    const cell = makeCell(rowOperation || null, row, column);
    cell.style.top = `${row * ROW_HEIGHT}px`;
    step.append(cell);
  }

  for (const stepOperation of stepOperations) {
    if (gateInfo[stepOperation.type].kind === "single") continue;
    const rows = occupiedRows(stepOperation);
    const connector = document.createElement("span");
    const isClassicalConnector = stepOperation.type === "MEASURE" || gateInfo[stepOperation.type].kind === "conditional";
    connector.className = `connector ${stepOperation.type === "CZ" ? "cz-connector" : ""} ${isClassicalConnector ? "classical-connector" : ""}`;
    connector.style.top = `${Math.min(...rows) * ROW_HEIGHT + 32}px`;
    connector.style.height = `${(Math.max(...rows) - Math.min(...rows)) * ROW_HEIGHT}px`;
    step.append(connector);
  }
  if (column === stepsCount - 1) step.classList.add("last-step");
  return step;
}

function renderCircuit() {
  const maxUsedColumn = operations.reduce((max, operation) => Math.max(max, operation.column), -1);
  const stepCount = Math.max(7, maxUsedColumn + 3);
  circuitGrid.replaceChildren();
  circuitGrid.style.setProperty("--qubit-count", qubits);
  circuitGrid.style.setProperty("--classical-bit-count", classicalBits);
  circuitGrid.style.setProperty("--wire-count", qubits + classicalBits);

  const labels = document.createElement("div");
  labels.className = "qubit-labels";
  const corner = document.createElement("div");
  corner.className = "qubit-corner";
  corner.textContent = "WIRE";
  labels.append(corner);
  for (let row = 0; row < qubits; row += 1) {
    const label = document.createElement("div");
    label.className = "qubit-label";
    label.innerHTML = `<span class="ket">|</span>q<sub>${row}</sub><span class="ket">⟩</span>`;
    labels.append(label);
  }
  for (let bit = 0; bit < classicalBits; bit += 1) {
    const label = document.createElement("div");
    label.className = "classical-label";
    label.innerHTML = `<span>c</span><sub>${bit}</sub>`;
    labels.append(label);
  }
  circuitGrid.append(labels);

  const timeline = document.createElement("div");
  timeline.className = "timeline";
  timeline.style.gridTemplateColumns = `repeat(${stepCount}, 64px)`;
  const stepHeadings = document.createElement("div");
  stepHeadings.className = "step-headings";
  stepHeadings.style.gridTemplateColumns = `repeat(${stepCount}, 64px)`;
  for (let column = 0; column < stepCount; column += 1) {
    const step = makeStep(column, stepCount);
    const heading = document.createElement("div");
    heading.className = "step-heading";
    heading.textContent = String(column + 1).padStart(2, "0");
    stepHeadings.append(heading);
    timeline.append(step);
  }
  const headLabel = document.createElement("div");
  headLabel.className = "steps-label";
  headLabel.textContent = "STEP";
  stepHeadings.prepend(headLabel);
  timeline.prepend(stepHeadings);
  circuitGrid.append(timeline);
}

function selectOptions(selected, excluded = []) {
  return Array.from({ length: qubits }, (_, index) => index)
    .filter((index) => !excluded.includes(index))
    .map((index) => `<option value="${index}" ${index === selected ? "selected" : ""}>q${index}</option>`)
    .join("");
}

function selectClassicalOptions(selected) {
  return Array.from({ length: classicalBits }, (_, index) =>
    `<option value="${index}" ${index === selected ? "selected" : ""}>c${index}</option>`).join("");
}

function renderInspector() {
  const operation = operations.find((item) => item.id === selectedOperation);
  if (!operation) {
    $("#inspector-title").textContent = "No gate selected";
    inspectorEmpty.hidden = false;
    inspectorFields.hidden = true;
    deleteButton.hidden = true;
    return;
  }
  const info = gateInfo[operation.type];
  $("#inspector-title").textContent = `${info.name} · step ${operation.column + 1}`;
  inspectorEmpty.hidden = true;
  inspectorFields.hidden = false;
  deleteButton.hidden = false;
  const fields = [];
  if (info.kind !== "measurement") {
    fields.push(`<label class="field-row">Target qubit<select data-property="target">${selectOptions(operation.target)}</select></label>`);
  }
  if (info.kind === "measurement") {
    fields.push(`<label class="field-row">Measure qubit<select data-property="target">${selectOptions(operation.target)}</select></label>`);
    fields.push(`<label class="field-row">Store result in<select data-property="classical_bit">${selectClassicalOptions(operation.classical_bit)}</select></label>`);
  }
  if (info.kind === "two" || info.kind === "three") {
    const label = operation.type === "SWAP" ? "Other qubit" : "Control qubit";
    fields.push(`<label class="field-row">${label}<select data-property="control">${selectOptions(operation.control, [operation.target])}</select></label>`);
  }
  if (info.kind === "three") {
    fields.push(`<label class="field-row">Second control<select data-property="control2">${selectOptions(operation.control2, [operation.target, operation.control])}</select></label>`);
  }
  if (info.kind === "conditional") {
    fields.push(`<label class="field-row">Read classical bit<select data-property="condition_bit">${selectClassicalOptions(operation.condition_bit)}</select></label>`);
    fields.push(`<label class="field-row">Apply when bit equals<select data-property="condition_value"><option value="0" ${operation.condition_value === 0 ? "selected" : ""}>0</option><option value="1" ${operation.condition_value === 1 ? "selected" : ""}>1</option></select></label>`);
  }
  if (info.kind === "rotation") {
    fields.push(`<label class="field-row">Angle <span class="input-with-unit"><input data-property="angle" type="number" step="0.1" value="${operation.angle}"><small>rad</small></span></label>`);
  }
  fields.push(`<label class="field-row">Circuit step<select data-property="column">${Array.from({ length: Math.max(12, operation.column + 2) }, (_, index) => `<option value="${index}" ${index === operation.column ? "selected" : ""}>${index + 1}</option>`).join("")}</select></label>`);
  inspectorFields.innerHTML = fields.join("");
  inspectorFields.querySelectorAll("[data-property]").forEach((input) => {
    input.addEventListener("change", () => updateOperation(operation, input.dataset.property, input.value));
  });
}

function updateOperation(operation, property, rawValue) {
  const oldValue = operation[property];
  const value = property === "angle" ? Number(rawValue) : Number.parseInt(rawValue, 10);
  operation[property] = value;
  const problem = canPlace(operation, operation.column, operation.id);
  if (problem) {
    operation[property] = oldValue;
    showError(problem);
  } else {
    requestError.hidden = true;
  }
  render();
}

function renderPalette() {
  document.querySelectorAll(".gate-tool").forEach((button) => {
    const type = button.dataset.gate;
    button.classList.toggle("active", selectedTool === type);
  });
}

function render() {
  $("#qubit-count").textContent = String(qubits);
  $("#cbit-count").textContent = String(classicalBits);
  $("#remove-qubit").disabled = qubits <= 1;
  $("#add-qubit").disabled = qubits >= MAX_QUBITS;
  $("#remove-cbit").disabled = classicalBits <= 1;
  $("#add-cbit").disabled = classicalBits >= MAX_CLASSICAL_BITS;
  $("#tool-hint").textContent = selectedTool
    ? `${selectedTool} selected — click a wire or drag it to a step.`
    : "Choose a gate above, then drop it onto a wire.";
  $("#cancel-tool").hidden = !selectedTool;
  renderCircuit();
  renderInspector();
  renderPalette();
  requestJson.textContent = JSON.stringify(buildRequest(), null, 2);
}

function renderResults(result) {
  resultPlaceholder.hidden = true;
  resultContent.hidden = false;
  resultContent.replaceChildren();
  const classicalOutcomes = Object.entries(result.classical_counts || {});
  if (classicalOutcomes.length > 0) {
    const summary = document.createElement("div");
    summary.className = "classical-summary";
    const heading = document.createElement("div");
    heading.className = "classical-summary-title";
    heading.textContent = "Measured classical bits · c1c0";
    const outcomes = document.createElement("div");
    outcomes.className = "classical-outcomes";
    for (const [bits, count] of classicalOutcomes.sort((left, right) => left[0].localeCompare(right[0]))) {
      const chip = document.createElement("span");
      chip.className = "classical-outcome";
      chip.innerHTML = `<code>${bits}</code><b>${count}</b>`;
      outcomes.append(chip);
    }
    summary.append(heading, outcomes);
    resultContent.append(summary);
  }
  const counts = result.measurement_counts || {};
  const list = document.createElement("div");
  list.className = "outcome-list";
  const probabilities = result.probabilities || [];
  probabilities.forEach((probability, index) => {
    if (probability < 1e-8) return;
    const bits = index.toString(2).padStart(qubits, "0");
    const count = counts[bits] || 0;
    const row = document.createElement("div");
    row.className = "outcome-row";
    const state = document.createElement("code");
    state.className = "outcome-state";
    state.textContent = `|${bits}⟩`;
    const track = document.createElement("span");
    track.className = "outcome-track";
    const bar = document.createElement("span");
    bar.className = "outcome-bar";
    bar.style.width = `${Math.max(2, probability * 100)}%`;
    track.append(bar);
    const value = document.createElement("span");
    value.className = "outcome-value";
    value.textContent = `${(probability * 100).toFixed(1)}%`;
    const sampled = document.createElement("small");
    sampled.textContent = `${count} shots`;
    row.append(state, track, value, sampled);
    list.append(row);
  });
  resultContent.append(list);
}

document.querySelectorAll(".gate-tool").forEach((button) => {
  const type = button.dataset.gate;
  button.addEventListener("click", () => {
    selectedTool = selectedTool === type ? null : type;
    selectedOperation = null;
    render();
  });
  button.addEventListener("dragstart", (event) => {
    selectedTool = type;
    event.dataTransfer.setData("text/plain", type);
    event.dataTransfer.effectAllowed = "copy";
    button.classList.add("dragging");
  });
  button.addEventListener("dragend", () => button.classList.remove("dragging"));
});

runButton.addEventListener("click", async () => {
  if (!simulator) return;
  requestError.hidden = true;
  runButton.disabled = true;
  showStatus("Simulating…");
  try {
    const request = buildRequest();
    const result = await simulator.simulateCircuit(request);
    responseJson.textContent = JSON.stringify(result, null, 2);
    if (!result.success) {
      showError(result.error?.message || "The engine could not run this circuit.");
      resultPlaceholder.hidden = false;
      resultContent.hidden = true;
      return;
    }
    renderResults(result);
    showStatus("Simulation complete", "ready");
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    runButton.disabled = false;
  }
});

$("#load-example").addEventListener("click", loadExample);
$("#clear-circuit").addEventListener("click", () => {
  operations = [];
  selectedOperation = null;
  selectedTool = null;
  requestError.hidden = true;
  resultContent.hidden = true;
  resultPlaceholder.hidden = false;
  responseJson.textContent = "";
  render();
});
$("#add-qubit").addEventListener("click", () => { if (qubits < MAX_QUBITS) { qubits += 1; render(); } });
$("#remove-qubit").addEventListener("click", () => {
  if (qubits <= 1) return;
  const lastQubit = qubits - 1;
  if (operations.some((operation) => occupiedRows(operation).includes(lastQubit))) {
    showError(`Remove gates that use q${lastQubit} before removing that qubit.`);
    return;
  }
  qubits -= 1;
  render();
});
$("#add-cbit").addEventListener("click", () => { if (classicalBits < MAX_CLASSICAL_BITS) { classicalBits += 1; render(); } });
$("#remove-cbit").addEventListener("click", () => {
  if (classicalBits <= 1) return;
  const lastBit = classicalBits - 1;
  if (operations.some((operation) =>
    (operation.type === "MEASURE" && operation.classical_bit === lastBit) ||
    ((operation.type === "IFX" || operation.type === "IFZ") && operation.condition_bit === lastBit))) {
    showError(`Remove gates that use c${lastBit} before removing that classical bit.`);
    return;
  }
  classicalBits -= 1;
  render();
});
$("#cancel-tool").addEventListener("click", () => { selectedTool = null; render(); });
$("#delete-gate").addEventListener("click", () => {
  operations = operations.filter((operation) => operation.id !== selectedOperation);
  selectedOperation = null;
  render();
});
$("#shots-input").addEventListener("input", () => {
  const value = Number($("#shots-input").value);
  $("#shot-count").textContent = Number.isFinite(value) ? value.toLocaleString() : "—";
  requestJson.textContent = JSON.stringify(buildRequest(), null, 2);
});

renderPalette();
loadExample();
try {
  simulator = await createSimulator();
  runButton.disabled = false;
  showStatus("Engine ready", "ready");
} catch (error) {
  showStatus("Engine unavailable", "error-state");
  showError(error instanceof Error ? error.message : String(error));
}
