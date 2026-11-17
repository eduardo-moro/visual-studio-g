import { ConstDecl, Expr, Program, Stmt, SubDecl, TypeDecl, VarDecl } from '../lang/ast';
import { exprToString, typeRefToString } from '../lang/print';

/** One flowchart per routine: the main algorithm and each procedimento/funcao. */
export interface FlowDiagram {
  title: string;
  /** Mermaid source. */
  code: string;
  /** Lines covered by this routine (to pick the diagram for a running line). */
  startLine: number;
  endLine: number;
  /** Node id -> source line (click a block to go to its line). */
  nodeLines: Record<string, number>;
  /** Source line -> the node that represents it (highlighted while it runs). */
  lineNodes: Record<number, string>;
}

type Shape = 'terminal' | 'process' | 'decision' | 'input' | 'output' | 'call' | 'decl';
type Out = { from: string; label?: string }[];

interface Ctx {
  /** Pending edges of `interrompa`, one list per enclosing loop. */
  breaks: Out[];
  /** Pending edges of `retorne` (go to Fim). */
  returns: Out;
}

const SHAPES: Record<Shape, [string, string]> = {
  terminal: ['(["', '"])'],
  process: ['["', '"]'],
  decision: ['{"', '"}'],
  input: ['[/"', '"/]'],
  output: ['[\\"', '"\\]'],
  call: ['[["', '"]]'],
  decl: ['{{"', '"}}'],
};

const CLASSES: Record<Shape, string> = {
  terminal: 'fill:#2e7d3233,stroke:#43a047,stroke-width:2px',
  process: 'fill:#1e88e522,stroke:#1e88e5',
  decision: 'fill:#f5b80033,stroke:#f5b800,stroke-width:2px',
  input: 'fill:#8e24aa22,stroke:#ab47bc',
  output: 'fill:#00897b22,stroke:#26a69a',
  call: 'fill:#e6510022,stroke:#fb8c00',
  decl: 'fill:#78909c22,stroke:#90a4ae',
};

/** Mermaid label text: entities for characters that would break the syntax. */
function esc(s: string): string {
  return s.replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');
}

const x = (e: Expr) => exprToString(e);

function negativeLiteral(e: Expr | undefined): number | undefined {
  if (e?.kind === 'num' && e.value < 0) return -e.value;
  if (e?.kind === 'unary' && e.op === '-' && e.operand.kind === 'num') return e.operand.value;
  return undefined;
}

class Builder {
  private readonly lines: string[] = [];
  private readonly byShape: Record<Shape, string[]> = { terminal: [], process: [], decision: [], input: [], output: [], call: [], decl: [] };
  private n = 0;
  readonly nodeLines: Record<string, number> = {};
  readonly lineNodes: Record<number, string> = {};

  constructor(private readonly prefix: string) {}

  /** Creates a node; `primary` marks it as the one to highlight for its line. */
  node(shape: Shape, text: string, line: number, primary = true): string {
    const id = `${this.prefix}${++this.n}`;
    const [open, close] = SHAPES[shape];
    this.lines.push(`  ${id}${open}${esc(text)}${close}`);
    this.byShape[shape].push(id);
    this.nodeLines[id] = line;
    if (primary && !(line in this.lineNodes)) this.lineNodes[line] = id;
    return id;
  }

  /** The declarations block (one line per declaration). Its own id, so it does not shift the numbering. */
  declarations(lines: string[], line: number): string {
    const id = `${this.prefix}0`;
    const [open, close] = SHAPES.decl;
    this.lines.push(`  ${id}${open}${lines.map(esc).join('<br>')}${close}`);
    this.byShape.decl.push(id);
    this.nodeLines[id] = line;
    return id;
  }

  link(out: Out, to: string): void {
    for (const o of out) this.lines.push(`  ${o.from} -->${o.label ? `|"${o.label}"|` : ''} ${to}`);
  }

  get count(): number {
    return this.n;
  }

  idAt(k: number): string {
    return `${this.prefix}${k}`;
  }

  block(stmts: Stmt[], incoming: Out, ctx: Ctx): Out {
    let cur = incoming;
    for (const s of stmts) cur = this.stmt(s, cur, ctx);
    return cur;
  }

  private simple(shape: Shape, text: string, s: Stmt, incoming: Out): Out {
    const id = this.node(shape, text, s.span.line);
    this.link(incoming, id);
    return [{ from: id }];
  }

  stmt(s: Stmt, inc: Out, ctx: Ctx): Out {
    switch (s.kind) {
      case 'assign':
        return this.simple('process', `${x(s.target)} ← ${x(s.value)}`, s, inc);
      case 'read':
        return this.simple('input', `Leia ${s.targets.map(x).join(', ')}`, s, inc);
      case 'write': {
        const args = s.args.map((a) => x(a.expr) + (a.width ? `:${x(a.width)}` : '') + (a.decimals ? `:${x(a.decimals)}` : ''));
        const kw = s.newline ? 'Escreval' : 'Escreva';
        return this.simple('output', args.length ? `${kw} ${args.join(', ')}` : `${kw} (pula linha)`, s, inc);
      }
      case 'call':
        return this.simple('call', x(s.call), s, inc);
      case 'if': {
        const d = this.node('decision', `${x(s.cond)}?`, s.span.line);
        this.link(inc, d);
        const yes = this.block(s.then, [{ from: d, label: 'Sim' }], ctx);
        const no = s.else ? this.block(s.else, [{ from: d, label: 'Não' }], ctx) : [{ from: d, label: 'Não' }];
        return [...yes, ...no];
      }
      case 'case': {
        const subject = x(s.subject);
        let prev = inc;
        const out: Out = [];
        for (const c of s.clauses) {
          const label = c.items
            .map((it) => (it.kind === 'value' ? `${subject} = ${x(it.expr)}` : `${x(it.lo)} ≤ ${subject} ≤ ${x(it.hi)}`))
            .join(' ou ');
          const d = this.node('decision', `${label}?`, c.span.line);
          this.link(prev, d);
          out.push(...this.block(c.body, [{ from: d, label: 'Sim' }], ctx));
          prev = [{ from: d, label: 'Não' }];
        }
        out.push(...(s.otherwise ? this.block(s.otherwise, prev, ctx) : prev));
        return out;
      }
      case 'for': {
        const i = x(s.counter);
        const neg = negativeLiteral(s.step);
        const init = this.node('process', `${i} ← ${x(s.from)}`, s.span.line, false);
        this.link(inc, init);
        const d = this.node('decision', `${i} ${neg !== undefined ? '≥' : '≤'} ${x(s.to)}?`, s.span.line);
        this.link([{ from: init }], d);
        ctx.breaks.push([]);
        const body = this.block(s.body, [{ from: d, label: 'Sim' }], ctx);
        const stepText = neg !== undefined ? `- ${neg}` : `+ ${s.step ? x(s.step) : '1'}`;
        const step = this.node('process', `${i} ← ${i} ${stepText}`, s.span.line, false);
        this.link(body, step);
        this.link([{ from: step }], d);
        return [{ from: d, label: 'Não' }, ...ctx.breaks.pop()!];
      }
      case 'while': {
        const d = this.node('decision', `${x(s.cond)}?`, s.span.line);
        this.link(inc, d);
        ctx.breaks.push([]);
        this.link(this.block(s.body, [{ from: d, label: 'Sim' }], ctx), d);
        return [{ from: d, label: 'Não' }, ...ctx.breaks.pop()!];
      }
      case 'repeat': {
        const before = this.count;
        ctx.breaks.push([]);
        const body = this.block(s.body, inc, ctx);
        const first = this.count > before ? this.idAt(before + 1) : undefined;
        const breaks = ctx.breaks.pop()!;
        if (s.until) {
          const d = this.node('decision', `${x(s.until)}?`, s.endSpan.line);
          this.link(body, d);
          this.link([{ from: d, label: 'Não' }], first ?? d);
          return [{ from: d, label: 'Sim' }, ...breaks];
        }
        if (first) this.link(body, first);
        return breaks;
      }
      case 'break':
        (ctx.breaks.length ? ctx.breaks[ctx.breaks.length - 1] : ctx.returns).push(...inc);
        return [];
      case 'return':
        if (s.value) {
          const id = this.node('process', `Retorne ${x(s.value)}`, s.span.line);
          this.link(inc, id);
          ctx.returns.push({ from: id });
        } else ctx.returns.push(...inc);
        return [];
      case 'clear':
        return this.simple('process', 'Limpa a tela', s, inc);
      case 'pause':
        return this.simple('process', 'Pausa', s, inc);
      case 'debug':
        return this.simple('process', `Pausa se ${x(s.cond)}`, s, inc);
      case 'timer':
        return this.simple('process', `timer ${s.mode === 'value' ? x(s.value!) : s.mode}`, s, inc);
      case 'random':
        return this.simple('process', s.mode === 'range' ? `aleatorio ${[s.lo, s.hi, s.decimals].filter(Boolean).map((e) => x(e!)).join(', ')}` : `aleatorio ${s.mode}`, s, inc);
      case 'echo':
        return this.simple('process', `eco ${s.on ? 'on' : 'off'}`, s, inc);
      case 'chrono':
        return this.simple('process', `cronometro ${s.on ? 'on' : 'off'}`, s, inc);
      case 'file':
        return this.simple('input', `Arquivo "${s.path}"`, s, inc);
      case 'nop':
        return inc;
    }
  }

  routine(startText: string, startLine: number, stmts: Stmt[], endLine: number, decls?: { lines: string[]; line: number }): string {
    const ctx: Ctx = { breaks: [], returns: [] };
    const start = this.node('terminal', startText, startLine);
    let first: Out = [{ from: start }];
    if (decls?.lines.length) {
      const d = this.declarations(decls.lines, decls.line);
      this.link(first, d);
      first = [{ from: d }];
    }
    const out = this.block(stmts, first, ctx);
    const end = this.node('terminal', 'Fim', endLine);
    this.link(out, end);
    this.link(ctx.returns, end);
    const classes = (Object.keys(CLASSES) as Shape[])
      .filter((k) => this.byShape[k].length)
      // "vg" prefix: names like "call" or "end" are Mermaid keywords.
      .flatMap((k) => [`  classDef vg${k} ${CLASSES[k]}`, `  class ${this.byShape[k].join(',')} vg${k}`]);
    return ['flowchart TD', ...this.lines, ...classes].join('\n');
  }
}

/** Text of the declarations block: constants, types and variables, in the order VisuAlg lists them. */
function declarationLines(consts: ConstDecl[], types: TypeDecl[], vars: VarDecl[]): { lines: string[]; line: number } | undefined {
  const lines = [
    ...consts.map((c) => `const ${c.name} = ${exprToString(c.value)}`),
    ...types.map((t) => `tipo ${t.name} = ${typeRefToString(t.type)}`),
    ...vars.map((v) => `${v.names.map((n) => n.name).join(', ')}: ${typeRefToString(v.type)}`),
  ];
  const spans = [...consts, ...types, ...vars].map((d) => d.span.line);
  return lines.length ? { lines, line: Math.min(...spans) } : undefined;
}

function subSignature(s: SubDecl): string {
  return `${s.name}(${s.params.map((p) => (p.byRef ? `var ${p.name}` : p.name)).join(', ')})`;
}

export function buildFlowcharts(p: Program): FlowDiagram[] {
  const out: FlowDiagram[] = [];
  const main = new Builder('n');
  out.push({
    title: `algoritmo "${p.name}"`,
    code: main.routine('Início', p.span.line, [...p.prelude, ...p.body], p.endSpan.line, declarationLines(p.consts, p.types, p.vars)),
    startLine: p.span.line,
    endLine: p.endSpan.line,
    nodeLines: main.nodeLines,
    lineNodes: main.lineNodes,
  });
  p.subs.forEach((s, k) => {
    const b = new Builder(`s${k}_`);
    out.push({
      title: `${s.kind} ${s.name}`,
      code: b.routine(`Início: ${subSignature(s)}`, s.span.line, s.body, s.endSpan.line, declarationLines(s.consts, [], s.vars)),
      startLine: s.span.line,
      endLine: s.endSpan.line,
      nodeLines: b.nodeLines,
      lineNodes: b.lineNodes,
    });
  });
  return out;
}
