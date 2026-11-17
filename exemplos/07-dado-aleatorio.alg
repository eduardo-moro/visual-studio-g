Algoritmo "O dado é justo?"
// Descrição : joga um dado muitas vezes e confere se cada face sai perto
//             de 1/6 das vezes (testa se o aleatório é uniforme).
//             O dado usa "aleatorio 1, 6" + leia + "aleatorio off".
// Como testar: abra o fluxograma (botão no canto do editor), ponha um
//              breakpoint na linha 30 e use F5, F10 e F11.
const
   JOGADAS = 6000

Var
   contagem: vetor[1..6] de inteiro
   i, face: inteiro
   esperado, desvio: real
   justo: logico

funcao jogaDado: inteiro
var valor: inteiro
inicio
   aleatorio 1, 6
   leia(valor)
   aleatorio off
   retorne valor
fimfuncao

Inicio
   // Não mostra na tela cada valor sorteado pelo aleatorio
   eco off

   para i de 1 ate JOGADAS faca
      face <- jogaDado
      contagem[face] <- contagem[face] + 1
   fimpara

   esperado <- JOGADAS / 6
   justo <- VERDADEIRO
   para face de 1 ate 6 faca
      desvio <- abs(contagem[face] - esperado) / esperado * 100
      escreval("Face ", face, ":", contagem[face]:5, " vezes (", desvio:4:1, "% de diferença)")
      se desvio > 10 entao
         justo <- FALSO
      fimse
   fimpara

   se justo entao
      escreval("O dado parece justo!")
   senao
      escreval("Alguma face saiu demais ou de menos...")
   fimse
Fimalgoritmo
