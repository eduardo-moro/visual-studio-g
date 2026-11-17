import assert from 'node:assert/strict';
import Module from 'node:module';
import * as path from 'node:path';
import { it } from 'node:test';

/** Loads the built dist/extension.js against a stub `vscode` module and runs activate(). */
it('extension activates and registers its features', () => {
  const registered: string[] = [];
  const disposable = { dispose() {} };
  const event = () => disposable;
  const anyProxy = (name: string): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) => (prop === 'then' ? undefined : anyProxy(`${name}.${String(prop)}`)),
      apply: () => {
        registered.push(name);
        return disposable;
      },
      construct: () => ({ event, fire() {}, dispose() {} }),
    });
  const vscode = {
    languages: anyProxy('languages'),
    debug: anyProxy('debug'),
    commands: anyProxy('commands'),
    window: new Proxy({}, { get: (_t, p) => (p === 'visibleTextEditors' ? [] : p === 'activeTextEditor' ? undefined : anyProxy(`window.${String(p)}`)) }),
    workspace: new Proxy({}, { get: (_t, p) => (p === 'textDocuments' ? [] : anyProxy(`workspace.${String(p)}`)) }),
    EventEmitter: class {
      event = event;
      fire() {}
      dispose() {}
    },
    ThemeColor: class {},
    OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
    ThemeIcon: class {},
    DebugAdapterInlineImplementation: class {},
  };

  const load = (Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown })._load;
  (Module as unknown as { _load: unknown })._load = (req: string, ...rest: unknown[]) => (req === 'vscode' ? vscode : load(req, ...rest));
  try {
    const ext = require(path.resolve(__dirname, '../dist/extension.js')) as { activate(ctx: unknown): void };
    ext.activate({ subscriptions: [] });
  } finally {
    (Module as unknown as { _load: unknown })._load = load;
  }

  for (const expected of [
    'languages.createDiagnosticCollection',
    'languages.registerHoverProvider',
    'languages.registerCompletionItemProvider',
    'languages.registerDocumentSymbolProvider',
    'languages.registerDocumentFormattingEditProvider',
    'debug.registerDebugAdapterDescriptorFactory',
    'debug.registerDebugConfigurationProvider',
    'commands.registerCommand',
    'window.registerTreeDataProvider',
  ]) {
    assert.ok(registered.includes(expected), `${expected} não foi registrado`);
  }
});
