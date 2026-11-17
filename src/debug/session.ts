import {
  Breakpoint, DebugSession, Handles, InitializedEvent, OutputEvent, Scope, Source, StackFrame, StoppedEvent,
  TerminatedEvent, Thread,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import { Program, Stmt, TypeSpec, typeToString } from '../lang/ast';
import { compile } from '../lang/compile';
import { VisualgError } from '../lang/errors';
import { parseExpression } from '../lang/parser';
import { nodeFiles } from '../runtime/files';
import { AliasCell, Cell, DebugHooks, Frame, Interpreter, IO, parseInput } from '../runtime/interpreter';
import { ArrayVal, displayValue, formatNumber, RecordVal, Value } from '../runtime/values';

/** The program's console: the extension gives a VS Code terminal, tests give a stub. */
export interface RunIO extends IO {
  /** A new run starts (clear the screen, show a header). */
  begin(title: string): void;
  /** The run ended; `message` is shown, `isError` marks it as an error. */
  end(message: string, isError: boolean): void;
  /** Make a pending readLine resolve with null. */
  cancelRead(): void;
  /** Set by the session: the user pressed Ctrl+C in the console. */
  onInterrupt?: () => void;
}

export interface SessionHost {
  createIO(): RunIO;
  readFile(file: string): string;
  /** `timer` is on: highlight this line in the editor (undefined clears). */
  showTimerLine?(file: string, line: number | undefined): void;
  /** A run started/ended (for the live memory view). */
  onRunChanged?(interp: Interpreter | undefined): void;
  /** The user pressed Ctrl+C in the console. */
  requestStop?(): void;
}

interface LaunchArgs extends DebugProtocol.LaunchRequestArguments {
  program: string;
  stopOnEntry?: boolean;
}

const THREAD = 1;

type StopKind = 'step' | 'breakpoint' | 'pause' | 'entry' | 'exception';

/** Decides, statement by statement, whether the program must stop. */
class Controller implements DebugHooks {
  mode: 'run' | 'stepIn' | 'stepOver' | 'stepOut' | 'pause' = 'run';
  stepDepth = 0;
  breakpoints = new Set<number>();
  private resumeFn?: () => void;

  constructor(private readonly onStop: (kind: StopKind, text?: string) => void) {}

  beforeLine(line: number, depth: number): Promise<void> | void {
    let kind: StopKind | undefined;
    if (this.mode === 'pause') kind = 'pause';
    else if (this.mode === 'stepIn') kind = 'step';
    else if (this.mode === 'stepOver' && depth <= this.stepDepth) kind = 'step';
    else if (this.mode === 'stepOut' && depth < this.stepDepth) kind = 'step';
    else if (this.breakpoints.has(line)) kind = 'breakpoint';
    if (!kind) return;
    return this.stop(kind);
  }

  pausa(line: number): Promise<void> {
    return this.stop('pause', `pausa (linha ${line})`);
  }

  stop(kind: StopKind, text?: string): Promise<void> {
    this.mode = 'run';
    return new Promise<void>((resolve) => {
      this.resumeFn = resolve;
      this.onStop(kind, text);
    });
  }

  resume(mode: Controller['mode'], depth: number): void {
    this.mode = mode;
    this.stepDepth = depth;
    const r = this.resumeFn;
    this.resumeFn = undefined;
    r?.();
  }

  get stopped(): boolean {
    return !!this.resumeFn;
  }
}

type VarRef =
  | { kind: 'scope'; cells: Cell[]; consts?: [string, Value][] }
  | { kind: 'array'; arr: ArrayVal; prefix: number[]; name: string }
  | { kind: 'record'; rec: RecordVal; name: string };

/** Lines where a statement starts: the only places a breakpoint can stop. */
function statementLines(p: Program): Set<number> {
  const lines = new Set<number>();
  const walk = (stmts: Stmt[]) => {
    for (const s of stmts) {
      lines.add(s.span.line);
      switch (s.kind) {
        case 'if':
          walk(s.then);
          if (s.else) walk(s.else);
          break;
        case 'case':
          s.clauses.forEach((c) => walk(c.body));
          if (s.otherwise) walk(s.otherwise);
          break;
        case 'for':
        case 'while':
          walk(s.body);
          break;
        case 'repeat':
          walk(s.body);
          if (s.until) lines.add(s.endSpan.line);
          break;
      }
    }
  };
  walk(p.prelude);
  walk(p.body);
  p.subs.forEach((s) => walk(s.body));
  return lines;
}

export class VisualgSession extends DebugSession {
  private interp?: Interpreter;
  private io?: RunIO;
  private file = '';
  private noDebug = false;
  private readonly controller: Controller;
  private readonly handles = new Handles<VarRef>();
  private configDone!: Promise<void>;
  private markConfigDone!: () => void;
  /** Breakpoints requested per file, before the program runs. */
  private pendingBreakpoints = new Map<string, number[]>();
  private errorFrames?: Frame[];
  private terminated = false;

  constructor(private readonly host: SessionHost) {
    super();
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
    this.configDone = new Promise((r) => (this.markConfigDone = r));
    this.controller = new Controller((kind, text) => {
      this.handles.reset();
      const ev = new StoppedEvent(kind, THREAD, text) as DebugProtocol.StoppedEvent;
      if (kind === 'exception') ev.body.description = 'Erro de execução';
      this.sendEvent(ev);
    });
  }

  // ---------- lifecycle ----------

  protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
    response.body = {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
      supportsTerminateRequest: true,
      supportsDelayedStackTraceLoading: false,
    };
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
    this.markConfigDone();
    this.sendResponse(response);
  }

  protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchArgs): Promise<void> {
    this.noDebug = !!args.noDebug;
    this.file = path.resolve(args.program);
    // Breakpoints arrive between initialize and configurationDone.
    await Promise.race([this.configDone, new Promise((r) => setTimeout(r, 1000))]);

    let src: string;
    try {
      src = this.host.readFile(this.file);
    } catch (e) {
      this.sendErrorResponse(response, 1, `Não foi possível abrir ${this.file}: ${(e as Error).message}`);
      return;
    }
    const io = (this.io = this.host.createIO());
    io.onInterrupt = () => (this.host.requestStop ? this.host.requestStop() : this.abort());
    io.begin(path.basename(this.file));
    this.sendResponse(response);

    const { analysis, errors } = compile(src);
    if (errors.length) {
      const msg = errors.map((e) => `Linha ${e.span.line}: ${e.message}`).join('\n');
      this.sendEvent(new OutputEvent(`${msg}\n`, 'stderr'));
      io.end(`O algoritmo tem erro${errors.length > 1 ? 's' : ''} e não foi executado:\n${msg}`, true);
      this.finish();
      return;
    }

    this.controller.breakpoints = new Set(this.resolveBreakpointLines(this.pendingBreakpoints.get(this.file) ?? [], analysis!.program));
    if (args.stopOnEntry && !this.noDebug) this.controller.mode = 'stepIn';

    const interp = (this.interp = new Interpreter(analysis!, {
      io,
      hooks: this.noDebug ? undefined : this.controller,
      baseDir: path.dirname(this.file),
      files: nodeFiles,
      onTimerLine: (line) => this.host.showTimerLine?.(this.file, line),
    }));
    this.host.onRunChanged?.(interp);

    try {
      const status = await interp.run();
      io.end(status === 'fim' ? 'Fim da execução.' : 'Execução interrompida.', false);
    } catch (e) {
      if (!(e instanceof VisualgError)) {
        io.end(`Erro interno do interpretador: ${(e as Error).message}`, true);
        this.sendEvent(new OutputEvent(`${(e as Error).stack}\n`, 'stderr'));
      } else {
        const text = `Erro na linha ${e.span.line}: ${e.message}`;
        io.end(text, true);
        this.sendEvent(new OutputEvent(`${text}\n`, 'stderr'));
        if (!this.noDebug && !this.terminated) {
          // Stop at the error so the variables can still be inspected.
          this.errorFrames = interp.errorStack;
          await this.controller.stop('exception', e.message);
        }
      }
    } finally {
      this.host.showTimerLine?.(this.file, undefined);
      this.host.onRunChanged?.(undefined);
      this.finish();
    }
  }

  private finish(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.sendEvent(new TerminatedEvent());
  }

  /** Stop the program (stop button, Ctrl+C, or another run starting). */
  abort(): void {
    this.interp?.stop();
    this.io?.cancelRead();
    if (this.controller.stopped) this.controller.resume('run', 0);
  }

  protected disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
    this.abort();
    this.sendResponse(response);
  }

  protected terminateRequest(response: DebugProtocol.TerminateResponse): void {
    this.abort();
    this.sendResponse(response);
  }

  // ---------- breakpoints ----------

  private resolveBreakpointLines(lines: number[], program: Program): number[] {
    const valid = statementLines(program);
    const sorted = [...valid].sort((a, b) => a - b);
    // A breakpoint on a blank/declaration line moves to the next statement.
    return lines.map((l) => (valid.has(l) ? l : sorted.find((s) => s > l) ?? l));
  }

  protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {
    const file = path.resolve(args.source.path ?? '');
    const requested = (args.breakpoints ?? []).map((b) => b.line);
    this.pendingBreakpoints.set(file, requested);

    let resolved = requested;
    let verified = false;
    try {
      const { analysis } = compile(this.host.readFile(file));
      if (analysis) {
        resolved = this.resolveBreakpointLines(requested, analysis.program);
        verified = true;
      }
    } catch {
      // file unreadable: keep breakpoints unverified
    }
    if (file === this.file && this.interp) this.controller.breakpoints = new Set(resolved);
    response.body = { breakpoints: resolved.map((l) => new Breakpoint(verified, l) as DebugProtocol.Breakpoint) };
    this.sendResponse(response);
  }

  // ---------- execution control ----------

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = { threads: [new Thread(THREAD, 'VisuAlg')] };
    this.sendResponse(response);
  }

  protected continueRequest(response: DebugProtocol.ContinueResponse): void {
    this.sendResponse(response);
    this.controller.resume('run', 0);
  }

  protected nextRequest(response: DebugProtocol.NextResponse): void {
    this.sendResponse(response);
    this.controller.resume('stepOver', this.interp?.depth ?? 0);
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse): void {
    this.sendResponse(response);
    this.controller.resume('stepIn', 0);
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
    this.sendResponse(response);
    this.controller.resume('stepOut', this.interp?.depth ?? 0);
  }

  protected pauseRequest(response: DebugProtocol.PauseResponse): void {
    this.controller.mode = 'pause';
    this.sendResponse(response);
  }

  // ---------- inspection ----------

  /** Frames, innermost first. After an error, the stack as it was when the error happened. */
  private frames(): Frame[] {
    const stack = this.errorFrames ?? this.interp?.callStack ?? [];
    return [...stack].reverse();
  }

  protected stackTraceRequest(response: DebugProtocol.StackTraceResponse): void {
    const source = new Source(path.basename(this.file), this.file);
    const frames = this.frames().map((f, i) => {
      const name = f.sub ? `${f.sub.decl.kind} ${f.name}` : `algoritmo "${f.name}"`;
      return new StackFrame(i, name, source, f.line, 1);
    });
    response.body = { stackFrames: frames, totalFrames: frames.length };
    this.sendResponse(response);
  }

  protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {
    const frame = this.frames()[args.frameId];
    const scopes: DebugProtocol.Scope[] = [];
    if (frame && this.interp) {
      if (frame.sub) scopes.push(new Scope(`Locais (${frame.name})`, this.handles.create({ kind: 'scope', cells: [...frame.vars.values()], consts: [...frame.consts].map(([, c]) => [c.name, c.value]) }), false));
      const g = this.interp.globals;
      scopes.push(new Scope('Globais', this.handles.create({ kind: 'scope', cells: [...g.vars.values()], consts: [...g.consts].map(([, c]) => [c.name, c.value]) }), false));
    }
    response.body = { scopes };
    this.sendResponse(response);
  }

  private variable(name: string, v: Value, type: string, evaluateName?: string): DebugProtocol.Variable {
    let ref = 0;
    let value = displayValue(v);
    if (v instanceof ArrayVal) {
      ref = this.handles.create({ kind: 'array', arr: v, prefix: [], name });
      value = this.arrayPreview(v);
    } else if (v instanceof RecordVal) {
      ref = this.handles.create({ kind: 'record', rec: v, name });
      value = `{ ${v.type.fields.map((f) => `${f.name}: ${displayValue(v.fields.get(f.norm)!)}`).join(', ')} }`;
    }
    return { name, value, type, variablesReference: ref, evaluateName: evaluateName ?? name };
  }

  private arrayPreview(a: ArrayVal): string {
    const shown = a.data.slice(0, 10).map((x) => (x instanceof ArrayVal || x instanceof RecordVal ? '…' : displayValue(x)));
    return `[${shown.join(', ')}${a.data.length > 10 ? ', …' : ''}]`;
  }

  private cellType(c: Cell): string {
    return `${c instanceof AliasCell ? 'var ' : ''}${typeToString(c.type)}`;
  }

  protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
    const ref = this.handles.get(args.variablesReference);
    const vars: DebugProtocol.Variable[] = [];
    if (ref?.kind === 'scope') {
      for (const c of ref.cells) vars.push(this.variable(c.name, c.get(), this.cellType(c)));
      for (const [name, v] of ref.consts ?? []) vars.push({ ...this.variable(name, v, 'constante'), presentationHint: { attributes: ['constant', 'readOnly'] } });
    } else if (ref?.kind === 'array') {
      const t = ref.arr.type;
      const depth = ref.prefix.length;
      const { lo, hi } = t.dims[depth];
      for (let i = lo; i <= hi; i++) {
        const idx = [...ref.prefix, i];
        const label = `[${idx.join(',')}]`;
        if (depth < t.dims.length - 1) {
          // A row of a matrix: expand to its elements.
          vars.push({ name: label, value: '', variablesReference: this.handles.create({ kind: 'array', arr: ref.arr, prefix: idx, name: ref.name }) });
        } else {
          let off = 0;
          for (let k = 0; k < idx.length; k++) off = off * (t.dims[k].hi - t.dims[k].lo + 1) + (idx[k] - t.dims[k].lo);
          vars.push(this.variable(label, ref.arr.data[off], typeToString(t.elem), `${ref.name}${label}`));
        }
      }
    } else if (ref?.kind === 'record') {
      for (const f of ref.rec.type.fields) vars.push(this.variable(f.name, ref.rec.fields.get(f.norm)!, typeToString(f.type), `${ref.name}.${f.name}`));
    }
    response.body = { variables: vars };
    this.sendResponse(response);
  }

  /** Parses what the user typed in the Variables panel into a value of type t. */
  private parseUserValue(text: string, t: TypeSpec): Value {
    if (t.kind !== 'prim') throw new Error('Só é possível alterar valores simples (inteiro, real, caractere ou logico)');
    let s = text.trim();
    if (t.name === 'caractere') {
      if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
      return s;
    }
    const v = parseInput(s, t.name);
    if (v === undefined) throw new Error(`"${text}" não é um valor ${t.name} válido`);
    return v;
  }

  protected setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments): void {
    const ref = this.handles.get(args.variablesReference);
    try {
      let newValue: Value | undefined;
      if (ref?.kind === 'scope') {
        const cell = ref.cells.find((c) => c.name === args.name);
        if (!cell) throw new Error('Constantes não podem ser alteradas');
        newValue = this.parseUserValue(args.value, cell.type);
        cell.set(newValue);
      } else if (ref?.kind === 'array') {
        const idx = args.name.slice(1, -1).split(',').map(Number);
        const t = ref.arr.type;
        let off = 0;
        for (let k = 0; k < idx.length; k++) off = off * (t.dims[k].hi - t.dims[k].lo + 1) + (idx[k] - t.dims[k].lo);
        newValue = this.parseUserValue(args.value, t.elem);
        ref.arr.data[off] = newValue;
      } else if (ref?.kind === 'record') {
        const f = ref.rec.type.fields.find((x) => x.name === args.name)!;
        newValue = this.parseUserValue(args.value, f.type);
        ref.rec.fields.set(f.norm, newValue);
      }
      response.body = { value: newValue === undefined ? args.value : displayValue(newValue) };
      this.sendResponse(response);
    } catch (e) {
      this.sendErrorResponse(response, 2, (e as Error).message);
    }
  }

  protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
    const frame = this.frames()[args.frameId ?? 0];
    if (!this.interp || !frame) {
      this.sendErrorResponse(response, 3, 'O algoritmo não está pausado');
      return;
    }
    try {
      const e = parseExpression(args.expression);
      const v = this.interp.evaluateForDebugger(e, frame);
      const d = this.variable(args.expression, v, '');
      response.body = { result: typeof v === 'number' ? formatNumber(v) : d.value, variablesReference: d.variablesReference };
      this.sendResponse(response);
    } catch (e) {
      // Hovering a keyword or an unknown word should just show nothing.
      if (args.context === 'hover') this.sendErrorResponse(response, 4, '');
      else this.sendErrorResponse(response, 4, (e as Error).message);
    }
  }
}

/** Exposed for tests. */
export { statementLines };
