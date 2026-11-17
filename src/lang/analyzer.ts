import { BUILTINS } from '../runtime/builtins';
import { Value } from '../runtime/values';
import { ConstDecl, Expr, Program, Stmt, SubDecl, TypeRef, TypeSpec, VarDecl } from './ast';
import { Span, VisualgError } from './errors';

export interface VarInfo {
  name: string;
  norm: string;
  type: TypeSpec;
  span: Span;
}

export interface ConstInfo {
  name: string;
  value: Value;
  span: Span;
}

export interface ParamInfo extends VarInfo {
  byRef: boolean;
}

export interface SubInfo {
  decl: SubDecl;
  params: ParamInfo[];
  returnType?: TypeSpec;
  locals: VarInfo[];
  consts: Map<string, ConstInfo>;
}

export interface Analysis {
  program: Program;
  consts: Map<string, ConstInfo>;
  types: Map<string, TypeSpec>;
  globals: VarInfo[];
  subs: Map<string, SubInfo>;
}

interface Scope {
  vars: Map<string, TypeSpec>;
  consts: Map<string, ConstInfo>;
  sub?: SubInfo;
  loops: number;
}

/** Resolves declarations and checks names/arity. Collects every error instead of stopping at the first. */
export function analyze(program: Program): { analysis: Analysis; errors: VisualgError[] } {
  const errors: VisualgError[] = [];
  const err = (msg: string, span: Span) => errors.push(new VisualgError(msg, span));

  const consts = new Map<string, ConstInfo>();
  const types = new Map<string, TypeSpec>();
  const analysis: Analysis = { program, consts, types, globals: [], subs: new Map() };

  const evalConst = (e: Expr, scopeConsts: Map<string, ConstInfo>): Value | undefined => {
    switch (e.kind) {
      case 'num':
        return e.value;
      case 'str':
        return e.value;
      case 'bool':
        return e.value;
      case 'var': {
        const c = scopeConsts.get(e.norm) ?? consts.get(e.norm);
        if (!c) {
          err(`"${e.name}" não é uma constante (aqui só são aceitos valores fixos ou constantes declaradas em "const")`, e.span);
          return undefined;
        }
        return c.value;
      }
      case 'unary': {
        const v = evalConst(e.operand, scopeConsts);
        if (v === undefined) return undefined;
        if (e.op === 'nao' && typeof v === 'boolean') return !v;
        if (typeof v === 'number') return e.op === '-' ? -v : v;
        break;
      }
      case 'binary': {
        const l = evalConst(e.left, scopeConsts);
        const r = evalConst(e.right, scopeConsts);
        if (l === undefined || r === undefined) return undefined;
        if (typeof l === 'number' && typeof r === 'number') {
          switch (e.op) {
            case '+': return l + r;
            case '-': return l - r;
            case '*': return l * r;
            case '/': return l / r;
            case '\\': return Math.trunc(l / r);
            case 'mod': return l % r;
            case '^': return l ** r;
          }
        }
        if (typeof l === 'string' && typeof r === 'string' && e.op === '+') return l + r;
        break;
      }
    }
    err('Esperava um valor constante', e.span);
    return undefined;
  };

  const resolveType = (t: TypeRef, scopeConsts: Map<string, ConstInfo>, recordName = 'registro'): TypeSpec | undefined => {
    switch (t.kind) {
      case 'prim':
        return { kind: 'prim', name: t.name };
      case 'named': {
        const found = types.get(t.norm);
        if (!found) err(`Tipo desconhecido: "${t.name}"`, t.span);
        return found;
      }
      case 'array': {
        const dims: { lo: number; hi: number }[] = [];
        for (const d of t.dims) {
          const lo = evalConst(d.lo, scopeConsts);
          const hi = evalConst(d.hi, scopeConsts);
          if (lo === undefined || hi === undefined) return undefined;
          if (typeof lo !== 'number' || typeof hi !== 'number' || !Number.isInteger(lo) || !Number.isInteger(hi)) {
            err('Os limites do vetor devem ser números inteiros', d.lo.span);
            return undefined;
          }
          if (hi < lo) {
            err(`O limite final do vetor (${hi}) deve ser maior ou igual ao inicial (${lo})`, d.hi.span);
            return undefined;
          }
          dims.push({ lo, hi });
        }
        const elem = resolveType(t.elem, scopeConsts);
        return elem && { kind: 'array', dims, elem };
      }
      case 'record': {
        const fields: { name: string; norm: string; type: TypeSpec }[] = [];
        for (const f of t.fields) {
          const ft = resolveType(f.type, scopeConsts);
          if (!ft) return undefined;
          for (const n of f.names) {
            if (fields.some((x) => x.norm === n.norm)) err(`Campo "${n.name}" declarado mais de uma vez`, n.span);
            fields.push({ name: n.name, norm: n.norm, type: ft });
          }
        }
        return { kind: 'record', name: recordName, fields };
      }
    }
  };

  const declareConsts = (list: ConstDecl[], into: Map<string, ConstInfo>) => {
    for (const c of list) {
      if (into.has(c.norm)) err(`Constante "${c.name}" declarada mais de uma vez`, c.span);
      const v = evalConst(c.value, into);
      if (v !== undefined) into.set(c.norm, { name: c.name, value: v, span: c.span });
    }
  };

  const declareVars = (list: VarDecl[], scopeConsts: Map<string, ConstInfo>, into: VarInfo[], taken: Set<string>) => {
    for (const d of list) {
      const t = resolveType(d.type, scopeConsts);
      for (const n of d.names) {
        if (taken.has(n.norm)) err(`"${n.name}" já foi declarado`, n.span);
        taken.add(n.norm);
        if (t) into.push({ name: n.name, norm: n.norm, type: t, span: n.span });
      }
    }
  };

  // ----- global declarations -----
  declareConsts(program.consts, consts);
  for (const td of program.types) {
    if (types.has(td.norm)) err(`Tipo "${td.name}" declarado mais de uma vez`, td.span);
    const t = resolveType(td.type, consts, td.name);
    if (t) types.set(td.norm, t);
  }
  const globalNames = new Set<string>([...consts.keys()]);
  declareVars(program.vars, consts, analysis.globals, globalNames);

  for (const sd of program.subs) {
    // A user subprogram may reuse a built-in's name (esquerda, replicar, ...): the user's one wins.
    if (analysis.subs.has(sd.norm)) err(`"${sd.name}" já foi declarado`, sd.span);
    const subConsts = new Map<string, ConstInfo>();
    declareConsts(sd.consts, subConsts);
    const params: ParamInfo[] = [];
    const taken = new Set<string>();
    for (const p of sd.params) {
      const t = resolveType(p.type, subConsts);
      if (taken.has(p.norm)) err(`Parâmetro "${p.name}" declarado mais de uma vez`, p.span);
      taken.add(p.norm);
      if (t) params.push({ name: p.name, norm: p.norm, type: t, span: p.span, byRef: p.byRef });
    }
    const locals: VarInfo[] = [];
    declareVars(sd.vars, subConsts, locals, taken);
    const returnType = sd.returnType ? resolveType(sd.returnType, subConsts) : undefined;
    analysis.subs.set(sd.norm, { decl: sd, params, returnType, locals, consts: subConsts });
  }

  // ----- name checking in statements -----
  const globalScope: Scope = { vars: new Map(analysis.globals.map((g) => [g.norm, g.type])), consts, loops: 0 };

  const lookupVar = (norm: string, s: Scope): TypeSpec | undefined => s.vars.get(norm) ?? (s !== globalScope ? globalScope.vars.get(norm) : undefined);
  const lookupConst = (norm: string, s: Scope): ConstInfo | undefined => s.consts.get(norm) ?? consts.get(norm);

  const checkArity = (name: string, got: number, min: number, max: number, span: Span) => {
    if (got < min || got > max) {
      const exp = min === max ? `${min}` : `de ${min} a ${max}`;
      err(`"${name}" espera ${exp} argumento${max === 1 ? '' : 's'}, mas recebeu ${got}`, span);
    }
  };

  const checkCall = (name: string, norm: string, args: Expr[], span: Span, s: Scope, asStatement: boolean) => {
    for (const a of args) checkExpr(a, s);
    const sub = analysis.subs.get(norm);
    if (sub) {
      checkArity(name, args.length, sub.decl.params.length, sub.decl.params.length, span);
      if (!asStatement && sub.decl.kind === 'procedimento') err(`"${name}" é um procedimento e não retorna valor`, span);
      sub.decl.params.forEach((p, i) => {
        if (p.byRef && args[i] && !isLValue(args[i])) err(`O parâmetro "${p.name}" de "${name}" é por referência (var): passe uma variável, não um valor`, args[i].span);
      });
      return;
    }
    const b = BUILTINS.get(norm);
    if (b) {
      checkArity(name, args.length, b.min, b.max, span);
      if (asStatement && !b.proc) err(`"${name}" é uma função: use o seu resultado, por exemplo: x <- ${b.name}(...)`, span);
      if (!asStatement && b.proc) err(`"${name}" é um procedimento e não retorna valor`, span);
      return;
    }
    if (lookupVar(norm, s) || lookupConst(norm, s)) {
      err(`"${name}" é uma variável, não ${asStatement ? 'um procedimento' : 'uma função'}`, span);
      return;
    }
    err(asStatement ? `Procedimento "${name}" não foi declarado` : `Função "${name}" não existe`, span);
  };

  const checkExpr = (e: Expr, s: Scope): void => {
    switch (e.kind) {
      case 'var':
        if (lookupVar(e.norm, s) || lookupConst(e.norm, s)) return;
        if (analysis.subs.has(e.norm) || BUILTINS.has(e.norm)) {
          checkCall(e.name, e.norm, [], e.span, s, false);
          return;
        }
        err(`Variável "${e.name}" não foi declarada`, e.span);
        return;
      case 'index':
        checkExpr(e.target, s);
        e.indices.forEach((i) => checkExpr(i, s));
        return;
      case 'field':
        checkExpr(e.target, s);
        return;
      case 'call':
        checkCall(e.name, e.norm, e.args, e.span, s, false);
        return;
      case 'unary':
        checkExpr(e.operand, s);
        return;
      case 'binary':
        checkExpr(e.left, s);
        checkExpr(e.right, s);
        return;
    }
  };

  const isLValue = (e: Expr): boolean => e.kind === 'var' || e.kind === 'index' || e.kind === 'field';

  const checkTarget = (e: Expr, s: Scope) => {
    let root = e;
    while (root.kind === 'index' || root.kind === 'field') root = root.target;
    if (root.kind !== 'var') {
      err('Esperava uma variável', e.span);
      return;
    }
    if (!lookupVar(root.norm, s)) {
      if (lookupConst(root.norm, s)) err(`"${root.name}" é uma constante e não pode ser alterada`, root.span);
      else if (analysis.subs.has(root.norm)) err(`"${root.name}" é ${analysis.subs.get(root.norm)!.decl.kind === 'funcao' ? 'uma função' : 'um procedimento'}, não uma variável (para devolver o valor de uma função use "retorne")`, root.span);
      else err(`Variável "${root.name}" não foi declarada`, root.span);
      return;
    }
    checkExpr(e, s);
  };

  const checkBlock = (stmts: Stmt[], s: Scope) => stmts.forEach((st) => checkStmt(st, s));

  const checkStmt = (st: Stmt, s: Scope): void => {
    switch (st.kind) {
      case 'assign':
        checkTarget(st.target, s);
        checkExpr(st.value, s);
        return;
      case 'call':
        checkCall(st.call.name, st.call.norm, st.call.args, st.call.span, s, true);
        return;
      case 'write':
        for (const a of st.args) {
          checkExpr(a.expr, s);
          if (a.width) checkExpr(a.width, s);
          if (a.decimals) checkExpr(a.decimals, s);
        }
        return;
      case 'read':
        st.targets.forEach((t) => checkTarget(t, s));
        return;
      case 'if':
        checkExpr(st.cond, s);
        checkBlock(st.then, s);
        if (st.else) checkBlock(st.else, s);
        return;
      case 'case':
        checkExpr(st.subject, s);
        for (const c of st.clauses) {
          for (const it of c.items) {
            if (it.kind === 'value') checkExpr(it.expr, s);
            else {
              checkExpr(it.lo, s);
              checkExpr(it.hi, s);
            }
          }
          checkBlock(c.body, s);
        }
        if (st.otherwise) checkBlock(st.otherwise, s);
        return;
      case 'for':
        checkTarget(st.counter, s);
        checkExpr(st.from, s);
        checkExpr(st.to, s);
        if (st.step) checkExpr(st.step, s);
        s.loops++;
        checkBlock(st.body, s);
        s.loops--;
        return;
      case 'while':
        checkExpr(st.cond, s);
        s.loops++;
        checkBlock(st.body, s);
        s.loops--;
        return;
      case 'repeat':
        s.loops++;
        checkBlock(st.body, s);
        s.loops--;
        if (st.until) checkExpr(st.until, s);
        return;
      case 'break':
        // Outside a loop, interrompa leaves the procedure/function (VisuAlg maps it to Pascal's Exit).
        return;
      case 'return':
        if (s.sub?.decl.kind === 'funcao' && !st.value) err(`"retorne" na função "${s.sub.decl.name}" precisa de um valor, por exemplo: retorne x`, st.span);
        if (s.sub?.decl.kind !== 'funcao' && st.value) err('"retorne" com valor só pode ser usado dentro de uma função', st.span);
        if (st.value) checkExpr(st.value, s);
        return;
      case 'debug':
        checkExpr(st.cond, s);
        return;
      case 'timer':
        if (st.value) checkExpr(st.value, s);
        return;
      case 'random':
        if (st.lo) checkExpr(st.lo, s);
        if (st.hi) checkExpr(st.hi, s);
        if (st.decimals) checkExpr(st.decimals, s);
        return;
      default:
        return;
    }
  };

  checkBlock(program.prelude, globalScope);
  checkBlock(program.body, globalScope);
  for (const sub of analysis.subs.values()) {
    const scope: Scope = {
      vars: new Map([...sub.params, ...sub.locals].map((v) => [v.norm, v.type])),
      consts: sub.consts,
      sub,
      loops: 0,
    };
    checkBlock(sub.decl.body, scope);
  }

  return { analysis, errors };
}
