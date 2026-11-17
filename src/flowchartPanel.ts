import * as vscode from 'vscode';
import { buildFlowcharts, FlowDiagram } from './editor/flowchart';
import { VisualgError } from './lang/errors';
import { parse } from './lang/parser';

export interface RenderStatus {
  ok: boolean;
  error?: string;
  diagram?: string;
  nodes?: number;
}

/**
 * The "Fluxograma" tab: Mermaid flowcharts of the active .alg file, one per routine.
 * Follows the active VisuAlg editor, re-renders as you type, highlights the running block.
 */
export class FlowchartPanel {
  private static instance?: FlowchartPanel;
  /** Last render result reported by the webview (used by tests). */
  static lastStatus?: RenderStatus;

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
      case 'rendered':
        FlowchartPanel.lastStatus = { ok: !!m.ok, error: m.error as string | undefined, diagram: m.diagram as string, nodes: m.nodes as number };
        break;
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
  <select id="routine" title="Rotina"></select>
  <button id="copy" title="Copiar o código Mermaid deste fluxograma">Copiar Mermaid</button>
  <button id="copyMd" title="Copiar como bloco Markdown (para GitHub, Notion, Obsidian...)">Copiar Markdown</button>
  <span class="sep"></span>
  <button id="zoomOut" title="Diminuir">−</button>
  <button id="zoomFit" title="Ajustar à janela">Ajustar</button>
  <button id="zoomIn" title="Aumentar">+</button>
</div>
<div id="status"></div>
<div id="viewport"><div id="diagram"></div></div>
<script nonce="${nonce}" src="${media('vendor/mermaid.min.js')}"></script>
<script nonce="${nonce}" src="${media('flowchart.js')}"></script>
</body>
</html>`;
  }
}
