import { createSimulator } from "./quantumlab-api.js";

const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const requestInput = document.querySelector("#request-input");
const simulateButton = document.querySelector("#simulate");
const loadBellButton = document.querySelector("#load-bell");
const copyButton = document.querySelector("#copy-result");
const resultOutput = document.querySelector("#result-output");

const bellRequest = {
  protocol_version: 1,
  num_qubits: 2,
  gates: [
    { type: "H", target: 0 },
    { type: "CNOT", control: 0, target: 1 },
  ],
  options: {
    include_statevector: true,
    include_snapshots: true,
    measurement_shots: 1000,
    seed: 42,
  },
};

let simulator = null;
let lastResult = null;

function setStatus(message, state) {
  statusText.textContent = message;
  statusDot.dataset.state = state;
}

function displayResult(result) {
  lastResult = result;
  resultOutput.textContent = JSON.stringify(result, null, 2);
  copyButton.disabled = false;
}

loadBellButton.addEventListener("click", () => {
  requestInput.value = JSON.stringify(bellRequest, null, 2);
});

simulateButton.addEventListener("click", async () => {
  if (!simulator) return;
  let request;
  try {
    request = JSON.parse(requestInput.value);
  } catch (error) {
    displayResult({
      protocol_version: 1,
      success: false,
      num_qubits: null,
      statevector: null,
      probabilities: [],
      measurement_counts: {},
      snapshots: [],
      error: { code: "INVALID_REQUEST_JSON", message: error.message },
    });
    return;
  }

  simulateButton.disabled = true;
  setStatus("Simulating…", "busy");
  try {
    const result = await simulator.simulateCircuit(request);
    displayResult(result);
    setStatus(result.success ? "Simulation complete" : `Simulation error: ${result.error.code}`, result.success ? "ready" : "error");
  } catch (error) {
    setStatus("Unexpected interface error", "error");
    resultOutput.textContent = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    simulateButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  if (!lastResult) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
    copyButton.textContent = "Copied";
    window.setTimeout(() => { copyButton.textContent = "Copy JSON"; }, 1200);
  } catch {
    copyButton.textContent = "Copy unavailable";
  }
});

try {
  simulator = await createSimulator();
  if (simulator.protocolVersion !== 1) throw new Error("Protocol version mismatch.");
  setStatus("WebAssembly engine ready", "ready");
  simulateButton.disabled = false;
  resultOutput.textContent = "Engine ready. Run the Bell-state example or edit the request JSON.";
} catch (error) {
  setStatus("Could not load WebAssembly", "error");
  resultOutput.textContent = `${error instanceof Error ? error.message : String(error)}\n\nBuild the WASM target first. See docs/building.md.`;
}
