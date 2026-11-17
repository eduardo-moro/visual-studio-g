import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prog, run } from './helpers';

async function out(src: string, inputs: string[] = []): Promise<string> {
  const r = await run(src, inputs);
  if (r.error) assert.fail(`linha ${r.error.span.line}: ${r.error.message}`);
  return r.out;
}

async function errorOf(src: string, inputs: string[] = []): Promise<string> {
  const r = await run(src, inputs);
  assert.ok(r.error, `esperava erro, saída: ${JSON.stringify(r.out)}`);
  return r.error.message;
}

describe('escreva', () => {
  it('puts a space before numbers and logicals, not before text', async () => {
    assert.equal(await out(prog('x: real\ny: inteiro', 'x <- 2.5\ny <- 6\nescreval("x", x, y+3)\nescreval(VERDADEIRO, "!")')), 'x 2.5 9\n VERDADEIRO!\n');
  });
  it('formats width and decimals like Pascal', async () => {
    assert.equal(await out(prog('x: real\ny: inteiro', 'x <- 2.5\ny <- 6\nescreval("x", x:4:1, y+3:4)\nescreval(3.14159:0:2, "|", "ab":4, "|")')), 'x 2.5   9\n3.14|  ab|\n');
  });
  it('prints reals like Delphi FloatToStr', async () => {
    assert.equal(await out(prog('', 'escreval(10/3)\nescreval(10/2)\nescreval(0.1 + 0.2)\nescreval(-7/2)')), ' 3.33333333333333\n 5\n 0.3\n -3.5\n');
  });
  it('escreval with no arguments just breaks the line', async () => {
    assert.equal(await out(prog('', 'escreva("a")\nescreval\nescreval()\nescreva("b")')), 'a\n\nb');
  });
});

describe('expressions', () => {
  it('arithmetic operators and precedence', async () => {
    const o = await out(prog('', 'escreval(2 + 3 * 4, (2 + 3) * 4, 7 \\ 2, 7 div 2, 7 mod 3, 7 % 3, 2 ^ 10, -2 ^ 2, 2 ^ 3 ^ 2)'));
    assert.equal(o, ' 14 20 3 3 1 1 1024 4 512\n');
  });
  it('logical operators bind looser than comparisons', async () => {
    const o = await out(prog('a, b: inteiro', 'a <- 5\nb <- 1\nescreval(a > 1 e b < 2, a > 9 ou b = 1, nao a = 5, VERDADEIRO xou VERDADEIRO)'));
    assert.equal(o, ' VERDADEIRO VERDADEIRO FALSO FALSO\n');
  });
  it('compares text without case', async () => {
    assert.equal(await out(prog('', 'escreval("ABC" = "abc", "a" < "B", "casa" <> "CASA")')), ' VERDADEIRO VERDADEIRO FALSO\n');
  });
  it('concatenates text with +', async () => {
    assert.equal(await out(prog('s: caractere', 's <- "Rio "\nescreval(s + "de Janeiro")')), 'Rio de Janeiro\n');
  });
  it('keywords ignore case and accents', async () => {
    const src = 'ALGORITMO "x"\nVAR i: INTEIRO\nINÍCIO\nPARA i DE 1 ATÉ 3 FAÇA\nSE i = 2 ENTÃO\nESCREVA("dois")\nSENÃO\nESCREVA(i)\nFIMSE\nFIMPARA\nFIMALGORITMO';
    assert.equal(await out(src), ' 1dois 3');
  });
  it('accepts := and the <- arrow', async () => {
    assert.equal(await out(prog('a, b: inteiro', 'a := 3\nb <- a + 1\nescreva(a, b)')), ' 3 4');
  });
});

describe('control flow', () => {
  it('para with passo, including negative, and the counter after the loop', async () => {
    assert.equal(await out(prog('i: inteiro', 'para i de 1 ate 10 passo 3 faca\nescreva(i)\nfimpara\nescreval\npara i de 3 ate 1 passo -1 faca\nescreva(i)\nfimpara\nescreval\npara i de 5 ate 1 faca\nescreva("nunca")\nfimpara\nescreva(i)')), ' 1 4 7 10\n 3 2 1\n 5');
  });
  it('enquanto, repita..ate and repita..fimrepita with interrompa', async () => {
    const o = await out(prog('j: inteiro', 'j <- 1\nenquanto j <= 3 faca\nescreva(j)\nj <- j + 1\nfimenquanto\nrepita\nj <- j - 1\nate j = 0\nescreva(j)\nrepita\nj <- j + 1\nse j = 4 entao\ninterrompa\nfimse\nfimrepita\nescreva(j)'));
    assert.equal(o, ' 1 2 3 0 4');
  });
  it('escolha with lists, ranges and outrocaso', async () => {
    const src = prog('nota: inteiro', 'leia(nota)\nescolha nota\ncaso 0,1,2,3\nescreva("R")\ncaso 5 ate 7, 4\nescreva("F")\ncaso 8 ate 10\nescreva("A")\noutrocaso\nescreva("?")\nfimescolha');
    const results = [];
    for (const n of ['2', '4', '6', '10', '11']) results.push(await out(src, [n]));
    assert.deepEqual(results, ['R', 'F', 'F', 'A', '?']);
  });
  it('escolha on text is case-insensitive', async () => {
    assert.equal(await out(prog('t: caractere', 't <- "vasco"\nescolha t\ncaso "Flamengo", "Vasco"\nescreva("carioca")\nfimescolha')), 'carioca');
  });
  it('interrompa outside a loop leaves the procedure', async () => {
    assert.equal(await out(prog('', 'p\nescreva("depois")', 'procedimento p\ninicio\nescreva("antes ")\ninterrompa\nescreva("nunca")\nfimprocedimento')), 'antes depois');
  });
});

describe('subprogramas', () => {
  it('recursive function', async () => {
    const subs = 'funcao fat(v: inteiro): inteiro\ninicio\nse v <= 1 entao\nretorne 1\nfimse\nretorne v * fat(v - 1)\nfimfuncao';
    assert.equal(await out(prog('', 'escreva(fat(10))', subs)), ' 3628800');
  });
  it('var parameters change the caller variable, value parameters do not', async () => {
    const subs = 'procedimento troca(var a, b: inteiro; c: inteiro)\nvar t: inteiro\ninicio\nt <- a\na <- b\nb <- t\nc <- 99\nfimprocedimento';
    assert.equal(await out(prog('x, y, z: inteiro', 'x <- 1\ny <- 2\nz <- 3\ntroca(x, y, z)\nescreva(x, y, z)', subs)), ' 2 1 3');
  });
  it('var parameter bound to a vector element', async () => {
    const subs = 'procedimento dobra(var n: inteiro)\ninicio\nn <- n * 2\nfimprocedimento';
    assert.equal(await out(prog('v: vetor[1..3] de inteiro', 'v[2] <- 21\ndobra(v[2])\nescreva(v[2])', subs)), ' 42');
  });
  it('procedure called without parentheses and function without arguments', async () => {
    const subs = 'procedimento ola\ninicio\nescreva("ola")\nfimprocedimento\nfuncao cinco: inteiro\ninicio\nretorne 5\nfimfuncao';
    assert.equal(await out(prog('', 'ola\nola()\nescreva(cinco + 1)', subs)), 'olaola 6');
  });
  it('locals shadow globals', async () => {
    const subs = 'procedimento p\nvar x: inteiro\ninicio\nx <- 7\nescreva(x)\nfimprocedimento';
    assert.equal(await out(prog('x: inteiro', 'x <- 1\np\nescreva(x)', subs)), ' 7 1');
  });
  it('a user procedure can reuse a built-in name', async () => {
    const subs = 'funcao replicar(c: caractere; n: inteiro): caractere\ninicio\nretorne "meu"\nfimfuncao';
    assert.equal(await out(prog('', 'escreva(replicar("x", 3))', subs)), 'meu');
  });
});

describe('vetores, registros, constantes', () => {
  it('2D vector with custom bounds', async () => {
    assert.equal(await out(prog('m: vetor[0..2, 5..6] de inteiro\ni, j: inteiro', 'para i de 0 ate 2 faca\npara j de 5 ate 6 faca\nm[i, j] <- i * 10 + j\nfimpara\nfimpara\nescreva(m[0,5], m[2,6])')), ' 5 26');
  });
  it('vector assignment copies', async () => {
    assert.equal(await out(prog('a, b: vetor[1..2] de inteiro', 'a[1] <- 1\nb <- a\nb[1] <- 9\nescreva(a[1], b[1])')), ' 1 9');
  });
  it('const and tipo registro', async () => {
    const src = 'algoritmo "r"\nconst\nMAX = 2\ntipo\ntaluno = registro\nnome: caractere\nnota: real\nfimregistro\nvar\nt: vetor[1..MAX] de taluno\ntmp: taluno\ninicio\nt[1].nome <- "Ana"\nt[2].nome <- "Bia"\ntmp <- t[1]\nt[1] <- t[2]\nt[2] <- tmp\nescreva(t[1].nome, t[2].nome, MAX)\nfimalgoritmo';
    assert.equal(await out(src), 'BiaAna 2');
  });
  it('variable named Matriz is allowed', async () => {
    assert.equal(await out(prog('Matriz: vetor[1..2] de inteiro', 'Matriz[1] <- 3\nescreva(Matriz[1])')), ' 3');
  });
});

describe('funções do VisuAlg', () => {
  it('numeric functions', async () => {
    const o = await out(prog('', 'escreval(abs(-3), int(7.9), raizq(16), quad(3), exp(2, 10), pot(2, 3), log(1000))'));
    assert.equal(o, ' 3 7 4 9 1024 8 3\n');
  });
  it('string functions', async () => {
    const o = await out(prog('', 'escreval(compr("Brasil"), "|", copia("Brasil", 2, 3), "|", maiusc("ab"), "|", pos("sil", "Brasil"), "|", asc("B"), "|", carac(65), "|", numpcarac(3+3) + "2", "|", caracpnum("2.5") * 2)'));
    assert.equal(o, ' 6|ras|AB| 4| 66|A|62| 5\n');
  });
  it('randi stays in range', async () => {
    const o = await out(prog('i, r: inteiro\nok: logico', 'ok <- VERDADEIRO\npara i de 1 ate 200 faca\nr <- randi(10)\nse (r < 0) ou (r >= 10) entao\nok <- FALSO\nfimse\nfimpara\nescreva(ok)'));
    assert.equal(o, ' VERDADEIRO');
  });
});

describe('leia', () => {
  it('reads each type and re-asks on invalid input', async () => {
    const o = await out(prog('i: inteiro\nr: real\ns: caractere\nl: logico', 'leia(i, r, s, l)\nescreva(i, r, s, l)'), ['abc', '7', '2,5', 'meu nome', 'v']);
    assert.equal(o, 'Valor inválido para o tipo inteiro (um número inteiro, sem casas decimais). Digite novamente:  7 2.5meu nome VERDADEIRO');
  });
  it('aleatorio fills leia and echoes the values', async () => {
    const o = await out(prog('x: inteiro\nn: caractere', 'aleatorio 5, 5\nleia(x)\nleia(n)\naleatorio off\nescreva(x, compr(n))'));
    assert.match(o, /^5\n[A-Z]{5}\n 5 5$/);
  });
  it('stops cleanly when input ends', async () => {
    const r = await run(prog('x: inteiro', 'leia(x)\nescreva("nunca")'), []);
    assert.equal(r.status, 'parado');
    assert.equal(r.out, '');
  });
});

describe('erros', () => {
  it('syntax errors point at the line', async () => {
    const r = await run('algoritmo "x"\ninicio\nse 1 = 1\nescreva(1)\nfimse\nfimalgoritmo');
    assert.equal(r.error?.span.line, 3);
    assert.match(r.error!.message, /entao/);
  });
  it('undeclared variable', async () => {
    assert.match(await errorOf(prog('', 'x <- 1')), /Variável "x" não foi declarada/);
  });
  it('index out of bounds', async () => {
    assert.match(await errorOf(prog('v: vetor[1..3] de inteiro', 'v[4] <- 1')), /Índice 4 fora dos limites/);
  });
  it('division by zero', async () => {
    assert.match(await errorOf(prog('a: inteiro', 'a <- 0\nescreva(1 / a)')), /Divisão por zero/);
  });
  it('real into inteiro', async () => {
    assert.match(await errorOf(prog('a: inteiro', 'a <- 7 / 2')), /real 3.5 em "a"/);
  });
  it('wrong argument count', async () => {
    assert.match(await errorOf(prog('', 'escreva(copia("a"))')), /espera 3 argumentos/);
  });
  it('mixing text and number', async () => {
    assert.match(await errorOf(prog('', 'escreva("a" + 1)')), /numpcarac/);
  });
  it('run-time errors carry the line number', async () => {
    const r = await run(prog('v: vetor[1..2] de inteiro\ni: inteiro', 'para i de 1 ate 3 faca\nv[i] <- i\nfimpara'));
    // algoritmo, var, v, i, (subs), inicio, para, v[i] <- i  -> line 8
    assert.equal(r.error?.span.line, 8);
  });
});
