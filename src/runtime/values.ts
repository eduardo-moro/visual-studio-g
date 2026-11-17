import { TypeSpec, typeToString } from '../lang/ast';

export type ArrayType = Extract<TypeSpec, { kind: 'array' }>;
export type RecordType = Extract<TypeSpec, { kind: 'record' }>;

export class ArrayVal {
  constructor(public readonly type: ArrayType, public readonly data: Value[]) {}
}

export class RecordVal {
  constructor(public readonly type: RecordType, public readonly fields: Map<string, Value>) {}
}

export type Value = number | string | boolean | ArrayVal | RecordVal;

export function defaultValue(t: TypeSpec): Value {
  switch (t.kind) {
    case 'prim':
      return t.name === 'caractere' ? '' : t.name === 'logico' ? false : 0;
    case 'array': {
      const n = t.dims.reduce((acc, d) => acc * (d.hi - d.lo + 1), 1);
      const data = new Array<Value>(n);
      for (let i = 0; i < n; i++) data[i] = defaultValue(t.elem);
      return new ArrayVal(t, data);
    }
    case 'record':
      return new RecordVal(t, new Map(t.fields.map((f) => [f.norm, defaultValue(f.type)])));
  }
}

/** VisuAlg assigns vectors and records by copy. */
export function cloneValue(v: Value): Value {
  if (v instanceof ArrayVal) return new ArrayVal(v.type, v.data.map(cloneValue));
  if (v instanceof RecordVal) return new RecordVal(v.type, new Map([...v.fields].map(([k, x]) => [k, cloneValue(x)])));
  return v;
}

/** Type name of a runtime value, for error messages. */
export function valueTypeName(v: Value): string {
  if (typeof v === 'number') return Number.isInteger(v) ? 'inteiro' : 'real';
  if (typeof v === 'string') return 'caractere';
  if (typeof v === 'boolean') return 'logico';
  if (v instanceof ArrayVal) return 'vetor';
  return v.type.name;
}

export function sameShape(a: TypeSpec, b: TypeSpec): boolean {
  return typeToString(a) === typeToString(b);
}

/**
 * Real numbers the way Delphi's FloatToStr prints them (VisuAlg is a Delphi program):
 * up to 15 significant digits, no trailing zeros, "." as decimal separator.
 */
export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return 'NAN';
  if (!Number.isFinite(n)) return n > 0 ? 'INF' : '-INF';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1e15 || abs < 1e-4) {
    let [mant, exp] = n.toExponential(14).split('e');
    if (mant.includes('.')) mant = mant.replace(/0+$/, '').replace(/\.$/, '');
    const e = Number(exp);
    return `${mant}E${e < 0 ? '-' : ''}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  let s = n.toPrecision(15);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

export function formatBool(b: boolean): string {
  return b ? 'VERDADEIRO' : 'FALSO';
}

/** How a value looks in the variables panel. */
export function displayValue(v: Value): string {
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'boolean') return formatBool(v);
  if (v instanceof ArrayVal) return typeToString(v.type);
  return `registro ${v.type.name}`;
}

/** Flat offset of an index tuple, or a message describing the bounds violation. */
export function arrayOffset(t: ArrayType, idx: number[]): number | string {
  if (idx.length !== t.dims.length) {
    return `O vetor tem ${t.dims.length} dimens${t.dims.length === 1 ? 'ão' : 'ões'}, mas foram usados ${idx.length} índice${idx.length === 1 ? '' : 's'}`;
  }
  let off = 0;
  for (let k = 0; k < idx.length; k++) {
    const { lo, hi } = t.dims[k];
    const i = idx[k];
    if (!Number.isInteger(i)) return `Índice de vetor deve ser inteiro, mas foi ${formatNumber(i)}`;
    if (i < lo || i > hi) return `Índice ${i} fora dos limites do vetor [${t.dims.map((d) => `${d.lo}..${d.hi}`).join(',')}]`;
    off = off * (hi - lo + 1) + (i - lo);
  }
  return off;
}

/** Index tuple for a flat offset (inverse of arrayOffset). */
export function arrayIndices(t: ArrayType, off: number): number[] {
  const out: number[] = [];
  for (let k = t.dims.length - 1; k >= 0; k--) {
    const size = t.dims[k].hi - t.dims[k].lo + 1;
    out.unshift(t.dims[k].lo + (off % size));
    off = Math.floor(off / size);
  }
  return out;
}
