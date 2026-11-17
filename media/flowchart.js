// Webview side of the "Fluxograma" tab. Receives diagrams from the extension and renders them with Mermaid.
(function () {
  const vscode = acquireVsCodeApi();
  const SVGNS = 'http://www.w3.org/2000/svg';
  const saved = vscode.getState() || {};
  let diagrams = [];
  let current = saved.routine || 0;
  let scale = saved.scale || 1;
  /** Fit to the panel width until the user zooms by hand. */
  let autoFit = saved.autoFit !== false;
  /** Layout options, applied to the view, the exports and the copied code. */
  const opts = { direction: saved.direction || 'TD', curve: saved.curve || 'basis' };
  let runningLine;
  let renderCount = 0;

  const $ = (id) => document.getElementById(id);
  const select = $('routine');
  const box = $('diagram');
  const viewport = $('viewport');
  const status = $('status');

  const body = document.body;
  const dark = body.classList.contains('vscode-dark') || body.classList.contains('vscode-high-contrast');
  const fontFamily = getComputedStyle(body).getPropertyValue('--vscode-font-family').trim() || 'sans-serif';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    flowchart: { htmlLabels: true, padding: 12 },
    fontFamily,
  });

  function save() {
    vscode.setState({ routine: current, scale, autoFit, direction: opts.direction, curve: opts.curve });
  }

  /**
   * The diagram's Mermaid code with the chosen direction and line style.
   * mode 'view' (the panel), 'export' (labels as plain SVG text: HTML labels inside foreignObject
   * cannot be turned into a PNG) or 'copy' (no config line when the line style is the default).
   */
  function codeWithOptions(d, mode) {
    const code = d.code.replace(/^flowchart \w+/, `flowchart ${opts.direction}`);
    if (mode === 'copy' && opts.curve === 'basis') return code;
    const config = { flowchart: { curve: opts.curve } };
    if (mode === 'export') {
      config.htmlLabels = false;
      config.flowchart.htmlLabels = false;
    }
    return `%%{init: ${JSON.stringify(config)}}%%\n${code}`;
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
      const glow = document.createElementNS(SVGNS, 'rect');
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
      const { svg: out } = await mermaid.render(id, codeWithOptions(d, 'view'));
      box.innerHTML = out;
      const nodes = box.querySelectorAll('.node');
      nodes.forEach((n) => {
        const nid = nodeId(n);
        const line = nid && d.nodeLines[nid];
        if (line) {
          n.addEventListener('click', () => vscode.postMessage({ type: 'reveal', line }));
          const title = document.createElementNS(SVGNS, 'title');
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
          await mermaid.parse(codeWithOptions(other, 'view'));
        } catch (e) {
          invalid.push(`${other.title}: ${e && e.message ? e.message : e}`);
        }
      }
      vscode.postMessage({ type: 'rendered', seq: renderCount, ok: invalid.length === 0, diagram: d.title, nodes: nodes.length, error: invalid.join('\n') || undefined });
    } catch (e) {
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      box.textContent = `Não foi possível desenhar o fluxograma: ${e && e.message ? e.message : e}`;
      vscode.postMessage({ type: 'rendered', seq: renderCount, ok: false, diagram: d.title, error: String(e && e.message ? e.message : e) });
    }
  }

  /** Renders the current diagram for export and sends it to the extension (SVG text or PNG base64). */
  async function exportDiagram(format, target) {
    const d = diagrams[current];
    if (!d) return;
    try {
      const { svg: text } = await mermaid.render(`exp${++renderCount}`, codeWithOptions(d, 'export'));
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.documentElement;
      const [x, y, w, h] = (root.getAttribute('viewBox') || '0 0 800 600').split(/[\s,]+/).map(Number);
      root.setAttribute('width', String(w));
      root.setAttribute('height', String(h));
      root.removeAttribute('style');
      // Solid background in the editor's color, so the image looks like the panel.
      const bgColor = getComputedStyle(body).getPropertyValue('--vscode-editor-background').trim() || (dark ? '#1e1e1e' : '#ffffff');
      const bg = doc.createElementNS(SVGNS, 'rect');
      bg.setAttribute('x', String(x));
      bg.setAttribute('y', String(y));
      bg.setAttribute('width', String(w));
      bg.setAttribute('height', String(h));
      bg.setAttribute('style', `fill: ${bgColor} !important; stroke: none !important;`);
      root.insertBefore(bg, root.querySelector('g'));
      const svgText = new XMLSerializer().serializeToString(root);
      const name = `${d.title.replace(/["]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}`;
      if (format === 'svg') {
        vscode.postMessage({ type: 'exportData', format, name, target, data: svgText });
        return;
      }
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('não foi possível converter o SVG em imagem'));
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgText)))}`;
      });
      const k = 2; // 2x for a sharp image
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * k);
      canvas.height = Math.ceil(h * k);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png').split(',')[1];
      vscode.postMessage({ type: 'exportData', format, name, target, data });
    } catch (e) {
      vscode.postMessage({ type: 'exportData', format, target, error: String(e && e.message ? e.message : e) });
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

  function setOptions(direction, curve) {
    if (direction) opts.direction = direction;
    if (curve) opts.curve = curve;
    $('direction').value = opts.direction;
    $('curve').value = opts.curve;
    autoFit = true;
    save();
    render();
  }

  $('direction').value = opts.direction;
  $('curve').value = opts.curve;
  $('direction').addEventListener('change', (e) => setOptions(e.target.value));
  $('curve').addEventListener('change', (e) => setOptions(undefined, e.target.value));
  select.addEventListener('change', () => {
    current = Number(select.value);
    autoFit = true;
    save();
    render();
  });
  $('copy').addEventListener('click', () => {
    const d = diagrams[current];
    if (d) vscode.postMessage({ type: 'copy', text: codeWithOptions(d, 'copy') });
  });
  $('copyMd').addEventListener('click', () => {
    const d = diagrams[current];
    if (d) vscode.postMessage({ type: 'copy', text: '```mermaid\n' + codeWithOptions(d, 'copy') + '\n```\n', markdown: true });
  });
  $('exportPng').addEventListener('click', () => exportDiagram('png'));
  $('exportSvg').addEventListener('click', () => exportDiagram('svg'));
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
    } else if (m.type === 'options') {
      setOptions(m.direction, m.curve);
    } else if (m.type === 'export') {
      exportDiagram(m.format, m.target);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
