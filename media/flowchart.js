// Webview side of the "Fluxograma" tab. Receives diagrams from the extension and renders them with Mermaid.
(function () {
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || { routine: 0, scale: 1, autoFit: true };
  let diagrams = [];
  let current = state.routine || 0;
  let scale = state.scale || 1;
  /** Fit to the panel width until the user zooms by hand. */
  let autoFit = state.autoFit !== false;
  let runningLine;
  let renderCount = 0;

  const $ = (id) => document.getElementById(id);
  const select = $('routine');
  const box = $('diagram');
  const viewport = $('viewport');
  const status = $('status');

  const body = document.body;
  const dark = body.classList.contains('vscode-dark') || body.classList.contains('vscode-high-contrast');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    flowchart: { htmlLabels: true, curve: 'basis', padding: 12 },
    fontFamily: getComputedStyle(body).getPropertyValue('--vscode-font-family') || 'sans-serif',
  });

  function save() {
    vscode.setState({ routine: current, scale, autoFit });
  }

  function svg() {
    return box.querySelector('svg');
  }

  function applyScale() {
    const s = svg();
    if (!s) return;
    const vb = s.viewBox.baseVal;
    s.style.maxWidth = 'none';
    s.setAttribute('width', String(vb.width * scale));
    s.setAttribute('height', String(vb.height * scale));
    save();
  }

  /** Fit the width of the panel (tall diagrams scroll vertically). */
  function fit() {
    const s = svg();
    if (!s) return;
    const vb = s.viewBox.baseVal;
    scale = Math.max(0.2, Math.min(1, (viewport.clientWidth - 40) / vb.width));
    applyScale();
  }

  function zoomBy(factor) {
    autoFit = false;
    scale = Math.min(4, Math.max(0.2, scale * factor));
    applyScale();
  }

  /** Mermaid node elements are <g class="node" id="...flowchart-<nodeId>-<n>">. */
  function nodeId(el) {
    const m = /flowchart-(.+)-\d+$/.exec(el.id || '');
    return m ? m[1] : undefined;
  }

  function applyHighlight() {
    const d = diagrams[current];
    box.querySelectorAll('.running-glow').forEach((g) => g.remove());
    if (!d || runningLine === undefined) return;
    const target = d.lineNodes[runningLine];
    if (!target) return;
    for (const n of box.querySelectorAll('.node')) {
      if (nodeId(n) !== target) continue;
      // A glow drawn behind the block: Mermaid styles the shapes inline with !important,
      // so recoloring the shape itself is not reliable.
      const b = n.getBBox();
      const glow = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      glow.setAttribute('class', 'running-glow');
      glow.setAttribute('x', String(b.x - 7));
      glow.setAttribute('y', String(b.y - 7));
      glow.setAttribute('width', String(b.width + 14));
      glow.setAttribute('height', String(b.height + 14));
      glow.setAttribute('rx', '10');
      // Inline: Mermaid's own ".node rect" theme rules would otherwise repaint it.
      glow.style.cssText = 'fill: rgba(245,184,0,0.45) !important; stroke: #f5b800 !important; stroke-width: 4px !important; filter: drop-shadow(0 0 8px #f5b800);';
      n.prepend(glow);
      n.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }

  async function render() {
    const d = diagrams[current];
    if (!d) {
      box.innerHTML = '';
      return;
    }
    const id = `fc${++renderCount}`;
    try {
      const { svg: out } = await mermaid.render(id, d.code);
      box.innerHTML = out;
      const nodes = box.querySelectorAll('.node');
      nodes.forEach((n) => {
        const nid = nodeId(n);
        const line = nid && d.nodeLines[nid];
        if (line) {
          n.addEventListener('click', () => vscode.postMessage({ type: 'reveal', line }));
          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent = `Linha ${line}`;
          n.prepend(title);
        }
      });
      if (autoFit) fit();
      else applyScale();
      applyHighlight();
      // Check the other routines' diagrams too, so a problem in any of them gets reported.
      const invalid = [];
      for (const other of diagrams) {
        try {
          await mermaid.parse(other.code);
        } catch (e) {
          invalid.push(`${other.title}: ${e && e.message ? e.message : e}`);
        }
      }
      vscode.postMessage({ type: 'rendered', ok: invalid.length === 0, diagram: d.title, nodes: nodes.length, error: invalid.join('\n') || undefined });
    } catch (e) {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      box.textContent = `Não foi possível desenhar o fluxograma: ${e && e.message ? e.message : e}`;
      vscode.postMessage({ type: 'rendered', ok: false, diagram: d.title, error: String(e && e.message ? e.message : e) });
    }
  }

  function fillSelect() {
    select.innerHTML = '';
    diagrams.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = d.title;
      select.appendChild(o);
    });
    if (current >= diagrams.length) current = 0;
    select.value = String(current);
  }

  select.addEventListener('change', () => {
    current = Number(select.value);
    save();
    render();
  });
  $('copy').addEventListener('click', () => {
    const d = diagrams[current];
    if (d) vscode.postMessage({ type: 'copy', text: d.code });
  });
  $('copyMd').addEventListener('click', () => {
    const d = diagrams[current];
    if (d) vscode.postMessage({ type: 'copy', text: '```mermaid\n' + d.code + '\n```\n', markdown: true });
  });
  $('zoomIn').addEventListener('click', () => zoomBy(1.2));
  $('zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
  $('zoomFit').addEventListener('click', () => {
    autoFit = true;
    fit();
  });
  viewport.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });
  window.addEventListener('resize', () => autoFit && fit());

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'diagrams') {
      status.textContent = m.error ? `⚠ ${m.error}. Mostrando a última versão válida.` : '';
      status.classList.toggle('visible', !!m.error);
      if (m.error && diagrams.length) return;
      const changed = JSON.stringify(m.diagrams.map((d) => d.code)) !== JSON.stringify(diagrams.map((d) => d.code));
      diagrams = m.diagrams;
      fillSelect();
      if (changed) render();
    } else if (m.type === 'highlight') {
      runningLine = m.line;
      if (runningLine !== undefined) {
        // Switch to the routine that contains the running line (innermost first).
        let best = 0;
        diagrams.forEach((d, i) => {
          if (i > 0 && runningLine >= d.startLine && runningLine <= d.endLine) best = i;
        });
        if (best !== current) {
          current = best;
          select.value = String(current);
          save();
          render();
          return;
        }
      }
      applyHighlight();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
