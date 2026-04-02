// ---------------------------------------------------------------------------
// Border Tracer — D3.js orthographic globe (minimalist wireframe)
// ---------------------------------------------------------------------------
const BT_API = 'https://borders.brightinteraction.com';

const btSection = document.getElementById('border-tracer')!;
const btI18n = JSON.parse(btSection.getAttribute('data-i18n') || '{}');

// Dynamic D3 loader (self-hosted for speed)
let btD3Loaded = false;
let btD3: any = null;
let btTopojson: any = null;

function btLoadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function btLoadD3(): Promise<void> {
  if (btD3Loaded) return;
  await Promise.all([
    btLoadScript('/vendor/d3.min.js'),
    btLoadScript('/vendor/topojson-client.min.js'),
  ]);
  btD3 = (window as any).d3;
  btTopojson = (window as any).topojson;
  btD3Loaded = true;
}

// Preload D3 when section is near viewport
const btPreloadObs = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    btLoadD3();
    btPreloadObs.disconnect();
  }
}, { rootMargin: '500px 0px' });
btPreloadObs.observe(btSection);

const btPanelEntry = document.getElementById('bt-panel-entry')!;
const btPanelScanning = document.getElementById('bt-panel-scanning')!;
const btPanelResults = document.getElementById('bt-panel-results')!;
const btScanningDomain = document.getElementById('bt-scanning-domain')!;
const btScanStepList = document.getElementById('bt-scan-step-list')!;
const btDomainInput = document.getElementById('bt-domain-input') as HTMLInputElement;
const btScanBtn = document.getElementById('bt-scan-btn') as HTMLButtonElement;
const btScanAgainBtn = document.getElementById('bt-scan-again-btn')!;
const btStatusText = document.getElementById('bt-status-text')!;
const btStatusOverlay = document.getElementById('bt-status-overlay')!;
const btGlobeSvg = document.getElementById('bt-globe-svg')!;

let btGlobeInitialized = false;
let btProjection: any = null;
let btPath: any = null;
let btLandFeature: any = null;
let btRotationTimer: number | null = null;
let btStatusInterval: number | null = null;
let btJurisdiction: 'american' | 'european' = 'european';
let btCurrentRotation = [0, -20, 0];
let btLocations: any[] = [];

// Jurisdiction toggle
const btJurisdictionUS = document.getElementById('bt-jurisdiction-us')!;
const btJurisdictionEU = document.getElementById('bt-jurisdiction-eu')!;

function btSetJurisdiction(j: 'american' | 'european') {
  btJurisdiction = j;
  const activeClasses = 'bg-gold/15 text-gold border border-gold/30';
  const inactiveClasses = 'text-text-secondary hover:text-text-secondary';
  if (j === 'american') {
    btJurisdictionUS.className = `flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeClasses}`;
    btJurisdictionEU.className = `flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${inactiveClasses}`;
  } else {
    btJurisdictionEU.className = `flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${activeClasses}`;
    btJurisdictionUS.className = `flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${inactiveClasses}`;
  }
}

btJurisdictionUS.addEventListener('click', () => btSetJurisdiction('american'));
btJurisdictionEU.addEventListener('click', () => btSetJurisdiction('european'));

const BT_COLORS = { high: '#DC2626', medium: '#D97706', low: '#16A34A' };

// ---------------------------------------------------------------------------
// Globe initialization with D3 - Dotted/Stippled style with network lines
// ---------------------------------------------------------------------------
let btDotData: Array<{lon: number, lat: number}> = [];
let btNetworkLines: Array<{start: [number, number], end: [number, number]}> = [];
let btNetworkAnimationFrame: number | null = null;

// Major city coordinates for network visualization
const BT_CITIES = [
  { name: 'Stockholm', coords: [18.07, 59.33] },
  { name: 'London', coords: [-0.12, 51.51] },
  { name: 'Frankfurt', coords: [8.68, 50.11] },
  { name: 'Amsterdam', coords: [4.90, 52.37] },
  { name: 'Paris', coords: [2.35, 48.86] },
  { name: 'New York', coords: [-74.01, 40.71] },
  { name: 'San Francisco', coords: [-122.42, 37.77] },
  { name: 'Singapore', coords: [103.82, 1.35] },
  { name: 'Tokyo', coords: [139.69, 35.69] },
  { name: 'Sydney', coords: [151.21, -33.87] },
  { name: 'São Paulo', coords: [-46.63, -23.55] },
  { name: 'Dubai', coords: [55.27, 25.20] },
];

async function btInitGlobe() {
  if (btGlobeInitialized) return;
  btGlobeInitialized = true;

  await btLoadD3();

  const width = 500;
  const height = 500;
  const sensitivity = 0.25;

  btProjection = btD3.geoOrthographic()
    .scale(220)
    .center([0, 0])
    .rotate(btCurrentRotation)
    .translate([width / 2, height / 2]);

  btPath = btD3.geoPath().projection(btProjection);

  const svg = btD3.select('#bt-globe-svg');
  svg.selectAll('*').remove();

  // Network lines group (behind dots)
  svg.append('g').attr('class', 'bt-network');

  // Dots group (for land)
  svg.append('g').attr('class', 'bt-dots');

  // Arcs group (for scan connections)
  svg.append('g').attr('class', 'bt-arcs');

  // Points group (for scan results - on top)
  svg.append('g').attr('class', 'bt-points');

  // Load land data and generate dot grid
  const world = await fetch('/vendor/land-110m.json').then(r => r.json());
  btLandFeature = btTopojson.feature(world, world.objects.land);

  // Generate denser dot grid for clearer continents
  const dotSpacing = 2.5; // degrees between dots (denser)
  btDotData = [];

  for (let lat = -85; lat <= 85; lat += dotSpacing) {
    const lonSpacing = dotSpacing / Math.cos(lat * Math.PI / 180);
    for (let lon = -180; lon < 180; lon += lonSpacing) {
      const point = [lon, lat];
      const onLand = btD3.geoContains(btLandFeature, point);
      if (onLand) {
        btDotData.push({ lon, lat });
      }
    }
  }

  // Generate network connections between cities
  btNetworkLines = [];
  for (let i = 0; i < BT_CITIES.length; i++) {
    for (let j = i + 1; j < BT_CITIES.length; j++) {
      // Only connect cities that are relatively close (< 10000km)
      const dist = btD3.geoDistance(BT_CITIES[i].coords as [number, number], BT_CITIES[j].coords as [number, number]);
      if (dist < 1.2) { // ~7600km
        btNetworkLines.push({
          start: BT_CITIES[i].coords as [number, number],
          end: BT_CITIES[j].coords as [number, number]
        });
      }
    }
  }

  // Draw initial state
  btDrawDots();
  btDrawNetwork();

  // Start rotation + network pulse (paused when off-screen)
  const btIsMobile = window.innerWidth < 768;
  btStartRotation();
  btStartNetworkAnimation();

  // Pause animations when section is off-screen
  const btGlobeContainer = document.getElementById('bt-globe-container');
  if (btGlobeContainer) {
    const btVisObs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        btStartRotation();
        btStartNetworkAnimation();
      } else {
        btStopRotation();
        btStopNetworkAnimation();
      }
    }, { threshold: 0 });
    btVisObs.observe(btGlobeContainer);
  }

  // Drag to rotate
  svg.call(btD3.drag()
    .on('start', () => btStopRotation())
    .on('drag', (event: any) => {
      const rotate = btProjection.rotate();
      btProjection.rotate([
        rotate[0] + event.dx * sensitivity,
        rotate[1] - event.dy * sensitivity,
        rotate[2]
      ]);
      btCurrentRotation = btProjection.rotate();
      btUpdateGlobe();
    })
    .on('end', () => btStartRotation())
  );
}

function btDrawDots() {
  const svg = btD3.select('#bt-globe-svg');
  const dotsGroup = svg.select('.bt-dots');
  dotsGroup.selectAll('*').remove();

  btDotData.forEach(dot => {
    const coords = btProjection([dot.lon, dot.lat]);
    if (!coords) return;

    // Check if point is on visible side of globe
    const center = btProjection.invert([250, 250]);
    const distance = btD3.geoDistance([dot.lon, dot.lat], center);
    if (distance > Math.PI / 2) return;

    // 3D depth effect
    const distFromCenter = Math.sqrt(Math.pow(coords[0] - 250, 2) + Math.pow(coords[1] - 250, 2));
    const edgeFactor = distFromCenter / 220;
    const sizeFactor = 1 - edgeFactor * 0.4;
    const dotSize = 2 * sizeFactor;

    // Stronger opacity gradient for depth
    const opacity = 0.3 + (1 - edgeFactor) * 0.7;

    dotsGroup.append('circle')
      .attr('cx', coords[0])
      .attr('cy', coords[1])
      .attr('r', dotSize)
      .attr('fill', '#18181b')
      .attr('opacity', opacity);
  });
}

function btDrawNetwork() {
  const svg = btD3.select('#bt-globe-svg');
  const networkGroup = svg.select('.bt-network');
  networkGroup.selectAll('*').remove();

  btNetworkLines.forEach((line, i) => {
    const startCoords = btProjection(line.start);
    const endCoords = btProjection(line.end);
    if (!startCoords || !endCoords) return;

    // Check visibility
    const center = btProjection.invert([250, 250]);
    const startDist = btD3.geoDistance(line.start, center);
    const endDist = btD3.geoDistance(line.end, center);

    // Only draw if at least one end is visible
    if (startDist > Math.PI / 2 && endDist > Math.PI / 2) return;

    // Create curved path along great circle
    const path = networkGroup.append('path')
      .datum({
        type: 'LineString',
        coordinates: [line.start, line.end]
      })
      .attr('d', btPath)
      .attr('fill', 'none')
      .attr('stroke', '#d4d4d4')
      .attr('stroke-width', 0.5)
      .attr('opacity', 0.4)
      .attr('class', 'bt-network-line')
      .attr('data-index', i);
  });
}

let btPulsePhase = 0;
function btStartNetworkAnimation() {
  if (btNetworkAnimationFrame) return;

  function animate() {
    btPulsePhase = (btPulsePhase + 0.02) % (Math.PI * 2);

    const svg = btD3.select('#bt-globe-svg');
    svg.selectAll('.bt-network-line').each(function(this: SVGPathElement, d: any, i: number) {
      const line = btD3.select(this);
      const index = parseInt(line.attr('data-index') || '0');
      // Stagger the pulse for each line
      const phase = btPulsePhase + (index * 0.5);
      const pulse = 0.2 + Math.sin(phase) * 0.15;
      line.attr('opacity', pulse);
    });

    btNetworkAnimationFrame = requestAnimationFrame(animate);
  }
  animate();
}

function btStopNetworkAnimation() {
  if (btNetworkAnimationFrame) {
    cancelAnimationFrame(btNetworkAnimationFrame);
    btNetworkAnimationFrame = null;
  }
}

function btUpdateGlobe() {
  btDrawDots();
  btDrawNetwork();

  const svg = btD3.select('#bt-globe-svg');

  // Update points (scan results)
  svg.select('.bt-points').selectAll('circle')
    .attr('cx', (d: any) => {
      const coords = btProjection([d.lng, d.lat]);
      return coords ? coords[0] : -1000;
    })
    .attr('cy', (d: any) => {
      const coords = btProjection([d.lng, d.lat]);
      return coords ? coords[1] : -1000;
    })
    .attr('display', (d: any) => {
      const coords = [d.lng, d.lat];
      const distance = btD3.geoDistance(coords, btProjection.invert([250, 250]));
      return distance > Math.PI / 2 ? 'none' : 'block';
    });

  // Update arcs
  svg.select('.bt-arcs').selectAll('path').attr('d', (d: any) => {
    return btPath({
      type: 'LineString',
      coordinates: [[d.startLng, d.startLat], [d.endLng, d.endLat]]
    });
  });
}

function btStartRotation() {
  if (btRotationTimer) return;
  const interval = window.innerWidth < 768 ? 80 : 50;
  btRotationTimer = window.setInterval(() => {
    const rotate = btProjection.rotate();
    btProjection.rotate([rotate[0] + 0.3, rotate[1], rotate[2]]);
    btCurrentRotation = btProjection.rotate();
    btUpdateGlobe();
  }, interval);
}

function btStopRotation() {
  if (btRotationTimer) {
    clearInterval(btRotationTimer);
    btRotationTimer = null;
  }
}

function btRenderLocations(locations: any[]) {
  btLocations = locations;
  if (!btD3 || !btProjection) return;

  const svg = btD3.select('#bt-globe-svg');

  // Clear previous
  svg.select('.bt-points').selectAll('*').remove();
  svg.select('.bt-arcs').selectAll('*').remove();

  if (!locations.length) return;

  // Stop rotation and focus on center point
  btStopRotation();
  const center = locations.find((l: any) => l.type === 'hosting') || locations[0];

  // Animate rotation to center
  const targetRotation = [-center.lng, -center.lat, 0];
  const startRotation = [...btCurrentRotation];
  const duration = 1500;
  const startTime = Date.now();

  function animateRotation() {
    const elapsed = Date.now() - startTime;
    const t = Math.min(1, elapsed / duration);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    btProjection.rotate([
      startRotation[0] + (targetRotation[0] - startRotation[0]) * ease,
      startRotation[1] + (targetRotation[1] - startRotation[1]) * ease,
      0
    ]);
    btCurrentRotation = btProjection.rotate();
    btUpdateGlobe();

    if (t < 1) requestAnimationFrame(animateRotation);
  }
  animateRotation();

  // Add points with delay
  locations.forEach((loc, i) => {
    setTimeout(() => {
      const color = BT_COLORS[loc.risk as keyof typeof BT_COLORS] || BT_COLORS.medium;
      svg.select('.bt-points')
        .append('circle')
        .datum(loc)
        .attr('r', 0)
        .attr('fill', color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .attr('cx', () => {
          const coords = btProjection([loc.lng, loc.lat]);
          return coords ? coords[0] : -1000;
        })
        .attr('cy', () => {
          const coords = btProjection([loc.lng, loc.lat]);
          return coords ? coords[1] : -1000;
        })
        .transition()
        .duration(300)
        .attr('r', 8);
    }, i * 200);
  });

  // Add arcs from center to other points
  const arcs = locations
    .filter(l => l.lat !== center.lat || l.lng !== center.lng)
    .map(l => ({
      startLat: center.lat,
      startLng: center.lng,
      endLat: l.lat,
      endLng: l.lng,
      color: BT_COLORS[l.risk as keyof typeof BT_COLORS] || BT_COLORS.medium
    }));

  arcs.forEach((arc, i) => {
    setTimeout(() => {
      const arcGroup = svg.select('.bt-arcs').append('g');

      const path = arcGroup
        .append('path')
        .datum(arc)
        .attr('fill', 'none')
        .attr('stroke', arc.color)
        .attr('stroke-width', 2)
        .attr('stroke-linecap', 'round')
        .attr('d', btPath({
          type: 'LineString',
          coordinates: [[arc.startLng, arc.startLat], [arc.endLng, arc.endLat]]
        }));

      const pathNode = path.node() as SVGPathElement | null;
      const totalLength = pathNode?.getTotalLength() || 0;

      // Draw-in animation
      path
        .attr('stroke-dasharray', `${totalLength} ${totalLength}`)
        .attr('stroke-dashoffset', totalLength)
        .transition()
        .duration(800)
        .attr('stroke-dashoffset', 0);

      // Flying pulse dot along the arc
      if (pathNode && totalLength > 0) {
        const pulse = arcGroup.append('circle')
          .attr('r', 4)
          .attr('fill', arc.color)
          .attr('opacity', 0);

        // Start pulse after draw-in completes
        setTimeout(() => {
          function flyPulse() {
            const node = pathNode;
            if (!node || !node.isConnected) return;
            pulse.attr('opacity', 1);
            const dur = 1200 + Math.random() * 400;
            let start: number | null = null;

            function step(ts: number) {
              if (!node.isConnected) return;
              if (!start) start = ts;
              const t = Math.min((ts - start) / dur, 1);
              const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
              try {
                const pt = node.getPointAtLength(eased * totalLength);
                pulse.attr('cx', pt.x).attr('cy', pt.y);
                pulse.attr('opacity', Math.sin(t * Math.PI) * 0.9);
              } catch(e) { return; }
              if (t < 1) requestAnimationFrame(step);
              else setTimeout(flyPulse, 1500 + Math.random() * 2000);
            }
            requestAnimationFrame(step);
          }
          flyPulse();
        }, 850);
      }
    }, 500 + i * 300);
  });
}

function btResetGlobe() {
  if (!btD3) return;
  const svg = btD3.select('#bt-globe-svg');
  svg.select('.bt-points').selectAll('*').remove();
  svg.select('.bt-arcs').selectAll('*').remove();
  btLocations = [];
  btStartRotation();
}

// Lazy-load globe when section enters viewport
const btObserver = new IntersectionObserver(async (entries) => {
  if (entries[0].isIntersecting) {
    btObserver.disconnect();
    await btInitGlobe();
  }
}, { rootMargin: '200px' });
btObserver.observe(btSection);

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------
function btShowPanel(panel: 'entry' | 'scanning' | 'results') {
  btPanelEntry.classList.add('hidden');
  btPanelScanning.classList.add('hidden');
  btPanelResults.classList.add('hidden');
  if (panel === 'entry') btPanelEntry.classList.remove('hidden');
  else if (panel === 'scanning') btPanelScanning.classList.remove('hidden');
  else btPanelResults.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Status animation
// ---------------------------------------------------------------------------
const BT_STEPS: string[] = btI18n.steps || [
  'Resolving DNS records', 'Tracing mail servers', 'Inspecting nameservers',
  'Checking CDN headers', 'Scanning for third-party scripts', 'Analyzing jurisdiction',
  'Calculating sovereignty score',
];

function btStartStatus() {
  btScanStepList.innerHTML = BT_STEPS.map((s, i) =>
    `<div class="bt-scan-step flex items-center gap-3 text-sm ${i === 0 ? 'text-gold' : 'text-text-secondary'}" data-step="${i}">
      <div class="w-1.5 h-1.5 rounded-full ${i === 0 ? 'bg-gold' : 'bg-text-muted'} shrink-0"></div>
      <span>${s}</span>
    </div>`
  ).join('');
  btStatusText.textContent = BT_STEPS[0] + '...';
  btStatusOverlay.classList.remove('hidden');
  let step = 0;
  btStatusInterval = window.setInterval(() => {
    step++;
    if (step < BT_STEPS.length) {
      btStatusText.textContent = BT_STEPS[step] + '...';
      btScanStepList.querySelectorAll('.bt-scan-step').forEach((el, i) => {
        const dot = el.querySelector('div')!;
        if (i < step) {
          el.className = 'bt-scan-step flex items-center gap-3 text-sm text-green-600 opacity-70';
          dot.className = 'w-1.5 h-1.5 rounded-full bg-green-600 shrink-0';
        } else if (i === step) {
          el.className = 'bt-scan-step flex items-center gap-3 text-sm text-gold';
          dot.className = 'w-1.5 h-1.5 rounded-full bg-gold shrink-0';
        }
      });
    }
  }, 800);
}

function btStopStatus() {
  if (btStatusInterval) { clearInterval(btStatusInterval); btStatusInterval = null; }
  btScanStepList.querySelectorAll('.bt-scan-step').forEach((el) => {
    const dot = el.querySelector('div')!;
    el.className = 'bt-scan-step flex items-center gap-3 text-sm text-green-600 opacity-70';
    dot.className = 'w-1.5 h-1.5 rounded-full bg-green-600 shrink-0';
  });
}

// ---------------------------------------------------------------------------
// Jurisdiction-aware risk mapping
// ---------------------------------------------------------------------------
const EU_CODES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
  'NO','IS','LI','CH','GB',
]);
const US_ALLIED_CODES = new Set(['US','CA','AU','NZ','GB']);

function btJurisdictionRisk(countryCode: string | undefined): 'low' | 'medium' | 'high' {
  if (!countryCode) return 'high';
  const cc = countryCode.toUpperCase();
  if (btJurisdiction === 'american') {
    if (US_ALLIED_CODES.has(cc)) return 'low';
    if (EU_CODES.has(cc)) return 'medium';
    return 'high';
  } else {
    if (EU_CODES.has(cc)) return 'low';
    if (cc === 'US') return 'high';
    return 'medium';
  }
}

function btRecalculateScore(data: any): { score: number; grade: string; riskLevel: string; headline: string } {
  const eu = data.sovereignty.euPercent || 0;
  const us = data.sovereignty.usPercent || 0;
  const other = data.sovereignty.otherPercent || 0;

  let score: number;
  if (btJurisdiction === 'american') {
    score = Math.round(us * 0.95 + eu * 0.60 + other * 0.15);
  } else {
    return {
      score: data.sovereignty.score,
      grade: data.sovereignty.grade,
      riskLevel: data.sovereignty.riskLevel,
      headline: data.sovereignty.headline,
    };
  }

  score = Math.min(100, Math.max(0, score));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : score >= 35 ? 'D' : 'F';
  const riskLevel = score >= 70 ? 'LOW' : score >= 40 ? 'MEDIUM' : 'HIGH';

  let headline: string;
  if (score >= 80) headline = btI18n.headlineStrongUS || 'Strong US data sovereignty. Infrastructure is well-aligned.';
  else if (score >= 60) headline = btI18n.headlineModerateUS || 'Moderate sovereignty. Some data flows outside US jurisdiction.';
  else if (score >= 40) headline = btI18n.headlineSignificantUS || 'Significant foreign exposure. Data resides across multiple jurisdictions.';
  else headline = btI18n.headlineWeakUS || 'Weak US sovereignty. Most infrastructure is outside US control.';

  return { score, grade, riskLevel, headline };
}

// ---------------------------------------------------------------------------
// Scorecard rendering
// ---------------------------------------------------------------------------
function btRenderScorecard(data: any) {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  $('bt-result-domain-badge').textContent = data.domain;

  const jBadge = $('bt-result-jurisdiction-badge');
  if (btJurisdiction === 'american') {
    jBadge.className = 'inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap';
    jBadge.innerHTML = '<span class="text-sm">🇺🇸</span> US';
  } else {
    jBadge.className = 'inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap';
    jBadge.innerHTML = '<span class="text-sm">🇪🇺</span> EU';
  }

  const scored = btRecalculateScore(data);
  const score = scored.score;
  const offset = 326.73 - (score / 100) * 326.73;
  const ring = $('bt-score-ring') as unknown as SVGCircleElement;
  ring.style.stroke = score >= 70 ? '#16A34A' : score >= 40 ? '#D97706' : '#DC2626';
  setTimeout(() => { ring.style.strokeDashoffset = String(offset); }, 100);

  $('bt-score-number').textContent = String(score);
  $('bt-score-grade').textContent = `Grade ${scored.grade}`;
  $('bt-score-headline').textContent = scored.headline;

  const riskLevel = scored.riskLevel;
  const riskBadge = $('bt-badge-risk');
  riskBadge.textContent = `Risk: ${riskLevel}`;
  riskBadge.className = `px-2.5 py-1 rounded-full text-xs font-bold ${
    riskLevel === 'HIGH' ? 'bg-red-100 text-red-700' :
    riskLevel === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
    'bg-green-100 text-green-700'
  }`;
  $('bt-badge-lockin').textContent = `Vendor Lock-in: ${data.sovereignty.vendorLockIn}`;

  const isUS = btJurisdiction === 'american';
  $('bt-bar-eu-pct').textContent = `${data.sovereignty.euPercent}%`;
  $('bt-bar-us-pct').textContent = `${data.sovereignty.usPercent}%`;
  $('bt-bar-other-pct').textContent = `${data.sovereignty.otherPercent}%`;

  const euBar = $('bt-bar-eu') as HTMLElement;
  const usBar = $('bt-bar-us') as HTMLElement;
  euBar.className = `h-full transition-all duration-700 ${isUS ? 'bg-amber-500' : 'bg-green-500'}`;
  usBar.className = `h-full transition-all duration-700 ${isUS ? 'bg-green-500' : 'bg-red-500'}`;
  euBar.style.width = `${data.sovereignty.euPercent}%`;
  usBar.style.width = `${data.sovereignty.usPercent}%`;
  ($('bt-bar-other') as HTMLElement).style.width = `${data.sovereignty.otherPercent}%`;

  const euPctSpan = $('bt-bar-eu-pct');
  const usPctSpan = $('bt-bar-us-pct');
  euPctSpan.className = `font-bold ${isUS ? 'text-amber-600' : 'text-green-600'}`;
  usPctSpan.className = `font-bold ${isUS ? 'text-green-600' : 'text-red-600'}`;

  if (data.hosting) {
    $('bt-section-hosting').classList.remove('hidden');
    const hostRisk = btJurisdictionRisk(data.hosting.location?.countryCode);
    $('bt-hosting-dot').className =
      `w-2 h-2 rounded-full ${hostRisk === 'high' ? 'bg-red-500' : hostRisk === 'low' ? 'bg-green-500' : 'bg-amber-500'}`;
    $('bt-hosting-details').innerHTML =
      `<span class="font-medium text-text-primary">${data.hosting.provider || 'Unknown'}</span> — ` +
      `${data.hosting.location ? `${data.hosting.location.city}, ${data.hosting.location.country}` : 'Unknown'} ` +
      `<span class="text-xs ${hostRisk === 'high' ? 'text-red-600' : hostRisk === 'low' ? 'text-green-600' : 'text-amber-600'}">(${data.hosting.location?.countryCode || '?'})</span>`;
  }

  if (data.email?.length > 0) {
    $('bt-section-email').classList.remove('hidden');
    const emailMap = new Map<string, { entry: any; count: number }>();
    data.email.forEach((e: any) => {
      const key = `${e.provider || e.host}|${e.location?.countryCode || '?'}`;
      if (emailMap.has(key)) { emailMap.get(key)!.count++; }
      else { emailMap.set(key, { entry: e, count: 1 }); }
    });
    const uniqueEmails = Array.from(emailMap.values());
    const worstRisk = uniqueEmails.reduce((worst: string, u) => {
      const r = btJurisdictionRisk(u.entry.location?.countryCode);
      if (r === 'high') return 'high';
      if (r === 'medium' && worst !== 'high') return 'medium';
      return worst;
    }, 'low');
    $('bt-email-dot').className =
      `w-2 h-2 rounded-full ${worstRisk === 'high' ? 'bg-red-500' : worstRisk === 'low' ? 'bg-green-500' : 'bg-amber-500'}`;
    $('bt-email-details').innerHTML = uniqueEmails.map(({ entry: e, count }) => {
      const eRisk = btJurisdictionRisk(e.location?.countryCode);
      return `<div><span class="font-medium text-text-primary">${e.provider || e.host}</span> — ` +
        `${e.location ? `${e.location.city}, ${e.location.country}` : 'Unknown'} ` +
        `<span class="text-xs ${eRisk === 'high' ? 'text-red-600' : eRisk === 'low' ? 'text-green-600' : 'text-amber-600'}">(${e.location?.countryCode || '?'})</span>` +
        `${count > 1 ? ` <span class="text-text-secondary">${count} servers</span>` : ''}</div>`;
    }).join('');
  }

  if (data.cdn?.detected) {
    $('bt-section-cdn').classList.remove('hidden');
    $('bt-cdn-details').innerHTML =
      `<span class="font-medium text-text-primary">${data.cdn.provider}</span> — ${data.cdn.note}`;
  }

  if (data.thirdParty?.length > 0) {
    $('bt-section-thirdparty').classList.remove('hidden');
    $('bt-thirdparty-list').innerHTML = data.thirdParty.map((tp: any) => {
      const tpRisk = tp.jurisdiction ? btJurisdictionRisk(tp.jurisdiction) : tp.risk;
      return `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap ${
        tpRisk === 'high' ? 'bg-red-100 text-red-700 border border-red-200' :
        tpRisk === 'low' ? 'bg-green-100 text-green-700 border border-green-200' :
        'bg-amber-100 text-amber-700 border border-amber-200'
      }"><span class="w-1.5 h-1.5 rounded-full ${tpRisk === 'high' ? 'bg-red-500' : tpRisk === 'low' ? 'bg-green-500' : 'bg-amber-500'}"></span>${tp.name}</span>`;
    }).join('');
  }

  const ctaEl = $('bt-cta-text');
  if (ctaEl) {
    ctaEl.textContent = btJurisdiction === 'american'
      ? (btI18n.ctaUS || 'Want a sovereign, US-compliant stack?')
      : (btI18n.ctaEU || 'Want a sovereign, EU-compliant stack?');
  }
}

// ---------------------------------------------------------------------------
// Scan flow
// ---------------------------------------------------------------------------
async function btRunScan(domain: string) {
  btShowPanel('scanning');
  btScanningDomain.textContent = `${btI18n.scanning || 'Scanning...'} ${domain}`;
  await btInitGlobe();
  btStartStatus();
  btResetGlobe();

  try {
    const res = await fetch(`${BT_API}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, jurisdiction: btJurisdiction }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Scan failed' }));
      throw new Error(err.error || 'Scan failed');
    }
    const data = await res.json();
    btStopStatus();
    btStatusText.textContent = btI18n.scanComplete || 'Scan complete';
    btRenderLocations(data.locations || []);

    const arcDelay = (data.locations?.length || 1) * 300 + 1000;
    setTimeout(() => {
      btStatusOverlay.classList.add('hidden');
      btShowPanel('results');
      btRenderScorecard(data);
    }, arcDelay);

  } catch (err: any) {
    btStopStatus();
    btStatusText.textContent = `Error: ${err.message}`;
    setTimeout(() => {
      btStatusOverlay.classList.add('hidden');
      btShowPanel('entry');
      btResetGlobe();
      const alertMsg = (btI18n.scanFailedAlert || 'Scan failed: {error}. Please check the domain and try again.')
        .replace('{error}', err.message);
      alert(alertMsg);
    }, 2000);
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------
function btHandleScan() {
  let domain = btDomainInput.value.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!domain || !domain.includes('.')) { btDomainInput.focus(); return; }
  btRunScan(domain);
}

btScanBtn.addEventListener('click', btHandleScan);
btDomainInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); btHandleScan(); }
});

btScanAgainBtn.addEventListener('click', () => {
  btStatusOverlay.classList.add('hidden');
  btShowPanel('entry');
  btDomainInput.value = '';
  btDomainInput.focus();
  btResetGlobe();
  ['bt-section-hosting', 'bt-section-email', 'bt-section-cdn', 'bt-section-thirdparty'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  const ring = document.getElementById('bt-score-ring') as SVGCircleElement;
  if (ring) ring.style.strokeDashoffset = '326.73';
});
