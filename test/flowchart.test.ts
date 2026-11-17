import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFlowcharts } from '../src/editor/flowchart';
import { parse } from '../src/lang/parser';
import { prog } from './helpers';

const edges = (code: string) => code.split('\n').filter((l) => l.includes('-->')).map((l) => l.trim());

describe('flowchart', () => {
  it('main program: start, read, decision with both branches, end', () => {
    const [main] = buildFlowcharts(parse(prog('x: inteiro', 'leia(x)\nse x > 0 entao\nescreval("positivo")\nsenao\nescreval("não positivo")\nfimse')));
    assert.equal(main.title, 'algoritmo "teste"');
    const code = main.code;
    assert.match(code, /^flowchart TD/);
    assert.match(code, /n1\(\["Início"\]\)/);
    assert.match(code, /n2\[\/"Leia x"\/\]/);
    assert.match(code, /n3\{"x #gt; 0\?"\}/);
    assert.match(code, /n4\[\\"Escreval #quot;positivo#quot;"\\\]/);
    assert.deepEqual(edges(code), [
      'n1 --> n0',
      'n0 --> n2',
      'n2 --> n3',
      'n3 -->|"Sim"| n4',
      'n3 -->|"Não"| n5',
      'n4 --> n6',
      'n5 --> n6',
    ]);
    assert.match(code, /n6\(\["Fim"\]\)/);
  });

  it('para loop: init, test, body, increment back to the test', () => {
    const [main] = buildFlowcharts(parse(prog('i: inteiro', 'para i de 1 ate 3 faca\nescreva(i)\nfimpara')));
    assert.match(main.code, /n2\["i ← 1"\]/);
    assert.match(main.code, /n3\{"i ≤ 3\?"\}/);
    assert.match(main.code, /n5\["i ← i \+ 1"\]/);
    assert.deepEqual(edges(main.code), ['n1 --> n0', 'n0 --> n2', 'n2 --> n3', 'n3 -->|"Sim"| n4', 'n4 --> n5', 'n5 --> n3', 'n3 -->|"Não"| n6']);
    // The test node is the one highlighted for the "para" line.
    assert.equal(main.lineNodes[6], 'n3');
  });

  it('negative passo tests with ≥', () => {
    const [main] = buildFlowcharts(parse(prog('i: inteiro', 'para i de 3 ate 1 passo -1 faca\nescreva(i)\nfimpara')));
    assert.match(main.code, /"i ≥ 1\?"/);
    assert.match(main.code, /"i ← i - 1"/);
  });

  it('repita..ate loops back to the first block; interrompa leaves the loop', () => {
    const src = prog('j: inteiro', 'repita\nj <- j + 1\nse j = 5 entao\ninterrompa\nfimse\nate j > 9\nescreva(j)');
    const [main] = buildFlowcharts(parse(src));
    const e = edges(main.code);
    // n2: j <- j+1, n3: j = 5?, n4: j > 9?, n5: escreva
    assert.ok(e.includes('n4 -->|"Não"| n2'), e.join('\n'));
    assert.ok(e.includes('n4 -->|"Sim"| n5'));
    assert.ok(e.includes('n3 -->|"Sim"| n5'), 'interrompa goes after the loop');
  });

  it('escolha becomes a chain of decisions', () => {
    const [main] = buildFlowcharts(parse(prog('n: inteiro', 'escolha n\ncaso 1, 2\nescreva("a")\ncaso 5 ate 7\nescreva("b")\noutrocaso\nescreva("c")\nfimescolha')));
    assert.match(main.code, /"n = 1 ou n = 2\?"/);
    assert.match(main.code, /"5 ≤ n ≤ 7\?"/);
    const e = edges(main.code);
    assert.ok(e.includes('n2 -->|"Não"| n4'));
    assert.ok(e.includes('n4 -->|"Não"| n6'));
  });

  it('one diagram per subprogram; retorne goes to Fim; calls use the subroutine shape', () => {
    const subs = 'funcao fat(n: inteiro): inteiro\ninicio\nse n <= 1 entao\nretorne 1\nfimse\nretorne n * fat(n - 1)\nfimfuncao';
    const charts = buildFlowcharts(parse(prog('r: inteiro', 'r <- fat(5)\nfat2', `${subs}\nprocedimento fat2\ninicio\nescreva(1)\nfimprocedimento`)));
    assert.deepEqual(charts.map((c) => c.title), ['algoritmo "teste"', 'funcao fat', 'procedimento fat2']);
    assert.match(charts[0].code, /\[\["fat2"\]\]/);
    const fat = charts[1].code;
    assert.match(fat, /"Início: fat\(n\)"/);
    assert.match(fat, /"n ≤ 1\?"/);
    assert.match(fat, /"Retorne n \* fat\(n - 1\)"/);
    const e = edges(fat);
    assert.ok(e.includes('s0_3 --> s0_5') && e.includes('s0_4 --> s0_5'), e.join('\n'));
  });

  it('every node maps back to a line', () => {
    const [main] = buildFlowcharts(parse(prog('i: inteiro', 'i <- 1\nenquanto i < 3 faca\ni <- i + 1\nfimenquanto')));
    assert.deepEqual(main.nodeLines, { n1: 1, n0: 3, n2: 6, n3: 7, n4: 8, n5: 10 });
  });

  it('declarations block after Início: const, tipo and var; locals in subprograms', () => {
    const src = [
      'algoritmo "d"',
      'const',
      'MAX = 10',
      'tipo',
      't = registro',
      'nome: caractere',
      'fimregistro',
      'var',
      'v: vetor[1..MAX] de inteiro',
      'a, b: real',
      'r: t',
      'procedimento p',
      'var k: inteiro',
      'inicio',
      'k <- 1',
      'fimprocedimento',
      'procedimento semvars',
      'inicio',
      'escreva(1)',
      'fimprocedimento',
      'inicio',
      'p',
      'fimalgoritmo',
    ].join('\n');
    const [main, p, semvars] = buildFlowcharts(parse(src));
    assert.match(main.code, /n0\{\{"const MAX = 10<br>tipo t = registro \(nome\)<br>v: vetor\[1\.\.MAX\] de inteiro<br>a, b: real<br>r: t"\}\}/);
    assert.ok(edges(main.code).includes('n1 --> n0') && edges(main.code).includes('n0 --> n2'));
    assert.equal(main.nodeLines.n0, 3); // "MAX = 10", the first declaration
    assert.match(p.code, /s0_0\{\{"k: inteiro"\}\}/);
    assert.doesNotMatch(semvars.code, /\{\{/);
  });
});
