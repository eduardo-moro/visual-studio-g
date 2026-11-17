import {
  BinOp, CaseClause, ConstDecl, Expr, Param, PrimName, Program, Stmt, SubDecl, TypeDecl, TypeRef, VarDecl, WriteArg,
} from './ast';
import { Span, VisualgError } from './errors';
import { Token, tokenize } from './lexer';

/** Keywords that end a block; a statement can never start with one of them. */
const BLOCK_END = new Set([
  'fimse', 'senao', 'fimpara', 'fimenquanto', 'fimrepita', 'ate', 'caso', 'outrocaso', 'fimescolha',
  'fimprocedimento', 'fimfuncao', 'fimfun', 'fimalgoritmo', 'inicio', 'procedimento', 'funcao', 'var', 'variavel',
]);

/** Words that are never valid as a variable/procedure name. */
export const RESERVED = new Set([
  ...BLOCK_END,
  'algoritmo', 'const', 'tipo', 'registro', 'fimregistro', 'vetor', 'de', 'se', 'entao', 'escolha',
  'para', 'passo', 'faca', 'enquanto', 'repita', 'interrompa', 'retorne', 'escreva', 'escreval', 'leia',
  'e', 'ou', 'nao', 'xou', 'mod', 'div', 'verdadeiro', 'falso', 'inteiro', 'real', 'numerico', 'caractere',
  'caracter', 'literal', 'logico', 'limpatela', 'pausa', 'debug', 'timer', 'aleatorio', 'eco', 'cronometro',
  'arquivo', 'on', 'off',
]);

const PRIM_TYPES: Record<string, PrimName> = {
  inteiro: 'inteiro',
  real: 'real',
  numerico: 'real',
  caractere: 'caractere',
  caracter: 'caractere',
  caracteres: 'caractere',
  literal: 'caractere',
  logico: 'logico',
};

const REL_OPS = new Set(['=', '<>', '<', '>', '<=', '>=']);

function join(a: Span, b: Span): Span {
  return { line: a.line, col: a.col, endLine: b.endLine, endCol: b.endCol };
}

export function parse(src: string): Program {
  return new Parser(tokenize(src)).program();
}

/** A single expression (debugger watch / hover / set value). */
export function parseExpression(src: string): Expr {
  const p = new Parser(tokenize(src));
  const e = p.expr();
  p.expectEnd();
  return e;
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  // ---------- token helpers ----------

  private peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  private next(): Token {
    const t = this.peek();
    if (this.i < this.toks.length - 1) this.i++;
    return t;
  }
  private prev(): Token {
    return this.toks[Math.max(this.i - 1, 0)];
  }
  private isKw(t: Token, ...kws: string[]): boolean {
    return t.kind === 'id' && kws.includes(t.norm);
  }
  private atKw(...kws: string[]): boolean {
    return this.isKw(this.peek(), ...kws);
  }
  private eatKw(...kws: string[]): Token | undefined {
    return this.atKw(...kws) ? this.next() : undefined;
  }
  private atOp(...ops: string[]): boolean {
    const t = this.peek();
    return t.kind === 'op' && ops.includes(t.text);
  }
  private eatOp(...ops: string[]): Token | undefined {
    return this.atOp(...ops) ? this.next() : undefined;
  }
  private describe(t: Token): string {
    if (t.kind === 'eof') return 'o fim do arquivo';
    if (t.kind === 'nl') return 'o fim da linha';
    if (t.kind === 'str') return `"${t.text}"`;
    return `"${t.text}"`;
  }
  private fail(msg: string, t: Token = this.peek()): never {
    throw new VisualgError(msg, t.span);
  }
  private expectKw(kw: string, what = `"${kw}"`): Token {
    if (this.atKw(kw)) return this.next();
    this.fail(`Esperava ${what}, mas encontrou ${this.describe(this.peek())}`);
  }
  private expectOp(op: string, what = `"${op}"`): Token {
    if (this.atOp(op)) return this.next();
    this.fail(`Esperava ${what}, mas encontrou ${this.describe(this.peek())}`);
  }
  private expectId(what: string): Token {
    const t = this.peek();
    if (t.kind === 'id' && !RESERVED.has(t.norm)) return this.next();
    if (t.kind === 'id') this.fail(`"${t.text}" é uma palavra reservada e não pode ser usada como ${what}`);
    this.fail(`Esperava ${what}, mas encontrou ${this.describe(t)}`);
  }
  /** Skip blank lines and stray semicolons. */
  private skipNl(): void {
    while (this.peek().kind === 'nl' || this.atOp(';')) this.next();
  }
  /** After a statement/declaration: end of line, `;`, or a block end on the same line. */
  private endStmt(): void {
    const t = this.peek();
    if (t.kind === 'nl' || t.kind === 'eof' || this.atOp(';')) {
      this.next();
      return;
    }
    if (t.kind === 'id' && BLOCK_END.has(t.norm)) return;
    this.fail(`Esperava o fim da linha, mas encontrou ${this.describe(t)} (o VisuAlg aceita apenas um comando por linha)`);
  }
  private atLineEnd(): boolean {
    const t = this.peek();
    return t.kind === 'nl' || t.kind === 'eof' || this.atOp(';') || (t.kind === 'id' && BLOCK_END.has(t.norm));
  }
  /** `a, b, c :` — the start of a variable declaration line. */
  private atDeclLine(): boolean {
    const t = this.peek();
    if (t.kind !== 'id' || RESERVED.has(t.norm)) return false;
    let k = 1;
    while (this.peek(k).kind === 'op' && this.peek(k).text === ',' && this.peek(k + 1).kind === 'id') k += 2;
    const after = this.peek(k);
    return after.kind === 'op' && after.text === ':';
  }

  expectEnd(): void {
    this.skipNl();
    if (this.peek().kind !== 'eof') this.fail(`Esperava o fim da expressão, mas encontrou ${this.describe(this.peek())}`);
  }

  // ---------- program structure ----------

  program(): Program {
    this.skipNl();
    const start = this.peek();
    let name = '';
    if (this.eatKw('algoritmo')) {
      const t = this.peek();
      if (t.kind === 'str' || t.kind === 'id') {
        name = t.text;
        this.next();
      }
      this.endStmt();
    } else {
      this.fail('O algoritmo deve começar com: algoritmo "nome"');
    }

    const prog: Program = {
      name, consts: [], types: [], vars: [], subs: [], prelude: [], body: [],
      span: start.span, endSpan: start.span,
    };

    for (;;) {
      this.skipNl();
      const t = this.peek();
      if (this.isKw(t, 'inicio')) break;
      if (t.kind === 'eof') this.fail('Esperava "inicio" (início da seção de comandos)');
      if (this.isKw(t, 'var', 'variavel')) {
        this.next();
        this.varSection(prog.vars);
      } else if (this.isKw(t, 'const')) {
        this.next();
        this.constSection(prog.consts);
      } else if (this.isKw(t, 'tipo')) {
        this.next();
        this.typeSection(prog.types);
      } else if (this.isKw(t, 'procedimento', 'funcao')) {
        prog.subs.push(this.subprogram());
      } else if (this.isKw(t, 'arquivo', 'aleatorio', 'eco', 'timer', 'cronometro', 'dos', 'perfil', 'lista')) {
        prog.prelude.push(this.statement());
      } else if (this.atDeclLine()) {
        prog.vars.push(this.varDecl());
      } else {
        this.fail(`Comando inesperado na área de declarações: ${this.describe(t)}. Os comandos devem ficar depois de "inicio"`);
      }
    }
    this.expectKw('inicio');
    this.endStmt();
    prog.body = this.block(['fimalgoritmo']);
    const end = this.peek();
    this.expectKw('fimalgoritmo', '"fimalgoritmo" no final do algoritmo');
    prog.endSpan = end.span;
    return prog;
  }

  private varSection(into: VarDecl[]): void {
    for (;;) {
      this.skipNl();
      if (!this.atDeclLine()) return;
      into.push(this.varDecl());
    }
  }

  private varDecl(): VarDecl {
    const first = this.peek();
    const names = [this.expectId('nome de variável')];
    while (this.eatOp(',')) names.push(this.expectId('nome de variável'));
    this.expectOp(':', '":" seguido do tipo da variável');
    const type = this.typeRef();
    this.endStmt();
    return {
      names: names.map((n) => ({ name: n.text, norm: n.norm, span: n.span })),
      type,
      span: join(first.span, this.prev().span),
    };
  }

  private constSection(into: ConstDecl[]): void {
    for (;;) {
      this.skipNl();
      const t = this.peek();
      if (t.kind !== 'id' || RESERVED.has(t.norm)) return;
      // NOME = valor   (also accepts NOME <- valor and NOME: tipo = valor)
      const n1 = this.peek(1);
      if (!(n1.kind === 'op' && (n1.text === '=' || n1.text === '<-' || n1.text === ':'))) return;
      const name = this.next();
      if (this.eatOp(':')) this.typeRef();
      if (!this.eatOp('=') && !this.eatOp('<-')) this.fail('Esperava "=" seguido do valor da constante');
      const value = this.expr();
      into.push({ name: name.text, norm: name.norm, value, span: join(name.span, this.prev().span) });
      this.endStmt();
    }
  }

  private typeSection(into: TypeDecl[]): void {
    for (;;) {
      this.skipNl();
      const t = this.peek();
      if (t.kind !== 'id' || RESERVED.has(t.norm) || !(this.peek(1).kind === 'op' && this.peek(1).text === '=')) return;
      const name = this.next();
      this.next(); // '='
      const type = this.typeRef();
      into.push({ name: name.text, norm: name.norm, type, span: join(name.span, this.prev().span) });
      this.endStmt();
    }
  }

  private typeRef(): TypeRef {
    const t = this.peek();
    if (t.kind !== 'id') this.fail(`Esperava um tipo (inteiro, real, caractere, logico ou vetor), mas encontrou ${this.describe(t)}`);
    if (PRIM_TYPES[t.norm]) {
      this.next();
      return { kind: 'prim', name: PRIM_TYPES[t.norm], span: t.span };
    }
    // "matriz" is only a synonym of vetor when followed by "[" (it is a common variable name).
    if (this.isKw(t, 'vetor') || (this.isKw(t, 'matriz') && this.peek(1).kind === 'op' && this.peek(1).text === '[')) {
      this.next();
      this.expectOp('[', '"[" com os limites do vetor, por exemplo: vetor[1..10] de inteiro');
      const dims: { lo: Expr; hi: Expr }[] = [];
      do {
        const lo = this.expr();
        this.expectOp('..', '".." entre os limites do vetor, por exemplo: [1..10]');
        const hi = this.expr();
        dims.push({ lo, hi });
      } while (this.eatOp(','));
      this.expectOp(']');
      this.expectKw('de', '"de" seguido do tipo dos elementos, por exemplo: vetor[1..10] de inteiro');
      const elem = this.typeRef();
      return { kind: 'array', dims, elem, span: join(t.span, this.prev().span) };
    }
    if (this.isKw(t, 'registro')) {
      this.next();
      const fields: { names: { name: string; norm: string; span: Span }[]; type: TypeRef }[] = [];
      for (;;) {
        this.skipNl();
        if (this.atKw('fimregistro')) break;
        if (!this.atDeclLine()) this.fail('Esperava a declaração de um campo do registro (nome: tipo) ou "fimregistro"');
        const d = this.varDecl();
        fields.push({ names: d.names, type: d.type });
      }
      this.expectKw('fimregistro');
      return { kind: 'record', fields, span: join(t.span, this.prev().span) };
    }
    if (RESERVED.has(t.norm)) this.fail(`Esperava um tipo, mas encontrou ${this.describe(t)}`);
    this.next();
    return { kind: 'named', name: t.text, norm: t.norm, span: t.span };
  }

  private subprogram(): SubDecl {
    const kw = this.next();
    const kind = kw.norm === 'funcao' ? 'funcao' : 'procedimento';
    const name = this.expectId(kind === 'funcao' ? 'nome da função' : 'nome do procedimento');
    const params: Param[] = [];
    if (this.eatOp('(')) {
      while (!this.atOp(')')) {
        const byRef = !!this.eatKw('var');
        const names = [this.expectId('nome de parâmetro')];
        while (this.eatOp(',')) names.push(this.expectId('nome de parâmetro'));
        this.expectOp(':', '":" seguido do tipo do parâmetro');
        const type = this.typeRef();
        for (const n of names) params.push({ name: n.text, norm: n.norm, byRef, type, span: n.span });
        if (!this.eatOp(';') && !this.eatOp(',')) break;
      }
      this.expectOp(')');
    }
    let returnType: TypeRef | undefined;
    if (kind === 'funcao') {
      this.expectOp(':', `":" seguido do tipo de retorno da função "${name.text}"`);
      returnType = this.typeRef();
    }
    this.endStmt();
    const sub: SubDecl = {
      kind, name: name.text, norm: name.norm, params, returnType, vars: [], consts: [], body: [],
      span: join(kw.span, name.span), endSpan: kw.span,
    };
    for (;;) {
      this.skipNl();
      if (this.eatKw('var', 'variavel')) this.varSection(sub.vars);
      else if (this.eatKw('const')) this.constSection(sub.consts);
      else if (this.atDeclLine()) sub.vars.push(this.varDecl());
      else break;
    }
    this.expectKw('inicio', `"inicio" no ${kind === 'funcao' ? 'começo da função' : 'começo do procedimento'} "${name.text}"`);
    this.endStmt();
    const endKws = kind === 'funcao' ? ['fimfuncao', 'fimfun'] : ['fimprocedimento'];
    sub.body = this.block(endKws);
    const end = this.peek();
    if (!this.eatKw(...endKws)) this.fail(`Esperava "${endKws[0]}" no final de "${name.text}", mas encontrou ${this.describe(end)}`);
    sub.endSpan = end.span;
    this.endStmt();
    return sub;
  }

  // ---------- statements ----------

  private block(terminators: string[]): Stmt[] {
    const out: Stmt[] = [];
    for (;;) {
      this.skipNl();
      const t = this.peek();
      if (t.kind === 'eof') return out;
      if (t.kind === 'id' && (terminators.includes(t.norm) || BLOCK_END.has(t.norm))) return out;
      out.push(this.statement());
    }
  }

  private statement(): Stmt {
    const t = this.peek();
    if (t.kind !== 'id') this.fail(`Comando inválido: ${this.describe(t)}`);
    const s = this.statementInner(t);
    this.endStmt();
    return s;
  }

  private onOff(what: string): boolean {
    const t = this.peek();
    if (this.eatKw('on')) return true;
    if (this.eatKw('off')) return false;
    this.fail(`Esperava "on" ou "off" depois de "${what}", mas encontrou ${this.describe(t)}`);
  }

  private statementInner(t: Token): Stmt {
    switch (t.norm) {
      case 'escreva':
      case 'escreval': {
        this.next();
        const args: WriteArg[] = [];
        if (this.eatOp('(')) {
          if (!this.atOp(')')) {
            do {
              const expr = this.expr();
              const arg: WriteArg = { expr };
              if (this.eatOp(':')) {
                arg.width = this.expr();
                if (this.eatOp(':')) arg.decimals = this.expr();
              }
              args.push(arg);
            } while (this.eatOp(','));
          }
          this.expectOp(')', '")" fechando o escreva');
        }
        return { kind: 'write', newline: t.norm === 'escreval', args, span: join(t.span, this.prev().span) };
      }
      case 'leia': {
        this.next();
        this.expectOp('(', '"(" com as variáveis a ler, por exemplo: leia(x)');
        const targets: Expr[] = [];
        do targets.push(this.lvalue()); while (this.eatOp(','));
        this.expectOp(')', '")" fechando o leia');
        return { kind: 'read', targets, span: join(t.span, this.prev().span) };
      }
      case 'se': {
        this.next();
        const cond = this.expr();
        this.expectKw('entao', '"entao" depois da condição do "se"');
        const then = this.block(['senao', 'fimse']);
        let els: Stmt[] | undefined;
        if (this.eatKw('senao')) els = this.block(['fimse']);
        const end = this.peek();
        if (!this.eatKw('fimse')) this.fail(`Esperava "fimse" para fechar o "se" da linha ${t.span.line}, mas encontrou ${this.describe(end)}`);
        return { kind: 'if', cond, then, else: els, span: join(t.span, cond.span), endSpan: end.span };
      }
      case 'escolha': {
        this.next();
        const subject = this.expr();
        this.eatKw('de', 'faca');
        const span = join(t.span, subject.span);
        this.endStmt();
        const clauses: CaseClause[] = [];
        let otherwise: Stmt[] | undefined;
        for (;;) {
          this.skipNl();
          const c = this.peek();
          if (this.eatKw('caso')) {
            const items: CaseClause['items'] = [];
            do {
              const lo = this.expr();
              if (this.eatKw('ate')) items.push({ kind: 'range', lo, hi: this.expr() });
              else items.push({ kind: 'value', expr: lo });
            } while (this.eatOp(','));
            this.eatOp(':');
            const cspan = join(c.span, this.prev().span);
            clauses.push({ items, body: this.block(['caso', 'outrocaso', 'fimescolha']), span: cspan });
          } else if (this.eatKw('outrocaso')) {
            this.eatOp(':');
            otherwise = this.block(['fimescolha']);
          } else break;
        }
        const end = this.peek();
        if (!this.eatKw('fimescolha')) this.fail(`Esperava "caso", "outrocaso" ou "fimescolha" no "escolha" da linha ${t.span.line}, mas encontrou ${this.describe(end)}`);
        return { kind: 'case', subject, clauses, otherwise, span };
      }
      case 'para': {
        this.next();
        const counter = this.lvalue();
        if (!this.eatKw('de') && !this.eatOp('<-')) this.fail(`Esperava "de" depois da variável do "para", por exemplo: para i de 1 ate 10 faca`);
        const from = this.expr();
        // "to" works too: VisuAlg passes it straight to Pascal.
        if (!this.eatKw('ate', 'to')) this.fail(`Esperava "ate" no "para", por exemplo: para i de 1 ate 10 faca, mas encontrou ${this.describe(this.peek())}`);
        const to = this.expr();
        let step: Expr | undefined;
        if (this.eatKw('passo')) step = this.expr();
        this.expectKw('faca', '"faca" no final da linha do "para"');
        const span = join(t.span, this.prev().span);
        const body = this.block(['fimpara']);
        const end = this.peek();
        if (!this.eatKw('fimpara')) this.fail(`Esperava "fimpara" para fechar o "para" da linha ${t.span.line}, mas encontrou ${this.describe(end)}`);
        return { kind: 'for', counter, from, to, step, body, span, endSpan: end.span };
      }
      case 'enquanto': {
        this.next();
        const cond = this.expr();
        this.expectKw('faca', '"faca" depois da condição do "enquanto"');
        const span = join(t.span, this.prev().span);
        const body = this.block(['fimenquanto']);
        const end = this.peek();
        if (!this.eatKw('fimenquanto')) this.fail(`Esperava "fimenquanto" para fechar o "enquanto" da linha ${t.span.line}, mas encontrou ${this.describe(end)}`);
        return { kind: 'while', cond, body, span, endSpan: end.span };
      }
      case 'repita': {
        this.next();
        const body = this.block(['ate', 'fimrepita']);
        const end = this.peek();
        if (this.eatKw('ate')) {
          const until = this.expr();
          return { kind: 'repeat', body, until, span: t.span, endSpan: join(end.span, until.span) };
        }
        if (this.eatKw('fimrepita')) return { kind: 'repeat', body, span: t.span, endSpan: end.span };
        this.fail(`Esperava "ate <condição>" ou "fimrepita" para fechar o "repita" da linha ${t.span.line}, mas encontrou ${this.describe(end)}`);
      }
      case 'interrompa':
        this.next();
        return { kind: 'break', span: t.span };
      case 'retorne': {
        this.next();
        if (this.atLineEnd()) return { kind: 'return', span: t.span };
        const value = this.expr();
        return { kind: 'return', value, span: join(t.span, value.span) };
      }
      case 'limpatela':
        this.next();
        if (this.eatOp('(')) this.expectOp(')');
        return { kind: 'clear', span: t.span };
      case 'pausa':
        this.next();
        return { kind: 'pause', span: t.span };
      case 'debug': {
        this.next();
        const cond = this.expr();
        return { kind: 'debug', cond, span: join(t.span, cond.span) };
      }
      case 'timer': {
        this.next();
        if (this.eatKw('on')) return { kind: 'timer', mode: 'on', span: t.span };
        if (this.eatKw('off')) return { kind: 'timer', mode: 'off', span: t.span };
        const value = this.expr();
        return { kind: 'timer', mode: 'value', value, span: join(t.span, value.span) };
      }
      case 'aleatorio': {
        this.next();
        if (this.atLineEnd() || this.eatKw('on')) return { kind: 'random', mode: 'on', span: t.span };
        if (this.eatKw('off')) return { kind: 'random', mode: 'off', span: t.span };
        const lo = this.expr();
        const hi = this.eatOp(',') ? this.expr() : undefined;
        // Optional third value: decimal places of generated real numbers.
        const decimals = hi && this.eatOp(',') ? this.expr() : undefined;
        return { kind: 'random', mode: 'range', lo, hi, decimals, span: join(t.span, this.prev().span) };
      }
      case 'eco':
        this.next();
        return { kind: 'echo', on: this.onOff('eco'), span: t.span };
      case 'cronometro':
        this.next();
        return { kind: 'chrono', on: this.onOff('cronometro'), span: t.span };
      case 'arquivo': {
        this.next();
        const p = this.peek();
        if (p.kind !== 'str') this.fail('Esperava o nome do arquivo entre aspas, por exemplo: arquivo "dados.txt"');
        this.next();
        return { kind: 'file', path: p.text, span: join(t.span, p.span) };
      }
      case 'dos':
      case 'perfil':
      case 'lista':
        // Legacy VisuAlg directives with no effect outside its own window.
        this.next();
        while (!this.atLineEnd()) this.next();
        return { kind: 'nop', span: t.span };
    }

    if (RESERVED.has(t.norm)) this.fail(`Comando inesperado: ${this.describe(t)}`);

    const n1 = this.peek(1);
    if (n1.kind === 'op' && (n1.text === '<-' || n1.text === '[' || n1.text === '.' || n1.text === '=')) {
      const target = this.lvalue();
      if (this.atOp('=')) this.fail('Para atribuir um valor use "<-" (ou ":="), não "="');
      this.expectOp('<-', '"<-" para atribuir um valor');
      const value = this.expr();
      return { kind: 'assign', target, value, span: join(t.span, value.span) };
    }
    // Procedure call: nome   or   nome(arg1, arg2)
    this.next();
    const args: Expr[] = [];
    let hasParens = false;
    if (this.eatOp('(')) {
      hasParens = true;
      if (!this.atOp(')')) {
        do args.push(this.expr()); while (this.eatOp(','));
      }
      this.expectOp(')');
    }
    const call = { kind: 'call' as const, name: t.text, norm: t.norm, args, hasParens, span: join(t.span, this.prev().span) };
    return { kind: 'call', call, span: call.span };
  }

  private lvalue(): Expr {
    const t = this.expectId('nome de variável');
    let e: Expr = { kind: 'var', name: t.text, norm: t.norm, span: t.span };
    return this.postfix(e);
  }

  // ---------- expressions ----------

  expr(): Expr {
    return this.orExpr();
  }

  private orExpr(): Expr {
    let left = this.andExpr();
    for (;;) {
      const t = this.eatKw('ou', 'xou');
      if (!t) return left;
      const right = this.andExpr();
      left = { kind: 'binary', op: t.norm as BinOp, left, right, span: join(left.span, right.span) };
    }
  }

  private andExpr(): Expr {
    let left = this.notExpr();
    while (this.eatKw('e')) {
      const right = this.notExpr();
      left = { kind: 'binary', op: 'e', left, right, span: join(left.span, right.span) };
    }
    return left;
  }

  private notExpr(): Expr {
    const t = this.eatKw('nao');
    if (t) {
      const operand = this.notExpr();
      return { kind: 'unary', op: 'nao', operand, span: join(t.span, operand.span) };
    }
    return this.relExpr();
  }

  private relExpr(): Expr {
    const left = this.addExpr();
    const t = this.peek();
    if (t.kind === 'op' && REL_OPS.has(t.text)) {
      this.next();
      const right = this.addExpr();
      return { kind: 'binary', op: t.text as BinOp, left, right, span: join(left.span, right.span) };
    }
    return left;
  }

  private addExpr(): Expr {
    let left = this.mulExpr();
    while (this.atOp('+', '-')) {
      const op = this.next().text as BinOp;
      const right = this.mulExpr();
      left = { kind: 'binary', op, left, right, span: join(left.span, right.span) };
    }
    return left;
  }

  private mulExpr(): Expr {
    let left = this.powExpr();
    for (;;) {
      let op: BinOp;
      if (this.atOp('*', '/', '\\', '%')) {
        const t = this.next().text;
        op = (t === '%' ? 'mod' : t) as BinOp;
      } else if (this.atKw('mod', 'div')) {
        op = this.next().norm === 'mod' ? 'mod' : '\\';
      } else return left;
      const right = this.powExpr();
      left = { kind: 'binary', op, left, right, span: join(left.span, right.span) };
    }
  }

  private powExpr(): Expr {
    const base = this.unaryExpr();
    if (this.eatOp('^')) {
      const exp = this.powExpr();
      return { kind: 'binary', op: '^', left: base, right: exp, span: join(base.span, exp.span) };
    }
    return base;
  }

  private unaryExpr(): Expr {
    if (this.atOp('-', '+')) {
      const t = this.next();
      const operand = this.unaryExpr();
      if (operand.kind === 'num' && t.text === '-') return { ...operand, value: -operand.value, span: join(t.span, operand.span) };
      return { kind: 'unary', op: t.text as '-' | '+', operand, span: join(t.span, operand.span) };
    }
    return this.postfix(this.primary());
  }

  private postfix(e: Expr): Expr {
    for (;;) {
      if (this.eatOp('[')) {
        const indices = [this.expr()];
        while (this.eatOp(',')) indices.push(this.expr());
        this.expectOp(']', '"]" fechando o índice');
        e = { kind: 'index', target: e, indices, span: join(e.span, this.prev().span) };
      } else if (this.atOp('.') && this.peek(1).kind === 'id') {
        this.next();
        const f = this.next();
        e = { kind: 'field', target: e, name: f.text, norm: f.norm, span: join(e.span, f.span) };
      } else return e;
    }
  }

  private primary(): Expr {
    const t = this.peek();
    if (t.kind === 'num') {
      this.next();
      return { kind: 'num', value: t.value!, isReal: !!t.isReal, span: t.span };
    }
    if (t.kind === 'str') {
      this.next();
      return { kind: 'str', value: t.text, span: t.span };
    }
    if (this.eatOp('(')) {
      const e = this.expr();
      this.expectOp(')', '")" fechando o parêntese');
      return e;
    }
    if (t.kind === 'id') {
      if (t.norm === 'verdadeiro' || t.norm === 'falso') {
        this.next();
        return { kind: 'bool', value: t.norm === 'verdadeiro', span: t.span };
      }
      const isCallable = !RESERVED.has(t.norm) || ((t.norm === 'div' || t.norm === 'mod') && this.peek(1).kind === 'op' && this.peek(1).text === '(');
      if (!isCallable) this.fail(`Esperava um valor ou expressão, mas encontrou ${this.describe(t)}`);
      this.next();
      if (this.eatOp('(')) {
        const args: Expr[] = [];
        if (!this.atOp(')')) {
          do args.push(this.expr()); while (this.eatOp(','));
        }
        this.expectOp(')', `")" fechando a chamada de "${t.text}"`);
        return { kind: 'call', name: t.text, norm: t.norm, args, hasParens: true, span: join(t.span, this.prev().span) };
      }
      return { kind: 'var', name: t.text, norm: t.norm, span: t.span };
    }
    this.fail(`Esperava um valor ou expressão, mas encontrou ${this.describe(t)}`);
  }
}
