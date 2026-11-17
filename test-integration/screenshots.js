// Takes the README screenshots inside a real VS Code (see scripts in package.json).
// Uses Hyprland (hyprctl) + grim, so it only works on a Hyprland desktop.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'media', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await sleep(100);
  }
}

const events = [];
vscode.debug.registerDebugAdapterTrackerFactory('visualg', {
  createDebugAdapterTracker: () => ({ onDidSendMessage: (m) => m.type === 'event' && events.push(m) }),
});

function myWindow() {
  const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }));
  return clients.find((c) => /code/i.test(c.class) && c.title.includes('Extension Development Host'));
}

function shot(name) {
  const w = myWindow();
  execFileSync('grim', ['-g', `${w.at[0]},${w.at[1]} ${w.size[0]}x${w.size[1]}`, path.join(outDir, `${name}.png`)]);
}

async function open(file, line) {
  const doc = await vscode.workspace.openTextDocument(path.join(root, 'exemplos', file));
  const ed = await vscode.window.showTextDocument(doc);
  if (line) ed.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
  return doc;
}

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  await vscode.extensions.getExtension('eduardo-moro.visual-studio-g').activate();
  const w = myWindow();
  execFileSync('hyprctl', ['dispatch', `hl.dsp.window.fullscreen({ mode = 'fullscreen', action = 'set', window = 'address:${w.address}' })`]);
  await sleep(1500);
  await vscode.commands.executeCommand('workbench.view.debug');
  // Wider sidebar (resizes the focused part, the debug view just opened); cosmetic only.
  for (let i = 0; i < 6; i++) await vscode.commands.executeCommand('workbench.action.increaseViewWidth').then(undefined, () => {});

  // 1. Debugger stopped at a breakpoint, after typing the inputs in the terminal
  let doc = await open('02-media-notas.alg');
  vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(doc.uri, new vscode.Position(21, 0)))]);
  await vscode.debug.startDebugging(undefined, { type: 'visualg', name: 'Depurar', request: 'launch', program: doc.uri.fsPath });
  const term = await waitFor('terminal', () => vscode.window.terminals.find((t) => t.name === 'VisuAlg'));
  for (const n of ['7', '8.5', '6', '9']) {
    await sleep(400);
    term.sendText(n, true);
  }
  await waitFor('breakpoint', () => events.find((e) => e.event === 'stopped'));
  await vscode.commands.executeCommand('workbench.view.debug');
  await vscode.window.showTextDocument(doc);
  await sleep(2000);
  shot('depurar');
  await vscode.debug.stopDebugging();
  await waitFor('fim', () => events.find((e) => e.event === 'terminated'));
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);

  // 2. Memory panel after a normal run
  events.length = 0;
  doc = await open('04-registros.alg');
  await vscode.commands.executeCommand('visualg.run');
  await waitFor('fim', () => events.find((e) => e.event === 'terminated'));
  await vscode.commands.executeCommand('workbench.view.debug');
  await vscode.commands.executeCommand('visualg.memory.focus');
  await sleep(2000);
  shot('memoria');

  // 3. timer highlighting the running line
  events.length = 0;
  doc = await open('05-matriz-timer.alg');
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await vscode.commands.executeCommand('visualg.run');
  await sleep(3200);
  shot('timer');
  await waitFor('fim', () => events.find((e) => e.event === 'terminated'));
  await vscode.commands.executeCommand('workbench.view.debug');

  // 4. Stopped at a run-time error
  events.length = 0;
  doc = await open('06-erro.alg');
  await vscode.debug.startDebugging(undefined, { type: 'visualg', name: 'Depurar', request: 'launch', program: doc.uri.fsPath });
  await waitFor('erro', () => events.find((e) => e.event === 'stopped'));
  await vscode.commands.executeCommand('workbench.view.debug');
  await sleep(2000);
  shot('erro');
  await vscode.debug.stopDebugging();
}

const resultFile = path.join(__dirname, 'result.txt');
module.exports = {
  run: () =>
    run().then(
      () => fs.writeFileSync(resultFile, 'SCREENSHOTS OK\n'),
      (e) => {
        fs.writeFileSync(resultFile, `SCREENSHOTS FAILED: ${e && e.stack ? e.stack : e}\n`);
        throw e;
      },
    ),
};
