# Plano de ação: próximos Reels com personagens animados

Escrito em 23/11/2026, depois do Black Friday 3 min (o 1º Reel com o Beto e a
Lia em 3D animados). Pedido do fundador: "terminando aqui precisa de plano de
ação pro próximo". Grade: **seg, qua e sex, 19h**. O tema de cada Reel continua
sendo decisão do fundador.

## O que aprendemos no 1º

| Etapa                  | Quanto levou                     | O que muda daqui pra frente                                   |
| ---------------------- | -------------------------------- | ------------------------------------------------------------- |
| Imagens das cenas      | minutos (Cloudflare)             | igual                                                         |
| 5 clipes de 5 s        | ~4 min, logo após 6h45 (cota HF) | igual: a cota grátis do dia cabe 5 clipes                     |
| Ampliar (nitidez)      | **~3 h 30** (anime 6B, 30 s/quadro) | **~40 min**: o compacto (6 s/quadro) virou o padrão         |
| Montagem e compressão  | ~10 min                          | igual                                                         |

O ampliador compacto (`ia.py ampliar`, sem `--fino`) foi comparado quadro a
quadro com o anterior no rosto do Beto: diferença mínima no cabelo, invisível
no celular, e os dois muito melhores que o clipe só esticado.

## Agenda de cada Reel animado (produzir 2 dias antes)

| Quando            | O quê                                                                   | Quem       |
| ----------------- | ----------------------------------------------------------------------- | ---------- |
| D-3, até 22h      | Tema e roteiro aprovados                                                | fundador   |
| D-3, à noite      | Imagens das cenas (Cloudflare, a partir de `beto-lia-3d.png`) e vozes   | Claude     |
| D-2, 6h45–7h      | 5 clipes no Hugging Face (a cota renova ~6h45)                          | Claude     |
| D-2, até ~8h      | Ampliar (~40 min) e montar                                              | Claude     |
| D-2, manhã        | Vídeo para aprovação; ajustes no mesmo dia                              | fundador   |
| D-1               | Pacote de publicação (legenda, horário, rótulo de IA)                   | Claude     |
| D, 19h            | Postar                                                                  | sócio      |

Exemplo: Reel de sexta 27/11 → tema até terça 24/11 à noite, clipes quarta
25/11 às 6h45, vídeo aprovado na quarta de manhã.

## Orçamento da cota grátis (Hugging Face, 300 s por dia)

- 1 clipe de 5 s ≈ 50 s → **5 clipes por dia** (um Reel).
- Boca sincronizada (LatentSync) reserva 180 s → **não cabe no mesmo dia** dos
  5 clipes. Se aprovada no teste, a fala é gerada no dia anterior (D-3 cedo)
  ou o Reel usa 2 clipes a menos (reaproveitando o banco de reações).
- Imagens nunca no Hugging Face (70 s cada): sempre Cloudflare (~60 por dia).
- Se a cota acabar: reaproveitar clipes do banco de reações; o rascunho local
  serve para testar, nunca para postar. Modal só com cartão cadastrado.

## Próximos passos

1. **Ter 24/11, 6h50:** teste da boca sincronizada na fala do Beto ("Mas era
   tudo oferta?!"). Se ficar bom: ampliar, remontar e mandar a versão falada
   para aprovação (o Reel de quarta continua pronto do jeito que está).
2. **Ter 24/11, até 22h:** o fundador decide se sexta 27/11 tem Reel animado
   e qual tema (proponho opções antes).
3. **Depois de 2 a 3 Reels animados:** comparar pulados e retenção dos 3
   primeiros segundos com os Reels sem animação (gasolina 12,5 s / 35%) e
   decidir se a animação vira padrão.

## Teste da boca sincronizada (24/11): não funcionou

LatentSync (Space `fffiloni/LatentSync`) na fala do Beto ("Mas era tudo
oferta?!"): erro nas duas tentativas, na cena inteira e no recorte do rosto
(512 px), ~25 s cada. A IA não reconheceu o rosto 3D (o Beto está com a mão na
testa). O teste com a Lia de frente não rodou: o Space pede 180 s livres e a
cota não deixou. O Reel de 25/11 fica como está. Próximo teste, se o
fundador quiser: rosto de frente, sem a mão, com a cota cheia (~6h45).

## Quando o Hugging Face PRO (US$ 9/mês, ~R$ 55–60) passa a valer

A cota grátis dá **1 Reel animado por dia**, sem fala sincronizada. O PRO
(25 min por dia, 5 vezes mais, segundo o aviso do próprio Hugging Face em 24/11)
vale quando acontecer **um** destes:

- a boca sincronizada for aprovada e entrar em todo Reel (5 clipes + fala =
  ~430 s, mais que os 300 s grátis);
- os 3 Reels da semana (ou os 7 vídeos diários de 27/12 a 02/01) forem todos
  animados e precisarem ser refeitos no mesmo dia;
- uma cena for refeita mais de 1 vez (cada nova tentativa gasta 50 s).

Enquanto for 1 a 2 Reels animados por semana sem fala, o grátis basta.
