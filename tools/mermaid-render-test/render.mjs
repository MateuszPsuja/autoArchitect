#!/usr/bin/env node
// Render the architecture blueprint + tech stack diagrams for a representative
// plan fixture using the project's installed `mermaid`, then write a static
// HTML file containing the rendered SVGs. The screenshot pass (Chrome
// headless) targets that HTML file.
//
// Usage:
//   OUT_LABEL=before|after node tools/mermaid-render-test/render.mjs

import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUT_DIR = join(__dirname, 'out');
const LABEL = process.env.OUT_LABEL ?? 'after';

// ── Tiny static file server (no deps) ──────────────────────────────────────
function startServer(rootDir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const safe = url.replace(/^\/+/, '');
    const filePath = resolve(rootDir, safe);
    if (!filePath.startsWith(rootDir)) { res.statusCode = 403; res.end(); return; }
    if (!existsSync(filePath)) { res.statusCode = 404; res.end('not found: ' + safe); return; }
    const ext = filePath.split('.').pop();
    const types = { html: 'text/html', js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', png: 'image/png', json: 'application/json' };
    res.setHeader('content-type', types[ext] ?? 'application/octet-stream');
    try {
      res.end(readFileSync(filePath));
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err));
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolveServer({ server, port });
    });
  });
}

// ── Chrome headless screenshot via DevTools Protocol over a websocket ──────
// We can't rely on `--screenshot` because we need to wait for the async
// mermaid.render() to finish.  Talk to the running headless Chrome via its
// WebSocket endpoint instead.

async function withChrome(port) {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target from Chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const messageHandlers = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
    for (const h of messageHandlers) h(msg);
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const onMessage = (handler) => {
    messageHandlers.push(handler);
    return () => {
      const i = messageHandlers.indexOf(handler);
      if (i >= 0) messageHandlers.splice(i, 1);
    };
  };
  return { ws, send, onMessage };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

async function screenshot(port, url, outPath, width = 1800, height = 1500) {
  const { ws, send, onMessage } = await withChrome(port);
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    // Wait for load event for the upcoming navigation.  Set up the listener
    // before issuing the navigate, otherwise we may miss the event.
    const navP = new Promise((resolve) => {
      const off = onMessage((msg) => {
        if (msg.method === 'Page.loadEventFired') { off(); resolve(); }
      });
      // Safety timeout in case the event never fires.
      setTimeout(() => { off(); resolve(); }, 20000);
    });
    await send('Page.navigate', { url });
    await navP;
    // Poll for body.dataset.rendered === '1'
    const start = Date.now();
    while (Date.now() - start < 30000) {
      const r = await send('Runtime.evaluate', {
        expression: "document.body && document.body.dataset && document.body.dataset.rendered === '1' ? '1' : ''",
        returnByValue: true,
      });
      if (r.result.value === '1') break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const status = await send('Runtime.evaluate', {
      expression: 'document.getElementById("status").textContent',
      returnByValue: true,
    });
    const metrics = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({clusterFontSize: document.getElementById("status").dataset.clusterFontSize || "", nodePadding: document.getElementById("status").dataset.nodePadding || "", clusterRect: document.getElementById("status").dataset.clusterRect || ""})',
      returnByValue: true,
    });
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const buf = Buffer.from(shot.data, 'base64');
    await writeFile(outPath, buf);
    return { status: status.result.value, metrics: JSON.parse(metrics.result.value), bytes: buf.length };
  } finally {
    ws.close();
  }
}

async function launchChrome() {
  const { spawn } = await import('node:child_process');
  const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const args = [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--remote-debugging-port=9222',
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=/tmp/mermaid-render-chrome',
    'about:blank',
  ];
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {}); // suppress
  // Wait until /json/version responds.
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9222/json/version');
      if (r.ok) { return { proc, debuggerPort: 9222 }; }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  throw new Error('Chrome did not start on 9222');
}

// ── Chart builders (mirror src/app/core/architecture-blueprint.ts) ─────────
function escapeNodeLabel(text) {
  return (text ?? '').toString()
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\r/g, '').replace(/\n/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function escapeEdgeLabel(text) {
  const AMP = '&' + 'amp;', PIPE = '&#' + '124;', SLASH = '&#' + '47;', QUOT = '&' + 'quot;', LT = '&' + 'lt;', GT = '&' + 'gt;';
  return (text ?? '').replace(/&/g, AMP).replace(/\|/g, PIPE).replace(/\//g, SLASH).replace(/"/g, QUOT).replace(/</g, LT).replace(/>/g, GT).replace(/\\/g, '\\\\').replace(/\r/g, '').replace(/\n/g, ' ').trim();
}
function truncate(text, max) {
  const t = (text ?? '').toString().trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}
function joinLines(...parts) {
  return parts.map((p) => (p ?? '').toString().trim()).filter(Boolean).map(escapeNodeLabel).join('\n');
}
function componentTypeLabel(type) {
  return ({ 'ui-component':'UI','service':'Service','store':'Store','repository':'Repository','aggregate':'Aggregate','domain-service':'Domain Service','use-case':'Use Case','controller':'Controller','utility':'Utility' })[type] ?? 'Component';
}
function groupContextsByLayer(contexts) {
  const order = [
    { key: 'frontend', title: 'Frontend Contexts', match: (l) => l === 'frontend' },
    { key: 'backend',  title: 'Backend Contexts',  match: (l) => l === 'backend' },
    { key: 'shared',   title: 'Shared Contexts',   match: (l) => l === 'shared' },
  ];
  const groups = [];
  for (const o of order) {
    const items = contexts.filter((c) => o.match(c.layer));
    if (items.length) groups.push({ key: o.key, title: o.title, contexts: items });
  }
  return groups;
}
function findDomainForContext(ctx, domains) {
  const name = (ctx.name ?? '').toLowerCase();
  return domains.find((d) => (d.name ?? '').toLowerCase() === name) ?? domains.find((d) => d.id === ctx.id);
}
function buildArchitectureBlueprint(plan) {
  const actors = (plan.systemOverview?.keyActors ?? []).map((a) => a.toString().trim()).filter(Boolean);
  const contexts = plan.boundedContexts ?? [];
  const domains = plan.domains ?? [];
  if (!actors.length && !contexts.length && !domains.length) return 'graph TD\nA["No architecture data yet."]';
  const lines = ['graph TD'];
  const ids = new Map();
  const classReg = new Map();
  const edges = [];
  const subgroups = [];
  let counter = 0;
  const newId = (k) => { const e = ids.get(k); if (e) return e; counter += 1; const id = `n${counter}`; ids.set(k, id); return id; };

  if (actors.length) {
    lines.push('subgraph S_actors["Key Actors"]', 'direction LR');
    for (const a of actors) {
      const id = newId(`actor::${a}`);
      lines.push(`${id}{{"${escapeNodeLabel(a)}"}}`);
      classReg.set(id, 'layerActor');
    }
    lines.push('end'); subgroups.push('S_actors');
  }
  const grouped = groupContextsByLayer(contexts);
  let letter = 0;
  const ctxById = new Map();
  for (const group of grouped) {
    letter += 1; const sgId = `S_ctx_${letter}`;
    lines.push(`subgraph ${sgId}["${escapeNodeLabel(group.title)}"]`);
    for (const ctx of group.contexts) {
      const id = newId(`ctx::${ctx.id}`);
      ctxById.set(ctx.id, id);
      const desc = truncate(ctx.description ?? '', 80);
      const label = joinLines(ctx.name, desc);
      let shape;
      switch (group.key) {
        case 'frontend': shape = `("${label}")`; classReg.set(id, 'layerFrontend'); break;
        case 'backend':  shape = `["${label}"]`;  classReg.set(id, 'layerBackend');  break;
        case 'shared':   shape = `[/"${label}"/]`; classReg.set(id, 'layerShared');  break;
        default:         shape = `["${label}"]`;  classReg.set(id, 'layerOther');
      }
      lines.push(`${id}${shape}`);
    }
    lines.push('end'); subgroups.push(sgId);
  }
  if (domains.length) {
    lines.push('subgraph S_dom["Domains & Components"]');
    for (const dom of domains) {
      const dId = newId(`dom::${dom.id}`);
      lines.push(`${dId}(["${joinLines(dom.name, truncate(dom.description ?? '', 60))}"])`);
      classReg.set(dId, 'layerDomain');
      for (const comp of (dom.components ?? []).slice(0, 2)) {
        const cId = newId(`comp::${comp.id}`);
        lines.push(`${cId}["${joinLines(comp.name, componentTypeLabel(comp.type))}"]`);
        classReg.set(cId, 'layerComponent');
        edges.push(`${dId} --- ${cId}`);
      }
    }
    lines.push('end'); subgroups.push('S_dom');
  }
  const actorIds = actors.map((a) => ids.get(`actor::${a}`)).filter(Boolean);
  const ctxIds = [...ctxById.values()].filter(Boolean);
  for (const aId of actorIds) { if (ctxIds.length) { edges.push(`${aId} -->|"${escapeEdgeLabel('uses')}"| ${ctxIds[0]}`); break; } }
  for (const ctx of contexts) {
    const cId = ctxById.get(ctx.id); if (!cId) continue;
    const dom = findDomainForContext(ctx, domains); if (!dom) continue;
    const dId = ids.get(`dom::${dom.id}`); if (!dId) continue;
    edges.push(`${cId} -.->|"${escapeEdgeLabel('implemented by')}"| ${dId}`);
  }
  lines.push('linkStyle default stroke:#94a3b8,stroke-width:1px');
  if (subgroups.includes('S_actors')) lines.push('classDef clusterActors fill:#f1f5f9,stroke:#94a3b8,stroke-width:1px');
  if (subgroups.includes('S_ctx_1'))  lines.push('classDef clusterFrontend fill:#e0f2fe,stroke:#0ea5e9,stroke-width:1.5px');
  if (subgroups.includes('S_ctx_2'))  lines.push('classDef clusterBackend  fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px');
  if (subgroups.includes('S_ctx_3'))  lines.push('classDef clusterShared   fill:#fef3c7,stroke:#d97706,stroke-width:1.5px');
  if (subgroups.includes('S_dom'))    lines.push('classDef clusterDomain   fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px');
  if (subgroups.includes('S_actors')) lines.push('class S_actors clusterActors');
  if (subgroups.includes('S_ctx_1'))  lines.push('class S_ctx_1 clusterFrontend');
  if (subgroups.includes('S_ctx_2'))  lines.push('class S_ctx_2 clusterBackend');
  if (subgroups.includes('S_ctx_3'))  lines.push('class S_ctx_3 clusterShared');
  if (subgroups.includes('S_dom'))    lines.push('class S_dom clusterDomain');
  lines.push('classDef layerActor    fill:#f8fafc,stroke:#475569,stroke-width:1.5px,color:#0f172a');
  lines.push('classDef layerFrontend fill:#f0f9ff,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e');
  lines.push('classDef layerBackend  fill:#f0fdf4,stroke:#16a34a,stroke-width:1.5px,color:#14532d');
  lines.push('classDef layerShared   fill:#fffbeb,stroke:#d97706,stroke-width:1.5px,color:#78350f');
  lines.push('classDef layerDomain   fill:#f5f3ff,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95');
  lines.push('classDef layerComponent fill:#ecfeff,stroke:#0891b2,stroke-width:1px,color:#164e63');
  const byClass = new Map();
  for (const [id, cls] of classReg) { if (!byClass.has(cls)) byClass.set(cls, []); byClass.get(cls).push(id); }
  for (const [cls, idList] of byClass) lines.push(`class ${idList.join(',')} ${cls}`);
  if (edges.length) lines.push(...edges);
  return lines.join('\n');
}
function buildTechStackDiagram(plan) {
  const layers = (plan.architectureLayers ?? []).filter((l) => (l.techStack ?? []).some(Boolean));
  if (!layers.length) return 'graph TD\nA["No tech stack declared yet."]';
  const lines = ['graph TD'];
  let counter = 0;
  const ids = new Map();
  const newId = (k) => { const e = ids.get(k); if (e) return e; counter += 1; const id = `n${counter}`; ids.set(k, id); return id; };
  layers.forEach((layer, idx) => {
    const sgId = `S_tech_${idx + 1}`;
    lines.push(`subgraph ${sgId}["${escapeNodeLabel(layer.name)}"]`, 'direction LR');
    const headerId = newId(`techHeader::${layer.id}`);
    lines.push(`${headerId}["${joinLines(layer.name, truncate(layer.description ?? '', 80))}"]`);
    for (const raw of layer.techStack ?? []) {
      const tech = (raw ?? '').toString().trim(); if (!tech) continue;
      const techId = newId(`tech::${layer.id}::${tech}`);
      lines.push(`${techId}[("${escapeNodeLabel(truncate(tech, 36))}")]`);
      lines.push(`${headerId} --- ${techId}`);
    }
    const patterns = (layer.patterns ?? []).filter(Boolean);
    if (patterns.length) {
      const pId = newId(`patterns::${layer.id}`);
      lines.push(`${pId}(["${joinLines('Patterns', ...patterns)}"])`);
      lines.push(`${headerId} --- ${pId}`);
    }
    lines.push('end');
  });
  lines.push('linkStyle default stroke:#94a3b8,stroke-width:1px');
  return lines.join('\n');
}

const fixture = {
  meta: { title: 'Demo Fixture', summary: 'Render fixture for mermaid cluster styling test.', generatedAt: '2026-07-24T00:00:00.000Z', model: 'test/model' },
  systemOverview: { purpose: 'Visual regression check.', context: 'Rendered headless via Chrome.', keyActors: ['End User', 'Administrator'], constraints: ['Headless Chrome'], nfrs: ['Subgraph titles 150% larger'], boundedContextMap: '', c4: { contextDiagram: '', containerDiagram: '' } },
  boundedContexts: [
    { id: 'planning',     name: 'Planning',      description: 'Plan generation core.',  layer: 'backend',  ubiquitousLanguage: {} },
    { id: 'execution',    name: 'Execution',     description: 'Executes plans.',         layer: 'backend',  ubiquitousLanguage: {} },
    { id: 'shared-auth',  name: 'Shared Auth',   description: 'Auth primitives.',        layer: 'shared',   ubiquitousLanguage: {} },
    { id: 'shared-events',name: 'Shared Events', description: 'Domain event bus.',       layer: 'shared',   ubiquitousLanguage: {} },
    { id: 'web-ui',       name: 'Web UI',        description: 'Browser SPA shell.',      layer: 'frontend', ubiquitousLanguage: {} },
    { id: 'ops-ui',       name: 'Ops Console',   description: 'Internal admin SPA.',     layer: 'frontend', ubiquitousLanguage: {} },
  ],
  architectureLayers: [
    { id: 'frontend', name: 'Frontend Layer', description: 'Browser-delivered SPA shell.', layer: 'frontend', techStack: ['Angular 21', 'PrimeNG', 'NgRx Signals'], patterns: ['Component-based', 'Signal Store'], directoryStructure: [] },
    { id: 'backend',  name: 'Backend Layer',  description: 'Stateless API services.',     layer: 'backend',  techStack: ['NestJS', 'PostgreSQL', 'Redis'],      patterns: ['Hexagonal Architecture', 'CQRS'], directoryStructure: [] },
  ],
  domains: [
    { id: 'core-planning', name: 'Core Planning', description: 'Plan generation domain.', layer: 'backend', responsibilities: ['Generate plan', 'Validate plan'], directoryPath: 'src/app/core',
      components: [{ id: 'planner', name: 'PlannerService', description: '', type: 'domain-service' }, { id: 'schema', name: 'PlanSchema', description: '', type: 'service' }] },
    { id: 'execution',     name: 'Execution',     description: 'Plan execution.',           layer: 'backend', responsibilities: ['Execute plan'], directoryPath: 'src/app/exec',
      components: [{ id: 'runner', name: 'PlanRunner', description: '', type: 'service' }] },
  ],
  workflows: [], adrs: [], agentTasks: [],
};

const blueprintSrc = buildArchitectureBlueprint(fixture);
const techStackSrc = buildTechStackDiagram(fixture);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, `${LABEL}-blueprint.mmd`), blueprintSrc, 'utf8');
await writeFile(join(OUT_DIR, `${LABEL}-techstack.mmd`), techStackSrc, 'utf8');

// Generate the page with charts embedded.
const tpl = await readFile(join(__dirname, 'page.template.html'), 'utf8');
const clusterCss = LABEL === 'after'
  ? `svg .cluster-label text { font-size: 21px; font-weight: 700; }`
  : `/* before: no CSS cluster-title override */`;
const page = tpl
  .replace('__BLUEPRINT__', blueprintSrc.replace(/`/g, '\\`'))
  .replace('__TECHSTACK__', techStackSrc.replace(/`/g, '\\`'))
  .replace('__CLUSTER_CSS__', clusterCss);
await writeFile(join(__dirname, 'page.html'), page, 'utf8');

const { server, port } = await startServer(__dirname);
const chrome = await launchChrome();
try {
  const result = await screenshot(9222, `http://127.0.0.1:${port}/page.html?mode=${LABEL}`, join(OUT_DIR, `${LABEL}.png`));
  console.log(`[${LABEL}] status: ${result.status}`);
  console.log(`[${LABEL}] metrics: ${JSON.stringify(result.metrics)}`);
  console.log(`[${LABEL}] PNG bytes: ${result.bytes}`);
  console.log(`[${LABEL}] Wrote ${join(OUT_DIR, `${LABEL}.png`)}`);
} finally {
  chrome.proc.kill();
  server.close();
}