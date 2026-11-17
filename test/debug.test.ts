import { DebugProtocol } from '@vscode/debugprotocol';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RunIO, VisualgSession } from '../src/debug/session';

/** Drives a VisualgSession with DAP messages, like VS Code does. */
class Client {
  readonly session: VisualgSession;
  readonly events: DebugProtocol.Event[] = [];
  output = '';
  inputs: string[] = [];
  private seq = 1;
  private pending = new Map<number, (r: DebugProtocol.Response) => void>();
  private eventWaiters: { name: string; resolve: (e: DebugProtocol.Event) => void }[] = [];

  constructor(files: Record<string, string>) {
    const self = this;
    const io: RunIO = {
      begin() {},
      end(msg) {
        self.output += `<${msg}>`;
      },
      cancelRead() {},
      write: (t) => (self.output += t),
      readLine: async () => self.inputs.shift() ?? null,
      clear() {},
      setColor() {},
    };
    this.session = new VisualgSession({ createIO: () => io, readFile: (f) => files[f] });
    this.session.onDidSendMessage((m) => {
      const msg = m as DebugProtocol.ProtocolMessage;
      if (msg.type === 'response') {
        const r = msg as DebugProtocol.Response;
        this.pending.get(r.request_seq)?.(r);
      } else if (msg.type === 'event') {
        const e = msg as DebugProtocol.Event;
        this.events.push(e);
        const i = this.eventWaiters.findIndex((w) => w.name === e.event);
        if (i >= 0) this.eventWaiters.splice(i, 1)[0].resolve(e);
      }
    });
  }

  request<T extends DebugProtocol.Response>(command: string, args?: unknown): Promise<T> {
    const seq = this.seq++;
    return new Promise((resolve) => {
      this.pending.set(seq, (r) => resolve(r as T));
      this.session.handleMessage({ seq, type: 'request', command, arguments: args } as DebugProtocol.Request);
    });
  }

  waitEvent(name: string): Promise<DebugProtocol.Event> {
    const seen = this.events.findIndex((e) => e.event === name && !(e as { consumed?: boolean }).consumed);
    if (seen >= 0) {
      (this.events[seen] as { consumed?: boolean }).consumed = true;
      return Promise.resolve(this.events[seen]);
    }
    return new Promise((resolve) => this.eventWaiters.push({ name, resolve: (e) => ((e as { consumed?: boolean }).consumed = true, resolve(e)) }));
  }

  async vars(frameId = 0): Promise<Record<string, string>> {
    const scopes = await this.request<DebugProtocol.ScopesResponse>('scopes', { frameId });
    const out: Record<string, string> = {};
    for (const s of scopes.body.scopes) {
      const v = await this.request<DebugProtocol.VariablesResponse>('variables', { variablesReference: s.variablesReference });
      for (const x of v.body.variables) out[`${s.name}/${x.name}`] = x.value;
    }
    return out;
  }

  async topLine(): Promise<number> {
    const st = await this.request<DebugProtocol.StackTraceResponse>('stackTrace', { threadId: 1 });
    return st.body.stackFrames[0].line;
  }
}

const FILE = '/tmp/visualg-test/prog.alg';
const SRC = [
  'algoritmo "teste"', //            1
  'var', //                          2
  '  i, soma: inteiro', //           3
  '  v: vetor[1..3] de inteiro', //  4
  'procedimento dobra(var n: inteiro)', // 5
  'inicio', //                       6
  '  n <- n * 2', //                 7
  'fimprocedimento', //              8
  'inicio', //                       9
  '  para i de 1 ate 3 faca', //     10
  '    v[i] <- i * 10', //           11
  '    soma <- soma + v[i]', //      12
  '  fimpara', //                    13
  '  dobra(soma)', //                14
  '  escreval("soma=", soma)', //    15
  'fimalgoritmo', //                 16
].join('\n');

async function start(c: Client, breakpoints: number[], extra: object = {}): Promise<void> {
  await c.request('initialize', { adapterID: 'visualg' });
  await c.request('setBreakpoints', { source: { path: FILE }, breakpoints: breakpoints.map((line) => ({ line })) });
  await c.request('configurationDone');
  void c.request('launch', { program: FILE, ...extra });
}

describe('debugger (DAP)', () => {
  it('stops at a breakpoint and shows variables, vectors and the call stack', async () => {
    const c = new Client({ [FILE]: SRC });
    await start(c, [12]);
    const stop = (await c.waitEvent('stopped')) as DebugProtocol.StoppedEvent;
    assert.equal(stop.body.reason, 'breakpoint');
    assert.equal(await c.topLine(), 12);
    const vars = await c.vars();
    assert.equal(vars['Globais/i'], '1');
    assert.equal(vars['Globais/soma'], '0');
    assert.equal(vars['Globais/v'], '[10, 0, 0]');

    // Hover/watch evaluation
    const ev = await c.request<DebugProtocol.EvaluateResponse>('evaluate', { expression: 'v[1] + 5', frameId: 0 });
    assert.equal(ev.body.result, '15');

    // Step over -> next statement (the loop header, re-checked each iteration)
    await c.request('next', { threadId: 1 });
    await c.waitEvent('stopped');
    assert.equal(await c.topLine(), 10);

    // Remove breakpoint, set one inside the procedure, continue -> stops inside dobra
    await c.request('setBreakpoints', { source: { path: FILE }, breakpoints: [{ line: 7 }] });
    await c.request('continue', { threadId: 1 });
    await c.waitEvent('stopped');
    const st = await c.request<DebugProtocol.StackTraceResponse>('stackTrace', { threadId: 1 });
    assert.deepEqual(st.body.stackFrames.map((f) => [f.name, f.line]), [['procedimento dobra', 7], ['algoritmo "teste"', 14]]);
    const local = await c.vars();
    assert.equal(local['Locais (dobra)/n'], '60');

    // Step out returns to the caller
    await c.request('stepOut', { threadId: 1 });
    await c.waitEvent('stopped');
    assert.equal(await c.topLine(), 15);

    await c.request('continue', { threadId: 1 });
    await c.waitEvent('terminated');
    assert.equal(c.output, 'soma= 120\n<Fim da execução.>');
  });

  it('stopOnEntry stops at the first statement; setVariable changes the value', async () => {
    const c = new Client({ [FILE]: SRC });
    await start(c, [], { stopOnEntry: true });
    await c.waitEvent('stopped');
    assert.equal(await c.topLine(), 10);
    await c.request('setBreakpoints', { source: { path: FILE }, breakpoints: [{ line: 15 }] });
    await c.request('continue', { threadId: 1 });
    await c.waitEvent('stopped');
    const scopes = await c.request<DebugProtocol.ScopesResponse>('scopes', { frameId: 0 });
    const ref = scopes.body.scopes[0].variablesReference;
    const set = await c.request<DebugProtocol.SetVariableResponse>('setVariable', { variablesReference: ref, name: 'soma', value: '7' });
    assert.equal(set.success, true);
    await c.request('continue', { threadId: 1 });
    await c.waitEvent('terminated');
    assert.equal(c.output, 'soma= 7\n<Fim da execução.>');
  });

  it('a breakpoint on a blank line moves to the next statement', async () => {
    const c = new Client({ [FILE]: SRC });
    await c.request('initialize', { adapterID: 'visualg' });
    const r = await c.request<DebugProtocol.SetBreakpointsResponse>('setBreakpoints', { source: { path: FILE }, breakpoints: [{ line: 9 }, { line: 13 }] });
    assert.deepEqual(r.body.breakpoints.map((b) => [b.verified, b.line]), [[true, 10], [true, 14]]);
  });

  it('stops at a run-time error with the variables still visible', async () => {
    const src = 'algoritmo "e"\nvar v: vetor[1..2] de inteiro\ni: inteiro\ninicio\npara i de 1 ate 3 faca\nv[i] <- i\nfimpara\nfimalgoritmo';
    const c = new Client({ [FILE]: src });
    await start(c, []);
    const stop = (await c.waitEvent('stopped')) as DebugProtocol.StoppedEvent;
    assert.equal(stop.body.reason, 'exception');
    assert.match(stop.body.text ?? '', /Índice 3 fora dos limites/);
    assert.equal(await c.topLine(), 6);
    assert.equal((await c.vars())['Globais/i'], '3');
    await c.request('continue', { threadId: 1 });
    await c.waitEvent('terminated');
  });

  it('pausa stops like a breakpoint; noDebug ignores breakpoints', async () => {
    const src = 'algoritmo "p"\ninicio\nescreva("a")\npausa\nescreva("b")\nfimalgoritmo';
    const c = new Client({ [FILE]: src });
    await start(c, []);
    const stop = (await c.waitEvent('stopped')) as DebugProtocol.StoppedEvent;
    assert.equal(stop.body.reason, 'pause');
    await c.request('continue', { threadId: 1 });
    await c.waitEvent('terminated');
    assert.equal(c.output, 'ab<Fim da execução.>');

    const c2 = new Client({ [FILE]: SRC });
    await start(c2, [11], { noDebug: true });
    await c2.waitEvent('terminated');
    assert.ok(!c2.events.some((e) => e.event === 'stopped'));
  });

  it('reports compile errors without running', async () => {
    const c = new Client({ [FILE]: 'algoritmo "x"\ninicio\nx <- 1\nfimalgoritmo' });
    await start(c, []);
    await c.waitEvent('terminated');
    assert.match(c.output, /Linha 3: Variável "x" não foi declarada/);
  });

  it('stop request ends a program waiting in leia', async () => {
    const src = 'algoritmo "l"\nvar x: inteiro\ninicio\nenquanto verdadeiro faca\nx <- x + 1\nfimenquanto\nfimalgoritmo';
    const c = new Client({ [FILE]: src });
    await start(c, [], { noDebug: true });
    await new Promise((r) => setTimeout(r, 50));
    await c.request('disconnect', {});
    await c.waitEvent('terminated');
    assert.match(c.output, /Execução interrompida/);
  });
});
