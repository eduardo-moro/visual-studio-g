Algoritmo "Tabuada em matriz"
// Descrição : matriz (vetor de duas dimensões) e o comando timer, que executa
//             devagar destacando em amarelo, no editor, a linha que está rodando.
// Como testar: Ctrl+F5 e olhe o editor enquanto o terminal vai mostrando a tabuada.
Var
   tab: vetor[1..3, 1..3] de inteiro
   lin, col: inteiro

Inicio
   timer 400
   para lin de 1 ate 3 faca
      para col de 1 ate 3 faca
         tab[lin, col] <- lin * col
         escreva(tab[lin, col]:4)
      fimpara
      escreval
   fimpara
   timer off
   escreval("Pronto!")
Fimalgoritmo
