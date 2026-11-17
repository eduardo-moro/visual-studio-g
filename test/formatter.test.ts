import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatSource } from '../src/editor/formatter';

describe('formatter', () => {
  it('indents sections and nested blocks', () => {
    const src = [
      'algoritmo "x"',
      '// comentario',
      'var',
      'i: inteiro',
      'tipo',
      't = registro',
      'a: inteiro',
      'fimregistro',
      'procedimento p(var n: inteiro)',
      'var k: inteiro',
      'inicio',
      'n <- 1',
      'fimprocedimento',
      'inicio',
      'para i de 1 ate 3 faca',
      'se i = 2 entao',
      'escreva("dois") // dois',
      'senao',
      'escreva(i)',
      'fimse',
      'fimpara',
      'escolha i',
      'caso 1',
      'escreva("um")',
      'outrocaso',
      'repita',
      'i <- i + 1',
      'ate i > 5',
      'fimescolha',
      'se i = 1 entao escreva("a") fimse',
      'escreva("fim")',
      'fimalgoritmo',
    ].join('\n');
    const expected = [
      'algoritmo "x"',
      '// comentario',
      'var',
      '   i: inteiro',
      'tipo',
      '   t = registro',
      '      a: inteiro',
      '   fimregistro',
      'procedimento p(var n: inteiro)',
      'var k: inteiro',
      'inicio',
      '   n <- 1',
      'fimprocedimento',
      'inicio',
      '   para i de 1 ate 3 faca',
      '      se i = 2 entao',
      '         escreva("dois") // dois',
      '      senao',
      '         escreva(i)',
      '      fimse',
      '   fimpara',
      '   escolha i',
      '      caso 1',
      '         escreva("um")',
      '      outrocaso',
      '         repita',
      '            i <- i + 1',
      '         ate i > 5',
      '   fimescolha',
      '   se i = 1 entao escreva("a") fimse',
      '   escreva("fim")',
      'fimalgoritmo',
    ].join('\n');
    assert.equal(formatSource(src), expected);
  });

  it('is stable when run twice', () => {
    const src = 'algoritmo "x"\nvar\n   i: inteiro\ninicio\n   enquanto i < 3 faca\n      i <- i + 1\n   fimenquanto\nfimalgoritmo';
    assert.equal(formatSource(formatSource(src)), formatSource(src));
    assert.equal(formatSource(src), src);
  });
});
