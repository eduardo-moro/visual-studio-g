Algoritmo "Média das notas"
// Descrição : vetor, para, escolha e formatação de números (x:6:2)
// Como testar: F5 com um breakpoint (clique à esquerda do número da linha 22)
//              e veja o vetor "notas" no painel Variáveis.
Var
   notas: vetor[1..4] de real
   soma, media: real
   i: inteiro

Inicio
   escreval("Digite as 4 notas do bimestre (use ponto ou vírgula):")
   para i de 1 ate 4 faca
      escreva("Nota ", i, ": ")
      leia(notas[i])
      soma <- soma + notas[i]
   fimpara

   media <- soma / 4
   escreval
   escreval("Média: ", media:6:2)

   escolha int(media)
   caso 0 ate 3
      escreval("Situação: reprovado")
   caso 4, 5, 6
      escreval("Situação: exame final")
   outrocaso
      escreval("Situação: aprovado")
   fimescolha
Fimalgoritmo
