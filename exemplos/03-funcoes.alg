Algoritmo "Funções e procedimentos"
// Descrição : função recursiva, procedimento com parâmetro por referência (var)
// Como testar: botão de depurar (o inseto ao lado do ▶) para ir passo a passo desde
//              o início. Use F11 para ENTRAR em fatorial e veja a pilha de chamadas
//              crescer no painel "Pilha de Chamadas"; Shift+F11 para sair.
Var
   a, b: inteiro

funcao fatorial(n: inteiro): inteiro
inicio
   se n <= 1 entao
      retorne 1
   fimse
   retorne n * fatorial(n - 1)
fimfuncao

procedimento troca(var x, y: inteiro)
var aux: inteiro
inicio
   aux <- x
   x <- y
   y <- aux
fimprocedimento

Inicio
   escreval("5! =", fatorial(5))

   a <- 1
   b <- 2
   troca(a, b)
   escreval("Depois da troca: a =", a, ", b =", b)
Fimalgoritmo
