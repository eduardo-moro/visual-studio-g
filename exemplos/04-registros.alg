Algoritmo "Cadastro de alunos"
// Descrição : const, tipo registro, vetor de registros e ordenação (bubble sort).
//             "aleatorio" preenche os leia sozinho, então não precisa digitar nada.
// Como testar: Ctrl+F5. Depois abra a aba "Executar e Depurar" e veja o painel
//              "Memória (VisuAlg)": os valores finais continuam lá.
const
   QTD = 5

tipo
   taluno = registro
      nome: caractere
      nota: real
   fimregistro

Var
   turma: vetor[1..QTD] de taluno
   temp: taluno
   i, j: inteiro

Inicio
   aleatorio 0, 10, 1
   para i de 1 ate QTD faca
      escreva("Nome do aluno ", i, ": ")
      leia(turma[i].nome)
      escreva("Nota: ")
      leia(turma[i].nota)
   fimpara
   aleatorio off

   // Ordena da maior nota para a menor
   para i de 1 ate QTD - 1 faca
      para j de 1 ate QTD - i faca
         se turma[j].nota < turma[j + 1].nota entao
            temp <- turma[j]
            turma[j] <- turma[j + 1]
            turma[j + 1] <- temp
         fimse
      fimpara
   fimpara

   escreval
   escreval("Classificação:")
   para i de 1 ate QTD faca
      escreval(i:2, "º  ", turma[i].nome, turma[i].nota:6:1)
   fimpara
Fimalgoritmo
