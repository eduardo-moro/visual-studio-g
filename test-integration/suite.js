// Runs inside a real VS Code (see test-integration/run.sh). Exits non-zero on failure.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${what}`);
    await sleep(100);
  }
}

/** Record DAP traffic of visualg sessions. */
const events = [];
vscode.debug.registerDebugAdapterTrackerFactory('visualg', {
  createDebugAdapterTracker: () => ({
    onDidSendMessage: (m) => {
      if (m.type === 'event') events.push(m);
    },
  }),
});

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visualg-it-'));
  const file = path.join(dir, 'teste.alg');
  // Windows-1252 bytes for "ç" / "ã", like files saved by VisuAlg.
  const src = [
    'algoritmo "Integração"', //            1
    'var', //                                 2
    '   x, dobro: inteiro', //                3
    'inicio', //                              4
    '   escreva("Digite um número: ")', //    5
    '   leia(x)', //                          6
    '   dobro <- x * 2', //                   7
    '   escreval("dobro = ", dobro)', //      8
    'fimalgoritmo', //                        9
  ].join('\r\n');
  fs.writeFileSync(file, Buffer.from(src, 'latin1'));

  await vscode.extensions.getExtension('eduardo-moro.visual-studio-g').activate();
  const doc = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(doc);
  assert.strictEqual(doc.languageId, 'visualg', 'linguagem do .alg');
  assert.ok(doc.getText().includes('Integração'), `acentos de arquivo Windows-1252: ${doc.getText().split('\n')[0]}`);

  // Hover documentation for a built-in
  const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(5, 5));
  assert.ok(hovers.some((h) => h.contents.some((c) => String(c.value ?? c).includes('Lê um valor'))), `hover do leia: ${JSON.stringify(hovers)} linha: ${doc.lineAt(5).text}`);

  // Diagnostics for a broken program
  const bad = await vscode.workspace.openTextDocument({ language: 'visualg', content: 'algoritmo "x"\ninicio\ny <- 1\nfimalgoritmo' });
  const diags = await waitFor('diagnóstico', () => {
    const d = vscode.languages.getDiagnostics(bad.uri);
    return d.length ? d : undefined;
  });
  assert.match(diags[0].message, /Variável "y" não foi declarada/);
  assert.strictEqual(diags[0].range.start.line, 2);

  // Formatter
  const edits = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', doc.uri, { tabSize: 3, insertSpaces: true });
  assert.ok(Array.isArray(edits), 'formatador respondeu');

  // Debug: breakpoint after leia; type the input into the VisuAlg terminal.
  vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(doc.uri, new vscode.Position(7, 0)))]);
  const started = await vscode.debug.startDebugging(undefined, { type: 'visualg', name: 'teste', request: 'launch', program: file });
  assert.ok(started, 'depuração iniciou');
  const term = await waitFor('terminal VisuAlg', () => vscode.window.terminals.find((t) => t.name === 'VisuAlg'));
  await sleep(500);
  term.sendText('21', true);

  const stopped = await waitFor('parada no breakpoint', () => events.find((e) => e.event === 'stopped'));
  assert.strictEqual(stopped.body.reason, 'breakpoint');
  const session = vscode.debug.activeDebugSession;
  const st = await session.customRequest('stackTrace', { threadId: 1 });
  assert.strictEqual(st.stackFrames[0].line, 8, 'linha da parada');
  const scopes = await session.customRequest('scopes', { frameId: st.stackFrames[0].id });
  const vars = await session.customRequest('variables', { variablesReference: scopes.scopes[0].variablesReference });
  const byName = Object.fromEntries(vars.variables.map((v) => [v.name, v.value]));
  assert.strictEqual(byName.x, '21', 'x lido do terminal');
  assert.strictEqual(byName.dobro, '42');

  await session.customRequest('continue', { threadId: 1 });
  await waitFor('fim da sessão', () => events.find((e) => e.event === 'terminated'));
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);

  // Flowchart tab: every example program must render (all routines must parse).
  const examples = path.resolve(__dirname, '..', 'exemplos');
  for (const f of fs.readdirSync(examples).filter((n) => n.endsWith('.alg'))) {
    const ex = await vscode.workspace.openTextDocument(path.join(examples, f));
    await vscode.window.showTextDocument(ex);
    await vscode.commands.executeCommand('visualg.flowchart');
    const title = `algoritmo "${(/algoritmo\s+"([^"]*)"/i.exec(ex.getText()) || [])[1]}"`;
    const status = await waitFor(`fluxograma de ${f}`, async () => {
      const s = await vscode.commands.executeCommand('visualg._flowchartStatus');
      return s && s.diagram === title ? s : undefined;
    });
    assert.ok(status.ok, `fluxograma de ${f}: ${status.error}`);
    assert.ok(status.nodes > 2, `fluxograma de ${f} tem ${status.nodes} blocos`);
  }
  // Flowchart options and export (last example is still the one shown): left-to-right, right-angle lines
  const statusNow = () => vscode.commands.executeCommand('visualg._flowchartStatus');
  const before = (await statusNow()).seq;
  await vscode.commands.executeCommand('visualg._flowchartPost', { type: 'options', direction: 'LR', curve: 'step' });
  const relaid = await waitFor('fluxograma com novas opções', async () => {
    const s = await statusNow();
    return s && s.seq > before ? s : undefined;
  });
  assert.ok(relaid.ok, `fluxograma LR/step: ${relaid.error}`);
  for (const format of ['png', 'svg']) {
    const target = path.join(dir, `fluxograma.${format}`);
    await vscode.commands.executeCommand('visualg._flowchartPost', { type: 'export', format, target });
    const exp = await waitFor(`exportar ${format}`, async () => {
      const e = await vscode.commands.executeCommand('visualg._flowchartLastExport');
      return e && (e.error || e.path === target) ? e : undefined;
    });
    assert.ok(!exp.error, `exportar ${format}: ${exp.error}`);
    const bytes = fs.readFileSync(target);
    if (format === 'png') {
      assert.deepStrictEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'assinatura PNG');
      assert.ok(bytes.readUInt32BE(16) > 200 && bytes.readUInt32BE(20) > 100, `tamanho do PNG ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
    } else {
      const text = bytes.toString('utf8');
      assert.ok(text.startsWith('<svg') && text.includes('Início') && !text.includes('foreignObject'), 'SVG com texto puro');
    }
  }
  await vscode.commands.executeCommand('visualg._flowchartPost', { type: 'options', direction: 'TD', curve: 'basis' });
  await vscode.window.showTextDocument(doc);

  // Run without debugging via the command (the ▶ button)
  events.length = 0;
  await vscode.commands.executeCommand('visualg.run');
  await sleep(500);
  term.sendText('5', true);
  await waitFor('fim da execução', () => events.find((e) => e.event === 'terminated'));
  assert.ok(!events.some((e) => e.event === 'stopped'), 'execução normal não para');
}

// The `code` launcher does not forward this process's output, so the result also goes to a file.
const resultFile = path.join(__dirname, 'result.txt');

module.exports = {
  run: () =>
    run().then(
      () => fs.writeFileSync(resultFile, 'INTEGRATION OK\n'),
      (e) => {
        fs.writeFileSync(resultFile, `INTEGRATION FAILED: ${e && e.stack ? e.stack : e}\n`);
        throw e;
      },
    ),
};
