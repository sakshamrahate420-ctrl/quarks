import { validateCircuit } from "../../features/circuit/model";
import type { Circuit, SimulationResult } from "../../features/circuit/types";
import { generateOpenQasm, generateQiskitPython } from "../codegen/circuitCode";

export interface CircuitFileEnvelope {
  schemaVersion: 1;
  exportedAt: string;
  circuit: Circuit;
}

export function createCircuitFile(circuit: Circuit): CircuitFileEnvelope {
  assertValidCircuit(circuit);
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    circuit: structuredClone(circuit),
  };
}

export function parseCircuitFile(contents: string): Circuit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error("This file is not a supported QUARKS circuit file.");
  }
  const circuit = parsed.circuit;
  assertValidCircuit(circuit);
  return structuredClone(circuit as Circuit);
}

export function buildCircuitExportRows(circuit: Circuit): string {
  return JSON.stringify(createCircuitFile(circuit), null, 2);
}

export function buildStatevectorCsv(result: SimulationResult): string {
  const rows = [["basis_state", "amplitude_real", "amplitude_imaginary", "probability"]];
  for (const state of result.probabilities) {
    rows.push([
      state.bitstring,
      state.amplitude ? String(state.amplitude.re) : "",
      state.amplitude ? String(state.amplitude.im) : "",
      String(state.probability),
    ]);
  }
  return rows.map(csvRow).join("\n");
}

export function buildMeasurementCountsCsv(result: SimulationResult): string {
  const rows = [["bitstring", "count", "percentage"]];
  for (const [bitstring, count] of Object.entries(result.measurementCounts).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    rows.push([
      bitstring,
      String(count),
      String(result.shots === 0 ? 0 : (count / result.shots) * 100),
    ]);
  }
  return rows.map(csvRow).join("\n");
}

export function buildProbabilityCsv(result: SimulationResult): string {
  const rows = [["basis_state", "probability", "percentage"]];
  for (const state of result.probabilities) {
    rows.push([
      state.bitstring,
      String(state.probability),
      String(state.probability * 100),
    ]);
  }
  return rows.map(csvRow).join("\n");
}

export function buildDownloadName(name: string, extension: string): string {
  const safeName =
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "quarks-circuit";
  return `${safeName}.${extension.replace(/^\./, "")}`;
}

export function downloadText(
  contents: string,
  filename: string,
  mimeType = "text/plain;charset=utf-8",
): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadSvgGraphic(
  source: SVGSVGElement,
  filename: string,
  format: "svg" | "png",
  extraCss = "",
): Promise<void> {
  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = clone.viewBox.baseVal;
  const bounds = source.getBoundingClientRect();
  const width =
    bounds.width ||
    Number.parseFloat(clone.getAttribute("width") ?? "") ||
    viewBox.width ||
    800;
  const height =
    bounds.height ||
    Number.parseFloat(clone.getAttribute("height") ?? "") ||
    viewBox.height ||
    400;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (extraCss) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = extraCss;
    clone.insertBefore(style, clone.firstChild);
  }
  const serialized = new XMLSerializer().serializeToString(clone);
  if (format === "svg") {
    downloadText(serialized, filename.replace(/\.png$/i, ".svg"), "image/svg+xml;charset=utf-8");
    return;
  }
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not render the SVG as a PNG."));
    });
    image.src = objectUrl;
    const rendered = await loaded;
    const canvas = document.createElement("canvas");
    const scale = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("PNG export is unavailable in this browser.");
    context.drawImage(rendered, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode PNG."))), "image/png"),
    );
    const pngUrl = URL.createObjectURL(png);
    const anchor = document.createElement("a");
    anchor.href = pngUrl;
    anchor.download = filename.replace(/\.svg$/i, ".png");
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function downloadCircuitCode(circuit: Circuit, format: "qasm" | "py"): void {
  const content =
    format === "qasm" ? generateOpenQasm(circuit) : generateQiskitPython(circuit);
  const extension = format === "qasm" ? "qasm" : "py";
  downloadText(content, buildDownloadName(circuit.name, extension));
}

function assertValidCircuit(value: unknown): asserts value is Circuit {
  const validation = validateCircuit(value);
  if (!validation.valid) {
    throw new Error(`Invalid circuit file: ${validation.errors.join(" ")}`);
  }
}

function csvRow(values: string[]): string {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
