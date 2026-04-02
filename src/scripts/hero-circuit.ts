const canvas = document.getElementById('hero-circuit') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Circuit canvas not found');
const ctx = canvas.getContext('2d')!;

const GOLD = '#0891B2';
const GOLD_RGB = { r: 8, g: 145, b: 178 };

let width = 0;
let height = 0;

// --- Circuit node/trace generation ---
interface CircuitNode {
  x: number;
  y: number;
  radius: number;
  type: 'pad' | 'via' | 'chip';
  pulsePhase: number;
  pulseSpeed: number;
}

interface CircuitTrace {
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  fromNode: number;
  toNode: number;
}

interface DataSignal {
  traceIndex: number;
  segmentIndex: number;
  progress: number;
  speed: number;
}

let nodes: CircuitNode[] = [];
let traces: CircuitTrace[] = [];
const signals: DataSignal[] = [];
const isMobile = window.innerWidth < 768;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_SIGNALS = isMobile ? 5 : 15;

function generateCircuit() {
  nodes = [];
  traces = [];

  // Create a grid-based circuit layout
  const spacing = Math.max(80, Math.min(120, width / 14));
  const cols = Math.floor(width / spacing) + 2;
  const rows = Math.floor(height / spacing) + 2;
  const offsetX = (width - (cols - 1) * spacing) / 2;
  const offsetY = (height - (rows - 1) * spacing) / 2;

  // Place nodes on a jittered grid
  const gridMap: Map<string, number> = new Map();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Skip ~60% of positions for organic feel
      if (Math.random() < 0.6) continue;

      // Reduce density in center (where text is) - make it very sparse
      const cx = width / 2;
      const cy = height / 2;
      const nx = offsetX + col * spacing;
      const ny = offsetY + row * spacing;
      const distToCenter = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
      const centerRadius = Math.min(width, height) * 0.32;
      if (distToCenter < centerRadius && Math.random() < 0.85) continue;

      const jitterX = (Math.random() - 0.5) * spacing * 0.3;
      const jitterY = (Math.random() - 0.5) * spacing * 0.3;

      const x = nx + jitterX;
      const y = ny + jitterY;

      const rand = Math.random();
      const type: CircuitNode['type'] = rand < 0.1 ? 'chip' : rand < 0.4 ? 'via' : 'pad';
      const radius = type === 'chip' ? 4 + Math.random() * 3 : type === 'via' ? 2 + Math.random() * 1.5 : 1.5 + Math.random() * 1;

      nodes.push({
        x, y, radius, type,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.3 + Math.random() * 0.7,
      });

      gridMap.set(`${col},${row}`, nodes.length - 1);
    }
  }

  // Create traces between nearby nodes using right-angle paths (PCB style)
  for (let i = 0; i < nodes.length; i++) {
    const from = nodes[i];
    // Connect to 1-3 nearby nodes
    const connectionCount = 1 + Math.floor(Math.random() * 2);
    const candidates: Array<{ idx: number; dist: number }> = [];

    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const to = nodes[j];
      const dist = Math.sqrt((from.x - to.x) ** 2 + (from.y - to.y) ** 2);
      if (dist < spacing * 2.5) {
        candidates.push({ idx: j, dist });
      }
    }

    candidates.sort((a, b) => a.dist - b.dist);

    for (let c = 0; c < Math.min(connectionCount, candidates.length); c++) {
      const toIdx = candidates[c].idx;
      // Avoid duplicate traces
      if (traces.some(t => (t.fromNode === i && t.toNode === toIdx) || (t.fromNode === toIdx && t.toNode === i))) continue;

      const to = nodes[toIdx];
      const segments: CircuitTrace['segments'] = [];

      // Right-angle routing (PCB style)
      if (Math.random() < 0.5) {
        // Horizontal first, then vertical
        segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: from.y });
        segments.push({ x1: to.x, y1: from.y, x2: to.x, y2: to.y });
      } else {
        // Vertical first, then horizontal
        segments.push({ x1: from.x, y1: from.y, x2: from.x, y2: to.y });
        segments.push({ x1: from.x, y1: to.y, x2: to.x, y2: to.y });
      }

      traces.push({ segments, fromNode: i, toNode: toIdx });
    }
  }
}

function spawnSignal() {
  if (signals.length >= MAX_SIGNALS || traces.length === 0) return;
  signals.push({
    traceIndex: Math.floor(Math.random() * traces.length),
    segmentIndex: 0,
    progress: 0,
    speed: 0.008 + Math.random() * 0.012,
  });
}

// Seed signals
const seedCount = isMobile ? 3 : 6;
for (let i = 0; i < seedCount; i++) {
  signals.push({
    traceIndex: Math.floor(Math.random() * Math.max(1, traces.length)),
    segmentIndex: 0,
    progress: Math.random(),
    speed: 0.008 + Math.random() * 0.012,
  });
}

// --- Resize ---
let resizeTimer: number;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2);
  const rect = canvas.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  generateCircuit();
}

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(resize, 150) as unknown as number;
});
resize();

// --- Draw ---
let time = 0;

function draw(dt: number) {
  time += dt * 0.001;
  ctx.clearRect(0, 0, width, height);

  // Distance fade from center — elements near center are more transparent
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  // Draw traces
  for (const trace of traces) {
    for (const seg of trace.segments) {
      const midX = (seg.x1 + seg.x2) / 2;
      const midY = (seg.y1 + seg.y2) / 2;
      const distToCenter = Math.sqrt((midX - cx) ** 2 + (midY - cy) ** 2);
      const centerFade = Math.min(1, distToCenter / (Math.min(width, height) * 0.28));
      const alpha = 0.06 + 0.06 * centerFade;

      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.strokeStyle = `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Draw nodes
  for (const node of nodes) {
    const distToCenter = Math.sqrt((node.x - cx) ** 2 + (node.y - cy) ** 2);
    const centerFade = Math.min(1, distToCenter / (Math.min(width, height) * 0.28));
    const pulse = 0.7 + 0.3 * Math.sin(time * node.pulseSpeed + node.pulsePhase);
    const baseAlpha = (0.1 + 0.2 * centerFade) * pulse;

    if (node.type === 'chip') {
      // Draw a small rounded rectangle
      const s = node.radius * 2;
      ctx.beginPath();
      ctx.roundRect(node.x - s, node.y - s * 0.6, s * 2, s * 1.2, 2);
      ctx.fillStyle = `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, ${baseAlpha * 0.5})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, ${baseAlpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (node.type === 'via') {
      // Filled circle with ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, ${baseAlpha * 0.4})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, ${baseAlpha})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      // Small pad dot
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, ${baseAlpha})`;
      ctx.fill();
    }
  }

  // Draw data signals traveling along traces
  for (let i = signals.length - 1; i >= 0; i--) {
    const sig = signals[i];
    if (sig.traceIndex >= traces.length) { signals.splice(i, 1); continue; }
    const trace = traces[sig.traceIndex];
    const seg = trace.segments[sig.segmentIndex];
    if (!seg) { signals.splice(i, 1); continue; }

    sig.progress += sig.speed;

    if (sig.progress >= 1) {
      sig.progress = 0;
      sig.segmentIndex++;
      if (sig.segmentIndex >= trace.segments.length) {
        signals.splice(i, 1);
        continue;
      }
      continue;
    }

    const x = seg.x1 + (seg.x2 - seg.x1) * sig.progress;
    const y = seg.y1 + (seg.y2 - seg.y1) * sig.progress;

    // Glow
    const grd = ctx.createRadialGradient(x, y, 0, x, y, 10);
    grd.addColorStop(0, `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, 0.5)`);
    grd.addColorStop(0.5, `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, 0.15)`);
    grd.addColorStop(1, `rgba(${GOLD_RGB.r}, ${GOLD_RGB.g}, ${GOLD_RGB.b}, 0)`);
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Core
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, 0.8)`;
    ctx.fill();
  }

  // Spawn
  if (Math.random() < 0.02) spawnSignal();
}

// --- Animation loop ---
let lastTime = 0;
let isVisible = true;

// Pause when off-screen
const heroObserver = new IntersectionObserver(
  ([entry]) => { isVisible = entry.isIntersecting; },
  { threshold: 0 }
);
heroObserver.observe(canvas);

if (prefersReducedMotion) {
  // Draw once, no animation
  draw(16);
} else {
  function animate(frameTime: number) {
    const delta = frameTime - lastTime;
    lastTime = frameTime;
    if (isVisible && delta < 200) draw(delta);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
