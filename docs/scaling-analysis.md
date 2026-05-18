# Análise de Escala — Custos, Receita e Margem

> Cenários para a mensalidade de **R$ 15,00** do Appliquei, considerando a
> dinâmica do programa de indicações **Applicash**.
> Valores em R$/mês salvo indicação contrária. Câmbio base USD→BRL = 5,20.

## 1. Premissas

### 1.1 Stack e custos unitários

| Item | Tarifa de referência | Fonte |
|---|---|---|
| **Asaas — cartão recorrente** | 2,99% + R$ 0,39 → R$ 0,84/cobrança de R$ 15 | Tabela pública Asaas |
| **Asaas — PIX recorrente** | 0,99% (mín R$ 1,99) → ~R$ 0,15–1,99 | Tabela pública |
| **Asaas — boleto** | R$ 1,99 fixo | Tabela pública |
| **Mix de cobrança assumido** | 50% cartão / 40% PIX / 10% boleto | Conservador para fintech BR |
| **Custo médio Asaas/cobrança** | **R$ 1,00** em escala pequena; **R$ 0,70–0,85** com negociação acima de 10k cobranças/mês | |
| **Firestore reads** | US$ 0,06 / 100k | GCP |
| **Firestore writes** | US$ 0,18 / 100k | GCP |
| **Firestore storage** | US$ 0,18 / GB·mês | GCP |
| **Uso médio/usuário ativo** | 6k reads + 1,5k writes + 50 MB/mês | Estimativa do app |
| **Custo Firebase/usuário pagante** | **~R$ 0,10/mês** | Cálculo |
| **Firebase Auth** | Free até 50k MAU; depois US$ 0,0055/MAU | Identity Platform |
| **Vercel Hobby → Pro → Enterprise** | R$ 0 / ~R$ 110 / ~R$ 5.000 | Pricing público |
| **Domínio + email transacional + monitoria** | R$ 30–200 fixo conforme porte | |

### 1.2 Dinâmica do Applicash (lida em `Appliquei_v13.0.html:10724`)

- **Indicado** ganha cupom: **10% de desconto** na mensalidade → paga **R$ 13,50**.
- **Indicador** ganha **10% sobre o valor pago pelo indicado** como abatimento
  na própria fatura → cada indicado ativo reduz R$ 1,50 da mensalidade do indicador.
- **Cap em 10–12 indicados ativos**: mensalidade do indicador zera (100%).
- Efeitos colaterais:
  1. **ARPU líquido cai** (descontos saem da cobrança Asaas).
  2. **CAC despenca** — % crescente de aquisições orgânicas via cupom.
  3. **Viralidade**: k-factor estimado 0,2 → 0,5 conforme o programa amadurece.

Curva de adoção do Applicash usada nos cenários:

| Cenário | % adquiridos via cupom | % usuários com ≥1 indicado ativo | Indicados ativos médios por indicador | ARPU líquido médio |
|---|---|---|---|---|
| Bootstrap (S1) | 10% | 3% | 1,5 | R$ 14,78 |
| Tração (S2) | 25% | 8% | 2,0 | R$ 14,38 |
| Crescimento (S3) | 40% | 15% | 2,5 | R$ 13,84 |
| Escala (S4) | 50% | 20% | 3,0 | R$ 13,30 |
| Maturidade (S5) | 55% | 25% | 3,2 | R$ 13,03 |

Cálculo do ARPU líquido: `15 × (1 − 0,10·p_cupom) − 1,50 · p_indicador · indicados_médios`,
truncado em 0 quando estoura o cap.

### 1.3 Outras premissas

- **Trial overhang**: a cada usuário pagante há ~30% de usuários em trial que
  consomem infra mas não geram receita (ajustado em Firestore/Auth).
- **Churn**: 5%/mês — incorporado implicitamente nos custos de aquisição.
- **Tributos**:
  - S1 ≤ R$ 6.750/mês de receita → MEI (DAS-MEI ~R$ 76).
  - S2 e S3 → Simples Nacional Anexo III, faixas 2–4, alíquota efetiva 8–11%.
  - S4 → Anexo III faixa 5, alíquota efetiva ~13%.
  - S5 ultrapassa o teto do Simples (R$ 4,8 MM/ano) → **Lucro Presumido**:
    ISS 5% + PIS/COFINS 3,65% + IRPJ/CSLL sobre presunção 32% (≈ 7,68%) → **~16% efetivo**.

---

## 2. Cenários de escala (assinantes **pagantes**)

| | **S1 — Bootstrap** | **S2 — Tração** | **S3 — Crescimento** | **S4 — Escala** | **S5 — Maturidade** |
|---|---:|---:|---:|---:|---:|
| Pagantes | 100 | 1.000 | 5.000 | 20.000 | 100.000 |
| Trial/free ativos | 30 | 300 | 1.500 | 6.000 | 30.000 |
| ARPU líquido (após Applicash) | R$ 14,78 | R$ 14,38 | R$ 13,84 | R$ 13,30 | R$ 13,03 |
| **Receita bruta líquida (mensal)** | **R$ 1.478** | **R$ 14.380** | **R$ 69.200** | **R$ 266.000** | **R$ 1.303.000** |

### 2.1 Quebra de custos (mensal)

| Linha | S1 | S2 | S3 | S4 | S5 |
|---|---:|---:|---:|---:|---:|
| Asaas (cobrança) | 100 | 1.000 | 5.000 | 17.000 | 70.000 |
| Firestore | 13 | 130 | 650 | 2.600 | 13.000 |
| Firebase Auth | 0 | 0 | 0 | 0 | 1.430 |
| Vercel | 0 | 110 | 110 | 400 | 5.000 |
| Domínio + email + monitoria | 30 | 80 | 200 | 800 | 3.000 |
| Suporte / atendimento | 0¹ | 1.500 | 5.000 | 15.000 | 45.000 |
| Equipe técnica (dev/ops) | 0¹ | 0¹ | 2.000² | 12.000² | 50.000 |
| Marketing pago (líquido de Applicash) | 200 | 2.000 | 8.000 | 25.000 | 80.000 |
| Segurança / backups / jurídico | 30 | 100 | 500 | 1.500 | 8.000 |
| **Custo operacional** | **373** | **4.920** | **21.460** | **74.300** | **275.430** |
| Tributos sobre receita | 76 (MEI) | 1.222 (~8,5%) | 7.266 (~10,5%) | 34.580 (~13%) | 208.480 (~16%) |
| **Custo total** | **449** | **6.142** | **28.726** | **108.880** | **483.910** |
| **Lucro líquido** | **R$ 1.029** | **R$ 8.238** | **R$ 40.474** | **R$ 157.120** | **R$ 819.090** |
| **Margem líquida** | **70%** | **57%** | **58%** | **59%** | **63%** |

¹ S1/S2: founder bota a mão na massa — custo de oportunidade não monetizado.
² S3/S4: dev part-time / freela; em S5 vira time interno.

### 2.2 Faturamento anualizado e marcos

| Cenário | Receita anual | Lucro anual | Faixa fiscal |
|---|---:|---:|---|
| S1 | R$ 17,7 k | R$ 12,3 k | MEI |
| S2 | R$ 172,5 k | R$ 98,9 k | Simples — sai do MEI |
| S3 | R$ 830,4 k | R$ 485,7 k | Simples Anexo III |
| S4 | R$ 3,19 MM | R$ 1,89 MM | Simples no topo |
| S5 | R$ 15,64 MM | R$ 9,83 MM | Lucro Presumido (excede teto Simples) |

---

## 3. Sensibilidades

### 3.1 E se o Applicash for mais agressivo do que o modelado?

Se a maturidade levar 70% dos usuários a virem via cupom + 35% com indicados
ativos (média 3,5), o ARPU cai para **R$ 12,20** em S5 → receita líquida
R$ 1,22 MM/mês, lucro ~R$ 740 k, margem ~60%. Aceitável **se** o CAC orgânico
estiver compensando: cada R$ 1,50 abatido custa muito menos que R$ 30–80 de
ads pagos.

### 3.2 E se o mix Asaas pender para boleto/cartão?

Mix 70% cartão / 10% PIX / 20% boleto eleva o custo médio para R$ 1,40/cobrança.
Em S5 isso somam +R$ 40 k/mês — corrói ~3 p.p. da margem. Conclusão:
**incentivar PIX recorrente é o lever de margem mais barato**.

### 3.3 E se a infra Firebase explodir?

O perfil do app (gestão financeira pessoal) é leitura-pesada. Se o uso médio
dobrar (12k reads/usuário/mês), em S5 o Firestore vira R$ 26 k (vs R$ 13 k).
Mitigação: cache em memória + lazy loading + agregar leituras (já há `rateLimits`
TTL prevendo isso).

### 3.4 E se o churn for 8% em vez de 5%?

Cada ponto extra de churn exige ~R$ 20–40 a mais de CAC por usuário reposto.
Em S4 isso adiciona ~R$ 12 k/mês de marketing → margem cai de 59% para ~54%.
**Applicash mitiga isso reduzindo a parcela do CAC que precisa ser comprada.**

---

## 4. Conclusões

1. **A margem do produto em si é estruturalmente alta** (60–70% líquido em
   regime), porque os custos variáveis (Asaas + Firebase) somam menos de R$ 1,50
   por usuário/mês — ou seja, ~10% do ticket.
2. **O Applicash custa entre 1% (S1) e 13% (S5) do ARPU bruto**, mas tem
   contrapartida em CAC reduzido. É um investimento em viralidade, não um
   desconto puro.
3. **Os dois maiores custos em escala são pessoas e impostos**, nessa ordem.
   Eficiência operacional (automação de suporte, KB, IA) é o que separa
   margem 55% de margem 65%.
4. **Marco crítico**: na transição S4 → S5 (sair do Simples) a alíquota efetiva
   pula ~3 p.p. — começar a planejar Lucro Real vs Presumido antes de
   ultrapassar R$ 4,8 MM/ano evita perder 1–2 p.p. de margem.
5. **Lever de margem mais barato disponível hoje**: forçar PIX recorrente como
   default no fluxo de assinatura (`/api/billing/subscribe` aceita
   `billingType=UNDEFINED` — passar a `PIX` quando possível economiza ~R$ 0,30
   por cobrança).
