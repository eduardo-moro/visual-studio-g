import * as vscode from 'vscode';
import { buildFlowcharts, FlowDiagram } from './editor/flowchart';
import { VisualgError } from './lang/errors';
import { parse } from './lang/parser';

export interface RenderStatus {
  ok: boolean;
  error?: string;
  diagram?: string;
  nodes?: number;
  /** Increases with every render (tests wait for a new one). */
  seq?: number;
}

/**
 * The "Fluxograma" tab: Mermaid flowcharts of the active .alg file, one per routine.
 * Follows the active VisuAlg editor, re-renders as you type, highlights the running block.
 */
export class FlowchartPanel {
  private static instance?: FlowchartPanel;
  /** Last render result reported by the webview (used by tests). */
  static lastStatus?: RenderStatus;
  /** Last exported file (used by tests). */
  static lastExport?: { path?: string; bytes?: number; error?: string };

  /** Send a message to the webview (tests: change options, export to a given path). */
  static post(message: unknown): boolean {
    if (!FlowchartPanel.instance) return false;
    void FlowchartPanel.instance.panel.webview.postMessage(message);
    return true;
  }

  private doc?: vscode.TextDocument;
  private diagrams: FlowDiagram[] = [];
  private timer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, doc: vscode.TextDocument): void {
    if (!FlowchartPanel.instance) FlowchartPanel.instance = new FlowchartPanel(context);
    FlowchartPanel.instance.panel.reveal(vscode.ViewColumn.Beside, true);
    FlowchartPanel.instance.setDocument(doc);
  }

  /** Highlight the block of `line` in `file` (undefined clears). */
  static highlight(file: string, line: number | undefined): void {
    const p = FlowchartPanel.instance;
    if (p?.doc && (line === undefined || p.doc.uri.fsPath === file)) void p.panel.webview.postMessage({ type: 'highlight', line });
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly context: vscode.ExtensionContext) {
    const vendor = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('visualg.flowchart', 'Fluxograma', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vendor],
    });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    this.panel.webview.html = this.html();

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === this.doc) {
          clearTimeout(this.timer);
          this.timer = setTimeout(() => this.update(), 400);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((ed) => {
        if (ed?.document.languageId === 'visualg' && ed.document !== this.doc) this.setDocument(ed.document);
      }),
    );
    this.panel.onDidDispose(() => {
      FlowchartPanel.instance = undefined;
      clearTimeout(this.timer);
      this.disposables.forEach((d) => d.dispose());
    });
  }

  private setDocument(doc: vscode.TextDocument): void {
    this.doc = doc;
    this.panel.title = `Fluxograma: ${doc.uri.path.split('/').pop()}`;
    this.update();
  }

  private update(): void {
    if (!this.doc) return;
    let error: string | undefined;
    try {
      this.diagrams = buildFlowcharts(parse(this.doc.getText()));
    } catch (e) {
      if (!(e instanceof VisualgError)) throw e;
      // Keep showing the last valid version while the code is being edited.
      error = `O código tem um erro na linha ${e.span.line}: ${e.message}`;
    }
    void this.panel.webview.postMessage({ type: 'diagrams', diagrams: this.diagrams, error });
  }

  private async onMessage(m: { type: string; [k: string]: unknown }): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.update();
        break;
      case 'reveal': {
        if (!this.doc || typeof m.line !== 'number') return;
        const ed = await vscode.window.showTextDocument(this.doc, { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
        const pos = new vscode.Position(m.line - 1, 0);
        ed.selection = new vscode.Selection(pos, ed.document.lineAt(m.line - 1).range.end);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        break;
      }
      case 'copy':
        await vscode.env.clipboard.writeText(String(m.text));
        void vscode.window.showInformationMessage(m.markdown ? 'Fluxograma copiado em Markdown (bloco ```mermaid).' : 'Código Mermaid do fluxograma copiado.');
        break;
      case 'exportData':
        await this.saveExport(m);
        break;
      case 'rendered':
        FlowchartPanel.lastStatus = { ok: !!m.ok, error: m.error as string | undefined, diagram: m.diagram as string, nodes: m.nodes as number, seq: m.seq as number };
        break;
    }
  }

  /** Writes an exported PNG/SVG: to `target` when given (tests), otherwise where the user picks. */
  private async saveExport(m: { [k: string]: unknown }): Promise<void> {
    if (m.error) {
      FlowchartPanel.lastExport = { error: String(m.error) };
      void vscode.window.showErrorMessage(`Não foi possível exportar o fluxograma: ${m.error}`);
      return;
    }
    const format = m.format === 'svg' ? 'svg' : 'png';
    const bytes = format === 'svg' ? Buffer.from(String(m.data), 'utf8') : Buffer.from(String(m.data), 'base64');
    let uri: vscode.Uri | undefined;
    if (typeof m.target === 'string') uri = vscode.Uri.file(m.target);
    else {
      const base = this.doc ? this.doc.uri.path.split('/').pop()!.replace(/\.alg$/i, '') : 'fluxograma';
      const folder = this.doc ? vscode.Uri.joinPath(this.doc.uri, '..') : undefined;
      const suggested = `${base}-${m.name || 'fluxograma'}.${format}`;
      uri = await vscode.window.showSaveDialog({
        defaultUri: folder ? vscode.Uri.joinPath(folder, suggested) : undefined,
        filters: format === 'svg' ? { 'Imagem SVG': ['svg'] } : { 'Imagem PNG': ['png'] },
        saveLabel: 'Salvar fluxograma',
      });
      if (!uri) return;
    }
    await vscode.workspace.fs.writeFile(uri, bytes);
    FlowchartPanel.lastExport = { path: uri.fsPath, bytes: bytes.length };
    if (typeof m.target !== 'string') {
      const open = await vscode.window.showInformationMessage(`Fluxograma salvo em ${uri.fsPath}`, 'Abrir');
      if (open) await vscode.commands.executeCommand('vscode.open', uri);
    }
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f));
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('flowchart.css')}">
</head>
<body>
<div id="toolbar">
  <div class="group">
    <select id="routine" title="Rotina"></select>
    <select id="direction" title="Direção do fluxograma">
      <option value="TD">↓ De cima para baixo</option>
      <option value="LR">→ Da esquerda para a direita</option>
    </select>
    <select id="curve" title="Formato das linhas">
      <option value="basis">Linhas curvas</option>
      <option value="linear">Linhas retas</option>
      <option value="step">Linhas em ângulo reto</option>
    </select>
  </div>
  <span class="sep"></span>
  <div class="group">
    <button id="copy" title="Copiar o código Mermaid deste fluxograma">Copiar Mermaid</button>
    <button id="copyMd" title="Copiar como bloco Markdown (para GitHub, Notion, Obsidian...)">Copiar Markdown</button>
    <button id="exportPng" title="Salvar como imagem PNG">PNG</button>
    <button id="exportSvg" title="Salvar como imagem SVG (vetorial)">SVG</button>
    <button id="zoomOut" title="Diminuir">−</button>
    <button id="zoomFit" title="Ajustar à janela">Ajustar</button>
    <button id="zoomIn" title="Aumentar">+</button>
  </div>
</div>
<div id="status"></div>
<div id="viewport"><div id="diagram"></div></div>
<script nonce="${nonce}" src="${media('vendor/mermaid.min.js')}"></script>
<script nonce="${nonce}" src="${media('flowchart.js')}"></script>
</body>
</html>`;
  }
}
