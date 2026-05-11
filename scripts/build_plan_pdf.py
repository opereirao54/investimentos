"""Gera o PDF do plano de publicacao Appliquei v2 (revisado).

Decisoes fechadas nesta versao:
  1. Stack: Next.js 14 (App Router) + Vercel.
  2. Tabelas 6 e 12 reescritas no modelo Firestore (colecoes/subcolecoes/indices).
  3. Saque PIX do Applicash fora do MVP (saldo so abate na propria assinatura).
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY, TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, ListFlowable, ListItem,
)
from reportlab.pdfgen import canvas


OUTPUT = "/home/user/investimentos/Appliquei_Plano_Publicacao_v2.pdf"

PRIMARY = colors.HexColor("#059669")
DARK = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#64748b")
ROW_ALT = colors.HexColor("#f1f5f9")
HEADER_BG = colors.HexColor("#064e3b")
BORDER = colors.HexColor("#cbd5e1")


def build_styles():
    base = getSampleStyleSheet()
    styles = {}
    styles["title"] = ParagraphStyle(
        "title", parent=base["Title"], fontName="Helvetica-Bold",
        fontSize=26, textColor=DARK, leading=30, spaceAfter=12, alignment=TA_LEFT,
    )
    styles["subtitle"] = ParagraphStyle(
        "subtitle", parent=base["Normal"], fontName="Helvetica",
        fontSize=13, textColor=MUTED, leading=18, spaceAfter=6,
    )
    styles["h1"] = ParagraphStyle(
        "h1", parent=base["Heading1"], fontName="Helvetica-Bold",
        fontSize=18, textColor=PRIMARY, leading=22, spaceBefore=18, spaceAfter=10,
    )
    styles["h2"] = ParagraphStyle(
        "h2", parent=base["Heading2"], fontName="Helvetica-Bold",
        fontSize=14, textColor=DARK, leading=18, spaceBefore=14, spaceAfter=6,
    )
    styles["h3"] = ParagraphStyle(
        "h3", parent=base["Heading3"], fontName="Helvetica-Bold",
        fontSize=11.5, textColor=DARK, leading=15, spaceBefore=10, spaceAfter=4,
    )
    styles["body"] = ParagraphStyle(
        "body", parent=base["BodyText"], fontName="Helvetica",
        fontSize=10.5, leading=15, alignment=TA_JUSTIFY, spaceAfter=8, textColor=DARK,
    )
    styles["small"] = ParagraphStyle(
        "small", parent=base["BodyText"], fontName="Helvetica",
        fontSize=9, leading=12, textColor=MUTED, alignment=TA_LEFT,
    )
    styles["mono"] = ParagraphStyle(
        "mono", parent=base["Code"], fontName="Courier",
        fontSize=8.5, leading=11, textColor=DARK,
    )
    styles["callout"] = ParagraphStyle(
        "callout", parent=base["BodyText"], fontName="Helvetica",
        fontSize=10, leading=14, textColor=DARK, alignment=TA_JUSTIFY,
    )
    styles["caption"] = ParagraphStyle(
        "caption", parent=base["Italic"], fontName="Helvetica-Oblique",
        fontSize=9, leading=12, textColor=MUTED, alignment=TA_CENTER, spaceAfter=14,
    )
    styles["bullet"] = ParagraphStyle(
        "bullet", parent=base["BodyText"], fontName="Helvetica",
        fontSize=10.5, leading=15, alignment=TA_LEFT, textColor=DARK,
    )
    styles["table_cell"] = ParagraphStyle(
        "table_cell", parent=base["BodyText"], fontName="Helvetica",
        fontSize=9.2, leading=12, alignment=TA_LEFT, textColor=DARK,
    )
    styles["table_header"] = ParagraphStyle(
        "table_header", parent=base["BodyText"], fontName="Helvetica-Bold",
        fontSize=9.5, leading=12, alignment=TA_LEFT, textColor=colors.white,
    )
    return styles


S = build_styles()


def P(text, style="body"):
    return Paragraph(text, S[style])


def cell(text, header=False):
    return Paragraph(text, S["table_header" if header else "table_cell"])


def make_table(header_row, body_rows, col_widths):
    data = [[cell(c, header=True) for c in header_row]]
    for row in body_rows:
        data.append([cell(c) for c in row])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
    ])
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.add("BACKGROUND", (0, i), (-1, i), ROW_ALT)
    t.setStyle(style)
    return t


def caption(n, text):
    return Paragraph(f"<b>Tabela {n}.</b> {text}", S["caption"])


def callout(title, text, color=PRIMARY):
    inner = Table(
        [[Paragraph(f"<b>{title}</b>", S["body"])],
         [Paragraph(text, S["callout"])]],
        colWidths=[16 * cm],
    )
    inner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ecfdf5")),
        ("BOX", (0, 0), (-1, -1), 0.6, color),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return inner


def bullets(items):
    return ListFlowable(
        [ListItem(P(it, "bullet"), leftIndent=10, value="bullet") for it in items],
        bulletType="bullet", start="circle", leftIndent=14, bulletFontSize=8,
    )


# ---------- Page chrome ----------

def on_page(canv: canvas.Canvas, doc):
    canv.saveState()
    page = canv.getPageNumber()
    # Footer line
    canv.setStrokeColor(BORDER)
    canv.setLineWidth(0.4)
    canv.line(2 * cm, 1.6 * cm, A4[0] - 2 * cm, 1.6 * cm)
    canv.setFont("Helvetica", 8)
    canv.setFillColor(MUTED)
    canv.drawString(2 * cm, 1.1 * cm, "Appliquei - Plano de Publicacao v2 (revisado)")
    canv.drawRightString(A4[0] - 2 * cm, 1.1 * cm, f"Pagina {page}")
    # Header bar (only after page 1)
    if page > 1:
        canv.setFillColor(PRIMARY)
        canv.rect(0, A4[1] - 0.5 * cm, A4[0], 0.5 * cm, stroke=0, fill=1)
    canv.restoreState()


# ---------- Content ----------

def cover():
    flow = []
    flow.append(Spacer(1, 4 * cm))
    flow.append(Paragraph("Appliquei", S["title"]))
    flow.append(Paragraph(
        "Plano de Publicacao da Plataforma <b>v2 (revisado)</b>", S["subtitle"]
    ))
    flow.append(Spacer(1, 0.6 * cm))
    flow.append(Paragraph(
        "Documento tecnico-executivo com a arquitetura, escopo e cronograma "
        "para tirar a aplicacao do prototipo (HTML monolitico) e coloca-la "
        "em producao com autenticacao, banco de dados online, cobranca recorrente "
        "e painel administrativo.",
        S["body"],
    ))
    flow.append(Spacer(1, 1.0 * cm))
    flow.append(callout(
        "Decisoes fechadas nesta revisao",
        "1. <b>Stack unica:</b> Next.js 14 (App Router) hospedado na Vercel. "
        "Sem mistura com Vite/Netlify Functions.<br/>"
        "2. <b>Modelo de dados em Firestore</b> (NoSQL): colecoes, subcolecoes "
        "e indices compostos. Sem chaves primarias/estrangeiras nem tipo Decimal.<br/>"
        "3. <b>Saque PIX do Applicash fora do MVP.</b> O saldo de comissoes "
        "abate apenas na propria assinatura nesta primeira versao.",
    ))
    flow.append(Spacer(1, 1.5 * cm))
    info = [
        ["Versao do documento", "2.0"],
        ["Data de referencia", "Maio / 2026"],
        ["Estado atual do produto", "HTML unico, ~10.700 linhas, sem backend"],
        ["Branch de trabalho", "claude/finance-app-storage-5W93N"],
    ]
    t = Table(info, colWidths=[5.5 * cm, 10.5 * cm])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (0, -1), "Helvetica-Bold", 10),
        ("FONT", (1, 0), (1, -1), "Helvetica", 10),
        ("TEXTCOLOR", (0, 0), (-1, -1), DARK),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    flow.append(t)
    flow.append(PageBreak())
    return flow


def section_executive_summary():
    flow = [
        P("1. Sumario Executivo", "h1"),
        P(
            "A plataforma Appliquei e hoje um prototipo funcional empacotado em "
            "um unico arquivo HTML com persistencia 100% em <i>localStorage</i>. "
            "Todas as funcionalidades de produto - carteira de investimentos, "
            "controle financeiro, simulador, sonhos, carteira recomendada e "
            "noticias - estao operacionais no navegador, mas nao ha autenticacao, "
            "banco de dados online, processamento real de pagamentos nem painel "
            "administrativo de fato. Para abrir a plataforma comercialmente, cinco "
            "bloqueios precisam ser resolvidos: autenticacao, persistencia online, "
            "cobranca recorrente, painel administrativo e a propria modularizacao "
            "do codigo."
        ),
        P(
            "Este documento descreve a arquitetura escolhida, o modelo de dados "
            "em Firestore, o fluxo de assinaturas via Asaas, o programa de "
            "indicacao Applicash em escopo de MVP (sem saque PIX) e o cronograma "
            "para colocar tudo em producao em 16 a 20 semanas com 1-2 desenvolvedores."
        ),
        P("1.1 Funcionalidades existentes vs lacunas", "h2"),
    ]
    rows = [
        ["Carteira de investimentos", "Completo", "Acoes, FIIs, ETFs, BDRs, Cripto, RF, Previdencia"],
        ["Controle financeiro", "Completo", "Receitas, despesas, cartoes, DRE, metas"],
        ["Simulador de liberdade financeira", "Completo", "Juros compostos, IPCA/Selic em tempo real"],
        ["Carteira recomendada", "Completo", "Questionario + alocacao + painel do consultor"],
        ["Meus Sonhos", "Completo", "CRUD de metas com aportes e progresso"],
        ["Noticias (InfoMoney RSS)", "Completo", "Feed via rss2json, ate 6 artigos"],
        ["FAQ e sugestoes", "Completo", "20+ perguntas, formulario de sugestoes"],
        ["Applicash (indicacao)", "Parcial", "UI existe, sem backend real"],
        ["Autenticacao de usuarios", "Ausente", "Bloqueante para producao"],
        ["Pagamentos / assinaturas", "Ausente", "Apenas mock, sem gateway"],
        ["Painel administrativo", "Parcial", "So carteira recomendada, sem multi-user"],
        ["Banco de dados online", "Ausente", "100% localStorage"],
    ]
    flow.append(make_table(["Funcionalidade", "Status", "Observacoes"], rows,
                           [5.5 * cm, 2.5 * cm, 8.5 * cm]))
    flow.append(caption(1, "Inventario de funcionalidades atuais."))
    flow.append(P("1.2 Pontos criticos", "h2"))
    flow.append(P(
        "Os cinco bloqueios identificados estao listados em ordem de prioridade. "
        "Cada um deles e pre-requisito para o anterior funcionar de verdade em "
        "producao - o sistema de assinaturas, por exemplo, depende de "
        "autenticacao real, que por sua vez depende de banco de dados online."
    ))
    flow.append(bullets([
        "<b>Sem autenticacao:</b> qualquer pessoa que acessa a aplicacao tem acesso total.",
        "<b>localStorage:</b> dados presos a um navegador, perdidos ao limpar cache.",
        "<b>Pagamentos mockados:</b> assinaturas e Applicash sao apenas simulacoes.",
        "<b>Painel administrativo limitado:</b> nao gerencia usuarios, assinaturas ou indicacoes.",
        "<b>Monolito de ~10.700 linhas:</b> impede teste, manutencao e colaboracao em equipe.",
    ]))
    flow.append(PageBreak())
    return flow


def section_architecture():
    flow = [
        P("2. Arquitetura e Stack Tecnologica", "h1"),
        P(
            "A reestruturacao do codigo e o alicerce sobre o qual todas as demais "
            "melhorias serao construidas. A escolha da stack prioriza maturidade, "
            "produtividade e custo operacional baixo no estagio inicial."
        ),
        callout(
            "Decisao 1 - Stack unica",
            "<b>Frontend e backend leves:</b> Next.js 14 (App Router) hospedado "
            "na <b>Vercel</b>. Toda logica de servidor que precisa de proximidade "
            "com o front roda em <b>Route Handlers</b> e <b>Server Actions</b> "
            "do proprio Next.js. Webhooks externos (Asaas) e jobs agendados "
            "tambem usam Route Handlers da Vercel.<br/><br/>"
            "<b>Backend pesado:</b> Firebase (Firestore + Auth + Cloud Storage). "
            "Cloud Functions do Firebase ficam reservadas para triggers de "
            "Firestore (envio de e-mail transacional, agregacoes), nao como "
            "endpoint HTTP principal."
        ),
        P("2.1 Stack recomendada", "h2"),
    ]
    rows = [
        ["Framework", "Next.js 14 (App Router)", "SSR + SSG, Route Handlers, Server Actions"],
        ["Linguagem", "TypeScript", "Tipagem estatica obrigatoria desde o dia 1"],
        ["Estilizacao", "Tailwind CSS + shadcn/ui", "Design system consistente, dark mode pronto"],
        ["Graficos", "Recharts", "Substitui Chart.js, integra com React de forma nativa"],
        ["Estado", "Zustand + TanStack Query", "Estado de UI + cache de dados remotos"],
        ["Hospedagem", "Vercel", "Deploy via Git, edge network, preview por PR"],
        ["Banco de dados", "Cloud Firestore", "NoSQL, sync em tempo real, offline-first"],
        ["Autenticacao", "Firebase Authentication", "Email/senha, Google OAuth, Magic Link"],
        ["Storage", "Firebase Cloud Storage", "Avatares, comprovantes, exportacoes"],
        ["Pagamentos", "Asaas", "PIX, boleto, cartao recorrente, webhooks"],
        ["E-mail", "Resend", "Transacional, templates React Email"],
        ["Observabilidade", "Sentry + Vercel Analytics", "Erros em runtime + metricas Web Vitals"],
        ["Testes", "Vitest + Playwright", "Unitario para regras de negocio + E2E do checkout"],
    ]
    flow.append(make_table(["Camada", "Tecnologia", "Justificativa"], rows,
                           [3.5 * cm, 4.5 * cm, 8.5 * cm]))
    flow.append(caption(2, "Stack tecnologica - Next.js + Vercel + Firebase."))

    flow.append(P("2.2 Estrutura de diretorios", "h2"))
    rows = [
        ["src/app/(auth)/", "Login, registro, recuperacao de senha"],
        ["src/app/(dashboard)/", "Patrimonio, controle, carteira, simulador, sonhos"],
        ["src/app/(admin)/", "Dashboard admin, usuarios, assinaturas, Applicash"],
        ["src/app/api/", "Route Handlers (webhooks Asaas, callbacks externos)"],
        ["src/components/", "Componentes React reutilizaveis"],
        ["src/features/", "Modulos por dominio (investments, finance, applicash, ...)"],
        ["src/lib/", "Utilitarios puros, formatadores BRL, calculadoras (juros)"],
        ["src/server/", "Acesso a Firestore com Admin SDK (server-only)"],
        ["src/firebase/", "Client SDK, hooks, conversores tipados"],
        ["firestore/", "Regras de seguranca + arquivo de indices compostos"],
    ]
    flow.append(make_table(["Diretorio", "Responsabilidade"], rows, [5 * cm, 11.5 * cm]))
    flow.append(caption(3, "Estrutura de diretorios proposta para o projeto Next.js."))

    flow.append(P("2.3 Plano de migracao incremental", "h2"))
    flow.append(P(
        "A migracao do monolito para a nova arquitetura e feita em quatro fases. "
        "Antes de iniciar a Fase 1, recomenda-se uma <b>Fase 0 (1 semana)</b>: "
        "extrair as funcoes puras de calculo (juros compostos, alocacao, "
        "dividendos, simulador) do HTML para modulos JavaScript com testes "
        "unitarios. Isso protege a regra de negocio durante a troca de framework."
    ))
    rows = [
        ["Fase 0", "Spike: extrair calculos puros + testes Vitest", "1 semana", "Critica"],
        ["Fase 1", "Setup Next.js + Vercel + Firebase + Auth", "3 semanas", "Critica"],
        ["Fase 2", "Migracao Carteira + Controle Financeiro", "5 semanas", "Alta"],
        ["Fase 3", "Asaas + Assinaturas + Applicash (sem saque)", "4 semanas", "Alta"],
        ["Fase 4", "Painel admin + observabilidade + soft launch", "3 semanas", "Media"],
    ]
    flow.append(make_table(
        ["Fase", "Escopo", "Prazo", "Prioridade"],
        rows, [1.8 * cm, 8.7 * cm, 3 * cm, 3 * cm],
    ))
    flow.append(caption(4, "Fases da migracao com prazos para 2 desenvolvedores."))
    flow.append(PageBreak())
    return flow


def section_auth():
    flow = [
        P("3. Autenticacao e Modelo de Usuario", "h1"),
        P(
            "Sem autenticacao real, nada que vem depois funciona: assinaturas, "
            "indicacoes, painel admin. O Firebase Authentication resolve a parte "
            "de identidade quase inteiramente sem codigo de servidor proprio."
        ),
        P("3.1 Metodos suportados", "h2"),
    ]
    rows = [
        ["Email + Senha", "Padrao. Politica de senha forte (>= 8 chars, regex)."],
        ["Google OAuth", "Login social com 1 clique. Reduz friccao de cadastro."],
        ["Magic Link", "Link por e-mail, expira em 24h. Sem senha."],
        ["MFA (admin)", "SMS via Firebase MFA - obrigatorio para role ADMIN. TOTP "
                        "fica para fase posterior (depende de Identity Platform)."],
    ]
    flow.append(make_table(["Metodo", "Detalhes"], rows, [4 * cm, 12.5 * cm]))
    flow.append(caption(5, "Metodos de autenticacao do MVP."))

    flow.append(P("3.2 Modelo de usuario em Firestore (Tabela 6 reescrita)", "h2"))
    flow.append(callout(
        "Decisao 2 - Modelo NoSQL",
        "O documento original descrevia o usuario como uma tabela SQL "
        "(UUID, password_hash bcrypt, FK para referrer). No Firestore correto:<br/>"
        "- chave do documento e o <b>uid</b> string do Firebase Auth;<br/>"
        "- nao armazenamos hash de senha (Firebase Auth gerencia);<br/>"
        "- valores monetarios ficam em <b>centavos como integer</b> "
        "(NumberInt) - nao existe Decimal no Firestore;<br/>"
        "- timestamps usam o tipo nativo Timestamp;<br/>"
        "- relacoes 1-N viram subcolecoes; relacoes N-N viram colecoes "
        "raiz com referencias por uid."
    ))
    flow.append(P(
        "Colecao raiz: <font face='Courier'>users/{uid}</font>. Cada documento "
        "tem os campos abaixo. Subcolecoes contem dados volumosos ou que "
        "precisam de query independente.", "body",
    ))
    rows = [
        ["uid", "string (doc id)", "Identificador do Firebase Auth"],
        ["email", "string", "Indexado, unico no Firebase Auth"],
        ["displayName", "string", "Nome de exibicao"],
        ["photoURL", "string?", "Avatar (Firebase Auth ou Storage)"],
        ["phone", "string?", "E.164, opcional"],
        ["role", "string enum", "USER | ADMIN | CONSULTANT"],
        ["subscription.status", "string enum", "ACTIVE | TRIAL | INACTIVE | CANCELLED"],
        ["subscription.plan", "string?", "MONTHLY | SEMESTRAL | ANNUAL"],
        ["subscription.endsAt", "Timestamp?", "Fim do ciclo pago atual"],
        ["subscription.asaasSubscriptionId", "string?", "ID da assinatura no Asaas"],
        ["trial.endsAt", "Timestamp?", "Fim do periodo de teste"],
        ["referral.code", "string", "Cupom proprio do usuario (APP-XXXXXX)"],
        ["referral.referrerUid", "string?", "Quem indicou esse usuario"],
        ["applicashBalanceCents", "integer", "Saldo em centavos (BRL)"],
        ["mfaEnabled", "boolean", "Obrigatorio quando role = ADMIN"],
        ["createdAt", "Timestamp", "serverTimestamp()"],
        ["updatedAt", "Timestamp", "serverTimestamp()"],
    ]
    flow.append(make_table(["Campo", "Tipo Firestore", "Descricao"], rows,
                           [5.5 * cm, 4 * cm, 7 * cm]))
    flow.append(caption(6, "Documento users/{uid} em Firestore."))

    flow.append(P("Subcolecoes de users/{uid}:", "h3"))
    rows = [
        ["investments", "Ativos da carteira (acao, FII, ETF, etc)"],
        ["transactions", "Lancamentos do controle financeiro"],
        ["creditCards", "Cartoes com limite, fechamento, vencimento"],
        ["goals", "Sonhos / metas com aportes"],
        ["portfolioSnapshots", "Snapshot mensal de patrimonio (para grafico historico)"],
        ["paymentHistory", "Pagamentos individuais recebidos via Asaas"],
    ]
    flow.append(make_table(["Subcolecao", "Conteudo"], rows, [5 * cm, 11.5 * cm]))

    flow.append(P("3.3 Onboarding e trial", "h2"))
    flow.append(P(
        "Cadastro -> trial de 7 dias com acesso completo -> escolha de plano. "
        "Cloud Function agendada (Firestore TTL ou pub/sub diario) verifica "
        "<font face='Courier'>trial.endsAt</font> e <font face='Courier'>"
        "subscription.endsAt</font> e altera <font face='Courier'>"
        "subscription.status</font> para INACTIVE quando expira. E-mails de "
        "lembrete sao disparados nos dias 3, 5 e 7 do trial via Resend."
    ))
    flow.append(PageBreak())
    return flow


def section_payments():
    flow = [
        P("4. Assinaturas e Pagamentos", "h1"),
        P(
            "O motor de receita usa Asaas como gateway e Firestore como fonte "
            "de verdade do estado da assinatura. Webhooks do Asaas atualizam "
            "Firestore; o frontend le Firestore via listener e reage em tempo real."
        ),
        P("4.1 Planos", "h2"),
    ]
    rows = [
        ["Mensal", "R$ 19,90", "R$ 19,90 / mes", "-", "10%"],
        ["Semestral", "R$ 16,90", "R$ 101,40 / 6 meses", "15%", "10%"],
        ["Anual", "R$ 12,90", "R$ 154,80 / ano", "35%", "10%"],
    ]
    flow.append(make_table(
        ["Plano", "Mensal eq.", "Cobranca", "Economia", "Cupom Applicash"],
        rows, [2.5 * cm, 2.8 * cm, 4.5 * cm, 2.5 * cm, 4.2 * cm],
    ))
    flow.append(caption(7, "Planos e descontos."))

    flow.append(P("4.2 Integracao com Asaas", "h2"))
    flow.append(P(
        "O Asaas oferece API de assinaturas recorrentes com retry automatico, "
        "PIX nativo, boleto com baixa em D+1 e cartao de credito ate 12x. "
        "Custo medio: 1.99% PIX, 2.99% + R$0,39 cartao, R$1,99 boleto."
    ))
    flow.append(P("4.3 Webhooks e ciclo de vida", "h2"))
    rows = [
        ["PAYMENT_CONFIRMED", "Ativa/renova assinatura. Atualiza subscription.endsAt."],
        ["PAYMENT_RECEIVED", "Confirma recebimento (pos compensacao de boleto)."],
        ["PAYMENT_OVERDUE", "Marca status TRIAL_EXPIRED ou GRACE; mantem acesso por 3 dias."],
        ["PAYMENT_DELETED", "Cancelamento solicitado. Mantem acesso ate endsAt."],
        ["PAYMENT_REFUNDED", "Revoga acesso imediato. status = INACTIVE."],
        ["PAYMENT_CHARGEBACK", "Marca para auditoria, suspende acesso."],
    ]
    flow.append(make_table(["Evento Asaas", "Acao no Firestore"], rows,
                           [5 * cm, 11.5 * cm]))
    flow.append(caption(8, "Mapeamento de webhooks Asaas para mutacoes no Firestore."))
    flow.append(P(
        "Os webhooks chegam em <font face='Courier'>POST /api/webhooks/asaas</font> "
        "(Route Handler do Next.js na Vercel). A rota valida assinatura HMAC, "
        "deduplica por <font face='Courier'>event.id</font> e grava idempotente "
        "no Firestore. Falhas de processamento gravam em colecao "
        "<font face='Courier'>webhookDeadLetter</font> para reprocessamento manual."
    ))
    flow.append(PageBreak())
    return flow


def section_applicash():
    flow = [
        P("5. Programa Applicash (MVP sem saque PIX)", "h1"),
        callout(
            "Decisao 3 - Saque PIX fora do MVP",
            "Saque via PIX exige KYC, antifraude, registro fiscal do recebedor "
            "(IR sobre comissao) e revisao juridica. <b>No MVP, o saldo "
            "Applicash so abate na propria assinatura do indicador.</b> "
            "Quando o saldo cobre 100% do proximo ciclo, a renovacao e "
            "automaticamente abatida e nenhum debito e feito no Asaas. "
            "Saque via PIX entra em fase posterior, apos validar volume e "
            "obter parecer fiscal/juridico.",
            color=colors.HexColor("#b91c1c"),
        ),
        P("5.1 Mecanica", "h2"),
        P(
            "Cada usuario tem um cupom unico <font face='Courier'>APP-XXXXXX</font>. "
            "Quando alguem se cadastra usando esse cupom, ganha 10% de desconto "
            "na primeira cobranca. O indicador acumula 10% de cada pagamento "
            "futuro do indicado em <font face='Courier'>applicashBalanceCents</font> "
            "enquanto a assinatura do indicado estiver ACTIVE."
        ),
        P("5.2 Modelo de dados (Tabela 12 parcial - Applicash)", "h2"),
        P("Colecoes raiz dedicadas (acessadas por queries cross-user):", "body"),
    ]
    rows = [
        ["coupons/{code}",
         "ownerUid, discountPct (int), usesCount, maxUses?, active, createdAt",
         "Indice: ownerUid"],
        ["referrals/{id}",
         "referrerUid, referredUid, couponCode, convertedAt, firstPaymentAt",
         "Indices: referrerUid+convertedAt, referredUid"],
        ["commissions/{id}",
         "beneficiaryUid, sourceUid, paymentId, amountCents, status "
         "(PENDING|CREDITED|REVERTED), createdAt",
         "Indices: beneficiaryUid+createdAt, paymentId (unico)"],
        ["milestones/{id}",
         "uid, tier (5|10|30|50|100), achievedAt, rewardClaimed",
         "Indice: uid+tier"],
        ["applicashLedger/{id}",
         "uid, type (CREDIT|DEBIT), amountCents, refType, refId, balanceAfterCents, createdAt",
         "Indice: uid+createdAt desc"],
    ]
    flow.append(make_table(
        ["Colecao", "Campos", "Indices compostos"],
        rows, [4 * cm, 8 * cm, 4.5 * cm],
    ))
    flow.append(caption(9, "Colecoes Firestore do Applicash. Saque PIX nao listado."))
    flow.append(P("5.3 Metas", "h2"))
    rows = [
        ["5 indicacoes ativas", "1 mes gratis na assinatura", "R$ 19,90"],
        ["10 indicacoes ativas", "Early access a novos recursos", "Experiencia VIP"],
        ["30 indicacoes ativas", "Assinatura vitalicia", "R$ 2.388 / ano"],
        ["50 indicacoes ativas", "Embaixador + kit oficial", "Status + brindes"],
        ["100 indicacoes ativas", "Mentoria 1:1 com a equipe financeira", "Inestimavel"],
    ]
    flow.append(make_table(["Meta", "Recompensa", "Valor estimado"], rows,
                           [4.5 * cm, 7 * cm, 5 * cm]))
    flow.append(caption(10, "Recompensas por milestones do Applicash."))
    flow.append(PageBreak())
    return flow


def section_admin():
    flow = [
        P("6. Painel Administrativo", "h1"),
        P(
            "Restrito a usuarios com role ADMIN e MFA habilitado. Implementado "
            "como um segmento de rotas <font face='Courier'>(admin)</font> em "
            "Next.js, com middleware que valida custom claim "
            "<font face='Courier'>role=ADMIN</font> no token do Firebase Auth."
        ),
        P("6.1 Modulos", "h2"),
    ]
    rows = [
        ["Dashboard", "MRR, churn, novos usuarios, ARR, ativos vs inativos"],
        ["Usuarios", "Lista, filtros, busca, edicao, suspensao, reset de senha"],
        ["Assinaturas", "Status, historico, cancelamentos, reembolsos, retentativas"],
        ["Applicash", "Ranking, comissoes pendentes, cupons promocionais, ledger"],
        ["Carteira recomendada", "Alocacao, ativos, publicacao mensal, perfis"],
        ["Financeiro", "Receita bruta, taxas Asaas, projecao MRR, exportacao CSV"],
        ["Conteudo", "FAQ, artigos, jornada financeira (CRUD)"],
        ["Configuracoes", "Planos, % comissao, duracao do trial, integracoes"],
        ["Logs", "Auditoria de acoes administrativas e webhooks"],
    ]
    flow.append(make_table(["Modulo", "Funcionalidades"], rows, [4.5 * cm, 12 * cm]))
    flow.append(caption(11, "Modulos do painel administrativo."))
    flow.append(P("6.2 Metricas-chave", "h2"))
    flow.append(bullets([
        "<b>MRR / ARR:</b> receita recorrente mensal e anualizada.",
        "<b>Churn rate:</b> cancelamentos / ativos no inicio do mes.",
        "<b>CAC:</b> custo de marketing dividido por novos pagantes.",
        "<b>LTV:</b> ticket medio dividido por churn mensal.",
        "<b>NPS:</b> coletado em pesquisa periodica in-app.",
        "<b>DAU/MAU:</b> engajamento de uso, via Vercel Analytics + evento custom.",
    ]))
    flow.append(PageBreak())
    return flow


def section_data_model():
    flow = [
        P("7. Modelo de Dados Completo em Firestore", "h1"),
        P(
            "Esta secao reescreve a Tabela 12 do documento original no formato "
            "NoSQL correto. Em vez de pensar em tabelas com chaves estrangeiras, "
            "o modelo Firestore usa colecoes raiz (acessadas por queries globais) "
            "e subcolecoes (acessadas a partir do documento pai)."
        ),
        callout(
            "Como ler esta secao",
            "<b>Subcolecao</b> indica que o caminho real e "
            "<font face='Courier'>users/{uid}/&lt;subcolecao&gt;/{docId}</font>. "
            "<b>Colecao raiz</b> indica caminho direto. <b>Indices compostos</b> "
            "precisam ser declarados em <font face='Courier'>firestore.indexes.json"
            "</font>; sem eles a query falha em runtime.",
        ),
        P("7.1 Colecao users e subcolecoes", "h2"),
    ]
    rows = [
        ["users/{uid}", "Documento", "Perfil + assinatura + saldo Applicash. Detalhes na Tabela 6."],
        ["users/{uid}/investments/{id}", "Subcolecao",
         "Ativo: ticker, classe, quantidade, precoMedioCents, custodia, broker, notes"],
        ["users/{uid}/investments/{id}/dividends/{id}", "Subcolecao",
         "Dividendo recebido: amountCents, payDate, type"],
        ["users/{uid}/transactions/{id}", "Subcolecao",
         "type (INCOME|EXPENSE|TRANSFER), amountCents, category, date, "
         "creditCardId?, recurrenceId?"],
        ["users/{uid}/creditCards/{id}", "Subcolecao",
         "name, limitCents, closingDay, dueDay, brand"],
        ["users/{uid}/goals/{id}", "Subcolecao",
         "title, targetCents, savedCents, deadline, contributions[]"],
        ["users/{uid}/portfolioSnapshots/{yyyymm}", "Subcolecao",
         "Snapshot mensal: totalCents, byClass{}, takenAt"],
        ["users/{uid}/investorProfile", "Documento unico",
         "Resultado do questionario: profile, score, answeredAt"],
        ["users/{uid}/paymentHistory/{paymentId}", "Subcolecao",
         "Pagamento individual recebido (mirror do Asaas)"],
    ]
    flow.append(make_table(["Caminho", "Tipo", "Conteudo"], rows,
                           [6 * cm, 2.5 * cm, 8 * cm]))
    flow.append(caption(12, "Modelo Firestore - parte 1: dados por usuario."))

    flow.append(P("7.2 Colecoes raiz (multi-usuario)", "h2"))
    rows = [
        ["coupons/{code}", "Cupom de indicacao. Code = doc id. Ver Tabela 9."],
        ["referrals/{id}", "Indicacoes convertidas, vinculo referrer-referred."],
        ["commissions/{id}", "Comissoes Applicash creditadas (idempotente por paymentId)."],
        ["milestones/{id}", "Conquistas do programa Applicash."],
        ["applicashLedger/{id}", "Ledger imutavel append-only de creditos e debitos."],
        ["subscriptions/{asaasId}", "Assinatura Asaas (espelho). uid, plan, status, nextDueDate."],
        ["webhookEvents/{id}", "Log idempotente de webhooks Asaas processados."],
        ["webhookDeadLetter/{id}", "Webhooks que falharam ao processar."],
        ["recommendedPortfolio/current", "Documento unico da carteira recomendada vigente."],
        ["recommendedPortfolio/history/{yyyymm}", "Historico mensal de carteiras."],
        ["systemConfig/global", "Planos, taxas, % comissao, duracao do trial."],
        ["auditLogs/{id}", "Acoes administrativas (quem, o que, quando, payload)."],
    ]
    flow.append(make_table(["Caminho", "Descricao"], rows, [6 * cm, 10.5 * cm]))
    flow.append(caption(13, "Modelo Firestore - parte 2: colecoes raiz."))

    flow.append(P("7.3 Indices compostos obrigatorios", "h2"))
    flow.append(P(
        "Toda query <font face='Courier'>where()</font> com mais de um campo "
        "ou combinada com <font face='Courier'>orderBy()</font> em campo "
        "diferente exige indice composto declarado em "
        "<font face='Courier'>firestore.indexes.json</font>:"
    ))
    rows = [
        ["users/{uid}/transactions",
         "type ASC, date DESC", "Listagem do controle financeiro filtrada por tipo"],
        ["users/{uid}/investments",
         "class ASC, ticker ASC", "Carteira agrupada por classe de ativo"],
        ["referrals",
         "referrerUid ASC, convertedAt DESC", "Lista de indicacoes do usuario"],
        ["commissions",
         "beneficiaryUid ASC, createdAt DESC", "Extrato de comissoes Applicash"],
        ["applicashLedger",
         "uid ASC, createdAt DESC", "Ledger por usuario em ordem cronologica"],
        ["subscriptions",
         "status ASC, nextDueDate ASC", "Painel admin: assinaturas a vencer"],
        ["auditLogs",
         "actorUid ASC, createdAt DESC", "Auditoria por administrador"],
    ]
    flow.append(make_table(["Colecao", "Indice composto", "Uso"], rows,
                           [4.5 * cm, 5.5 * cm, 6.5 * cm]))
    flow.append(caption(14, "Indices compostos obrigatorios."))

    flow.append(P("7.4 Regras de seguranca (firestore.rules)", "h2"))
    flow.append(P(
        "As regras devem garantir: (1) cada usuario so le/escreve "
        "<font face='Courier'>users/{uid}</font> proprio; (2) campos sensiveis "
        "(role, subscription.*, applicashBalanceCents) sao read-only para o "
        "cliente, escritos apenas pelo Admin SDK em Route Handlers; (3) "
        "<font face='Courier'>auditLogs</font>, <font face='Courier'>"
        "webhookEvents</font> e <font face='Courier'>commissions</font> sao "
        "totalmente bloqueados para clientes; (4) <font face='Courier'>"
        "auditLogs</font> aceita apenas role=ADMIN para leitura."
    ))

    flow.append(P("7.5 Estrategia de migracao do localStorage", "h2"))
    flow.append(P(
        "No primeiro login na nova plataforma, um Server Action le um payload "
        "JSON enviado pelo cliente (extraido do localStorage), valida com Zod, "
        "transforma em estrutura de subcolecoes e grava em batch. O "
        "<i>localStorage</i> original e mantido por 30 dias como backup local. "
        "Para usuarios com volume grande, a importacao e feita em chunks com "
        "barra de progresso na UI."
    ))
    flow.append(PageBreak())
    return flow


def section_deploy():
    flow = [
        P("8. Publicacao e Deploy", "h1"),
        P("8.1 Infraestrutura", "h2"),
    ]
    rows = [
        ["Vercel (hosting + Route Handlers)", "Hobby: gratis", "Pro: US$20/mes"],
        ["Firebase (BD + Auth + Storage)", "Spark: gratis", "Blaze: pay-per-use"],
        ["Resend (e-mail transacional)", "Free: 3k/mes", "Pro: US$20/mes"],
        ["Asaas (pagamentos)", "Sem mensalidade", "Por transacao"],
        ["Sentry (erros)", "Developer: gratis", "Team: US$26/mes"],
        ["Dominio .com.br", "R$ 40/ano", "Renovacao anual"],
    ]
    flow.append(make_table(["Servico", "Plano inicial", "Escala"], rows,
                           [6 * cm, 5 * cm, 5.5 * cm]))
    flow.append(caption(15, "Custos da infraestrutura inicial."))

    flow.append(P("8.2 Checklist de publicacao", "h2"))
    flow.append(bullets([
        "Dominio appliquei.com.br configurado na Vercel com SSL automatico.",
        "Variaveis de ambiente em Vercel (FIREBASE_*, ASAAS_API_KEY, RESEND_API_KEY).",
        "Service account do Firebase Admin SDK em variavel encriptada.",
        "Headers de seguranca via <font face='Courier'>next.config.js</font> "
        "(CSP, HSTS, X-Frame-Options, Referrer-Policy).",
        "Rate limiting nos Route Handlers de auth (Upstash Ratelimit).",
        "Sentry instalado client-side e server-side.",
        "Webhooks Asaas validados em ambiente de staging com ngrok.",
        "Templates de e-mail (boas-vindas, reset, cobranca, lembrete trial).",
        "robots.txt e sitemap.xml gerados pela rota proper do Next.",
        "Backup diario do Firestore via scheduled Cloud Function.",
        "Procedimento de rollback documentado (Vercel rollback por deployment).",
        "Pagina de status: <i>status.appliquei.com.br</i> (Better Stack ou Statuspage).",
        "<b>LGPD:</b> politica de privacidade, termos de uso, registro de "
        "consentimento, fluxo de exclusao de conta, contato do DPO.",
    ]))
    flow.append(PageBreak())
    return flow


def section_extras():
    flow = [
        P("9. Funcionalidades Adicionais Sugeridas", "h1"),
        P(
            "Itens que agregam valor mas nao bloqueiam o lancamento. Avaliar "
            "apos validar retencao com a base inicial de pagantes."
        ),
    ]
    rows = [
        ["Notificacoes push (FCM)", "Cobrancas, dividendos, metas atingidas", "Alta", "Media"],
        ["Importacao OFX", "Bancos e corretoras (extrato)", "Alta", "Alta"],
        ["Exportacao PDF", "Relatorios mensais e anuais", "Media", "Media"],
        ["Open Finance", "Sincronizacao via OFB", "Muito alta", "Muito alta"],
        ["PWA + offline", "Instalavel, cache de read-only", "Media", "Media"],
        ["Chat IA financeiro", "Assistente para duvidas e analise", "Alta", "Media"],
        ["Comparador de ativos", "Lado a lado com metricas", "Alta", "Media"],
        ["Gamificacao", "Conquistas, ranking de disciplina", "Media", "Baixa"],
        ["Comunidade", "Forum interno", "Media", "Media"],
        ["API publica", "Integracoes de terceiros", "Baixa", "Alta"],
        ["Saque PIX do Applicash", "Pos-MVP, depende de KYC e parecer fiscal", "Media", "Alta"],
    ]
    flow.append(make_table(
        ["Funcionalidade", "Descricao", "Impacto", "Complexidade"],
        rows, [4 * cm, 7.5 * cm, 2.5 * cm, 2.5 * cm],
    ))
    flow.append(caption(16, "Backlog pos-MVP."))
    flow.append(PageBreak())
    return flow


def section_roadmap():
    flow = [
        P("10. Cronograma e Investimento", "h1"),
        P("10.1 Cronograma (16 semanas com 2 devs / 20-22 semanas com 1 dev)", "h2"),
    ]
    rows = [
        ["1", "Spike: extrair calculos puros + Vitest", "Funcoes de juros, alocacao, dividendos com testes"],
        ["2-3", "Setup Next.js + Vercel + Firebase + design system", "Repo novo, deploy preview, login basico"],
        ["4-5", "Auth completo + onboarding + trial", "Cadastro, magic link, MFA admin"],
        ["6-9", "Migracao Carteira + Controle Financeiro", "Funcionalidades core em Firestore"],
        ["10-11", "Asaas: planos, checkout, webhooks", "Cobranca real funcionando"],
        ["12-13", "Applicash MVP (sem saque PIX)", "Cupom, comissao, abate na propria assinatura"],
        ["14-15", "Painel admin + observabilidade", "Dashboard, usuarios, assinaturas"],
        ["16", "Hardening + LGPD + soft launch", "Beta fechado com 50-100 usuarios"],
    ]
    flow.append(make_table(["Semana", "Atividade", "Entregavel"], rows,
                           [1.8 * cm, 7.2 * cm, 7.5 * cm]))
    flow.append(caption(17, "Cronograma detalhado."))

    flow.append(P("10.2 Investimento estimado", "h2"))
    rows = [
        ["Desenvolvimento - 1 dev senior, 5 meses", "R$ 25.000 - 45.000", "-"],
        ["Desenvolvimento - 2 devs, 4 meses", "R$ 30.000 - 55.000", "-"],
        ["Dominio .com.br", "R$ 40", "Anual"],
        ["Vercel Pro (opcional)", "-", "~ R$ 110 / mes"],
        ["Firebase Blaze (uso real)", "-", "R$ 80 - 250 / mes"],
        ["Resend Pro", "-", "~ R$ 110 / mes"],
        ["Sentry Team (opcional)", "-", "~ R$ 145 / mes"],
        ["Asaas - PIX", "-", "1.99% por transacao"],
        ["Asaas - Cartao", "-", "2.99% + R$ 0,39 por transacao"],
        ["Asaas - Boleto", "-", "R$ 1,99 por transacao"],
        ["Total operacional inicial", "-", "R$ 0 a R$ 600 / mes"],
    ]
    flow.append(make_table(["Item", "Custo unico", "Custo mensal"], rows,
                           [8 * cm, 4.5 * cm, 4 * cm]))
    flow.append(caption(18, "Investimento estimado para publicacao."))
    flow.append(PageBreak())
    return flow


def section_pages():
    flow = [
        P("11. Paginas e Telas a Implementar", "h1"),
        P(
            "Lista completa das rotas do app Next.js, organizadas por grupo. "
            "Cada rota corresponde a um arquivo "
            "<font face='Courier'>page.tsx</font> dentro do segmento adequado."
        ),
    ]
    rows = [
        ["/login", "(auth)", "Nao existe", "Critica"],
        ["/registro", "(auth)", "Nao existe", "Critica"],
        ["/esqueci-senha", "(auth)", "Nao existe", "Critica"],
        ["/verificar-email", "(auth)", "Nao existe", "Alta"],
        ["/", "(marketing)", "Nao existe", "Alta"],
        ["/precos", "(marketing)", "Nao existe", "Alta"],
        ["/sobre", "(marketing)", "Nao existe", "Media"],
        ["/dashboard", "(dashboard)", "Existe (patrimonio)", "Alta"],
        ["/investimentos", "(dashboard)", "Existe", "Alta"],
        ["/controle-financeiro", "(dashboard)", "Existe", "Alta"],
        ["/carteira-recomendada", "(dashboard)", "Existe", "Alta"],
        ["/simulador", "(dashboard)", "Existe", "Alta"],
        ["/meus-sonhos", "(dashboard)", "Existe", "Media"],
        ["/applicash", "(dashboard)", "Existe (mock)", "Alta"],
        ["/assinatura", "(dashboard)", "Nao existe", "Critica"],
        ["/configuracoes", "(dashboard)", "Nao existe", "Alta"],
        ["/relatorio-mensal", "(dashboard)", "Placeholder", "Media"],
        ["/jornada-financeira", "(dashboard)", "Placeholder", "Baixa"],
        ["/admin", "(admin)", "Parcial", "Alta"],
        ["/admin/usuarios", "(admin)", "Nao existe", "Alta"],
        ["/admin/assinaturas", "(admin)", "Nao existe", "Alta"],
        ["/admin/applicash", "(admin)", "Nao existe", "Alta"],
        ["/admin/financeiro", "(admin)", "Nao existe", "Media"],
        ["/admin/carteira-recomendada", "(admin)", "Existe", "Media"],
        ["/admin/conteudo", "(admin)", "Nao existe", "Baixa"],
        ["/admin/logs", "(admin)", "Nao existe", "Baixa"],
    ]
    flow.append(make_table(
        ["Rota", "Grupo", "Status atual", "Prioridade"],
        rows, [5 * cm, 3.5 * cm, 4 * cm, 3 * cm],
    ))
    flow.append(caption(19, "Inventario de paginas/rotas Next.js."))
    flow.append(PageBreak())
    return flow


def section_appendix():
    flow = [
        P("12. Apendice - Resumo das Decisoes Fechadas", "h1"),
        callout(
            "Decisao 1 - Stack",
            "Next.js 14 (App Router) + Vercel para frontend e Route Handlers. "
            "Firebase (Firestore + Auth + Storage) como backend. "
            "Sem Vite, sem Netlify, sem mistura. TypeScript obrigatorio.",
        ),
        Spacer(1, 0.4 * cm),
        callout(
            "Decisao 2 - Modelo de dados",
            "Tabelas SQL substituidas por colecoes e subcolecoes Firestore. "
            "Sem PK/FK, sem bcrypt, sem Decimal. Dinheiro em centavos como integer. "
            "Indices compostos declarados em firestore.indexes.json. Regras de "
            "seguranca em firestore.rules cobrindo todos os caminhos.",
        ),
        Spacer(1, 0.4 * cm),
        callout(
            "Decisao 3 - Saque PIX fora do MVP",
            "Saldo Applicash so abate na propria assinatura do indicador. "
            "Saque via PIX entra em fase posterior, apos parecer fiscal/juridico "
            "e validacao de volume. Isso simplifica drasticamente o MVP e remove "
            "obrigacoes de KYC, antifraude e tributacao do escopo inicial.",
            color=colors.HexColor("#b91c1c"),
        ),
        Spacer(1, 1 * cm),
        P("Proximos passos imediatos", "h2"),
        bullets([
            "Aprovar este documento como base do contrato de desenvolvimento.",
            "Iniciar Fase 0 (1 semana): extracao de calculos puros + suite de testes.",
            "Criar projeto Firebase, conta Vercel, conta Asaas (sandbox).",
            "Definir politica de privacidade e termos de uso (LGPD) com apoio juridico.",
            "Bater foto do estado atual do HTML para garantir paridade funcional.",
        ]),
    ]
    return flow


def main():
    doc = SimpleDocTemplate(
        OUTPUT, pagesize=A4,
        leftMargin=2 * cm, rightMargin=2 * cm,
        topMargin=2.2 * cm, bottomMargin=2.2 * cm,
        title="Appliquei - Plano de Publicacao v2",
        author="Plano de migracao Appliquei",
    )
    story = []
    story += cover()
    story += section_executive_summary()
    story += section_architecture()
    story += section_auth()
    story += section_payments()
    story += section_applicash()
    story += section_admin()
    story += section_data_model()
    story += section_deploy()
    story += section_extras()
    story += section_roadmap()
    story += section_pages()
    story += section_appendix()

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"PDF gerado: {OUTPUT}")


if __name__ == "__main__":
    main()
