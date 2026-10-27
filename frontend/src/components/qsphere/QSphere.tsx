import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { Download, RotateCcw } from "lucide-react";
import type { BasisStateResult } from "../../features/circuit/types";

type QSphereMode = "amplitude" | "phase";

interface QSphereProps {
  states: BasisStateResult[];
}

interface PlotState extends BasisStateResult {
  position: [number, number, number];
  magnitude: number;
  phase: number;
  color: string;
}

export function QSphere({ states }: QSphereProps) {
  const [mode, setMode] = useState<QSphereMode>("amplitude");
  const [cameraKey, setCameraKey] = useState(0);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  );
  const plotted = useMemo(
    () => states.map((state) => toPlotState(state, states, mode)),
    [states, mode],
  );

  const downloadPng = () => {
    if (!canvasElement) return;
    const anchor = document.createElement("a");
    anchor.href = canvasElement.toDataURL("image/png");
    anchor.download = "quarks-qsphere.png";
    anchor.click();
  };

  return (
    <section className="qsphere-panel" aria-label="Interactive QSphere">
      <div className="qsphere-toolbar">
        <div>
          <h3>QSphere</h3>
          <p>
            {mode === "amplitude"
              ? "Polar angle θ = 2 arccos(|α|); color encodes phase."
              : "Basis-state Hamming weight sets latitude; color encodes phase."}
          </p>
        </div>
        <div className="qsphere-actions">
          <select
            aria-label="QSphere visualization mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as QSphereMode)}
            data-testid="select-qsphere-mode"
          >
            <option value="amplitude">Amplitude angle</option>
            <option value="phase">Phase angle</option>
          </select>
          <button
            type="button"
            className="icon-button"
            title="Reset camera"
            aria-label="Reset QSphere camera"
            onClick={() => setCameraKey((key) => key + 1)}
            data-testid="button-reset-qsphere-camera"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Download QSphere as PNG"
            aria-label="Download QSphere as PNG"
            onClick={downloadPng}
            disabled={!canvasElement}
            data-testid="button-download-qsphere"
          >
            <Download size={14} />
          </button>
        </div>
      </div>
      <div className="qsphere-canvas" data-testid="visualization-qsphere">
        <Canvas
          key={cameraKey}
          camera={{ position: [0, 0, 3.7], fov: 42 }}
          gl={{ preserveDrawingBuffer: true, antialias: true }}
          onCreated={({ gl }) => setCanvasElement(gl.domElement)}
          aria-label="Rotatable three-dimensional quantum state sphere"
        >
          <color attach="background" args={["#101522"]} />
          <ambientLight intensity={1.5} />
          <pointLight position={[3, 3, 4]} intensity={30} />
          <SphereScene states={plotted} />
          <OrbitControls
            enablePan={false}
            minDistance={2.2}
            maxDistance={7}
            enableDamping
          />
        </Canvas>
      </div>
      <div className="qsphere-legend">
        <span>
          <i className="qsphere-dot" /> Marker size = amplitude magnitude
        </span>
        <span>
          <i className="qsphere-phase" /> Marker hue = phase (−π to +π)
        </span>
      </div>
      <p className="qsphere-caption">
        Drag to rotate · scroll to zoom · hover a marker for amplitude and
        probability details.
      </p>
    </section>
  );
}

function SphereScene({ states }: { states: PlotState[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <group>
      <mesh>
        <sphereGeometry args={[1, 28, 28]} />
        <meshBasicMaterial
          color="#98a3ba"
          wireframe
          transparent
          opacity={0.22}
        />
      </mesh>
      <axesHelper args={[1.25]} />
      {states.map((state) => {
        const magnitude = state.magnitude;
        const markerSize = 0.055 + magnitude * 0.22;
        const isHovered = hovered === state.bitstring;
        return (
          <group key={state.bitstring} position={state.position}>
            <mesh
              scale={markerSize}
              onPointerOver={(event) => {
                event.stopPropagation();
                setHovered(state.bitstring);
              }}
              onPointerOut={(event) => {
                event.stopPropagation();
                setHovered(null);
              }}
            >
              <sphereGeometry args={[1, 20, 20]} />
              <meshStandardMaterial
                color={state.color}
                emissive={state.color}
                emissiveIntensity={isHovered ? 1.1 : 0.45}
                transparent
                opacity={magnitude < 1e-8 ? 0.28 : 1}
              />
            </mesh>
            {isHovered && (
              <Html distanceFactor={7} position={[0.1, 0.12, 0]}>
                <div className="qsphere-tooltip" role="status">
                  <strong>|{state.bitstring}⟩</strong>
                  <span>
                    α = {formatComplex(state.amplitude?.re ?? 0, state.amplitude?.im ?? 0)}
                  </span>
                  <span>Probability: {(state.probability * 100).toFixed(2)}%</span>
                  <span>Magnitude: {magnitude.toFixed(4)}</span>
                  <span>Phase: {state.phase.toFixed(3)} rad</span>
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

function toPlotState(
  state: BasisStateResult,
  allStates: BasisStateResult[],
  mode: QSphereMode,
): PlotState {
  const magnitude = Math.sqrt(state.probability);
  const amplitude = state.amplitude ?? { re: 0, im: 0 };
  const phase = Math.atan2(amplitude.im, amplitude.re);
  const color = phaseColor(phase);
  const bits = state.bitstring.split("").map(Number);
  const weight = bits.reduce((sum, bit) => sum + bit, 0);

  let theta: number;
  let phi: number;
  if (mode === "amplitude") {
    theta = 2 * Math.acos(Math.min(1, magnitude));
    phi = (2 * Math.PI * state.index) / allStates.length;
  } else {
    theta =
      bits.length > 0
        ? (Math.PI * weight) / bits.length
        : Math.PI / 2;
    const sameWeight = allStates.filter(
      (candidate) =>
        candidate.bitstring.split("").filter((bit) => bit === "1").length ===
        weight,
    );
    const position = Math.max(
      0,
      sameWeight.findIndex((candidate) => candidate.bitstring === state.bitstring),
    );
    phi = (2 * Math.PI * position) / Math.max(1, sameWeight.length);
  }
  const radius = 0.97;
  return {
    ...state,
    amplitude,
    magnitude,
    phase,
    color,
    position: [
      radius * Math.sin(theta) * Math.cos(phi),
      radius * Math.cos(theta),
      radius * Math.sin(theta) * Math.sin(phi),
    ],
  };
}

function phaseColor(phase: number): string {
  const hue = ((phase + Math.PI) / (2 * Math.PI)) * 300;
  return `hsl(${hue} 84% 62%)`;
}

function formatComplex(real: number, imaginary: number): string {
  const sign = imaginary < 0 ? "−" : "+";
  return `${real.toFixed(3)} ${sign} ${Math.abs(imaginary).toFixed(3)}i`;
}
