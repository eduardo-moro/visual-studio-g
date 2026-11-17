import { formatNumber, Value } from './values';

export interface BuiltinCtx {
  random(): number;
  fail(msg: string): never;
  /** Terminal side effects for the procedures (mudacor, posicionar). */
  setColor(fg?: string, bg?: string): void;
  write(s: string): void;
}

export interface Builtin {
  name: string;
  /** Signature shown in hover/completion. */
  sig: string;
  doc: string;
  min: number;
  max: number;
  /** true for procedures (no return value), e.g. mudacor. */
  proc?: boolean;
  run(args: Value[], ctx: BuiltinCtx): Value | void;
}

function num(v: Value, fn: string, ctx: BuiltinCtx): number {
  if (typeof v !== 'number') ctx.fail(`A função ${fn} espera um valor numérico`);
  return v;
}
function int(v: Value, fn: string, ctx: BuiltinCtx): number {
  const n = num(v, fn, ctx);
  if (!Number.isInteger(n)) ctx.fail(`A função ${fn} espera um valor inteiro, mas recebeu ${formatNumber(n)}`);
  return n;
}
function str(v: Value, fn: string, ctx: BuiltinCtx): string {
  if (typeof v !== 'string') ctx.fail(`A função ${fn} espera um valor do tipo caractere`);
  return v;
}

const DEG = Math.PI / 180;

/** VisuAlg's color names for mudacor. */
export const COLORS: Record<string, string> = {
  preto: 'black', vermelho: 'red', verde: 'green', amarelo: 'yellow', azul: 'blue',
  magenta: 'magenta', roxo: 'magenta', ciano: 'cyan', branco: 'white', cinza: 'gray',
};

const list: Builtin[] = [
  // ----- numéricas -----
  { name: 'abs', sig: 'abs(x): real', doc: 'Valor absoluto de x.', min: 1, max: 1, run: ([x], c) => Math.abs(num(x, 'abs', c)) },
  { name: 'arccos', sig: 'arccos(x): real', doc: 'Ângulo (em radianos) cujo cosseno é x.', min: 1, max: 1, run: ([x], c) => Math.acos(num(x, 'arccos', c)) },
  { name: 'arcsen', sig: 'arcsen(x): real', doc: 'Ângulo (em radianos) cujo seno é x.', min: 1, max: 1, run: ([x], c) => Math.asin(num(x, 'arcsen', c)) },
  { name: 'arctan', sig: 'arctan(x): real', doc: 'Ângulo (em radianos) cuja tangente é x.', min: 1, max: 1, run: ([x], c) => Math.atan(num(x, 'arctan', c)) },
  { name: 'cos', sig: 'cos(x): real', doc: 'Cosseno do ângulo x (em radianos).', min: 1, max: 1, run: ([x], c) => Math.cos(num(x, 'cos', c)) },
  { name: 'cotan', sig: 'cotan(x): real', doc: 'Cotangente do ângulo x (em radianos).', min: 1, max: 1, run: ([x], c) => 1 / Math.tan(num(x, 'cotan', c)) },
  {
    name: 'exp', sig: 'exp(base, expoente): real', doc: 'base elevado a expoente (com um só argumento: e elevado a x).', min: 1, max: 2,
    run: (a, c) => (a.length === 1 ? Math.exp(num(a[0], 'exp', c)) : Math.pow(num(a[0], 'exp', c), num(a[1], 'exp', c))),
  },
  { name: 'grauprad', sig: 'grauprad(graus): real', doc: 'Converte graus para radianos.', min: 1, max: 1, run: ([x], c) => num(x, 'grauprad', c) * DEG },
  { name: 'radpgrau', sig: 'radpgrau(radianos): real', doc: 'Converte radianos para graus.', min: 1, max: 1, run: ([x], c) => num(x, 'radpgrau', c) / DEG },
  { name: 'int', sig: 'int(x): inteiro', doc: 'Parte inteira de x (sem arredondar).', min: 1, max: 1, run: ([x], c) => Math.trunc(num(x, 'int', c)) },
  {
    name: 'log', sig: 'log(x): real', doc: 'Logaritmo de x na base 10.', min: 1, max: 1,
    run: ([x], c) => {
      const n = num(x, 'log', c);
      if (n <= 0) c.fail('Logaritmo de número menor ou igual a zero');
      return Math.log10(n);
    },
  },
  {
    name: 'logn', sig: 'logn(x): real', doc: 'Logaritmo natural (neperiano, base e) de x.', min: 1, max: 1,
    run: ([x], c) => {
      const n = num(x, 'logn', c);
      if (n <= 0) c.fail('Logaritmo de número menor ou igual a zero');
      return Math.log(n);
    },
  },
  { name: 'pi', sig: 'pi: real', doc: 'O valor de π (3.14159265358979).', min: 0, max: 0, run: () => Math.PI },
  { name: 'pot', sig: 'pot(base, expoente): real', doc: 'base elevado a expoente.', min: 2, max: 2, run: ([b, e], c) => Math.pow(num(b, 'pot', c), num(e, 'pot', c)) },
  { name: 'quad', sig: 'quad(x): real', doc: 'Quadrado de x.', min: 1, max: 1, run: ([x], c) => num(x, 'quad', c) ** 2 },
  {
    name: 'raizq', sig: 'raizq(x): real', doc: 'Raiz quadrada de x.', min: 1, max: 1,
    run: ([x], c) => {
      const n = num(x, 'raizq', c);
      if (n < 0) c.fail(`Raiz quadrada de número negativo (${formatNumber(n)})`);
      return Math.sqrt(n);
    },
  },
  { name: 'rand', sig: 'rand: real', doc: 'Número real aleatório, maior ou igual a 0 e menor que 1.', min: 0, max: 0, run: (_a, c) => c.random() },
  {
    name: 'randi', sig: 'randi(limite): inteiro', doc: 'Número inteiro aleatório, maior ou igual a 0 e menor que limite.', min: 1, max: 1,
    run: ([x], c) => Math.floor(c.random() * Math.trunc(num(x, 'randi', c))),
  },
  { name: 'sen', sig: 'sen(x): real', doc: 'Seno do ângulo x (em radianos).', min: 1, max: 1, run: ([x], c) => Math.sin(num(x, 'sen', c)) },
  { name: 'tan', sig: 'tan(x): real', doc: 'Tangente do ângulo x (em radianos).', min: 1, max: 1, run: ([x], c) => Math.tan(num(x, 'tan', c)) },
  {
    name: 'div', sig: 'div(a, b): inteiro', doc: 'Divisão inteira de a por b (o mesmo que a \\ b).', min: 2, max: 2,
    run: ([a, b], c) => {
      const d = num(b, 'div', c);
      if (d === 0) c.fail('Divisão por zero');
      return Math.trunc(num(a, 'div', c) / d);
    },
  },
  {
    name: 'mod', sig: 'mod(a, b): inteiro', doc: 'Resto da divisão inteira de a por b (o mesmo que a mod b).', min: 2, max: 2,
    run: ([a, b], c) => {
      const d = num(b, 'mod', c);
      if (d === 0) c.fail('Divisão por zero');
      return num(a, 'mod', c) % d;
    },
  },

  // ----- caracteres -----
  {
    name: 'asc', sig: 'asc(s: caractere): inteiro', doc: 'Código ASCII do primeiro caractere de s.', min: 1, max: 1,
    run: ([s], c) => {
      const t = str(s, 'asc', c);
      return t.length ? t.charCodeAt(0) : 0;
    },
  },
  { name: 'carac', sig: 'carac(codigo: inteiro): caractere', doc: 'Caractere cujo código ASCII é codigo.', min: 1, max: 1, run: ([n], c) => String.fromCharCode(int(n, 'carac', c)) },
  {
    name: 'caracpnum', sig: 'caracpnum(s: caractere): real', doc: 'Converte o texto s em número (inteiro ou real).', min: 1, max: 1,
    run: ([s], c) => {
      const t = str(s, 'caracpnum', c).trim().replace(',', '.');
      const n = Number(t);
      if (t === '' || !Number.isFinite(n)) c.fail(`Não foi possível converter "${s}" em número`);
      return n;
    },
  },
  { name: 'compr', sig: 'compr(s: caractere): inteiro', doc: 'Comprimento (quantidade de caracteres) de s.', min: 1, max: 1, run: ([s], c) => str(s, 'compr', c).length },
  {
    name: 'copia', sig: 'copia(s: caractere; inicio, quantidade: inteiro): caractere', doc: 'Parte de s com quantidade caracteres a partir da posição inicio (a primeira posição é 1).', min: 3, max: 3,
    run: ([s, p, n], c) => {
      const t = str(s, 'copia', c);
      const start = Math.max(Math.trunc(num(p, 'copia', c)), 1);
      const len = Math.max(Math.trunc(num(n, 'copia', c)), 0);
      return t.substr(start - 1, len);
    },
  },
  { name: 'maiusc', sig: 'maiusc(s: caractere): caractere', doc: 's convertido para maiúsculas.', min: 1, max: 1, run: ([s], c) => str(s, 'maiusc', c).toUpperCase() },
  { name: 'minusc', sig: 'minusc(s: caractere): caractere', doc: 's convertido para minúsculas.', min: 1, max: 1, run: ([s], c) => str(s, 'minusc', c).toLowerCase() },
  { name: 'numpcarac', sig: 'numpcarac(n): caractere', doc: 'Converte o número n em texto.', min: 1, max: 1, run: ([n], c) => formatNumber(num(n, 'numpcarac', c)) },
  {
    name: 'numpcaraczero', sig: 'numpcaraczero(n, tamanho: inteiro): caractere', doc: 'Converte n em texto com zeros à esquerda até ter tamanho caracteres.', min: 2, max: 2,
    run: ([n, w], c) => {
      const v = num(n, 'numpcaraczero', c);
      const s = formatNumber(Math.abs(v)).padStart(Math.trunc(num(w, 'numpcaraczero', c)) - (v < 0 ? 1 : 0), '0');
      return v < 0 ? `-${s}` : s;
    },
  },
  {
    name: 'pos', sig: 'pos(sub, s: caractere): inteiro', doc: 'Posição em que sub aparece em s (0 se não aparece).', min: 2, max: 2,
    run: ([sub, s], c) => str(s, 'pos', c).indexOf(str(sub, 'pos', c)) + 1,
  },
  { name: 'esquerda', sig: 'esquerda(s: caractere; n: inteiro): caractere', doc: 'Os n primeiros caracteres de s.', min: 2, max: 2, run: ([s, n], c) => str(s, 'esquerda', c).slice(0, Math.max(0, int(n, 'esquerda', c))) },
  {
    name: 'direita', sig: 'direita(s: caractere; n: inteiro): caractere', doc: 'Os n últimos caracteres de s.', min: 2, max: 2,
    run: ([s, n], c) => {
      const t = str(s, 'direita', c);
      const k = Math.max(0, int(n, 'direita', c));
      return k === 0 ? '' : t.slice(-k);
    },
  },
  { name: 'etrim', sig: 'etrim(s: caractere): caractere', doc: 's sem os espaços à esquerda.', min: 1, max: 1, run: ([s], c) => str(s, 'etrim', c).trimStart() },
  { name: 'dtrim', sig: 'dtrim(s: caractere): caractere', doc: 's sem os espaços à direita.', min: 1, max: 1, run: ([s], c) => str(s, 'dtrim', c).trimEnd() },
  { name: 'replicar', sig: 'replicar(s: caractere; n: inteiro): caractere', doc: 's repetido n vezes.', min: 2, max: 2, run: ([s, n], c) => str(s, 'replicar', c).repeat(Math.max(0, int(n, 'replicar', c))) },

  // ----- procedimentos de tela -----
  {
    name: 'mudacor', sig: 'mudacor(cor, posicao: caractere)', proc: true, min: 2, max: 2,
    doc: 'Muda a cor do texto ("FRENTE") ou do fundo ("FUNDO"). Cores: "AMARELO", "AZUL", "BRANCO", "PRETO", "VERDE", "VERMELHO".',
    run: ([cor, posicao], c) => {
      const color = COLORS[str(cor, 'mudacor', c).toLowerCase()];
      if (!color) c.fail(`Cor desconhecida: "${cor}"`);
      const where = str(posicao, 'mudacor', c).toLowerCase();
      if (where.startsWith('fundo')) c.setColor(undefined, color);
      else c.setColor(color, undefined);
    },
  },
  {
    name: 'posicionar', sig: 'posicionar(linha, coluna: inteiro)', proc: true, min: 2, max: 2,
    doc: 'Move o cursor da tela para a linha e coluna indicadas.',
    run: ([l, col], c) => c.write(`\x1b[${int(l, 'posicionar', c)};${int(col, 'posicionar', c)}H`),
  },
];

export const BUILTINS = new Map(list.map((b) => [b.name, b]));
