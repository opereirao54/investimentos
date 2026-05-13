# Graph Report - investimentos-claude-finance-app-storage-5W93N  (2026-05-13)

## Corpus Check
- 7 files · ~386,211 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 62 nodes · 147 edges · 13 communities (10 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]

## God Nodes (most connected - your core abstractions)
1. `P()` - 15 edges
2. `main()` - 15 edges
3. `make_table()` - 14 edges
4. `Appliquei v13.0 - Gestão Financeira Inteligente` - 14 edges
5. `caption()` - 13 edges
6. `callout()` - 8 edges
7. `bullets()` - 7 edges
8. `section_executive_summary()` - 7 edges
9. `section_architecture()` - 7 edges
10. `section_auth()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `section_architecture()` --calls--> `P()`  [EXTRACTED]
  scripts/build_plan_pdf.py → scripts/build_plan_pdf.py  _Bridges community 4 → community 2_
- `section_payments()` --calls--> `P()`  [EXTRACTED]
  scripts/build_plan_pdf.py → scripts/build_plan_pdf.py  _Bridges community 4 → community 3_
- `section_architecture()` --calls--> `make_table()`  [EXTRACTED]
  scripts/build_plan_pdf.py → scripts/build_plan_pdf.py  _Bridges community 3 → community 2_

## Communities (13 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.33
Nodes (10): attach(), attachWhenReady(), collectKeysPayload(), flushPush(), mainRef(), onUser(), pullAndApply(), shouldSyncKey() (+2 more)

### Community 1 - "Community 1"
Cohesion: 0.18
Nodes (10): Appliquei v13.0 - Gestão Financeira Inteligente, 🤝 Contribuição, 👨‍💻 Desenvolvimento, 🎨 Design System, Firebase (incremental), ✨ Funcionalidades, 📄 Licença, 📸 Recursos Visuais (+2 more)

### Community 2 - "Community 2"
Cohesion: 0.44
Nodes (8): build_styles(), callout(), cover(), on_page(), Gera o PDF do plano de publicacao Appliquei v2 (revisado).  Decisoes fechadas ne, section_architecture(), section_auth(), section_data_model()

### Community 3 - "Community 3"
Cohesion: 0.44
Nodes (9): caption(), cell(), main(), make_table(), section_applicash(), section_extras(), section_pages(), section_payments() (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.6
Nodes (6): bullets(), P(), section_admin(), section_appendix(), section_deploy(), section_executive_summary()

### Community 5 - "Community 5"
Cohesion: 0.5
Nodes (4): code:bash (python -m pip install -r requirements-graphify.txt), 🧠 Graphify (grafo de conhecimento no Cursor), Instalação (Python 3.10+), Uso

## Knowledge Gaps
- **14 isolated node(s):** `📖 Sobre`, `✨ Funcionalidades`, `🛠️ Tecnologias Utilizadas`, `code:bash (git clone <repositorio>)`, `code:block2 (/workspace)` (+9 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Appliquei v13.0 - Gestão Financeira Inteligente` connect `Community 1` to `Community 8`, `Community 5`, `Community 6`, `Community 7`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `🧠 Graphify (grafo de conhecimento no Cursor)` connect `Community 5` to `Community 1`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `🚀 Como Usar` connect `Community 7` to `Community 1`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `📖 Sobre`, `✨ Funcionalidades`, `🛠️ Tecnologias Utilizadas` to the rest of the system?**
  _14 weakly-connected nodes found - possible documentation gaps or missing edges._