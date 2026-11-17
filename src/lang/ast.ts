import { Span } from './errors';

// ---------- Types ----------

export type PrimName = 'inteiro' | 'real' | 'caractere' | 'logico';

export type TypeSpec =
  | { kind: 'prim'; name: PrimName }
  | { kind: 'array'; dims: { lo: number; hi: number }[]; elem: TypeSpec }
  | { kind: 'record'; name: string; fields: { name: string; norm: string; type: TypeSpec }[] };

export function typeToString(t: TypeSpec): string {
  switch (t.kind) {
    case 'prim':
      return t.name;
    case 'array':
      return `vetor[${t.dims.map((d) => `${d.lo}..${d.hi}`).join(',')}] de ${typeToString(t.elem)}`;
    case 'record':
      return t.name;
  }
}

/** Type as written, resolved once constants and `tipo` declarations are known. */
export type TypeRef =
  | { kind: 'prim'; name: PrimName; span: Span }
  | { kind: 'named'; name: string; norm: string; span: Span }
  | { kind: 'array'; dims: { lo: Expr; hi: Expr }[]; elem: TypeRef; span: Span }
  | { kind: 'record'; fields: { names: { name: string; norm: string; span: Span }[]; type: TypeRef }[]; span: Span };

// ---------- Expressions ----------

export type Expr =
  | { kind: 'num'; value: number; isReal: boolean; span: Span }
  | { kind: 'str'; value: string; span: Span }
  | { kind: 'bool'; value: boolean; span: Span }
  | { kind: 'var'; name: string; norm: string; span: Span }
  | { kind: 'index'; target: Expr; indices: Expr[]; span: Span }
  | { kind: 'field'; target: Expr; name: string; norm: string; span: Span }
  | { kind: 'call'; name: string; norm: string; args: Expr[]; span: Span; hasParens: boolean }
  | { kind: 'unary'; op: '-' | '+' | 'nao'; operand: Expr; span: Span }
  | { kind: 'binary'; op: BinOp; left: Expr; right: Expr; span: Span };

export type BinOp = '+' | '-' | '*' | '/' | '\\' | 'mod' | '^' | '=' | '<>' | '<' | '>' | '<=' | '>=' | 'e' | 'ou' | 'xou';

// ---------- Statements ----------

export interface WriteArg {
  expr: Expr;
  width?: Expr;
  decimals?: Expr;
}

export interface CaseClause {
  items: ({ kind: 'value'; expr: Expr } | { kind: 'range'; lo: Expr; hi: Expr })[];
  body: Stmt[];
  span: Span;
}

export type Stmt =
  | { kind: 'assign'; target: Expr; value: Expr; span: Span }
  | { kind: 'call'; call: Extract<Expr, { kind: 'call' }>; span: Span }
  | { kind: 'write'; newline: boolean; args: WriteArg[]; span: Span }
  | { kind: 'read'; targets: Expr[]; span: Span }
  | { kind: 'if'; cond: Expr; then: Stmt[]; else?: Stmt[]; span: Span; endSpan: Span }
  | { kind: 'case'; subject: Expr; clauses: CaseClause[]; otherwise?: Stmt[]; span: Span }
  | { kind: 'for'; counter: Expr; from: Expr; to: Expr; step?: Expr; body: Stmt[]; span: Span; endSpan: Span }
  | { kind: 'while'; cond: Expr; body: Stmt[]; span: Span; endSpan: Span }
  | { kind: 'repeat'; body: Stmt[]; until?: Expr; span: Span; endSpan: Span }
  | { kind: 'break'; span: Span }
  | { kind: 'return'; value?: Expr; span: Span }
  | { kind: 'clear'; span: Span }
  | { kind: 'pause'; span: Span }
  | { kind: 'debug'; cond: Expr; span: Span }
  | { kind: 'timer'; mode: 'on' | 'off' | 'value'; value?: Expr; span: Span }
  | { kind: 'random'; mode: 'on' | 'off' | 'range'; lo?: Expr; hi?: Expr; decimals?: Expr; span: Span }
  | { kind: 'echo'; on: boolean; span: Span }
  | { kind: 'chrono'; on: boolean; span: Span }
  | { kind: 'file'; path: string; span: Span }
  | { kind: 'nop'; span: Span };

// ---------- Declarations ----------

export interface VarDecl {
  names: { name: string; norm: string; span: Span }[];
  type: TypeRef;
  span: Span;
}

export interface ConstDecl {
  name: string;
  norm: string;
  value: Expr;
  span: Span;
}

export interface TypeDecl {
  name: string;
  norm: string;
  type: TypeRef;
  span: Span;
}

export interface Param {
  name: string;
  norm: string;
  byRef: boolean;
  type: TypeRef;
  span: Span;
}

export interface SubDecl {
  kind: 'procedimento' | 'funcao';
  name: string;
  norm: string;
  params: Param[];
  returnType?: TypeRef;
  vars: VarDecl[];
  consts: ConstDecl[];
  body: Stmt[];
  span: Span;
  endSpan: Span;
}

export interface Program {
  name: string;
  consts: ConstDecl[];
  types: TypeDecl[];
  vars: VarDecl[];
  subs: SubDecl[];
  /** Statements written in the declarations area (arquivo, aleatorio, eco, ...), run before `inicio`. */
  prelude: Stmt[];
  body: Stmt[];
  span: Span;
  endSpan: Span;
}
