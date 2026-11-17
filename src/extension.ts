import * as fs from 'fs';
import * as vscode from 'vscode';
import { SessionHost, VisualgSession } from './debug/session';
import { registerLanguageFeatures } from './editor/features';
import { decodeSource } from './lang/compile';
import { FlowchartPanel } from './flowchartPanel';
import { MemoryView } from './memoryView';
import { ConsoleTerminal } from './terminal';

export function activate(context: vscode.ExtensionContext): void {
  registerLanguageFeatures(context);

  const console = new ConsoleTerminal();
  const memory = new MemoryView();
  context.subscriptions.push(console, memory, vscode.window.registerTreeDataProvider('visualg.memory', memory));

  // `timer` highlights the line being run, like VisuAlg's blue bar.
  const timerLine = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('visualg.timerLineBackground'),
    borderColor: new vscode.ThemeColor('visualg.timerLineBorder'),
    borderStyle: 'solid',
    borderWidth: '0 0 0 3px',
    overviewRulerColor: new vscode.ThemeColor('visualg.timerLineBorder'),
    overviewRulerLane: vscode.OverviewRulerLane.Full,
  });
  context.subscriptions.push(timerLine);

  let current: VisualgSession | undefined;

  const host: SessionHost = {
    createIO: () => console,
    readFile: (file) => {
      // Run what is in the editor, even if it was not saved yet.
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file);
      return doc ? doc.getText() : decodeSource(fs.readFileSync(file));
    },
    showTimerLine: (file, line) => {
      FlowchartPanel.highlight(file, line);
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document.uri.fsPath !== file) continue;
        ed.setDecorations(timerLine, line === undefined ? [] : [new vscode.Range(line - 1, 0, line - 1, 0)]);
        if (line !== undefined) ed.revealRange(new vscode.Range(line - 1, 0, line - 1, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    },
    onRunChanged: (interp) => memory.setRun(interp),
    requestStop: () => {
      const s = vscode.debug.activeDebugSession;
      if (s?.type === 'visualg') void vscode.debug.stopDebugging(s);
    },
  };

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('visualg', {
      createDebugAdapterDescriptor() {
        // One program at a time: they share the console.
        current?.abort();
        current = new VisualgSession(host);
        return new vscode.DebugAdapterInlineImplementation(current);
      },
    }),
    vscode.debug.registerDebugConfigurationProvider('visualg', {
      resolveDebugConfiguration(_folder, config) {
        // F5 without a launch.json: run the open .alg file.
        if (!config.type && !config.request && !config.name) {
          const doc = vscode.window.activeTextEditor?.document;
          if (doc?.languageId === 'visualg') {
            config.type = 'visualg';
            config.name = 'Executar VisuAlg';
            config.request = 'launch';
            config.program = doc.uri.fsPath;
          }
        }
        if (!config.program) {
          void vscode.window.showInformationMessage('Abra um arquivo .alg para executar.');
          return undefined;
        }
        // The program talks through the VisuAlg terminal; the Debug Console would just cover it.
        config.internalConsoleOptions ??= 'neverOpen';
        return config;
      },
    }),
  );

  const start = async (uri: vscode.Uri | undefined, debug: boolean) => {
    const doc = uri ? undefined : vscode.window.activeTextEditor?.document;
    const target = uri ?? doc?.uri;
    if (!target) {
      void vscode.window.showInformationMessage('Abra um arquivo .alg para executar.');
      return;
    }
    await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(target), {
      type: 'visualg',
      name: debug ? 'Depurar VisuAlg' : 'Executar VisuAlg',
      request: 'launch',
      program: target.fsPath,
      stopOnEntry: debug,
      internalConsoleOptions: 'neverOpen',
    }, { noDebug: !debug });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('visualg.run', (uri?: vscode.Uri) => start(uri, false)),
    vscode.commands.registerCommand('visualg.debug', (uri?: vscode.Uri) => start(uri, true)),
    vscode.commands.registerCommand('visualg.flowchart', async (uri?: vscode.Uri) => {
      const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
      if (doc?.languageId !== 'visualg') {
        void vscode.window.showInformationMessage('Abra um arquivo .alg para ver o fluxograma.');
        return;
      }
      FlowchartPanel.show(context, doc);
    }),
    // For the integration tests: did the webview manage to draw the last diagram?
    vscode.commands.registerCommand('visualg._flowchartStatus', () => FlowchartPanel.lastStatus),
  );

  // While debugging, light up the block of the line where the program stopped.
  context.subscriptions.push(
    vscode.debug.onDidChangeActiveStackItem(async (item) => {
      if (!(item instanceof vscode.DebugStackFrame) || item.session.type !== 'visualg') return;
      try {
        const st = await item.session.customRequest('stackTrace', { threadId: item.threadId });
        const frame = (st.stackFrames as { id: number; line: number; source?: { path?: string } }[]).find((f) => f.id === item.frameId);
        if (frame?.source?.path) FlowchartPanel.highlight(frame.source.path, frame.line);
      } catch {
        // session already gone
      }
    }),
    vscode.debug.onDidTerminateDebugSession((s) => {
      if (s.type === 'visualg') FlowchartPanel.highlight('', undefined);
    }),
  );
}

export function deactivate(): void {}
