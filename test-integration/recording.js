// Records the README demo: debugging 07-dado-aleatorio.alg with the flowchart in sync.
// Captures frames with grim (Hyprland) into test-integration/frames/ and writes the caption
// timeline to frames/timeline.json; test-integration/make-gif.mjs turns that into the GIF.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const root = path.resolve(__dirname, '..');
const frameDir = path.join(__dirname, 'frames');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, timeout = 30000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await sleep(50);
  }
}

const events = [];
vscode.debug.registerDebugAdapterTrackerFactory('visualg', {
  createDebugAdapterTracker: () => ({ onDidSendMessage: (m) => m.type === 'event' && events.push(m) }),
});
const stops = () => events.filter((e) => e.event === 'stopped').length;

function myWindow() {
  const clients = JSON.parse(execFileSync('hyprctl', ['clients', '-j'], { encoding: 'utf8' }));
  return clients.find((c) => /code/i.test(c.class) && c.title.includes('Extension Development Host'));
}

// ----- recording -----
let recorder;
let t0 = 0;
const captions = [];

function startRecording() {
  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir);
  const w = myWindow();
  const geom = `${w.at[0]},${w.at[1]} ${w.size[0]}x${w.size[1]}`;
  recorder = spawn('sh', ['-c', `while :; do grim -t jpeg -q 88 -g "${geom}" "${frameDir}/$(date +%s%3N).jpg"; sleep 0.04; done`], { detached: true, stdio: 'ignore' });
  t0 = Date.now();
}

function stopRecording() {
  caption(null);
  process.kill(-recorder.pid, 'SIGTERM');
  fs.writeFileSync(path.join(frameDir, 'timeline.json'), JSON.stringify({ t0, captions }, null, 2));
}

/** Shows `text` from now until the next caption (null = no caption). */
function caption(text) {
  const now = Date.now();
  const last = captions[captions.length - 1];
  if (last && last.end === undefined) last.end = now;
  if (text) captions.push({ text, start: now });
}

/** Run a debug command and wait until the debugger stops again. */
async function act(command) {
  const n = stops();
  await vscode.commands.executeCommand(command);
  await waitFor(command, () => stops() > n);
}

function breakpointAt(doc, line) {
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(doc.uri, new vscode.Position(line - 1, 0)))]);
}

async function run() {
  await vscode.extensions.getExtension('eduardo-moro.visual-studio-g').activate();
  const w = myWindow();
  execFileSync('hyprctl', ['dispatch', `hl.dsp.window.fullscreen({ mode = 'fullscreen', action = 'set', window = 'address:${w.address}' })`]);
  await sleep(1500);

  const doc = await vscode.workspace.openTextDocument(path.join(root, 'exemplos', '07-dado-aleatorio.alg'));
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await vscode.commands.executeCommand('visualg.flowchart');
  await waitFor('fluxograma', async () => (await vscode.commands.executeCommand('visualg._flowchartStatus'))?.ok);
  await vscode.commands.executeCommand('workbench.view.debug');
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await sleep(2000);

  startRecording();
  await sleep(800);
  caption('Visual Studio G: depurando VisuAlg com o fluxograma ao lado');
  await sleep(3000);

  caption('Breakpoint na linha 30 e F5 para depurar');
  breakpointAt(doc, 30);
  await sleep(1500);
  const n = stops();
  await vscode.debug.startDebugging(undefined, { type: 'visualg', name: 'Depurar', request: 'launch', program: doc.uri.fsPath });
  await waitFor('breakpoint', () => stops() > n);
  await sleep(2800);

  caption('F11: entra na função jogaDado (o fluxograma muda junto)');
  await act('workbench.action.debug.stepInto');
  await sleep(3000);

  caption('F10: aleatorio 1, 6  →  leia(valor)  →  aleatorio off');
  for (let k = 0; k < 3; k++) {
    await act('workbench.action.debug.stepOver');
    await sleep(1700);
  }

  caption('Shift+F11: volta para o algoritmo');
  await act('workbench.action.debug.stepOut');
  await sleep(2600);

  caption('F10: próxima linha (veja i, face e contagem mudando)');
  for (let k = 0; k < 4; k++) {
    await act('workbench.action.debug.stepOver');
    await sleep(1700);
  }

  caption('F5: continua até o próximo breakpoint, depois das 6000 jogadas');
  breakpointAt(doc, 39);
  await sleep(1300);
  await act('workbench.action.debug.continue');
  await sleep(3200);

  caption('F10: o bloco aceso acompanha cada decisão');
  for (let k = 0; k < 4; k++) {
    await act('workbench.action.debug.stepOver');
    await sleep(1600);
  }

  caption('F5 até o fim: o resultado aparece no terminal');
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  await sleep(800);
  await vscode.commands.executeCommand('workbench.action.debug.continue');
  await waitFor('fim', () => events.find((e) => e.event === 'terminated'));
  await sleep(4000);
  stopRecording();
}

const resultFile = path.join(__dirname, 'result.txt');
module.exports = {
  run: () =>
    run().then(
      () => fs.writeFileSync(resultFile, 'RECORDING OK\n'),
      (e) => {
        try {
          if (recorder) process.kill(-recorder.pid, 'SIGTERM');
        } catch {}
        fs.writeFileSync(resultFile, `RECORDING FAILED: ${e && e.stack ? e.stack : e}\n`);
        throw e;
      },
    ),
};
