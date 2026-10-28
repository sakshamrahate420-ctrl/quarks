import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { generateOpenQasm, generateQiskitPython } from '@/services/codegen/circuitCode';
import { simulateCircuit } from '@/services/simulation/SimulationAdapter';
import { MAX_SPARSE_AMPLITUDES, MAX_SPARSE_QUBITS } from '@/services/simulation/SparseStateSimulator';
import type { Circuit as EngineCircuit, SimulationResult } from '@/features/circuit/types';
import {
  buildCircuitExportRows,
  buildDownloadName,
  buildMeasurementCountsCsv,
  buildProbabilityCsv,
  buildStatevectorCsv,
  downloadSvgGraphic,
  parseCircuitFile,
} from '@/services/storage/circuitFiles';
import {
  addClassicalRegister as addEngineClassicalRegister,
  addQuantumRegister as addEngineQuantumRegister,
  deleteClassicalRegister as deleteEngineClassicalRegister,
  deleteQuantumRegister as deleteEngineQuantumRegister,
  insertClassicalBit as insertEngineClassicalBit,
  insertQubit as insertEngineQubit,
  MAX_QUBITS,
  removeClassicalBit as removeEngineClassicalBit,
  removeQubit as removeEngineQubit,
} from '@/features/circuit/model';
const QSphere = lazy(() => import('@/components/qsphere/QSphere').then((module) => ({ default: module.QSphere })));
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown,
  CircleHelp, CircuitBoard, Command, Copy, Cpu, Download, FilePlus2, FileText,
  FolderOpen, Gauge, Grid2X2, HardDrive, Info, Layers3, Link2,
  Menu, Moon, MoreHorizontal, Play, Plus, RotateCcw, Save, Search, Settings,
  Share2, ShieldCheck, SkipBack, SkipForward, Sparkles, Sun, Trash2, Undo2,
  Redo2, X, X as XIcon, Zap,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';

type GateKind = 'X' | 'Y' | 'Z' | 'H' | 'S' | 'SDG' | 'T' | 'TDG' | 'RX' | 'RY' | 'RZ' | 'CNOT' | 'CZ' | 'SWAP' | 'CCNOT' | 'M' | 'COND_X' | 'COND_Z';
type Gate = { id: string; kind: GateKind; target: number; control?: number; control2?: number; column: number; classical?: number; angle?: number; conditionBit?: number; conditionValue?: 0 | 1 };
type Register = { id: string; name: string; start: number; size: number };
type Circuit = { schemaVersion: 1; id: string; name: string; qubits: number; classicalBits: number; quantumRegisters: Register[]; classicalRegisters: Register[]; gates: Gate[]; updatedAt: string };
type Theme = 'light' | 'dark' | 'system';
const qc = new QueryClient();
const STORE_KEY = 'quarks.local.circuits.v1';
const DRAFT_KEY = 'quarks.local.draft.v1';
const SIMULATOR_MAX_QUBITS = 16;
const simulatorLimitMessage = `QUARKS supports up to ${MAX_QUBITS} qubits. This circuit exceeds the supported sparse-simulation range.`;
const NAV = [
  { href: '/', label: 'Dashboard', icon: Grid2X2 },
  { href: '/editor', label: 'Circuit editor', icon: CircuitBoard },
  { href: '/circuits', label: 'My circuits', icon: Layers3 },
  { href: '/learn', label: 'Learn', icon: BookOpen },
  { href: '/about', label: 'About QUARKS', icon: Info },
];
const PRESETS: Array<{ id: string; name: string; detail: string; qubits: number; gates: Omit<Gate, 'id'>[] }> = [
  { id: 'x-state', name: 'A bit flip', detail: 'X gate · |0⟩ → |1⟩', qubits: 1, gates: [{ kind: 'X', target: 0, column: 0 }] },
  { id: 'superposition', name: 'Superposition', detail: 'Hadamard · equal amplitudes', qubits: 1, gates: [{ kind: 'H', target: 0, column: 0 }] },
  { id: 'bell-pair', name: 'Bell pair', detail: 'Entanglement · two qubits', qubits: 2, gates: [{ kind: 'H', target: 0, column: 0 }, { kind: 'CNOT', target: 1, control: 0, column: 1 }] },
  { id: 'interference', name: 'Interference', detail: 'H · Z · H sequence', qubits: 1, gates: [{ kind: 'H', target: 0, column: 0 }, { kind: 'Z', target: 0, column: 1 }, { kind: 'H', target: 0, column: 2 }] },
  { id: 'multi-gate', name: 'Gate study', detail: 'A three-qubit circuit', qubits: 3, gates: [{ kind: 'H', target: 0, column: 0 }, { kind: 'X', target: 2, column: 0 }, { kind: 'CNOT', control: 0, target: 1, column: 1 }, { kind: 'Z', target: 1, column: 2 }] },
  { id: 'phase-rotation', name: 'Phase & rotation', detail: 'S, T†, and an RY rotation', qubits: 1, gates: [{ kind: 'H', target: 0, column: 0 }, { kind: 'S', target: 0, column: 1 }, { kind: 'TDG', target: 0, column: 2 }, { kind: 'RY', target: 0, column: 3, angle: Math.PI / 3 }] },
  { id: 'toffoli', name: 'Toffoli', detail: 'CCNOT controlled by two qubits', qubits: 3, gates: [{ kind: 'H', target: 0, column: 0 }, { kind: 'X', target: 1, column: 0 }, { kind: 'CCNOT', control: 0, control2: 1, target: 2, column: 1 }] },
  { id: 'classical-condition', name: 'Conditional control', detail: 'Measure, then conditionally flip', qubits: 2, gates: [{ kind: 'H', target: 0, column: 0 }, { kind: 'M', target: 0, classical: 0, column: 1 }, { kind: 'COND_X', target: 1, conditionBit: 0, conditionValue: 1, column: 2 }] },
];
const gateInfo: Record<GateKind, string> = {
  X: 'Bit flip: exchanges |0⟩ and |1⟩.', Y: 'Pauli Y rotation on the Bloch sphere.',
  Z: 'Phase flip: changes the phase of |1⟩.', H: 'Hadamard: creates or recombines equal superposition.',
  S: 'Quarter-turn phase gate.', SDG: 'Inverse quarter-turn phase gate.',
  T: 'Eighth-turn phase gate.', TDG: 'Inverse eighth-turn phase gate.',
  RX: 'Rotation around the X axis. Angle is editable in radians.',
  RY: 'Rotation around the Y axis. Angle is editable in radians.',
  RZ: 'Rotation around the Z axis. Angle is editable in radians.',
  CNOT: 'Controlled X: flips the target when the control is |1⟩.',
  CZ: 'Controlled phase flip when both qubits are |1⟩.',
  SWAP: 'Exchange the states of the two selected qubits.',
  CCNOT: 'Toffoli: flip the target when both controls are |1⟩.',
  M: 'Measurement maps a qubit result to a classical bit.',
  COND_X: 'Apply X when the selected classical bit equals the condition.',
  COND_Z: 'Apply Z when the selected classical bit equals the condition.',
};
const gateColor: Record<GateKind, string> = {
  X: '#765bd1', Y: '#765bd1', Z: '#765bd1', H: '#765bd1', S: '#765bd1',
  SDG: '#765bd1', T: '#765bd1', TDG: '#765bd1', RX: '#765bd1', RY: '#765bd1',
  RZ: '#765bd1', CNOT: '#765bd1', CZ: '#765bd1', SWAP: '#765bd1',
  CCNOT: '#765bd1', M: '#11a8b5', COND_X: '#c17a26', COND_Z: '#c17a26',
};
const GATE_GROUPS: { title: string; gates: GateKind[] }[] = [
  { title: 'Single-qubit', gates: ['H', 'X', 'Y', 'Z', 'S', 'T', 'SDG', 'TDG'] },
  { title: 'Rotations', gates: ['RX', 'RY', 'RZ'] },
  { title: 'Multi-qubit', gates: ['CNOT', 'CZ', 'SWAP', 'CCNOT'] },
  { title: 'Classical', gates: ['M', 'COND_X', 'COND_Z'] },
];
const gateLabel: Record<GateKind, string> = {
  X: 'X / NOT', Y: 'Y', Z: 'Z', H: 'H', S: 'S', SDG: 'S†', T: 'T', TDG: 'T†',
  RX: 'RX', RY: 'RY', RZ: 'RZ', CNOT: 'CNOT', CZ: 'CZ', SWAP: 'SWAP',
  CCNOT: 'CCNOT', M: 'MEASURE', COND_X: 'Conditional X', COND_Z: 'Conditional Z',
};
function gateUsesUiQubit(gate: Gate, qubit: number): boolean {
  if (gate.kind === 'M') return gate.target === qubit;
  if (gate.kind === 'CNOT' || gate.kind === 'CZ' || gate.kind === 'SWAP') return gate.target === qubit || gate.control === qubit;
  if (gate.kind === 'CCNOT') return gate.target === qubit || gate.control === qubit || gate.control2 === qubit;
  return gate.target === qubit;
}
function gateUsesUiClassicalBit(gate: Gate, bit: number): boolean {
  return gate.kind === 'M' ? gate.classical === bit
    : (gate.kind === 'COND_X' || gate.kind === 'COND_Z') && gate.conditionBit === bit;
}
function gateSymbol(kind: GateKind): string {
  if (kind === 'M') return 'M';
  if (kind === 'CNOT') return '⊕';
  if (kind === 'SWAP') return '×';
  if (kind === 'CCNOT') return '⊙';
  if (kind === 'COND_X') return 'Xc';
  if (kind === 'COND_Z') return 'Zc';
  return kind;
}
const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const createCircuit = (name = 'Untitled circuit', qubits = 2): Circuit => ({
  schemaVersion: 1, id: makeId(), name, qubits, classicalBits: qubits,
  quantumRegisters: [{ id: makeId(), name: 'q', start: 0, size: qubits }],
  classicalRegisters: qubits > 0 ? [{ id: makeId(), name: 'c', start: 0, size: qubits }] : [],
  gates: [], updatedAt: new Date().toISOString(),
});
function nextRegisterName(registers: Register[], prefix: string) {
  let index = 0;
  let name = prefix;
  while (registers.some((register) => register.name === name)) name = `${prefix}${++index}`;
  return name;
}
function loadCircuits(): Circuit[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeUiCircuit).filter((c): c is Circuit => c !== null);
  } catch { return []; }
}
function normalizeUiCircuit(value: unknown): Circuit | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Partial<Circuit>;
  if (item.schemaVersion !== 1 || typeof item.id !== 'string' || typeof item.name !== 'string'
    || !Number.isInteger(item.qubits) || !Number.isInteger(item.classicalBits) || !Array.isArray(item.gates)) return null;
  const qubits = item.qubits as number;
  const classicalBits = item.classicalBits as number;
  if (qubits < 1 || qubits > MAX_QUBITS || classicalBits < 0 || classicalBits > 16) return null;
  const quantumRegisters = Array.isArray(item.quantumRegisters) && item.quantumRegisters.length
    ? item.quantumRegisters : [{ id: makeId(), name: 'q', start: 0, size: qubits }];
  const classicalRegisters = Array.isArray(item.classicalRegisters) && item.classicalRegisters.length
    ? item.classicalRegisters : (classicalBits ? [{ id: makeId(), name: 'c', start: 0, size: classicalBits }] : []);
  const circuit: Circuit = {
    schemaVersion: 1,
    id: item.id,
    name: item.name,
    qubits,
    classicalBits,
    quantumRegisters: quantumRegisters as Register[],
    classicalRegisters: classicalRegisters as Register[],
    gates: item.gates as Gate[],
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
  };
  try {
    generateOpenQasm(toEngineCircuit(circuit));
    return circuit;
  } catch {
    return null;
  }
}
function saveCircuits(circuits: Circuit[]) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(circuits)); return true; } catch { return false; }
}
function formatDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? 'Local draft' : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function downloadText(name: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function sanitize(name: string) { return name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-|-$/g, '') || 'quarks-circuit'; }
function makePreset(id: string): Circuit {
  const preset = PRESETS.find((item) => item.id === id) ?? PRESETS[0];
  return { ...createCircuit(preset.name, preset.qubits), gates: preset.gates.map((gate) => ({ ...gate, id: makeId() })) };
}
function toEngineCircuit(circuit: Circuit): EngineCircuit {
  const now = circuit.updatedAt || new Date().toISOString();
  return {
    schemaVersion: 1,
    id: circuit.id,
    name: circuit.name || 'Untitled circuit',
    numQubits: circuit.qubits,
    numClassicalBits: circuit.classicalBits,
    quantumRegisters: circuit.quantumRegisters.map((register) => ({ ...register })),
    classicalRegisters: circuit.classicalRegisters.map((register) => ({ ...register })),
    gates: circuit.gates.map((gate) => {
      if (gate.kind === 'M') {
        return { id: gate.id, type: 'MEASURE', qubit: gate.target, classicalBit: gate.classical ?? 0, column: gate.column };
      }
      if (gate.kind === 'CNOT' || gate.kind === 'CZ' || gate.kind === 'SWAP') {
        return { id: gate.id, type: gate.kind, control: gate.control ?? 0, target: gate.target, column: gate.column };
      }
      if (gate.kind === 'CCNOT') {
        return { id: gate.id, type: 'CCNOT', control1: gate.control ?? 0, control2: gate.control2 ?? 1, target: gate.target, column: gate.column };
      }
      if (gate.kind === 'COND_X' || gate.kind === 'COND_Z') {
        return { id: gate.id, type: gate.kind, target: gate.target, conditionBit: gate.conditionBit ?? 0, conditionValue: gate.conditionValue ?? 1, column: gate.column };
      }
      if (gate.kind === 'RX' || gate.kind === 'RY' || gate.kind === 'RZ') {
        return { id: gate.id, type: gate.kind, target: gate.target, angle: gate.angle ?? Math.PI / 2, column: gate.column };
      }
      return { id: gate.id, type: gate.kind, target: gate.target, column: gate.column };
    }),
    createdAt: now,
    updatedAt: now,
  };
}
function fromEngineCircuit(circuit: EngineCircuit): Circuit {
  return {
    schemaVersion: 1,
    id: circuit.id,
    name: circuit.name,
    qubits: circuit.numQubits,
    classicalBits: circuit.numClassicalBits,
    quantumRegisters: circuit.quantumRegisters.map((register) => ({ ...register })),
    classicalRegisters: circuit.classicalRegisters.map((register) => ({ ...register })),
    updatedAt: circuit.updatedAt,
    gates: circuit.gates.map((gate) => {
      if (gate.type === 'MEASURE') {
        return { id: gate.id, kind: 'M', target: gate.qubit, classical: gate.classicalBit, column: gate.column };
      }
      if (gate.type === 'CNOT' || gate.type === 'CZ' || gate.type === 'SWAP') {
        return { id: gate.id, kind: gate.type, control: gate.control, target: gate.target, column: gate.column };
      }
      if (gate.type === 'CCNOT') {
        return { id: gate.id, kind: 'CCNOT', control: gate.control1, control2: gate.control2, target: gate.target, column: gate.column };
      }
      if (gate.type === 'COND_X' || gate.type === 'COND_Z') {
        return { id: gate.id, kind: gate.type, target: gate.target, conditionBit: gate.conditionBit, conditionValue: gate.conditionValue, column: gate.column };
      }
      if (gate.type === 'RX' || gate.type === 'RY' || gate.type === 'RZ') {
        return { id: gate.id, kind: gate.type, target: gate.target, angle: gate.angle, column: gate.column };
      }
      return { id: gate.id, kind: gate.type, target: gate.target, column: gate.column };
    }),
  };
}
function parseAnyCircuitFile(text: string): Circuit {
  try {
    return fromEngineCircuit(parseCircuitFile(text));
  } catch (formatError) {
    const legacy: unknown = JSON.parse(text);
    if (!isLegacyCircuit(legacy)) {
      throw formatError instanceof Error ? formatError : new Error('Circuit file is invalid.');
    }
    const normalized = normalizeUiCircuit(legacy);
    if (!normalized) throw new Error('Circuit structure is not valid.');
    generateOpenQasm(toEngineCircuit(normalized));
    return normalized;
  }
}
function isLegacyCircuit(value: unknown): value is Circuit {
  return typeof value === 'object' && value !== null
    && 'schemaVersion' in value && value.schemaVersion === 1
    && 'id' in value && typeof value.id === 'string'
    && 'name' in value && typeof value.name === 'string'
    && 'qubits' in value && Number.isInteger(value.qubits)
    && 'classicalBits' in value && Number.isInteger(value.classicalBits)
    && 'gates' in value && Array.isArray(value.gates)
    && 'updatedAt' in value && typeof value.updatedAt === 'string';
}
function codeFor(circuit: Circuit, format: 'qasm' | 'python') {
  const source = toEngineCircuit(circuit);
  return format === 'qasm' ? generateOpenQasm(source) : generateQiskitPython(source);
}
function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('quarks.theme') as Theme) || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    try { localStorage.setItem('quarks.theme', theme); } catch { /* preference storage is optional */ }
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return [theme, setTheme] as const;
}
function Logo() {
  return <div className="brand" data-testid="brand-quarks"><div className="brand-mark"><CircuitBoard size={20} strokeWidth={1.8}/></div><div><div className="brand-name">QUARKS</div><div className="brand-caption">CIRCUIT EXPLORER</div></div></div>;
}
function AppLink({ href, children, className, testid }: { href: string; children: ReactNode; className?: string; testid?: string }) {
  return <Link href={href} className={className} data-testid={testid}>{children}</Link>;
}
function Shell({ children, theme, onTheme, title }: { children: ReactNode; theme: Theme; onTheme: (theme: Theme) => void; title: string }) {
  const [location, setLocation] = useLocation();
  const [editorNavigationOpen, setEditorNavigationOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen((v) => !v); }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  const isEditorPage = location.split('?')[0] === '/editor';
  useEffect(() => { if (isEditorPage) setEditorNavigationOpen(false); }, [location, isEditorPage]);
  const choices = [
    ...NAV,
    { href: '/settings', label: 'Settings', icon: Settings },
      { href: '/editor?new=1', label: 'Command: Create a new circuit', icon: FilePlus2 },
    ...PRESETS.map((preset) => ({ href: `/editor?example=${preset.id}`, label: `Example: ${preset.name}`, icon: CircuitBoard })),
    ...['Qubit', 'Superposition', 'Entanglement', 'Statevector', 'Probability', 'Measurement', 'QSphere', 'OpenQASM'].map((topic) => ({ href: '/learn', label: `Help: ${topic}`, icon: CircleHelp })),
  ];
  const results = choices.filter((item) => item.label.toLowerCase().includes(search.toLowerCase()));
  return <div className={`app-shell${isEditorPage && !editorNavigationOpen ? ' editor-nav-collapsed' : ''}`}>
    <aside className="sidebar"><AppLink href="/" className="brand-link"><Logo/></AppLink>
      <div className="nav-label">Workspace</div>
      <nav aria-label="Primary navigation">{NAV.map(({ href, label, icon: Icon }) => <AppLink key={href} href={href} className={`nav-item ${location === href || (href !== '/' && location.startsWith(href)) ? 'active' : ''}`} testid={`nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={17}/><span>{label}</span></AppLink>)}</nav>
      <div className="nav-label">Preferences</div>
      <AppLink href="/settings" className={`nav-item ${location === '/settings' ? 'active' : ''}`} testid="nav-settings"><Settings size={17}/><span>Settings</span></AppLink>
      <div className="sidebar-bottom"><div className="local-note"><strong><HardDrive size={14}/> Local by design</strong><p>Your circuits stay in this browser. No account or cloud sync is required.</p></div><button className="nav-item" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')} data-testid="button-toggle-theme"><Moon size={17}/><span>Toggle appearance</span></button></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><div className="topbar-leading">{isEditorPage && <button type="button" className="icon-button editor-nav-toggle" onClick={() => setEditorNavigationOpen((open) => !open)} aria-label={editorNavigationOpen ? 'Hide navigation' : 'Show navigation'} aria-expanded={editorNavigationOpen} title={editorNavigationOpen ? 'Hide navigation for more workspace' : 'Show navigation'} data-testid="button-toggle-editor-navigation"><Menu size={16}/></button>}<div className="crumb"><span>QUARKS</span><span style={{ opacity: .45, margin: '0 8px' }}>/</span><span data-testid="text-page-title">{title}</span></div></div>
        <div className="top-actions"><button className="button subtle" onClick={() => setSearchOpen(true)} data-testid="button-open-search"><Search size={14}/> <span className="desktop-only">Search anything</span><kbd className="desktop-only">⌘ K</kbd></button><AppLink href="/settings" className="icon-button" testid="link-settings" aria-label="Settings"><Settings size={16}/></AppLink></div>
      </header>{children}
    </div>
    <nav className="mobile-nav" aria-label="Mobile navigation">{[...NAV, { href: '/settings', label: 'Settings', icon: Settings }].map(({ href, label, icon: Icon }) => <AppLink key={href} href={href} className={`nav-item ${location === href ? 'active' : ''}`} testid={`mobile-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16}/><span>{label === 'Circuit editor' ? 'Editor' : label === 'About QUARKS' ? 'About'  : label}</span></AppLink>)}</nav>
    {searchOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSearchOpen(false); }}><div className="search-modal card" role="dialog" aria-modal="true" aria-label="Search QUARKS">
       <div className="search-input-wrap"><Search size={18}/><input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search pages, commands, examples & help…" data-testid="input-command-search"/><kbd>ESC</kbd></div>
       <div className="search-results">{results.map(({ href, label, icon: Icon }) => <button key={`${href}:${label}`} className="search-result" onClick={() => { setLocation(href); setSearchOpen(false); setSearch(''); }} data-testid={`search-result-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={16}/>{label}<ArrowRight size={14}/></button>)}{results.length === 0 && <div className="empty">No matching page. Try “editor” or “learn”.</div>}</div>
      <div className="search-foot">Navigate quickly · Escape to close</div></div></div>}
  </div>;
}
function Footer() {
  return <div className="footer-links"><AppLink href="/terms">Terms</AppLink><AppLink href="/privacy">Privacy</AppLink><span>QUARKS · frontend preview</span></div>;
}
function Dashboard({ circuits, openPreset, onNew, recentRuns }: { circuits: Circuit[]; openPreset: (id: string) => void; onNew: () => void; recentRuns: number }) {
  const [minimized, setMinimized] = useState(false);
  const totalGates = circuits.reduce((n, c) => n + c.gates.length, 0);
  const latest = circuits.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  return <main className="page">
    <section className="welcome card"><div className="welcome-grid">
      <div><div className="eyebrow"><Sparkles size={13}/> A place to think in circuits</div><h1>Good to have you<br/>in the lab.</h1><p className="lead">Build circuits. Explore quantum states. Start with a blank canvas or use a guided example.</p></div>
      <div className="welcome-actions"><button className="button primary" onClick={onNew} data-testid="button-create-circuit"><Plus size={16}/> Create new circuit</button><button className="button subtle" onClick={() => setMinimized((current) => !current)} aria-expanded={!minimized} data-testid="button-toggle-dashboard-minimize">{minimized ? 'Expand dashboard' : 'Minimize dashboard'}</button></div>
    </div></section>
    {minimized ? <section className="dashboard-minimized card" data-testid="dashboard-minimized"><strong>Dashboard minimized</strong><span>{circuits.length} saved · {totalGates} gates · {recentRuns} previews</span><button className="button" onClick={() => setMinimized(false)}>Expand dashboard</button></section> : <>
      <section className="stat-grid" aria-label="Local workspace statistics"><div className="card stat-card"><div className="stat-label">Saved circuits</div><div className="stat-value" data-testid="stat-circuit-count">{circuits.length.toString().padStart(2, '0')}</div><div className="stat-foot">Stored in this browser</div></div><div className="card stat-card"><div className="stat-label">Gates placed</div><div className="stat-value" data-testid="stat-gate-count">{totalGates.toString().padStart(2, '0')}</div><div className="stat-foot">Across your saved work</div></div><div className="card stat-card"><div className="stat-label">Recent runs</div><div className="stat-value" data-testid="stat-run-count">{recentRuns.toString().padStart(2, '0')}</div><div className="stat-foot">{recentRuns === 0 ? 'No runs recorded yet' : 'Classical previews in this browser'}</div></div></section>
      <div className="section-head"><div><h2>Start with an example</h2><p>Each card opens a real, editable circuit.</p></div><AppLink href="/learn" className="button subtle" testid="link-learn-examples">Explore concepts <ArrowRight size={14}/></AppLink></div>
      <section className="examples">{PRESETS.map((preset) => <button className="card example-card" key={preset.id} onClick={() => openPreset(preset.id)} data-testid={`card-example-${preset.id}`} aria-label={`Open ${preset.name} example`}><div className="example-glyph">{preset.gates.slice(0, 4).map((g, i) => <span key={`${g.kind}-${i}`} className="glyph-gate">{gateSymbol(g.kind)}</span>)}{preset.gates.some((g) => ['CNOT', 'CZ', 'SWAP', 'CCNOT'].includes(g.kind)) && <Link2 size={15}/>}</div><span className="example-title">{preset.name}</span><span className="example-desc">{preset.detail}</span></button>)}</section>
      <div className="quick-grid"><section className="quick-card card"><div className="section-head" style={{ margin: '0 0 10px' }}><div><h2>Local circuits</h2><p>Your actual saved projects, nothing invented.</p></div><AppLink href="/circuits" className="button subtle" testid="link-all-circuits">View all</AppLink></div>
        {latest.length ? latest.map((c) => <AppLink href={`/editor?circuit=${encodeURIComponent(c.id)}`} className="quick-link" key={c.id} testid={`link-recent-circuit-${c.id}`}><span>{c.name}<small style={{ display: 'block', color: 'hsl(var(--muted-foreground))', fontWeight: 500, marginTop: 4 }}>{c.qubits} qubits · {c.gates.length} gates · {formatDate(c.updatedAt)}</small></span><ArrowRight size={15}/></AppLink>) : <div className="empty">No local circuits yet. Create one or open an example.</div>}</section>
        <section className="quick-card card"><div className="eyebrow"><CircleHelp size={13}/> First steps</div><h2 style={{ marginTop: 10 }}>A small map for a big idea.</h2><p className="lead" style={{ fontSize: 11 }}>Place gates on wires, inspect the generated code, then follow each operation through a classical preview.</p><AppLink href="/learn" className="button" testid="button-getting-started"><BookOpen size={14}/> Read the field guide</AppLink></section></div>
    </>}
    <Footer/>
  </main>;
}
function Editor({ circuits, setCircuits, active, setActive, notify, onRun }: { circuits: Circuit[]; setCircuits: (items: Circuit[]) => void; active: Circuit; setActive: (c: Circuit) => void; notify: (message: string) => void; onRun: () => void }) {
  const [editorLocation] = useLocation();
  const [selected, setSelected] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [armed, setArmed] = useState<GateKind | null>(null);
  const [codeTab, setCodeTab] = useState<'qasm' | 'python'>('qasm');
  const [simulation, setSimulation] = useState<'idle' | 'ready' | 'step'>('idle');
  const [stepIndex, setStepIndex] = useState(-1);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [shots, setShots] = useState(1024);
  const [resultTab, setResultTab] = useState<'statevector' | 'histogram'>('statevector');
  const [isRunning, setIsRunning] = useState(false);
  const [isAutoUpdating, setIsAutoUpdating] = useState(false);
  const [simulationError, setSimulationError] = useState('');
  const [wireMenu, setWireMenu] = useState<{ kind: 'quantum' | 'classical'; index: number } | null>(null);
  const [savedStatus, setSavedStatus] = useState('Draft not saved');
  const fileInput = useRef<HTMLInputElement>(null);
  const diagramRef = useRef<SVGSVGElement>(null);
  const loadedQuery = useRef('');
  const selectedGate = active.gates.find((g) => g.id === selected);
  const code = useMemo(() => codeFor(active, codeTab), [active, codeTab]);
  useEffect(() => {
    const params = new URLSearchParams(editorLocation.split('?')[1] ?? '');
    const requestedCircuit = params.get('circuit');
    const requestedExample = params.get('example');
    const createNew = params.get('new') === '1';
    const requestKey = requestedCircuit ? `circuit:${requestedCircuit}`
      : requestedExample ? `example:${requestedExample}`
      : createNew ? 'new:1' : '';
    if (!requestKey || requestKey === loadedQuery.current) return;
    if (requestedCircuit) {
      const found = circuits.find((c) => c.id === requestedCircuit);
      if (found) { setActive(found); setSelected(null); loadedQuery.current = requestKey; }
    } else if (requestedExample) {
      setActive(makePreset(requestedExample)); setSelected(null); loadedQuery.current = requestKey;
    } else if (createNew) {
      setActive(createCircuit()); setSelected(null); loadedQuery.current = requestKey;
    }
  }, [editorLocation, circuits, setActive]);
  useEffect(() => {
    setSimulation('idle');
    setSimulationResult(null);
    setStepIndex(-1);
    setSelected(null);
  }, [active.id]);
  const history = useRef<Circuit[]>([]);
  const future = useRef<Circuit[]>([]);
  const snapshot = useCallback((next: Circuit) => {
    history.current = [...history.current.slice(-39), active];
    future.current = [];
    setActive({ ...next, updatedAt: new Date().toISOString() });
    setSimulation('idle');
    setSimulationResult(null);
  }, [active, setActive]);
  const pushGate = (kind: GateKind, target: number, column?: number) => {
    const safeTarget = Math.max(0, Math.min(active.qubits - 1, target));
    if (kind === 'M' && active.classicalBits < 1) { notify('Add a classical bit before placing a measurement.'); return; }
    if ((kind === 'COND_X' || kind === 'COND_Z') && active.classicalBits < 1) { notify('Add a classical bit before placing a conditional gate.'); return; }
    const nextColumn = column ?? Math.max(0, ...active.gates.map((g) => g.column + 1));
    let gate: Gate = { id: makeId(), kind, target: safeTarget, column: nextColumn };
    if (['CNOT', 'CZ', 'SWAP'].includes(kind)) {
      if (active.qubits < 2) { notify(`${kind} needs at least two qubits. Add a qubit first.`); return; }
      gate = { ...gate, control: safeTarget === 0 ? 1 : 0 };
    }
    if (kind === 'CCNOT') {
      if (active.qubits < 3) { notify('CCNOT needs three qubits. Add more qubits first.'); return; }
      const controls = Array.from({ length: active.qubits }, (_, index) => index).filter((index) => index !== safeTarget);
      gate = { ...gate, control: controls[0] ?? 0, control2: controls[1] ?? 1 };
    }
    if (kind === 'M') gate.classical = Math.min(safeTarget, Math.max(0, active.classicalBits - 1));
    if (kind === 'RX' || kind === 'RY' || kind === 'RZ') gate.angle = Math.PI / 2;
    if (kind === 'COND_X' || kind === 'COND_Z') { gate.conditionBit = 0; gate.conditionValue = 1; }
    snapshot({ ...active, gates: [...active.gates, gate] }); setSelected(gate.id); setArmed(null); setWireMenu(null);
  };
  const undo = () => { const prev = history.current.pop(); if (!prev) return; future.current.push(active); setActive(prev); setSelected(null); setSimulation('idle'); setSimulationResult(null); };
  const redo = () => { const next = future.current.pop(); if (!next) return; history.current.push(active); setActive(next); setSimulation('idle'); setSimulationResult(null); };
  const deleteSelected = () => { if (!selectedGate) return; snapshot({ ...active, gates: active.gates.filter((g) => g.id !== selected) }); setSelected(null); };
  const duplicateSelected = () => { if (!selectedGate) return; const copy = { ...selectedGate, id: makeId(), column: selectedGate.column + 1 }; snapshot({ ...active, gates: [...active.gates, copy] }); setSelected(copy.id); };
  const updateGate = (patch: Partial<Gate>) => {
    if (!selectedGate) return;
    const updated = { ...selectedGate, ...patch };
    if (['CNOT', 'CZ', 'SWAP'].includes(updated.kind) && updated.target === updated.control) { notify(`${updated.kind} control and target must be different qubits.`); return; }
    if (updated.kind === 'CCNOT' && new Set([updated.target, updated.control, updated.control2]).size !== 3) { notify('CCNOT controls and target must be different qubits.'); return; }
    if ((updated.kind === 'M' && (updated.classical ?? -1) >= active.classicalBits)
      || ((updated.kind === 'COND_X' || updated.kind === 'COND_Z') && (updated.conditionBit ?? -1) >= active.classicalBits)) {
      notify('The selected classical bit is outside the circuit.'); return;
    }
    if (['RX', 'RY', 'RZ'].includes(updated.kind) && !Number.isFinite(updated.angle)) { notify('Rotation angle must be finite.'); return; }
    snapshot({ ...active, gates: active.gates.map((g) => g.id === selected ? updated : g) });
  };
  const saveDraft = (asNew = false) => {
    const toSave = { ...active, id: asNew ? makeId() : active.id, updatedAt: new Date().toISOString() };
    const items = circuits.filter((c) => c.id !== toSave.id);
    if (saveCircuits([toSave, ...items])) { setCircuits([toSave, ...items]); setActive(toSave); setSavedStatus(`Saved locally · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`); notify('Circuit saved in this browser.'); }
    else { setSavedStatus('Could not save'); notify('Browser storage is unavailable. Export the circuit JSON instead.'); }
  };
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(active)); setSavedStatus('Unsaved changes'); } catch { setSavedStatus('Draft storage unavailable'); }
  }, [active]);
  useEffect(() => {
    let cancelled = false;
    if (!active.gates.length) {
      setSimulationResult(null);
      setSimulation('idle');
      setStepIndex(-1);
      setSimulationError('');
      return;
    }
    setSimulationResult(null);
    setSimulation('idle');
    setSimulationError('');
    if (active.qubits > MAX_QUBITS) {
      setSimulationError(simulatorLimitMessage);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsAutoUpdating(true);
      void simulateCircuit({ circuit: toEngineCircuit(active), shots })
        .then((result) => {
          if (cancelled) return;
          setSimulationResult(result);
          setSimulation('ready');
          setStepIndex(active.gates.length - 1);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setSimulationError(error instanceof Error ? error.message : 'Live preview could not update.');
        })
        .finally(() => {
          if (!cancelled) setIsAutoUpdating(false);
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setIsAutoUpdating(false);
    };
  }, [active.id, active.qubits, active.classicalBits, active.gates, active.quantumRegisters, active.classicalRegisters, shots]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveDraft(); }
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); deleteSelected(); }
      else if (event.key === 'Escape') { setArmed(null); setSelected(null); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const editWithEngine = (edit: (circuit: EngineCircuit) => EngineCircuit) => {
    try {
      snapshot(fromEngineCircuit(edit(toEngineCircuit(active))));
      setSelected(null);
      setWireMenu(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Register edit could not be applied.');
    }
  };
  const addQubitAt = (index: number, registerId?: string) => editWithEngine((circuit) => insertEngineQubit(circuit, index, registerId));
  const deleteQubitAt = (index: number) => {
    if (active.gates.some((gate) => gateUsesUiQubit(gate, index)) && !window.confirm(`Delete q[${index}] and gates that use it?`)) return;
    editWithEngine((circuit) => removeEngineQubit(circuit, index));
  };
  const addQubitRegisterAt = (index: number) => editWithEngine((circuit) => addEngineQuantumRegister(circuit, 1, undefined, index));
  const deleteQubitRegister = (register: Register) => {
    const affected = active.gates.some((gate) => Array.from({ length: register.size }, (_, offset) => gateUsesUiQubit(gate, register.start + offset)).some(Boolean));
    if (affected && !window.confirm(`Delete register ${register.name} and all gates that use it?`)) return;
    editWithEngine((circuit) => deleteEngineQuantumRegister(circuit, register.id));
  };
  const addClassicalBitAt = (index: number, registerId?: string) => editWithEngine((circuit) => insertEngineClassicalBit(circuit, index, registerId));
  const deleteClassicalBitAt = (index: number) => {
    if (active.gates.some((gate) => gateUsesUiClassicalBit(gate, index)) && !window.confirm(`Delete c[${index}] and operations that use it?`)) return;
    editWithEngine((circuit) => removeEngineClassicalBit(circuit, index));
  };
  const addClassicalRegisterAt = (index: number) => editWithEngine((circuit) => addEngineClassicalRegister(circuit, 1, undefined, index));
  const deleteClassicalRegister = (register: Register) => {
    const affected = active.gates.some((gate) => Array.from({ length: register.size }, (_, offset) => gateUsesUiClassicalBit(gate, register.start + offset)).some(Boolean));
    if (affected && !window.confirm(`Delete register ${register.name} and operations that use it?`)) return;
    editWithEngine((circuit) => deleteEngineClassicalRegister(circuit, register.id));
  };
  const onDrop = (event: DragEvent<SVGSVGElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('text/quarks-gate') as GateKind;
    if (!GATE_GROUPS.some((group) => group.gates.includes(kind))) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const y = (event.clientY - rect.top) * (event.currentTarget.viewBox.baseVal.height / rect.height);
    const target = Math.max(0, Math.min(active.qubits - 1, Math.round((y - 50) / 68)));
    const x = (event.clientX - rect.left) * (event.currentTarget.viewBox.baseVal.width / rect.width);
    const column = Math.max(0, Math.floor((x - 120) / 88));
    if (kind) pushGate(kind, target, column);
  };
  const startSimulation = async () => {
    if (!active.gates.length) { notify('Add at least one operation before running a preview.'); return; }
    if (active.qubits > MAX_QUBITS) { setSimulationError(simulatorLimitMessage); notify(simulatorLimitMessage); return; }
    setIsRunning(true);
    setSimulationError('');
    try {
      const result = await simulateCircuit({ circuit: toEngineCircuit(active), shots });
      setSimulationResult(result);
      setResultTab('statevector');
      setSimulation('ready');
      setStepIndex(active.gates.length - 1);
      onRun();
      notify(`${result.engine.includes('sparse') ? 'Sparse simulation' : 'QuantumLab WASM simulation'} completed · ${shots} shots. No quantum hardware was used.`);
    } catch (error) {
      setSimulation('idle');
      setSimulationResult(null);
      const message = error instanceof Error ? error.message : 'Simulation could not run.';
      setSimulationError(message);
      notify(message);
    } finally {
      setIsRunning(false);
    }
  };
  const stepBackward = () => {
    if (!simulationResult) { notify('Run the circuit before stepping through it.'); return; }
    setSimulation('step');
    setStepIndex((current) => Math.max(-1, current - 1));
  };
  const stepForward = () => {
    if (!simulationResult) { notify('Run the circuit before stepping through it.'); return; }
    setSimulation('step');
    setStepIndex((current) => Math.min(active.gates.length - 1, current + 1));
  };
  const resetSimulation = () => {
    setSimulation('idle');
    setSimulationResult(null);
    setStepIndex(-1);
    setSelected(null);
  };
  const exportJSON = () => downloadText(`${sanitize(active.name)}.json`, buildCircuitExportRows(toEngineCircuit(active)), 'application/json');
  const exportDiagram = async (format: 'svg' | 'png') => {
    if (!diagramRef.current) { notify('Circuit diagram is not available for export.'); return; }
    try {
      await downloadSvgGraphic(
        diagramRef.current,
        `${sanitize(active.name)}-circuit.${format}`,
        format,
        '.wire-label{fill:#8290a8;font:11px monospace}.wire-line{stroke:#657188;stroke-width:1}.gate-box{fill:#f6f4ff;stroke:#765bd1;stroke-width:1.6}.gate-text{fill:#5942ae;font:bold 12px monospace}.cnot-line{stroke:#765bd1;stroke-width:1.5}.cnot-dot{fill:#765bd1}.drop-target{fill:#765bd1;fill-opacity:.12;stroke:#765bd1;stroke-dasharray:3 3}',
      );
      notify(`Circuit diagram downloaded as ${format.toUpperCase()}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Circuit diagram export failed.');
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = parseAnyCircuitFile(await file.text());
      const imported = { ...parsed, id: makeId(), updatedAt: new Date().toISOString() };
      setActive(imported); setSelected(null); notify('Circuit JSON imported.');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not import this circuit file.'); }
  };
  const diagramWidth = Math.max(640, 200 + Math.max(4, ...active.gates.map((g) => g.column + 2)) * 88);
  const orderedGates = active.gates.map((gate, index) => ({ gate, index }))
    .sort((a, b) => a.gate.column - b.gate.column || a.index - b.index)
    .map(({ gate }) => gate);
  const wireY = (qubit: number) => 50 + qubit * 68;
  const classicalTop = wireY(active.qubits - 1) + 58;
  const classicalY = (bit: number) => classicalTop + bit * 30;
  const diagramHeight = active.classicalBits > 0
    ? classicalY(active.classicalBits - 1) + 38
    : wireY(active.qubits - 1) + 54;
  const selectedWireRegister = wireMenu
    ? (wireMenu.kind === 'quantum' ? active.quantumRegisters : active.classicalRegisters)
      .find((register) => wireMenu.index >= register.start && wireMenu.index < register.start + register.size)
    : undefined;
  const openWireMenu = (kind: 'quantum' | 'classical', index: number) => {
    setSelected(null);
    setWireMenu({ kind, index });
  };
  const addByClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!armed) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const y = (event.clientY - bounds.top) * (event.currentTarget.viewBox.baseVal.height / bounds.height);
    const target = Math.max(0, Math.min(active.qubits - 1, Math.round((y - 50) / 68)));
    pushGate(armed, target);
  };
  const copyCode = async () => { try { await navigator.clipboard.writeText(code); notify('Generated code copied.'); } catch { notify('Clipboard access is unavailable in this browser.'); } };
  const loadProject = (id: string) => { const found = circuits.find((c) => c.id === id); if (found) { setActive(found); setSelected(null); } };
  return <main className="editor-page">
    <div className="editor-toolbar"><div className="editor-title"><input value={active.name} onChange={(e) => setActive({ ...active, name: e.target.value })} aria-label="Circuit name" data-testid="input-circuit-name"/></div>
      <button className="icon-button" title="Undo (Ctrl/Cmd+Z)" onClick={undo} disabled={!history.current.length} data-testid="button-undo"><Undo2 size={15}/></button>
      <button className="icon-button" title="Redo (Ctrl/Cmd+Shift+Z)" onClick={redo} disabled={!future.current.length} data-testid="button-redo"><Redo2 size={15}/></button>
      <button className="button" onClick={() => fileInput.current?.click()} data-testid="button-import-circuit"><FolderOpen size={14}/> Open</button>
      <button className="button" onClick={exportJSON} data-testid="button-export-json"><Download size={14}/> Export</button>
      <button className="button subtle desktop-only" onClick={() => void exportDiagram('svg')} data-testid="button-export-circuit-svg">SVG</button>
      <button className="button subtle desktop-only" onClick={() => void exportDiagram('png')} data-testid="button-export-circuit-png">PNG</button>
      <button className="button" onClick={() => saveDraft(true)} data-testid="button-save-as"><FilePlus2 size={14}/> Save as</button>
      <button className="button" onClick={() => saveDraft()} data-testid="button-save-circuit"><Save size={14}/> Save</button>
      <button className="button subtle" onClick={() => setFocusMode((current) => !current)} aria-pressed={focusMode} title={focusMode ? "Show gate palette and inspector" : "Hide side panels for a clearer canvas"} data-testid="button-toggle-workspace-panels"><MoreHorizontal size={14}/> {focusMode ? "Show panels" : "Focus canvas"}</button>
      <div className="toolbar-spacer"/>
      <button className="button" onClick={resetSimulation} data-testid="button-reset-simulation"><RotateCcw size={14}/> Reset</button>
      <button className="button subtle" onClick={() => { setSimulation('idle'); setStepIndex(-1); setSimulationResult(null); }} data-testid="button-stop-simulation">Stop</button>
      <button className="button" title="Step backward" onClick={stepBackward} disabled={!simulationResult || !simulationResult.snapshots.length || stepIndex <= -1} data-testid="button-step-back"><SkipBack size={14}/></button>
      <button className="button" title="Step forward" onClick={stepForward} disabled={!simulationResult || !simulationResult.snapshots.length || stepIndex >= active.gates.length - 1} data-testid="button-step-forward"><SkipForward size={14}/></button>
      <button className="button primary" onClick={() => void startSimulation()} disabled={isRunning} data-testid="button-run-circuit"><Play size={14}/> {isRunning ? 'Running…' : 'Run'}</button>
      <input type="file" accept=".json,application/json" ref={fileInput} hidden onChange={(e) => importFile(e.target.files?.[0])} data-testid="input-import-file"/>
    </div>
    <div className={`editor-layout${focusMode ? " focus-mode" : ""}`} data-focus-mode={focusMode}>
      <aside className="palette" aria-label="Gate composer palette">
        {GATE_GROUPS.map((group) => <section className="gate-group-list" key={group.title}>
          <div className="panel-label">{group.title}</div>
          {group.gates.map((kind) => <button key={kind} className={`gate-tool ${['M', 'COND_X', 'COND_Z'].includes(kind) ? 'measure' : ''} ${armed === kind ? 'armed' : ''}`} draggable onDragStart={(event) => event.dataTransfer.setData('text/quarks-gate', kind)} onClick={() => setArmed(armed === kind ? null : kind)} title={gateInfo[kind]} aria-pressed={armed === kind} data-testid={`tool-gate-${kind.toLowerCase()}`}><span className="gate-icon">{gateSymbol(kind)}</span><span>{gateLabel[kind]}</span></button>)}
        </section>)}
        <p className="palette-help">Choose a gate, then select a qubit wire or drag it onto the circuit. Select a q[i] or c[i] label to manage bits and registers. {armed && `Now placing ${gateLabel[armed]}.`}</p>
      </aside>
      <section className="circuit-workspace">
        <div className="canvas-controls"><span className="status-pill"><span style={{ width: 5, height: 5, borderRadius: 8, background: 'currentColor' }}/> {savedStatus}</span><div className="toolbar-spacer"/><span className="mono" style={{ color: 'hsl(var(--muted-foreground))', fontSize: 10 }} data-testid="text-circuit-summary">{active.qubits} qubits · {active.gates.length} operations</span><select className="select-control" aria-label="Open a local circuit" value="" onChange={(e) => loadProject(e.target.value)} data-testid="select-open-circuit"><option value="">Open saved…</option>{circuits.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {wireMenu && selectedWireRegister && <div className="wire-context-menu" role="group" aria-label={`${wireMenu.kind} wire editing options`} data-testid="wire-context-menu">
          <div className="wire-context-heading"><strong>{wireMenu.kind === 'quantum' ? `q[${wireMenu.index}]` : `c[${wireMenu.index}]`}</strong><span>in {selectedWireRegister.name}</span><button className="icon-button" onClick={() => setWireMenu(null)} aria-label="Close wire options" data-testid="button-close-wire-options"><XIcon size={13}/></button></div>
          <div className="wire-context-actions">
            {wireMenu.kind === 'quantum' ? <>
              <button onClick={() => addQubitAt(wireMenu.index, selectedWireRegister.id)} disabled={active.qubits >= MAX_QUBITS} data-testid="button-insert-qubit-before">Add qubit before</button>
              <button onClick={() => addQubitAt(wireMenu.index + 1, selectedWireRegister.id)} disabled={active.qubits >= MAX_QUBITS} data-testid="button-insert-qubit-after">Add qubit after</button>
              <button onClick={() => deleteQubitAt(wireMenu.index)} disabled={active.qubits <= 1} data-testid="button-delete-selected-qubit">Delete this qubit</button>
              <button onClick={() => addQubitRegisterAt(wireMenu.index)} disabled={active.qubits >= MAX_QUBITS} data-testid="button-insert-register-before">Add register before</button>
              <button onClick={() => addQubitRegisterAt(wireMenu.index + 1)} disabled={active.qubits >= MAX_QUBITS} data-testid="button-insert-register-after">Add register after</button>
              <button onClick={() => deleteQubitRegister(selectedWireRegister)} disabled={active.quantumRegisters.length <= 1} data-testid="button-delete-selected-register">Delete register</button>
            </> : <>
              <button onClick={() => addClassicalBitAt(wireMenu.index, selectedWireRegister.id)} disabled={active.classicalBits >= 16} data-testid="button-insert-classical-before">Add bit before</button>
              <button onClick={() => addClassicalBitAt(wireMenu.index + 1, selectedWireRegister.id)} disabled={active.classicalBits >= 16} data-testid="button-insert-classical-after">Add bit after</button>
              <button onClick={() => deleteClassicalBitAt(wireMenu.index)} data-testid="button-delete-selected-classical-bit">Delete this bit</button>
              <button onClick={() => addClassicalRegisterAt(wireMenu.index)} disabled={active.classicalBits >= 16} data-testid="button-insert-classical-register-before">Add register before</button>
              <button onClick={() => addClassicalRegisterAt(wireMenu.index + 1)} disabled={active.classicalBits >= 16} data-testid="button-insert-classical-register-after">Add register after</button>
              <button onClick={() => deleteClassicalRegister(selectedWireRegister)} data-testid="button-delete-selected-classical-register">Delete register</button>
            </>}
          </div>
        </div>}
        <div className="canvas-wrap"><div className="circuit-canvas">
          <svg ref={diagramRef} className="circuit-svg" viewBox={`0 0 ${diagramWidth} ${diagramHeight}`} style={{ height: diagramHeight, minWidth: diagramWidth }} role="img" aria-label="Editable quantum circuit diagram" onClick={addByClick} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} data-testid="circuit-canvas">
            {Array.from({ length: active.qubits }, (_, i) => <g key={`wire-${i}`}>
              <text x="10" y={wireY(i) + 4} className="wire-label wire-label-clickable" role="button" tabIndex={0} aria-label={`Manage qubit q[${i}]`} aria-haspopup="true" aria-expanded={wireMenu?.kind === 'quantum' && wireMenu.index === i} onClick={(event) => { event.stopPropagation(); armed ? pushGate(armed, i) : openWireMenu('quantum', i); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); armed ? pushGate(armed, i) : openWireMenu('quantum', i); } }} data-testid={`wire-qubit-${i}`}>q[{i}]</text>
              <line x1="58" x2={diagramWidth - 20} y1={wireY(i)} y2={wireY(i)} className="wire-line"/>
              {armed && <circle cx="75" cy={wireY(i)} r="16" className="drop-target" onClick={(event) => { event.stopPropagation(); pushGate(armed, i); }}/>}
            </g>)}
            {Array.from({ length: active.classicalBits }, (_, i) => <g key={`classical-wire-${i}`}>
              <text x="10" y={classicalY(i) + 4} className="wire-label wire-label-clickable" role="button" tabIndex={0} aria-label={`Manage classical bit c[${i}]`} aria-haspopup="true" aria-expanded={wireMenu?.kind === 'classical' && wireMenu.index === i} onClick={(event) => { event.stopPropagation(); openWireMenu('classical', i); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openWireMenu('classical', i); } }} data-testid={`wire-classical-${i}`}>c[{i}]</text>
              <line x1="58" x2={diagramWidth - 20} y1={classicalY(i)} y2={classicalY(i)} className="classical-wire"/>
            </g>)}
            {orderedGates.map((gate, operationIndex) => {
              const x = 120 + gate.column * 88;
              const y = wireY(gate.target);
              const isSelected = gate.id === selected;
              const isCurrentStep = simulation === 'step' && operationIndex === stepIndex;
              const groupClass = `gate-group ${isSelected ? 'gate-selected' : ''} ${isCurrentStep ? 'gate-current' : ''}`;
              if (gate.kind === 'CNOT' || gate.kind === 'CZ' || gate.kind === 'SWAP' || gate.kind === 'CCNOT') {
                const controls = gate.kind === 'CCNOT' ? [gate.control ?? 0, gate.control2 ?? 1] : [gate.control ?? 0];
                const controlYs = controls.map(wireY);
                return <g key={gate.id} className={groupClass} onClick={(event) => { event.stopPropagation(); setSelected(gate.id); setWireMenu(null); }} data-testid={`gate-${gate.kind.toLowerCase()}-${gate.id}`} aria-label={`${gateLabel[gate.kind]} target q${gate.target}`}>
                  {controlYs.map((controlY, index) => <line key={`link-${index}`} x1={x} x2={x} y1={Math.min(controlY, y)} y2={Math.max(controlY, y)} className="cnot-line"/> )}
                  {gate.kind === 'SWAP' ? <>
                    {controlYs.map((controlY, index) => <text key={`swap-${index}`} x={x} y={controlY + 1} className="gate-text swap-text" fill={gateColor.SWAP}>×</text>)}
                    <text x={x} y={y + 1} className="gate-text swap-text" fill={gateColor.SWAP}>×</text>
                  </> : <>
                    {controlYs.map((controlY, index) => <circle key={`control-${index}`} cx={x} cy={controlY} r="5" className="cnot-dot"/> )}
                    <circle cx={x} cy={y} r="11" fill="hsl(var(--card))" stroke={gateColor[gate.kind]} strokeWidth="1.6"/>
                    {gate.kind === 'CZ'
                      ? <text x={x} y={y + 1} className="gate-text" fill={gateColor.CZ}>Z</text>
                      : <path d={`M${x - 7} ${y}h14 M${x} ${y - 7}v14`} stroke={gateColor[gate.kind]} strokeWidth="1.4"/>}
                  </>}
                  {(isSelected || isCurrentStep) && <circle cx={x} cy={y} r="21" fill="none" stroke={isCurrentStep ? '#11a8b5' : 'hsl(var(--accent))'} strokeDasharray="3 3"/>}
                </g>;
              }
              if (gate.kind === 'M') {
                const bit = Math.min(gate.classical ?? 0, Math.max(0, active.classicalBits - 1));
                return <g key={gate.id} className={groupClass} onClick={(event) => { event.stopPropagation(); setSelected(gate.id); setWireMenu(null); }} data-testid={`gate-measure-${gate.id}`} aria-label={`Measure q${gate.target} into c${bit}`}>
                  <line x1={x} x2={x} y1={y + 15} y2={classicalY(bit)} className="measurement-link"/>
                  <rect x={x - 15} y={y - 15} width="30" height="30" rx="6" className="gate-box" style={{ stroke: gateColor.M }}/>
                  <text x={x} y={y + 1} className="gate-text" style={{ fill: gateColor.M }}>M</text>
                </g>;
              }
              if (gate.kind === 'COND_X' || gate.kind === 'COND_Z') {
                const bit = Math.min(gate.conditionBit ?? 0, Math.max(0, active.classicalBits - 1));
                return <g key={gate.id} className={groupClass} onClick={(event) => { event.stopPropagation(); setSelected(gate.id); setWireMenu(null); }} data-testid={`gate-${gate.kind.toLowerCase()}-${gate.id}`} aria-label={`${gateLabel[gate.kind]} from c${bit}`}>
                  <line x1={x} x2={x} y1={Math.min(classicalY(bit), y + 15)} y2={Math.max(classicalY(bit), y + 15)} className="conditional-link"/>
                  <rect x={x - 17} y={y - 15} width="34" height="30" rx="6" className="gate-box" style={{ stroke: gateColor[gate.kind] }}/>
                  <text x={x} y={y + 1} className="gate-text" style={{ fill: gateColor[gate.kind] }}>{gate.kind === 'COND_X' ? 'X' : 'Z'}</text>
                  <text x={x + 17} y={y - 10} className="gate-annotation">c{bit}={gate.conditionValue ?? 1}</text>
                </g>;
              }
              const symbol = gate.kind === 'RX' ? 'Rx' : gate.kind === 'RY' ? 'Ry' : gate.kind === 'RZ' ? 'Rz' : gate.kind;
              return <g key={gate.id} className={groupClass} onClick={(event) => { event.stopPropagation(); setSelected(gate.id); setWireMenu(null); }} data-testid={`gate-${gate.kind.toLowerCase()}-${gate.id}`} aria-label={`${gateLabel[gate.kind]} on qubit ${gate.target}`}>
                <rect x={x - 16} y={y - 15} width="32" height="30" rx="6" className="gate-box"/>
                <text x={x} y={y + 1} className="gate-text">{symbol}</text>
                {['RX', 'RY', 'RZ'].includes(gate.kind) && <text x={x} y={y + 27} className="gate-annotation">{((gate.angle ?? Math.PI / 2) * 180 / Math.PI).toFixed(0)}°</text>}
              </g>;
            })}
          </svg>
          {active.classicalBits === 0 && <button className="add-classical-wire" onClick={() => addClassicalBitAt(0)} data-testid="button-add-first-classical-bit"><Plus size={13}/> Add classical bit</button>}
        </div>
        {active.gates.length === 0 && <div className="canvas-empty empty-circuit-hub" data-testid="empty-circuit-starters">
          <div className="empty-hub-orbit" aria-hidden="true"><span>ψ</span><i>H</i><b>+</b></div>
          <div className="eyebrow"><Sparkles size={13}/> A clear canvas, ready for you</div>
          <h2>Choose a starting point</h2>
          <p>Load a small circuit to explore, or place gates yourself on the wires above.</p>
          <div className="canvas-starters">
            {[
              { id: 'superposition', title: 'Superposition', glyphs: ['H'], detail: 'One qubit · equal amplitudes' },
              { id: 'bell-pair', title: 'Bell pair', glyphs: ['H', 'CNOT'], detail: 'Two qubits · entangled' },
              { id: 'phase-rotation', title: 'Phase rotations', glyphs: ['H', 'S', 'RY'], detail: 'Explore phase and angle' },
            ].map((starter) => <button type="button" className="canvas-starter" key={starter.id} onClick={() => { setActive(makePreset(starter.id)); setSelected(null); }} data-testid={`button-start-${starter.id}`}>
              <span className="starter-gates" aria-hidden="true">{starter.glyphs.map((glyph, index) => <span key={`${starter.id}-${glyph}-${index}`}><i>{glyph}</i>{index < starter.glyphs.length - 1 && <b>·</b>}</span>)}</span>
              <strong>{starter.title}</strong><small>{starter.detail}</small>
            </button>)}
          </div>
          <span className="empty-hub-hint">Tip: choose any gate, then click a qubit wire to place it.</span>
        </div>}
        </div>
        <div className="canvas-controls"><button className="button subtle" onClick={() => { const clean = active.gates.map((g, i) => ({ ...g, column: i })); snapshot({ ...active, gates: clean }); }} data-testid="button-align-gates"><Activity size={13}/> Compact columns</button><span className="toolbar-spacer"/><span className="run-note" data-testid="text-keyboard-shortcuts">Ctrl/Cmd+S save · Z undo · Delete removes selection</span></div>
        <section className={`workspace-results${simulationResult ? ' has-results' : simulationError ? ' has-error' : ' is-idle'}`} aria-label="Circuit simulation results">
          <div className="workspace-results-heading"><div><div className="panel-label">Simulation results</div><span className="run-note">Dense simulation: up to {SIMULATOR_MAX_QUBITS} qubits. Sparse simulation: up to {MAX_SPARSE_QUBITS} qubits and {MAX_SPARSE_AMPLITUDES.toLocaleString()} occupied states.</span></div><span className="status-pill">STATEVECTOR · DEMO</span></div>
          <div className="shot-control"><label htmlFor="shot-count">Measurement shots</label><input id="shot-count" type="number" min="1" max="10000" value={shots} onChange={(event) => setShots(Math.min(10000, Math.max(1, Number(event.target.value) || 1)))} data-testid="input-shot-count"/></div>
          {simulationError && <div className="notice simulation-limit-notice" role="status" data-testid="notice-simulation-limit">{simulationError}</div>}
          {simulationResult ? <div data-testid="status-simulation"><div className="run-note workspace-engine-note"><strong>{simulation === 'ready' ? 'Simulation complete' : `Step ${Math.max(0, stepIndex + 1)} of ${active.gates.length}`}</strong> · {simulationResult.engine} · {simulationResult.engine.includes('sparse') ? 'Occupied states only; per-gate snapshots are disabled.' : 'Local simulation, not quantum hardware execution.'}</div>
            <SimulationResultsPanel result={simulationResult} stepIndex={stepIndex} activeTab={resultTab} onTabChange={setResultTab} circuitName={active.name} notify={notify}/>
          </div> : <div className="empty workspace-results-empty" data-testid="empty-simulation">Run the circuit to view its state probabilities and measurement counts.</div>}
        </section>
      </section>
      <aside className="editor-side">
        <div className="side-tabs" role="tablist"><button className={`tab-button ${codeTab === 'qasm' ? 'active' : ''}`} onClick={() => setCodeTab('qasm')} role="tab" aria-selected={codeTab === 'qasm'} data-testid="tab-openqasm">OpenQASM</button><button className={`tab-button ${codeTab === 'python' ? 'active' : ''}`} onClick={() => setCodeTab('python')} role="tab" aria-selected={codeTab === 'python'} data-testid="tab-python">Python</button><div className="toolbar-spacer"/><button className="icon-button" title="Copy generated code" onClick={copyCode} data-testid="button-copy-code"><Copy size={14}/></button><button className="icon-button" title="Download generated code" onClick={() => downloadText(`${sanitize(active.name)}.${codeTab === 'qasm' ? 'qasm' : 'py'}`, code)} data-testid="button-download-code"><ArrowDownToLine size={14}/></button></div>
        <div className="side-section"><div className="code-header"><span>Generated from this circuit</span><span className="mono">{codeTab === 'qasm' ? 'QASM 3' : 'QISKIT STYLE'}</span></div><pre className="code-block" data-testid="code-generated"><code>{code}</code></pre></div>
        <div className="side-section">
          <div className="panel-label" style={{ margin: '0 0 8px' }}>Selection</div>
          {selectedGate ? <>
            <div className="property-row"><span>Operation</span><strong>{gateLabel[selectedGate.kind]}</strong></div>
            <div className="property-row"><span>Target qubit</span><select value={selectedGate.target} onChange={(event) => updateGate({ target: Number(event.target.value) })} data-testid="select-gate-target">{Array.from({ length: active.qubits }, (_, index) => <option key={index} value={index}>q[{index}]</option>)}</select></div>
            {(selectedGate.kind === 'CNOT' || selectedGate.kind === 'CZ' || selectedGate.kind === 'SWAP') && <div className="property-row"><span>Control qubit</span><select value={selectedGate.control ?? 0} onChange={(event) => updateGate({ control: Number(event.target.value) })} data-testid="select-gate-control">{Array.from({ length: active.qubits }, (_, index) => <option key={index} value={index} disabled={index === selectedGate.target}>q[{index}]</option>)}</select></div>}
            {selectedGate.kind === 'CCNOT' && <>
              <div className="property-row"><span>First control</span><select value={selectedGate.control ?? 0} onChange={(event) => updateGate({ control: Number(event.target.value) })} data-testid="select-gate-control">{Array.from({ length: active.qubits }, (_, index) => <option key={index} value={index} disabled={index === selectedGate.target || index === selectedGate.control2}>q[{index}]</option>)}</select></div>
              <div className="property-row"><span>Second control</span><select value={selectedGate.control2 ?? 1} onChange={(event) => updateGate({ control2: Number(event.target.value) })} data-testid="select-gate-control2">{Array.from({ length: active.qubits }, (_, index) => <option key={index} value={index} disabled={index === selectedGate.target || index === selectedGate.control}>q[{index}]</option>)}</select></div>
            </>}
            {(selectedGate.kind === 'RX' || selectedGate.kind === 'RY' || selectedGate.kind === 'RZ') && <div className="property-row"><span>Angle (degrees)</span><input type="number" min="-360" max="360" step="15" value={Number((((selectedGate.angle ?? Math.PI / 2) * 180) / Math.PI).toFixed(2))} onChange={(event) => updateGate({ angle: (Number(event.target.value) * Math.PI) / 180 })} data-testid="input-gate-angle"/></div>}
            {selectedGate.kind === 'M' && <div className="property-row"><span>Classical bit</span><select value={selectedGate.classical ?? 0} onChange={(event) => updateGate({ classical: Number(event.target.value) })} data-testid="select-measure-bit">{Array.from({ length: Math.max(1, active.classicalBits) }, (_, index) => <option key={index} value={index}>c[{index}]</option>)}</select></div>}
            {(selectedGate.kind === 'COND_X' || selectedGate.kind === 'COND_Z') && <>
              <div className="property-row"><span>Condition bit</span><select value={selectedGate.conditionBit ?? 0} onChange={(event) => updateGate({ conditionBit: Number(event.target.value) })} data-testid="select-condition-bit">{Array.from({ length: active.classicalBits }, (_, index) => <option key={index} value={index}>c[{index}]</option>)}</select></div>
              <div className="property-row"><span>Apply when bit equals</span><select value={selectedGate.conditionValue ?? 1} onChange={(event) => updateGate({ conditionValue: Number(event.target.value) as 0 | 1 })} data-testid="select-condition-value"><option value={0}>0</option><option value={1}>1</option></select></div>
            </>}
            <div className="property-row"><span>Column</span><input type="number" min="0" value={selectedGate.column} onChange={(event) => updateGate({ column: Math.max(0, Number(event.target.value)) })} data-testid="input-gate-column"/></div>
            <p className="run-note">{gateInfo[selectedGate.kind]}</p>
            <div style={{ display: 'flex', gap: 7, marginTop: 10 }}><button className="button" onClick={duplicateSelected} data-testid="button-duplicate-gate"><Copy size={13}/> Duplicate</button><button className="button danger" onClick={deleteSelected} data-testid="button-delete-gate"><Trash2 size={13}/> Delete</button></div>
          </> : <div className="empty" data-testid="empty-gate-selection">Select a gate to inspect or edit its properties.</div>}
        </div>
        <div className="side-section"><div className="property-row"><span>Qubits</span><strong data-testid="text-qubit-count">{active.qubits} / {MAX_QUBITS}</strong></div><div className="property-row"><span>Classical bits</span><strong>{active.classicalBits}</strong></div><div className="property-row"><span>Operations</span><strong>{active.gates.length}</strong></div></div>
      </aside>
      <QSphereColumn result={simulationResult} stepIndex={stepIndex} qubits={active.qubits}/>
    </div>
  </main>;
}
function SimulationResultsPanel({ result, stepIndex, activeTab, onTabChange, circuitName, notify }: { result: SimulationResult; stepIndex: number; activeTab: 'statevector' | 'histogram'; onTabChange: (tab: 'statevector' | 'histogram') => void; circuitName: string; notify: (message: string) => void }) {
  const snapshot = result.snapshots.find((item) => item.gateIndex === stepIndex)
    ?? result.snapshots.find((item) => item.gateIndex === -1)
    ?? result.snapshots[result.snapshots.length - 1];
  const states = result.probabilities.map((state, index) => ({
    ...state,
    amplitude: snapshot?.statevector[index] ?? state.amplitude,
    probability: snapshot?.probabilities[index] ?? state.probability,
  }));
  const displayStates = [...states].sort((a, b) => b.probability - a.probability).slice(0, 64);
  const histogram = Object.entries(result.measurementCounts)
    .map(([bitstring, count]) => ({ bitstring, count, percentage: (count / result.shots) * 100 }))
    .sort((a, b) => b.count - a.count || a.bitstring.localeCompare(b.bitstring));
  const amplitudeText = (amplitude: { re: number; im: number } | null) => amplitude ? `${amplitude.re.toFixed(3)} ${amplitude.im < 0 ? '−' : '+'} ${Math.abs(amplitude.im).toFixed(3)}i` : "Not available for trajectory estimates";
  const currentResult: SimulationResult = { ...result, statevector: result.statevector ? states.map((state) => state.amplitude ?? { re: 0, im: 0 }) : null, probabilities: states };
  const exportChart = async (chartId: string, suffix: string, format: 'svg' | 'png') => {
    const svg = document.querySelector(`[data-testid="${chartId}"] svg`);
    if (!(svg instanceof SVGSVGElement)) { notify('Chart is not available for export yet.'); return; }
    try {
      await downloadSvgGraphic(svg, `${sanitize(circuitName)}-${suffix}.${format}`, format);
      notify(`${suffix} chart downloaded as ${format.toUpperCase()}.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Chart export failed.');
    }
  };
  return <div className="simulation-results">
    <div className="result-tabs" role="tablist" aria-label="Simulation result views">
      <button className={activeTab === 'statevector' ? 'active' : ''} role="tab" aria-selected={activeTab === 'statevector'} onClick={() => onTabChange('statevector')} data-testid="tab-result-statevector">State</button>
      <button className={activeTab === 'histogram' ? 'active' : ''} role="tab" aria-selected={activeTab === 'histogram'} onClick={() => onTabChange('histogram')} data-testid="tab-result-histogram">Counts</button>
    </div>
    {activeTab === 'statevector' && <div role="tabpanel" data-testid="panel-result-statevector">
      <p className="result-explainer">{result.statevector ? `Probability = |amplitude|². Values shown for ${stepIndex < 0 ? "the initial state" : `operation ${stepIndex + 1}`}.${states.length > displayStates.length ? ` Showing the top ${displayStates.length} of ${states.length.toLocaleString()} basis states.` : ''}` : `Probabilities averaged over ${result.shots.toLocaleString()} measured shot trajectories. A single statevector amplitude is not defined for this ensemble.`}</p>
      <div className="result-chart" aria-label="Basis state probability chart" data-testid="chart-statevector">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={displayStates} margin={{ top: 8, right: 4, left: -22, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #333b4a)"/>
            <XAxis dataKey="bitstring" tickFormatter={(label: string) => label.length > 12 ? `${label.slice(0, 5)}…${label.slice(-5)}` : label} tick={{ fontSize: 9, fill: 'var(--chart-label, #a9b1c4)' }} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: 'var(--chart-label, #a9b1c4)' }} />
            <ChartTooltip formatter={(value: number | string) => [`${(Number(value) * 100).toFixed(2)}%`, 'Probability']} labelFormatter={(label) => `|${label}⟩`} />
            <Bar dataKey="probability" radius={[3, 3, 0, 0]}>
              {displayStates.map((state) => <Cell key={state.bitstring} fill={state.probability > 1e-9 ? '#8b76ee' : '#435064'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="result-export-actions">
        <button className="button subtle" onClick={() => downloadText(buildDownloadName(circuitName, 'statevector.csv'), buildStatevectorCsv(currentResult), 'text/csv;charset=utf-8')} data-testid="button-export-statevector-csv">State CSV</button>
        <button className="button subtle" onClick={() => downloadText(buildDownloadName(circuitName, 'probabilities.csv'), buildProbabilityCsv(currentResult), 'text/csv;charset=utf-8')} data-testid="button-export-probability-csv">Probability CSV</button>
        <button className="button subtle" onClick={() => void exportChart('chart-statevector', 'probabilities', 'svg')} data-testid="button-export-probability-svg">Chart SVG</button>
        <button className="button subtle" onClick={() => void exportChart('chart-statevector', 'probabilities', 'png')} data-testid="button-export-probability-png">Chart PNG</button>
      </div>
      <div className="state-table-wrap"><table className="state-table" aria-label="Statevector amplitude and probability values" data-testid="table-statevector">
        <thead><tr><th>Basis</th><th>Amplitude</th><th>Probability</th></tr></thead>
        <tbody>{displayStates.map((state) => <tr key={state.bitstring} data-testid={`row-state-${state.bitstring}`}><td>|{state.bitstring}⟩</td><td>{amplitudeText(state.amplitude)}</td><td>{(state.probability * 100).toFixed(2)}%</td></tr>)}</tbody>
      </table></div>
    </div>}
    {activeTab === 'histogram' && <div role="tabpanel" data-testid="panel-result-histogram">
      <p className="result-explainer">Seeded sample counts from the final ideal state · {result.shots.toLocaleString()} shots.</p>
      {histogram.length > 0 ? <div className="result-chart" aria-label="Measurement count histogram" data-testid="chart-histogram">
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={histogram} margin={{ top: 8, right: 4, left: -22, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #333b4a)"/>
            <XAxis dataKey="bitstring" tickFormatter={(label: string) => label.length > 12 ? `${label.slice(0, 5)}…${label.slice(-5)}` : label} tick={{ fontSize: 9, fill: 'var(--chart-label, #a9b1c4)' }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 9, fill: 'var(--chart-label, #a9b1c4)' }} />
            <ChartTooltip formatter={(value: number | string, name: string, item) => [name === 'count' ? `${value} (${Number(item.payload.percentage).toFixed(2)}%)` : value, 'Measured']} labelFormatter={(label) => `Outcome ${label}`} />
            <Bar dataKey="count" fill="#25b7c4" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div> : <div className="empty">No measurement outcomes are available.</div>}
      {histogram.length > 0 && <div className="result-export-actions">
        <button className="button subtle" onClick={() => downloadText(buildDownloadName(circuitName, 'measurements.csv'), buildMeasurementCountsCsv(result), 'text/csv;charset=utf-8')} data-testid="button-export-measurement-csv">Counts CSV</button>
        <button className="button subtle" onClick={() => void exportChart('chart-histogram', 'measurements', 'svg')} data-testid="button-export-histogram-svg">Chart SVG</button>
        <button className="button subtle" onClick={() => void exportChart('chart-histogram', 'measurements', 'png')} data-testid="button-export-histogram-png">Chart PNG</button>
      </div>}
      <div className="measurement-list">{histogram.map((row) => <div className="property-row" key={row.bitstring}><span>{row.bitstring}</span><strong>{row.count} · {row.percentage.toFixed(1)}%</strong></div>)}</div>
    </div>}
  </div>;
}

function QSphereColumn({ result, stepIndex, qubits }: { result: SimulationResult | null; stepIndex: number; qubits: number }) {
  const snapshot = result?.snapshots.find((item) => item.gateIndex === stepIndex)
    ?? result?.snapshots.find((item) => item.gateIndex === -1)
    ?? result?.snapshots[result.snapshots.length - 1];
  const states = result?.probabilities.map((state, index) => ({
    ...state,
    amplitude: snapshot?.statevector[index] ?? state.amplitude,
    probability: snapshot?.probabilities[index] ?? state.probability,
  })) ?? [];
  const hasStatevector = Boolean(result?.statevector);
  const norm = states.reduce((sum, state) => sum + state.probability, 0);
  const entropy = states.reduce((sum, state) => state.probability > 0 ? sum - state.probability * Math.log2(state.probability) : sum, 0);
  const rankedStates = [...states].sort((a, b) => b.probability - a.probability);
  const supportCount = states.reduce((count, state) => count + Number(state.probability > 1e-9), 0);
  const dominant = rankedStates[0];
  const sphereStates = rankedStates.filter((state) => state.probability > 1e-12).slice(0, 128);
  const inspectorStates = rankedStates.slice(0, 64);
  const averageWeight = states.reduce((sum, state) => sum + state.probability * state.bitstring.split('').filter((bit) => bit === '1').length, 0);
  return <aside className="qsphere-column" aria-label="QSphere state explorer" data-testid="column-qsphere">
    <div className="qsphere-column-heading"><div><div className="panel-label">State explorer</div><h2>QSphere</h2></div><span className={`status-pill ${hasStatevector ? 'qsphere-ready' : ''}`}>{hasStatevector ? 'LIVE STATE' : 'WAITING'}</span></div>
    {hasStatevector ? <>
      <Suspense fallback={<div className="qsphere-loading">Loading 3D state renderer…</div>}><QSphere states={sphereStates}/></Suspense>
      <div className="qsphere-metrics" aria-label="State diagnostics" data-testid="qsphere-metrics">
        <div><span>Norm</span><strong>{norm.toFixed(6)}</strong></div>
        <div><span>Entropy</span><strong>{entropy.toFixed(3)} bits</strong></div>
        <div><span>Occupied states</span><strong>{supportCount.toLocaleString()} / {(2 ** qubits).toLocaleString()}</strong></div>
        <div><span>Mean excitations</span><strong>{averageWeight.toFixed(3)}</strong></div>
      </div>
      <section className="qsphere-inspector"><div className="qsphere-inspector-title"><strong>Basis amplitudes</strong><span>{states.length > inspectorStates.length ? `top ${inspectorStates.length} by probability` : 'sorted by probability'}</span></div>
        {dominant && <div className="qsphere-dominant"><span>Most probable</span><strong>|{dominant.bitstring}⟩ · {(dominant.probability * 100).toFixed(2)}%</strong></div>}
        <div className="qsphere-state-list" data-testid="qsphere-state-list">{inspectorStates.map((state) => {
          const amplitude = state.amplitude ?? { re: 0, im: 0 };
          const phase = Math.atan2(amplitude.im, amplitude.re);
          return <div className="qsphere-state-row" key={state.bitstring}><span className="qsphere-state-label">|{state.bitstring}⟩</span><span className="qsphere-state-amplitude">{amplitude.re.toFixed(3)} {amplitude.im < 0 ? '−' : '+'} {Math.abs(amplitude.im).toFixed(3)}i</span><span className="qsphere-state-prob">{(state.probability * 100).toFixed(1)}%</span><span className="qsphere-phase-track"><i style={{ left: `${((phase + Math.PI) / (2 * Math.PI)) * 100}%` }}/></span></div>;
        })}</div>
      </section>
      <p className="qsphere-column-note">{result?.engine.includes('sparse') ? `Sparse view plots occupied states only: ${sphereStates.length.toLocaleString()} markers shown out of ${(2 ** qubits).toLocaleString()} possible basis states.` : 'Inspect marker position, magnitude, and phase in 3D. The diagnostics describe the currently selected simulation step.'} The selected-step diagnostics appear here.</p>
    </> : <div className="qsphere-waiting" data-testid="empty-qsphere-column"><div className="qsphere-waiting-orb">ψ</div><strong>{result ? 'Pure state unavailable' : 'Run a circuit to explore its state'}</strong><p>{result ? 'This circuit includes measurement trajectories. Probability and counts are available in Simulation results; a single pure-state QSphere is undefined for that ensemble.' : 'The QSphere will show basis states, amplitude magnitude, and phase after the circuit runs.'}</p></div>}
  </aside>;
}
function Circuits({ circuits, onOpen, onNew, onDelete }: { circuits: Circuit[]; onOpen: (c: Circuit) => void; onNew: () => void; onDelete: (c: Circuit) => void }) {
  return <main className="page"><div className="eyebrow"><Layers3 size={13}/> Local project shelf</div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 15 }}><div><h1>My circuits</h1><p className="lead">Projects saved in this browser. Nothing here is synced or uploaded.</p></div><button className="button primary" onClick={onNew} data-testid="button-new-local-circuit"><Plus size={15}/> New circuit</button></div>
    <div className="section-head"><div><h2>Your workspace</h2><p>{circuits.length} locally saved {circuits.length === 1 ? 'circuit' : 'circuits'}</p></div></div>
    {circuits.length ? <section className="content-grid">{circuits.map((c) => <article className="card list-card" key={c.id} data-testid={`card-local-circuit-${c.id}`}><div className="list-icon"><CircuitBoard size={19}/></div><div className="list-main"><strong>{c.name}</strong><p>{c.qubits} qubits · {c.gates.length} operations · saved {formatDate(c.updatedAt)}</p></div><button className="button" onClick={() => onOpen(c)} data-testid={`button-open-circuit-${c.id}`}>Open</button><button className="icon-button" aria-label={`Delete ${c.name}`} onClick={() => onDelete(c)} data-testid={`button-delete-circuit-${c.id}`}><Trash2 size={14}/></button></article>)}</section> : <div className="empty" data-testid="empty-circuits"><div className="list-icon" style={{ margin: '0 auto 11px' }}><HardDrive size={19}/></div><strong>No circuits saved yet</strong><p>Save an editor draft or start with one of the example circuits.</p><button className="button primary" onClick={onNew} data-testid="button-empty-create"><Plus size={14}/> Create a circuit</button></div>}<Footer/></main>;
}
const LEARN = [
  ['A qubit', 'A qubit can be in a combination of |0⟩ and |1⟩. Its state is described by complex probability amplitudes.'],
  ['The X gate', 'X flips the computational basis states: |0⟩ becomes |1⟩ and |1⟩ becomes |0⟩.'],
  ['The Y and Z gates', 'Y and Z are rotations that change amplitudes and phase. Z leaves |0⟩ unchanged and flips the phase of |1⟩.'],
  ['Hadamard', 'H transforms a basis state into an equal superposition: H|0⟩ = (|0⟩ + |1⟩) / √2.'],
  ['CNOT and entanglement', 'CNOT flips its target only when the control is |1⟩. Paired with H, it creates a Bell state from |00⟩.'],
  ['Measurement', 'Measurement samples a classical outcome according to the squared magnitude of each amplitude. It changes what you can observe.'],
  ['Statevector & probability', 'For a normalized state, each basis-state probability is |aᵢ|² and the probabilities sum to 1. Amplitudes are not probabilities.'],
  ['The QSphere', 'QUARKS places basis-state markers on an interactive sphere. Marker size reflects amplitude magnitude and hue encodes phase; amplitude-angle mode maps polar angle to 2 arccos(|α|).'],
  ['Measurement counts', 'A histogram shows seeded samples from the ideal state probabilities. Counts vary with shot count; they are distinct from the exact ideal probabilities.'],
  ['Classical simulation', 'A classical simulator computes a model of a quantum circuit on ordinary hardware. It is not a connection to a quantum processor.'],
  ['OpenQASM', 'OpenQASM is a textual language for describing quantum circuits. QUARKS generates a live QASM 3 view from your circuit.'],
];
function Learn() {
  return <main className="page"><div className="eyebrow"><BookOpen size={13}/> Field notes</div><h1>Learn by building.</h1><p className="lead">Short, accurate notes for the ideas you meet inside the editor.</p><section className="learn-grid" style={{ marginTop: 25 }}>{LEARN.map(([title, text], i) => <article className="card learn-card" key={title} data-testid={`learn-topic-${i}`}><div className="eyebrow">NOTE {String(i + 1).padStart(2, '0')}</div><h3 style={{ marginTop: 10 }}>{title}</h3><p>{text}</p></article>)}</section><div className="notice" style={{ marginTop: 20 }}><strong>What this preview does not do</strong><br/>It does not connect to quantum hardware. Results come from the local QuantumLab C++/WebAssembly engine.</div><Footer/></main>;
}
function About() {
  return <main className="page"><div className="eyebrow"><Sparkles size={13}/> About the instrument</div><h1>Quantum ideas,<br/>made tangible.</h1><p className="lead">QUARKS is a local-first circuit workspace for students and curious minds. It turns quantum operations into something you can place, inspect, and question.</p><section className="quick-grid" style={{ marginTop: 30 }}><article className="card quick-card"><div className="list-icon"><CircuitBoard size={20}/></div><h2 style={{ marginTop: 16 }}>An instrument for learning</h2><p className="lead" style={{ fontSize: 12 }}>The circuit is the source of truth. Its diagram and generated code stay in step, giving you a concrete way to explore gates and register relationships.</p></article><article className="card quick-card"><div className="list-icon"><ShieldCheck size={20}/></div><h2 style={{ marginTop: 16 }}>Local by design</h2><p className="lead" style={{ fontSize: 12 }}>Theme preferences and saved circuit projects live in your browser. There is no account system, cloud database, or password storage.</p></article></section><div className="section-head"><div><h2>Honest boundaries</h2><p>This is an early frontend preview, not a hardware portal.</p></div></div><div className="notice">The QuantumLab C++/WebAssembly engine simulates circuit gates, measurements, and classical feed-forward locally. No result represents execution on quantum hardware.</div><Footer/></main>;
}
function SettingsPage({ theme, setTheme, notify, circuits, onClear }: { theme: Theme; setTheme: (t: Theme) => void; notify: (s: string) => void; circuits: Circuit[]; onClear: () => boolean }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const exportAll = () => downloadText('quarks-local-circuits.json', JSON.stringify({ schemaVersion: 1, circuits }, null, 2), 'application/json');
  return <main className="page"><div className="eyebrow"><Settings size={13}/> Preferences</div><h1>Settings</h1><p className="lead">Tune how QUARKS looks and how it keeps your local work.</p><section className="card quick-card" style={{ marginTop: 23 }}><h2>Appearance</h2><div className="settings-row"><div><strong>Theme</strong><p>Choose a fixed palette or follow your system setting.</p></div><select className="select-control" value={theme} onChange={(e) => { setTheme(e.target.value as Theme); notify(`Theme set to ${e.target.value}.`); }} data-testid="select-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div><div className="settings-row"><div><strong>Local storage</strong><p>{circuits.length} saved projects in this browser. Theme preference is stored separately.</p></div><span className="status-pill"><HardDrive size={12}/> BROWSER ONLY</span></div><div className="settings-row"><div><strong>Export all circuits</strong><p>Download a JSON archive of your saved local projects.</p></div><button className="button" onClick={exportAll} data-testid="button-export-all"><Download size={14}/> Export archive</button></div><div className="settings-row"><div><strong>Clear local projects</strong><p>This removes saved projects and the recoverable draft from this browser. Export first if you need a copy.</p></div>{confirmClear ? <><button className="button danger" onClick={() => { const cleared = onClear(); notify(cleared ? 'Saved projects and draft cleared from this browser.' : 'Could not clear browser storage.'); setConfirmClear(false); }} data-testid="button-confirm-clear">Confirm clear</button><button className="button" onClick={() => setConfirmClear(false)} data-testid="button-cancel-clear">Cancel</button></> : <button className="button danger" onClick={() => setConfirmClear(true)} data-testid="button-clear-storage"><Trash2 size={14}/> Clear</button>}</div></section><div className="notice" style={{ marginTop: 16 }}>QUARKS has no sign-in or account system. Circuit projects are stored locally in this browser.</div><Footer/></main>;
}
function Policy({ kind }: { kind: 'terms' | 'privacy' }) {
  const privacy = kind === 'privacy';
  return <main className="page"><div className="eyebrow"><FileText size={13}/> QUARKS / {privacy ? 'Privacy' : 'Terms'}</div><h1>{privacy ? 'Privacy, plainly.' : 'Terms of use'}</h1><p className="lead">A student-project disclosure for this frontend preview. Last updated: today.</p><section className="card quick-card" style={{ marginTop: 24 }}><h2>{privacy ? 'What this preview stores' : 'What this preview is'}</h2><p className="lead" style={{ fontSize: 12 }}>{privacy ? 'Theme preferences and local circuit drafts/projects may be saved in your browser storage. QUARKS has no cloud database or analytics service in this frontend. Do not enter sensitive information.' : 'QUARKS is an educational frontend preview provided as-is. Circuit data is local to your browser and may be removed by clearing browser storage. Verify outputs before relying on them.'}</p><h3 style={{ marginTop: 24 }}>No account system or remote quantum service</h3><p className="lead" style={{ fontSize: 12 }}>QUARKS has no sign-in. Simulation runs locally in your browser and does not represent execution on quantum hardware.</p><h3 style={{ marginTop: 24 }}>Educational use</h3><p className="lead" style={{ fontSize: 12 }}>The interface is for learning and experimentation. It is not a secure storage product, scientific validation tool, or hardware access service.</p></section><Footer/></main>;
}
function Router() {
  const [theme, setTheme] = useTheme();
  const [circuits, updateCircuits] = useState<Circuit[]>(loadCircuits);
  const [runCount, setRunCount] = useState(() => {
    try {
      const count = Number(localStorage.getItem('quarks.run-count'));
      return Number.isSafeInteger(count) && count >= 0 ? count : 0;
    } catch { return 0; }
  });
  const [active, updateActive] = useState<Circuit>(() => {
    try { const raw = localStorage.getItem(DRAFT_KEY); const draft = raw ? JSON.parse(raw) : null; if (draft?.schemaVersion === 1 && Array.isArray(draft.gates) && draft.qubits <= MAX_QUBITS) return draft; } catch { /* recover to clean circuit */ }
    return createCircuit();
  });
  const [toast, setToast] = useState('');
  const [, setLocation] = useLocation();
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = (message: string) => { setToast(message); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(''), 3000); };
  const recordRun = () => setRunCount((count) => {
    const next = count + 1;
    try { localStorage.setItem('quarks.run-count', String(next)); } catch { /* current-session count remains accurate */ }
    return next;
  });
  const setCircuits = (items: Circuit[]) => { updateCircuits(items); saveCircuits(items); };
  const setActive = (c: Circuit) => { updateActive(c); };
  const clearLocalData = (): boolean => {
    try {
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem('quarks.run-count');
      updateCircuits([]);
      updateActive(createCircuit());
      setRunCount(0);
      return true;
    } catch { return false; }
  };
  const newCircuit = () => { const next = createCircuit(); setActive(next); setLocation('/editor'); };
  const openPreset = (id: string) => { setActive(makePreset(id)); setLocation('/editor'); };
  const openSaved = (c: Circuit) => { setActive(c); setLocation('/editor'); };
  const deleteCircuit = (c: Circuit) => { if (!window.confirm(`Delete “${c.name}” from this browser?`)) return; setCircuits(circuits.filter((item) => item.id !== c.id)); notify('Local circuit deleted.'); };
  const pageNames: Record<string, string> = { '/': 'Dashboard', '/editor': 'Circuit editor', '/circuits': 'My circuits', '/learn': 'Learn', '/about': 'About QUARKS', '/settings': 'Settings', '/terms': 'Terms', '/privacy': 'Privacy' };
  return <Shell theme={theme} onTheme={setTheme} title={pageNames[window.location.pathname] ?? 'QUARKS'}>
    <Switch>
      <Route path="/"><Dashboard circuits={circuits} openPreset={openPreset} onNew={newCircuit} recentRuns={runCount}/></Route>
      <Route path="/editor"><Editor circuits={circuits} setCircuits={setCircuits} active={active} setActive={setActive} notify={notify} onRun={recordRun}/></Route>
      <Route path="/circuits"><Circuits circuits={circuits} onOpen={openSaved} onNew={newCircuit} onDelete={deleteCircuit}/></Route>
      <Route path="/learn"><Learn/></Route>
      <Route path="/about"><About/></Route>
      <Route path="/settings"><SettingsPage theme={theme} setTheme={setTheme} notify={notify} circuits={circuits} onClear={clearLocalData}/></Route>
      <Route path="/terms"><Policy kind="terms"/></Route>
      <Route path="/privacy"><Policy kind="privacy"/></Route>
      <Route component={NotFound}/>
    </Switch>
    {toast && <div className="toast" role="status" data-testid="status-toast">{toast}</div>}
  </Shell>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={qc}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Router/></RoutedErrorBoundary></WouterRouter><Toaster/></TooltipProvider></QueryClientProvider>;
}
export default App;
