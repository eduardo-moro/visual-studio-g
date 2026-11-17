import { Analysis, ConstInfo, SubInfo } from '../lang/analyzer';
import { Expr, Stmt, TypeSpec, typeToString } from '../lang/ast';
import { Span, VisualgError } from '../lang/errors';
import { normalize } from '../lang/lexer';
import { BUILTINS, BuiltinCtx } from './builtins';
import {
  arrayOffset, ArrayVal, cloneValue, defaultValue, formatBool, formatNumber, RecordVal, sameShape, Value, valueTypeName,
} from './values';

/** Where the program's text goes and where `leia` gets its input from. */
export interface IO {
  write(text: string): void;
  /** Resolves with the typed line, or null when input is closed (the run is then stopped). */
  readLine(): Promise<string | null>;
  clear(): void;
  /** Color names from builtins.COLORS; undefined keeps the current one. */
  setColor(fg?: string, bg?: string): void;
}

/** Lets a debugger pause the program. Only consulted when present. */
export interface DebugHooks {
  /** Before each statement (and each loop re-check). Return a promise to hold execution there. */
  beforeLine(line: number, depth: number): Promise<void> | void;
  /** `pausa`, or `debug <cond>` with a true condition. */
  pausa(line: number): Promise<void>;
}

/** File access for the `arquivo` command (injectable for tests). */
export interface FileAccess {
  readLines(path: string): string[] | undefined;
  appendLine(path: string, line: string): void;
  resolve(base: string | undefined, path: string): string;
}

export interface RunOptions {
  io: IO;
  hooks?: DebugHooks;
  /** Seed for rand/randi/aleatorio, for reproducible runs. */
  seed?: number;
  /** Folder of the .alg file, where `arquivo` looks for its file. */
  baseDir?: string;
  files?: FileAccess;
  /** Called with the line being run while `timer` is on (to highlight it in the editor). */
  onTimerLine?(line: number): void;
}

export interface Cell {
  name: string;
  readonly type: TypeSpec;
  get(): Value;
  set(v: Value): void;
}

class VarCell implements Cell {
  constructor(public name: string, public readonly type: TypeSpec, public value: Value) {}
  get(): Value {
    return this.value;
  }
  set(v: Value): void {
    this.value = v;
  }
}

/** A `var` parameter: another name for the caller's variable (or element/field). */
export class AliasCell implements Cell {
  constructor(public name: string, public readonly target: Cell) {}
  get type(): TypeSpec {
    return this.target.type;
  }
  get(): Value {
    return this.target.get();
  }
  set(v: Value): void {
    this.target.set(v);
  }
}

class ElemCell implements Cell {
  constructor(public name: string, private arr: ArrayVal, private off: number) {}
  get type(): TypeSpec {
    return this.arr.type.elem;
  }
  get(): Value {
    return this.arr.data[this.off];
  }
  set(v: Value): void {
    this.arr.data[this.off] = v;
  }
}

class FieldCell implements Cell {
  constructor(public name: string, private rec: RecordVal, private norm: string, public readonly type: TypeSpec) {}
  get(): Value {
    return this.rec.fields.get(this.norm)!;
  }
  set(v: Value): void {
    this.rec.fields.set(this.norm, v);
  }
}

export class Frame {
  /** Line currently executing in this frame. */
  line = 0;
  returnValue?: Value;
  constructor(
    public readonly name: string,
    public readonly sub: SubInfo | undefined,
    public readonly vars: Map<string, Cell>,
    public readonly consts: Map<string, ConstInfo>,
  ) {}
}

/** Thrown to unwind the interpreter when the run is stopped (Ctrl+C, stop button, closed input). */
export class StopSignal extends Error {
  constructor() {
    super('stopped');
  }
}

const NORMAL = 0;
const BREAK = 1;
const RETURN = 2;
type Signal = typeof NORMAL | typeof BREAK | typeof RETURN;

/** Yield to the event loop this often on the fast path, so stop requests get through. */
const YIELD_EVERY = 20000;
const MAX_DEPTH = 5000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseInput(text: string, type: 'inteiro' | 'real' | 'caractere' | 'logico'): Value | undefined {
  const t = text.trim();
  switch (type) {
    case 'inteiro':
      return /^[+-]?\d+$/.test(t) ? Number(t) : undefined;
    case 'real': {
      const s = t.replace(',', '.');
      return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : undefined;
    }
    case 'logico': {
      const n = normalize(t);
      if (['v', 'verdadeiro', 's', 'sim', 'true', '1'].includes(n)) return true;
      if (['f', 'falso', 'n', 'nao', 'false', '0'].includes(n)) return false;
      return undefined;
    }
    case 'caractere':
      return text;
  }
}

export class Interpreter {
  readonly globals: Frame;
  /** callStack[0] is the main program; the last entry is the frame running now. */
  readonly callStack: Frame[] = [];

  private readonly io: IO;
  private readonly hooks?: DebugHooks;
  private readonly random: () => number;
  private counter = 0;
  private stopped = false;
  private timerMs = 0;
  private slow: boolean;
  private randomOn = false;
  private randomLo = 0;
  private randomHi = 100;
  private randomDecimals = 2;
  private echo = true;
  private chronoStart?: number;
  private fileLines?: string[];
  private filePos = 0;
  private recordPath?: string;
  private curSpan: Span;
  private readonly pure = new WeakMap<Expr, boolean>();
  private readonly ctx: BuiltinCtx;

  constructor(public readonly analysis: Analysis, private readonly opts: RunOptions) {
    this.io = opts.io;
    this.hooks = opts.hooks;
    this.slow = !!this.hooks;
    this.random = mulberry32(opts.seed ?? (Date.now() ^ (Math.random() * 0x7fffffff)));
    this.curSpan = analysis.program.span;
    const vars = new Map<string, Cell>();
    for (const g of analysis.globals) vars.set(g.norm, new VarCell(g.name, g.type, defaultValue(g.type)));
    this.globals = new Frame(analysis.program.name || 'algoritmo', undefined, vars, analysis.consts);
    this.ctx = {
      random: this.random,
      fail: (msg) => this.fail(msg, this.curSpan),
      setColor: (fg, bg) => this.io.setColor(fg, bg),
      write: (s) => this.io.write(s),
    };
  }

  /** Runs the whole program. Resolves when it ends or is stopped; rejects with VisualgError on run-time errors. */
  async run(): Promise<'fim' | 'parado'> {
    const p = this.analysis.program;
    this.callStack.push(this.globals);
    this.globals.line = p.span.line;
    try {
      if ((await this.execBlock(p.prelude, this.globals)) === NORMAL) await this.execBlock(p.body, this.globals);
      return 'fim';
    } catch (e) {
      if (e instanceof StopSignal) return 'parado';
      if (e instanceof RangeError && /call stack/i.test(e.message)) {
        throw new VisualgError('Recursão muito profunda: o programa chamou funções demais sem retornar', this.curSpan, 'execucao');
      }
      throw e;
    }
  }

  /** Ask the running program to stop at its next statement. */
  stop(): void {
    this.stopped = true;
  }

  get depth(): number {
    return this.callStack.length;
  }

  /** Looks a name up the way the program would at this frame (locals, then globals). */
  lookup(frame: Frame, name: string): { cell?: Cell; constValue?: Value } {
    const norm = normalize(name);
    const cell = frame.vars.get(norm) ?? this.globals.vars.get(norm);
    if (cell) return { cell };
    const c = frame.consts.get(norm) ?? this.globals.consts.get(norm);
    return c ? { constValue: c.value } : {};
  }

  /** Evaluates an expression for the debugger (watch/hover). Calls to user functions are not allowed. */
  evaluateForDebugger(e: Expr, frame: Frame): Value {
    if (!this.isPure(e)) throw new VisualgError('Expressões com chamadas de funções do algoritmo não podem ser avaliadas aqui', e.span, 'execucao');
    return this.evalSync(e, frame);
  }

  /** Converts/validates v for storing into a variable of type t (copies vectors and records). */
  coerce(v: Value, t: TypeSpec, span: Span, what: string): Value {
    if (t.kind === 'prim') {
      switch (t.name) {
        case 'inteiro':
          if (typeof v !== 'number') this.fail(`Não é possível guardar um valor ${valueTypeName(v)} em ${what}, que é do tipo inteiro`, span);
          if (!Number.isInteger(v)) this.fail(`Não é possível guardar o valor real ${formatNumber(v)} em ${what}, que é do tipo inteiro (use int(...) para pegar só a parte inteira)`, span);
          return v;
        case 'real':
          if (typeof v !== 'number') this.fail(`Não é possível guardar um valor ${valueTypeName(v)} em ${what}, que é do tipo real`, span);
          return v;
        case 'caractere':
          if (typeof v !== 'string') this.fail(`Não é possível guardar um valor ${valueTypeName(v)} em ${what}, que é do tipo caractere (use numpcarac(...) para converter números em texto)`, span);
          return v;
        case 'logico':
          if (typeof v !== 'boolean') this.fail(`Não é possível guardar um valor ${valueTypeName(v)} em ${what}, que é do tipo logico`, span);
          return v;
      }
    }
    if ((v instanceof ArrayVal || v instanceof RecordVal) && sameShape(v.type, t)) return cloneValue(v);
    const got = v instanceof ArrayVal || v instanceof RecordVal ? typeToString(v.type) : valueTypeName(v);
    this.fail(`Não é possível guardar um valor do tipo ${got} em ${what}, que é do tipo ${typeToString(t)}`, span);
  }

  /** Call stack at the moment of the last run-time error (frames stay inspectable after unwinding). */
  errorStack?: Frame[];

  private fail(msg: string, span: Span): never {
    this.errorStack = [...this.callStack];
    this.errorStack[this.errorStack.length - 1].line = span.line;
    throw new VisualgError(msg, span, 'execucao');
  }

  // ---------- statements ----------

  private async execBlock(stmts: Stmt[], f: Frame): Promise<Signal> {
    for (const s of stmts) {
      const sig = await this.execStmt(s, f);
      if (sig !== NORMAL) return sig;
    }
    return NORMAL;
  }

  private async yieldNow(): Promise<void> {
    this.counter = 0;
    await new Promise<void>((r) => setImmediate(r));
    if (this.stopped) throw new StopSignal();
  }

  /** Per-line work on the slow path: timer delay, debugger hook. */
  private async tick(line: number): Promise<void> {
    if (++this.counter >= YIELD_EVERY || this.stopped) await this.yieldNow();
    if (this.timerMs > 0) {
      this.opts.onTimerLine?.(line);
      await new Promise((r) => setTimeout(r, this.timerMs));
      if (this.stopped) throw new StopSignal();
    }
    if (this.hooks) {
      const p = this.hooks.beforeLine(line, this.callStack.length);
      if (p) await p;
      if (this.stopped) throw new StopSignal();
    }
  }

  private async loopTick(line: number): Promise<void> {
    if (this.slow) await this.tick(line);
    else if (++this.counter >= YIELD_EVERY) await this.yieldNow();
  }

  private async execStmt(s: Stmt, f: Frame): Promise<Signal> {
    f.line = s.span.line;
    this.curSpan = s.span;
    await this.loopTick(s.span.line);
    this.curSpan = s.span;

    switch (s.kind) {
      case 'assign': {
        const cell = await this.cellOf(s.target, f);
        const v = await this.ev(s.value, f);
        cell.set(this.coerce(v, cell.type, s.value.span, `"${cell.name}"`));
        return NORMAL;
      }
      case 'call':
        await this.callStatement(s.call, f);
        return NORMAL;
      case 'write': {
        let out = '';
        for (const a of s.args) {
          const v = await this.ev(a.expr, f);
          const width = a.width ? this.toInt(await this.ev(a.width, f), a.width.span, 'A largura') : undefined;
          const dec = a.decimals ? this.toInt(await this.ev(a.decimals, f), a.decimals.span, 'O número de casas decimais') : undefined;
          out += this.formatArg(v, width, dec, a.expr.span);
        }
        if (s.newline) out += '\n';
        if (out) this.io.write(out);
        return NORMAL;
      }
      case 'read':
        for (const t of s.targets) {
          const cell = await this.cellOf(t, f);
          if (cell.type.kind !== 'prim') this.fail(`Não é possível ler "${cell.name}" de uma vez: leia um elemento ou campo por vez`, t.span);
          cell.set(await this.readValue(cell.type.name));
        }
        return NORMAL;
      case 'if': {
        const c = await this.ev(s.cond, f);
        if (typeof c !== 'boolean') this.fail(`A condição do "se" deve ser um valor lógico (VERDADEIRO ou FALSO), mas é ${valueTypeName(c)}`, s.cond.span);
        if (c) return this.execBlock(s.then, f);
        return s.else ? this.execBlock(s.else, f) : NORMAL;
      }
      case 'case': {
        const subject = await this.ev(s.subject, f);
        for (const clause of s.clauses) {
          for (const item of clause.items) {
            let hit: boolean;
            if (item.kind === 'value') {
              hit = this.compare(subject, await this.ev(item.expr, f), item.expr.span) === 0;
            } else {
              const lo = await this.ev(item.lo, f);
              const hi = await this.ev(item.hi, f);
              hit = this.compare(subject, lo, item.lo.span) >= 0 && this.compare(subject, hi, item.hi.span) <= 0;
            }
            if (hit) return this.execBlock(clause.body, f);
          }
        }
        return s.otherwise ? this.execBlock(s.otherwise, f) : NORMAL;
      }
      case 'for': {
        const cell = await this.cellOf(s.counter, f);
        const from = this.toNum(await this.ev(s.from, f), s.from.span, 'O valor inicial do "para"');
        const to = this.toNum(await this.ev(s.to, f), s.to.span, 'O valor final do "para"');
        const step = s.step ? this.toNum(await this.ev(s.step, f), s.step.span, 'O passo do "para"') : 1;
        if (step === 0) this.fail('O passo do "para" não pode ser zero', s.step!.span);
        const what = `"${cell.name}"`;
        cell.set(this.coerce(from, cell.type, s.from.span, what));
        for (let first = true; ; first = false) {
          if (!first) {
            f.line = s.span.line;
            await this.loopTick(s.span.line);
          }
          const i = cell.get();
          if (typeof i !== 'number') this.fail('A variável do "para" deve ser numérica', s.counter.span);
          if (step > 0 ? i > to : i < to) break;
          const sig = await this.execBlock(s.body, f);
          if (sig === BREAK) break;
          if (sig === RETURN) return RETURN;
          cell.set(this.coerce((cell.get() as number) + step, cell.type, s.span, what));
        }
        return NORMAL;
      }
      case 'while':
        for (let first = true; ; first = false) {
          if (!first) {
            f.line = s.span.line;
            await this.loopTick(s.span.line);
          }
          const c = await this.ev(s.cond, f);
          if (typeof c !== 'boolean') this.fail(`A condição do "enquanto" deve ser um valor lógico, mas é ${valueTypeName(c)}`, s.cond.span);
          if (!c) break;
          const sig = await this.execBlock(s.body, f);
          if (sig === BREAK) break;
          if (sig === RETURN) return RETURN;
        }
        return NORMAL;
      case 'repeat':
        for (;;) {
          const sig = await this.execBlock(s.body, f);
          if (sig === BREAK) break;
          if (sig === RETURN) return RETURN;
          f.line = s.endSpan.line;
          this.curSpan = s.endSpan;
          await this.loopTick(s.endSpan.line);
          if (s.until) {
            const c = await this.ev(s.until, f);
            if (typeof c !== 'boolean') this.fail(`A condição do "ate" deve ser um valor lógico, mas é ${valueTypeName(c)}`, s.until.span);
            if (c) break;
          }
        }
        return NORMAL;
      case 'break':
        return BREAK;
      case 'return':
        if (s.value && f.sub?.returnType) {
          f.returnValue = this.coerce(await this.ev(s.value, f), f.sub.returnType, s.value.span, `o retorno da função "${f.sub.decl.name}"`);
        }
        return RETURN;
      case 'clear':
        this.io.clear();
        return NORMAL;
      case 'pause':
        await this.pausa(s.span.line);
        return NORMAL;
      case 'debug': {
        const c = await this.ev(s.cond, f);
        if (typeof c !== 'boolean') this.fail('A condição do "debug" deve ser um valor lógico', s.cond.span);
        if (c) await this.pausa(s.span.line);
        return NORMAL;
      }
      case 'timer': {
        if (s.mode === 'on') this.timerMs = 500;
        else if (s.mode === 'off') this.timerMs = 0;
        else this.timerMs = Math.min(Math.max(this.toNum(await this.ev(s.value!, f), s.value!.span, 'O tempo do timer'), 0), 10000);
        this.slow = !!this.hooks || this.timerMs > 0;
        return NORMAL;
      }
      case 'random': {
        if (s.mode === 'off') {
          this.randomOn = false;
          return NORMAL;
        }
        this.randomOn = true;
        if (s.mode === 'on') {
          this.randomLo = 0;
          this.randomHi = 100;
        } else {
          const a = this.toNum(await this.ev(s.lo!, f), s.lo!.span, 'O limite do aleatorio');
          const b = s.hi ? this.toNum(await this.ev(s.hi, f), s.hi.span, 'O limite do aleatorio') : undefined;
          [this.randomLo, this.randomHi] = b === undefined ? [0, a] : [a, b];
          if (this.randomHi < this.randomLo) [this.randomLo, this.randomHi] = [this.randomHi, this.randomLo];
          if (s.decimals) this.randomDecimals = Math.min(Math.max(this.toInt(await this.ev(s.decimals, f), s.decimals.span, 'As casas decimais do aleatorio'), 0), 10);
        }
        return NORMAL;
      }
      case 'echo':
        this.echo = s.on;
        return NORMAL;
      case 'chrono':
        if (s.on) {
          this.chronoStart = Date.now();
          this.io.write('Cronômetro iniciado.\n');
        } else if (this.chronoStart !== undefined) {
          const ms = Date.now() - this.chronoStart;
          this.io.write(`Cronômetro terminado. Tempo decorrido: ${Math.floor(ms / 1000)} segundo(s) e ${ms % 1000} ms\n`);
          this.chronoStart = undefined;
        }
        return NORMAL;
      case 'file': {
        const files = this.opts.files;
        if (!files) this.fail('O comando "arquivo" não está disponível aqui', s.span);
        const path = files.resolve(this.opts.baseDir, s.path);
        const lines = files.readLines(path);
        if (lines) {
          this.fileLines = lines;
          this.filePos = 0;
        } else this.recordPath = path;
        return NORMAL;
      }
      case 'nop':
        return NORMAL;
    }
  }

  private async pausa(line: number): Promise<void> {
    if (this.hooks) {
      await this.hooks.pausa(line);
      if (this.stopped) throw new StopSignal();
      return;
    }
    this.io.write(`\n*** Pausa na linha ${line}. Tecle ENTER para continuar ***\n`);
    if ((await this.io.readLine()) === null) throw new StopSignal();
  }

  private async readValue(type: 'inteiro' | 'real' | 'caractere' | 'logico'): Promise<Value> {
    const show = (v: Value) => (typeof v === 'number' ? formatNumber(v) : typeof v === 'boolean' ? formatBool(v) : v);
    if (this.randomOn && type !== 'logico') {
      let v: Value;
      if (type === 'caractere') {
        v = Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(this.random() * 26))).join('');
      } else if (type === 'inteiro') {
        const lo = Math.ceil(this.randomLo);
        const hi = Math.floor(this.randomHi);
        v = lo + Math.floor(this.random() * (hi - lo + 1));
      } else {
        const scale = 10 ** this.randomDecimals;
        v = Math.round((this.randomLo + this.random() * (this.randomHi - this.randomLo)) * scale) / scale;
      }
      if (this.echo) this.io.write(`${show(v)}\n`);
      return v;
    }
    if (this.fileLines && this.filePos < this.fileLines.length) {
      const line = this.fileLines[this.filePos++];
      const v = parseInput(line, type);
      if (v === undefined) this.fail(`O valor "${line}" do arquivo (linha ${this.filePos}) não é do tipo ${type}`, this.curSpan);
      if (this.echo) this.io.write(`${show(v)}\n`);
      return v;
    }
    for (;;) {
      const line = await this.io.readLine();
      if (line === null || this.stopped) throw new StopSignal();
      const v = parseInput(line, type);
      if (v !== undefined) {
        if (this.recordPath) this.opts.files!.appendLine(this.recordPath, line);
        return v;
      }
      const hint = type === 'inteiro' ? ' (um número inteiro, sem casas decimais)' : type === 'real' ? ' (um número, use ponto ou vírgula para as decimais)' : type === 'logico' ? ' (V ou F)' : '';
      this.io.write(`Valor inválido para o tipo ${type}${hint}. Digite novamente: `);
    }
  }

  private formatArg(v: Value, width: number | undefined, dec: number | undefined, span: Span): string {
    if (v instanceof ArrayVal || v instanceof RecordVal) {
      this.fail(`Não é possível escrever ${v instanceof ArrayVal ? 'um vetor' : 'um registro'} inteiro: escreva um elemento ou campo por vez`, span);
    }
    let s: string;
    if (typeof v === 'number') s = dec !== undefined ? v.toFixed(Math.max(0, Math.min(dec, 100))) : formatNumber(v);
    else if (typeof v === 'boolean') s = formatBool(v);
    else s = v;
    if (width !== undefined) return s.padStart(width);
    // VisuAlg puts a space before numbers and logical values (not before text).
    return typeof v === 'string' ? s : ` ${s}`;
  }

  // ---------- calls ----------

  private async callStatement(call: Extract<Expr, { kind: 'call' }>, f: Frame): Promise<void> {
    const sub = this.analysis.subs.get(call.norm);
    if (sub) {
      await this.callSub(sub, call.args, f, call.span);
      return;
    }
    const b = BUILTINS.get(call.norm)!;
    const args: Value[] = [];
    for (const a of call.args) args.push(await this.ev(a, f));
    this.curSpan = call.span;
    b.run(args, this.ctx);
  }

  private async callSub(sub: SubInfo, args: Expr[], caller: Frame, span: Span): Promise<Value | undefined> {
    if (this.callStack.length >= MAX_DEPTH) this.fail(`Recursão muito profunda: mais de ${MAX_DEPTH} chamadas ativas ao mesmo tempo`, span);
    const vars = new Map<string, Cell>();
    for (let i = 0; i < sub.params.length; i++) {
      const p = sub.params[i];
      const arg = args[i];
      if (p.byRef) {
        const cell = await this.cellOf(arg, caller);
        if (!sameShape(cell.type, p.type)) {
          this.fail(`O parâmetro "${p.name}" é do tipo ${typeToString(p.type)}, mas "${cell.name}" é do tipo ${typeToString(cell.type)} (parâmetros "var" precisam ser do mesmo tipo)`, arg.span);
        }
        vars.set(p.norm, new AliasCell(p.name, cell));
      } else {
        const v = await this.ev(arg, caller);
        vars.set(p.norm, new VarCell(p.name, p.type, this.coerce(v, p.type, arg.span, `o parâmetro "${p.name}"`)));
      }
    }
    for (const l of sub.locals) vars.set(l.norm, new VarCell(l.name, l.type, defaultValue(l.type)));
    const frame = new Frame(sub.decl.name, sub, vars, sub.consts);
    frame.line = sub.decl.span.line;
    this.callStack.push(frame);
    try {
      await this.execBlock(sub.decl.body, frame);
    } finally {
      this.callStack.pop();
    }
    if (sub.decl.kind === 'funcao') return frame.returnValue ?? defaultValue(sub.returnType!);
    return undefined;
  }

  // ---------- expressions ----------

  /** Expressions without calls to user functions can be evaluated synchronously (much faster). */
  private isPure(e: Expr): boolean {
    const cached = this.pure.get(e);
    if (cached !== undefined) return cached;
    let r: boolean;
    switch (e.kind) {
      case 'var':
        r = !this.analysis.subs.has(e.norm);
        break;
      case 'call':
        r = !this.analysis.subs.has(e.norm) && e.args.every((a) => this.isPure(a));
        break;
      case 'index':
        r = this.isPure(e.target) && e.indices.every((i) => this.isPure(i));
        break;
      case 'field':
        r = this.isPure(e.target);
        break;
      case 'unary':
        r = this.isPure(e.operand);
        break;
      case 'binary':
        r = this.isPure(e.left) && this.isPure(e.right);
        break;
      default:
        r = true;
    }
    this.pure.set(e, r);
    return r;
  }

  private ev(e: Expr, f: Frame): Value | Promise<Value> {
    return this.isPure(e) ? this.evalSync(e, f) : this.evalAsync(e, f);
  }

  private varValue(e: Extract<Expr, { kind: 'var' }>, f: Frame): Value | undefined {
    const cell = f.vars.get(e.norm) ?? this.globals.vars.get(e.norm);
    if (cell) return cell.get();
    const c = f.consts.get(e.norm) ?? this.globals.consts.get(e.norm);
    return c?.value;
  }

  private evalSync(e: Expr, f: Frame): Value {
    switch (e.kind) {
      case 'num':
        return e.value;
      case 'str':
        return e.value;
      case 'bool':
        return e.value;
      case 'var': {
        const v = this.varValue(e, f);
        if (v !== undefined) return v;
        const b = BUILTINS.get(e.norm);
        if (b) {
          this.curSpan = e.span;
          return b.run([], this.ctx) as Value;
        }
        this.fail(`Variável "${e.name}" não foi declarada`, e.span);
      }
      case 'index':
        return this.indexValue(this.evalSync(e.target, f), e.indices.map((i) => this.evalSync(i, f)), e);
      case 'field':
        return this.fieldValue(this.evalSync(e.target, f), e);
      case 'call': {
        const args = e.args.map((a) => this.evalSync(a, f));
        return this.callBuiltin(e, args);
      }
      case 'unary':
        return this.unary(e, this.evalSync(e.operand, f));
      case 'binary': {
        const l = this.evalSync(e.left, f);
        if (e.op === 'e' || e.op === 'ou') {
          if (typeof l !== 'boolean') this.logicFail(e.op, l, e.left.span);
          if (e.op === 'e' ? !l : l) return l;
        }
        return this.binary(e, l, this.evalSync(e.right, f));
      }
    }
  }

  private async evalAsync(e: Expr, f: Frame): Promise<Value> {
    switch (e.kind) {
      case 'var': {
        const v = this.varValue(e, f);
        if (v !== undefined) return v;
        return (await this.callSub(this.analysis.subs.get(e.norm)!, [], f, e.span))!;
      }
      case 'call': {
        const sub = this.analysis.subs.get(e.norm);
        if (sub) return (await this.callSub(sub, e.args, f, e.span))!;
        const args: Value[] = [];
        for (const a of e.args) args.push(await this.ev(a, f));
        return this.callBuiltin(e, args);
      }
      case 'index': {
        const target = await this.ev(e.target, f);
        const idx: Value[] = [];
        for (const i of e.indices) idx.push(await this.ev(i, f));
        return this.indexValue(target, idx, e);
      }
      case 'field':
        return this.fieldValue(await this.ev(e.target, f), e);
      case 'unary':
        return this.unary(e, await this.ev(e.operand, f));
      case 'binary': {
        const l = await this.ev(e.left, f);
        if (e.op === 'e' || e.op === 'ou') {
          if (typeof l !== 'boolean') this.logicFail(e.op, l, e.left.span);
          if (e.op === 'e' ? !l : l) return l;
        }
        return this.binary(e, l, await this.ev(e.right, f));
      }
      default:
        return this.evalSync(e, f);
    }
  }

  private callBuiltin(e: Extract<Expr, { kind: 'call' }>, args: Value[]): Value {
    const b = BUILTINS.get(e.norm);
    if (!b) this.fail(`Função "${e.name}" não existe`, e.span);
    this.curSpan = e.span;
    const r = b.run(args, this.ctx);
    if (r === undefined) this.fail(`"${e.name}" é um procedimento e não retorna valor`, e.span);
    if (typeof r === 'number' && !Number.isFinite(r)) this.fail(`O resultado de ${e.name} não é um número válido`, e.span);
    return r;
  }

  private indexValue(target: Value, idx: Value[], e: Extract<Expr, { kind: 'index' }>): Value {
    if (!(target instanceof ArrayVal)) this.fail('Só é possível usar [ ] em vetores', e.span);
    const nums = idx.map((v, k) => this.toNum(v, e.indices[k].span, 'O índice do vetor'));
    const off = arrayOffset(target.type, nums);
    if (typeof off === 'string') this.fail(off, e.span);
    return target.data[off];
  }

  private fieldValue(target: Value, e: Extract<Expr, { kind: 'field' }>): Value {
    if (!(target instanceof RecordVal)) this.fail(`Só é possível usar ".${e.name}" em registros`, e.span);
    const v = target.fields.get(e.norm);
    if (v === undefined) this.fail(`O registro ${target.type.name} não tem o campo "${e.name}"`, e.span);
    return v;
  }

  /** The storage location an assignment/leia/var-parameter refers to. */
  private async cellOf(e: Expr, f: Frame): Promise<Cell> {
    switch (e.kind) {
      case 'var': {
        const cell = f.vars.get(e.norm) ?? this.globals.vars.get(e.norm);
        if (cell) return cell;
        if (f.consts.has(e.norm) || this.globals.consts.has(e.norm)) this.fail(`"${e.name}" é uma constante e não pode ser alterada`, e.span);
        this.fail(`Variável "${e.name}" não foi declarada`, e.span);
      }
      case 'index': {
        const base = await this.cellOf(e.target, f);
        const arr = base.get();
        if (!(arr instanceof ArrayVal)) this.fail(`"${base.name}" não é um vetor`, e.span);
        const idx: number[] = [];
        for (const i of e.indices) idx.push(this.toNum(await this.ev(i, f), i.span, 'O índice do vetor'));
        const off = arrayOffset(arr.type, idx);
        if (typeof off === 'string') this.fail(`${off} (em "${base.name}")`, e.span);
        return new ElemCell(`${base.name}[${idx.join(',')}]`, arr, off);
      }
      case 'field': {
        const base = await this.cellOf(e.target, f);
        const rec = base.get();
        if (!(rec instanceof RecordVal)) this.fail(`"${base.name}" não é um registro`, e.span);
        const field = rec.type.fields.find((x) => x.norm === e.norm);
        if (!field) this.fail(`O registro ${rec.type.name} não tem o campo "${e.name}"`, e.span);
        return new FieldCell(`${base.name}.${field.name}`, rec, field.norm, field.type);
      }
      default:
        this.fail('Esperava uma variável', e.span);
    }
  }

  private unary(e: Extract<Expr, { kind: 'unary' }>, v: Value): Value {
    if (e.op === 'nao') {
      if (typeof v !== 'boolean') this.fail(`"nao" espera um valor lógico, mas recebeu ${valueTypeName(v)}`, e.span);
      return !v;
    }
    if (typeof v !== 'number') this.fail(`O sinal "${e.op}" só pode ser usado com números`, e.span);
    return e.op === '-' ? -v : v;
  }

  private logicFail(op: string, v: Value, span: Span): never {
    this.fail(`O operador "${op}" espera valores lógicos (VERDADEIRO ou FALSO), mas recebeu ${valueTypeName(v)}`, span);
  }

  private binary(e: Extract<Expr, { kind: 'binary' }>, l: Value, r: Value): Value {
    const op = e.op;
    switch (op) {
      case '+':
        if (typeof l === 'number' && typeof r === 'number') return l + r;
        if (typeof l === 'string' && typeof r === 'string') return l + r;
        this.fail(`Não é possível somar ${valueTypeName(l)} com ${valueTypeName(r)}${typeof l === 'string' || typeof r === 'string' ? ' (para juntar texto e número, use numpcarac(...) no número)' : ''}`, e.span);
      case '-':
      case '*':
      case '/':
      case '\\':
      case 'mod':
      case '^': {
        if (typeof l !== 'number' || typeof r !== 'number') {
          this.fail(`O operador "${op === '\\' ? '\\' : op}" só pode ser usado com números, mas recebeu ${valueTypeName(l)} e ${valueTypeName(r)}`, e.span);
        }
        switch (op) {
          case '-':
            return l - r;
          case '*':
            return l * r;
          case '/':
            if (r === 0) this.fail('Divisão por zero', e.span);
            return l / r;
          case '\\':
            if (r === 0) this.fail('Divisão por zero', e.span);
            return Math.trunc(l / r);
          case 'mod':
            if (r === 0) this.fail('Divisão por zero (no mod)', e.span);
            return l % r;
          case '^': {
            const p = Math.pow(l, r);
            if (!Number.isFinite(p)) this.fail(`Resultado inválido em ${formatNumber(l)} ^ ${formatNumber(r)}`, e.span);
            return p;
          }
        }
        break;
      }
      case '=':
        return this.compare(l, r, e.span) === 0;
      case '<>':
        return this.compare(l, r, e.span) !== 0;
      case '<':
        return this.compare(l, r, e.span) < 0;
      case '>':
        return this.compare(l, r, e.span) > 0;
      case '<=':
        return this.compare(l, r, e.span) <= 0;
      case '>=':
        return this.compare(l, r, e.span) >= 0;
      case 'e':
      case 'ou':
      case 'xou':
        if (typeof l !== 'boolean') this.logicFail(op, l, e.left.span);
        if (typeof r !== 'boolean') this.logicFail(op, r, e.right.span);
        return op === 'e' ? l && r : op === 'ou' ? l || r : l !== r;
    }
    this.fail(`Operador desconhecido: ${op}`, e.span);
  }

  /** VisuAlg compares text without distinguishing upper/lower case. */
  private compare(l: Value, r: Value, span: Span): number {
    if (typeof l === 'number' && typeof r === 'number') return l < r ? -1 : l > r ? 1 : 0;
    if (typeof l === 'string' && typeof r === 'string') {
      const a = l.toUpperCase();
      const b = r.toUpperCase();
      return a < b ? -1 : a > b ? 1 : 0;
    }
    if (typeof l === 'boolean' && typeof r === 'boolean') return Number(l) - Number(r);
    this.fail(`Não é possível comparar ${valueTypeName(l)} com ${valueTypeName(r)}`, span);
  }

  private toNum(v: Value, span: Span, what: string): number {
    if (typeof v !== 'number') this.fail(`${what} deve ser um número, mas é ${valueTypeName(v)}`, span);
    return v;
  }

  private toInt(v: Value, span: Span, what: string): number {
    const n = this.toNum(v, span, what);
    if (!Number.isInteger(n)) this.fail(`${what} deve ser um número inteiro`, span);
    return n;
  }
}
