# Appliquei v13.0 - Gestão Financeira Inteligente

![Versão](https://img.shields.io/badge/vers%C3%A3o-13.0-green)
![Licença](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)

## 📖 Sobre

**Appliquei** é uma aplicação web de gestão financeira pessoal e empresarial, desenvolvida com foco em design premium e experiência do usuário intuitiva. A versão 13.0 traz uma interface moderna com sidebar escura, tema claro/escuro e visualizações gráficas avançadas.

## ✨ Funcionalidades

- 💰 **Gestão Financeira Completa** - Controle de receitas, despesas e patrimônio
- 📊 **Dashboards Interativos** - Gráficos visuais com Chart.js para análise de dados
- 🌓 **Tema Claro/Escuro** - Alternância entre modos de exibição
- 📱 **Design Responsivo** - Interface adaptável para diferentes dispositivos
- 🎨 **Design System Premium** - UI sofisticada com paleta de cores cuidadosamente selecionada
- 🔍 **Ícones Modernos** - Integração com Phosphor Icons
- 📈 **Relatórios Visuais** - Visualização clara de métricas financeiras

## 🛠️ Tecnologias Utilizadas

| Tecnologia | Descrição |
|------------|-----------|
| HTML5 | Estrutura semântica da aplicação |
| CSS3 | Estilização com Design System personalizado |
| JavaScript | Lógica e interatividade |
| Chart.js | Biblioteca de gráficos |
| Chart.js Plugin Datalabels | Exibição de dados nos gráficos |
| Phosphor Icons | Biblioteca de ícones modernos |
| Google Fonts | Tipografia (Syne, Figtree, DM Mono) |

## 🚀 Como Usar

1. **Clone ou baixe o repositório**
   ```bash
   git clone <repositorio>
   cd workspace
   ```

2. **Abra a aplicação no navegador**
   - Basta abrir o arquivo `Appliquei_v13.0.html` em qualquer navegador moderno
   - Não requer servidor ou instalação de dependências

3. **Navegação**
   - Use a sidebar lateral para acessar as diferentes seções
   - Alterne entre temas claro/escuro conforme preferência
   - Visualize gráficos e relatórios financeiros

## 📁 Estrutura do Projeto

```
/workspace
├── Appliquei_v13.0.html      # Arquivo principal da aplicação
├── appliquei_logo_white.jpg  # Logo da aplicação (versão branca)
├── appliquei_favicon.jpg     # Ícone/favicon da aplicação
├── requirements-graphify.txt # Opcional: CLI Graphify (Python)
├── .cursor/rules/graphify.mdc # Opcional: regra Cursor após `graphify cursor install`
├── graphify-out/             # Grafo versionado (GRAPH_REPORT.md, graph.html, graph.json)
├── web/                      # Firebase (init incremental; ver secção Firebase)
└── README.md                 # Este arquivo
```

## 🎨 Design System

A aplicação utiliza um Design System próprio com:

- **Cores Primárias**: Tons de verde esmeralda (#10b981, #059669)
- **Sidebar Dark**: Sempre escura com gradientes sutis
- **Modo Escuro**: Tema dark mode completo para área principal
- **Tipografia**: 
  - Syne (títulos)
  - Figtree (corpo)
  - DM Mono (código/dados)
- **Componentes**: Cards, botões, inputs e tabelas com sombras suaves e bordas arredondadas

## 📸 Recursos Visuais

- Sidebar colapsável com animações suaves
- Cards com efeitos hover e sombras dinâmicas
- Gráficos interativos com datalabels
- Transições fluidas entre temas
- Layout responsivo e adaptativo

## 🔧 Personalização

O Design System permite fácil personalização através das variáveis CSS no arquivo HTML:

```css
:root {
    --cor-primaria: #059669;
    --radius: 14px;
    --shadow-card: 0 1px 2px rgba(0,0,0,0.04);
    /* ... mais variáveis */
}
```

## 📄 Licença

Este projeto está disponível para uso e modificação.

## 👨‍💻 Desenvolvimento

Para modificações ou melhorias:

1. Edite diretamente o arquivo `Appliquei_v13.0.html`
2. As dependências são carregadas via CDN (Chart.js, Phosphor Icons, Google Fonts)
3. Teste em múltiplos navegadores para garantir compatibilidade

## 🧠 Graphify (grafo de conhecimento no Cursor)

O [Graphify](https://graphify.homes/) gera um grafo a partir do código e documentação (`graphify-out/graph.html`, `graph.json`, `GRAPH_REPORT.md`), para o assistente responder perguntas de arquitetura com estrutura em vez de adivinhar. **Não substitui o Chart.js** dos dashboards financeiros; é uma camada à parte para desenvolvimento.

### Instalação (Python 3.10+)

```bash
python -m pip install -r requirements-graphify.txt
python -m graphify cursor install
```

O segundo comando cria ou atualiza `.cursor/rules/graphify.mdc` neste repositório.

### Uso

- No Cursor, peça para rodar **Graphify na pasta do projeto** (equivalente ao fluxo `/graphify .` do [README oficial](https://github.com/safishamsi/graphify)), ou use a versão hospedada em [graphify.homes](https://graphify.homes/) (envio de ZIP).
- Em terminal, extração sem o comando slash do Claude Code: `python -m graphify extract .` (requer variáveis de API do backend escolhido; ver documentação do pacote).
- Após alterar código: `python -m graphify update .` (atualização AST, sem custo de LLM).

O repositório inclui **`graphify-out/graph.json`**, **`GRAPH_REPORT.md`** e **`graph.html`** para clones e para a regra do Cursor. Apenas **`graphify-out/cache/`** fica ignorada no Git (regenerável). Para atualizar o grafo após mudanças grandes: `python -m graphify extract .` e, se precisar, `python -m graphify cluster-only .`.

## Firebase (incremental)

1. Copie `web/firebase-config.example.js` → `web/firebase-config.local.js` e preencha com o objeto do SDK (ficheiro **gitignored**).
2. Abra `Appliquei_v13.0.html` a partir da pasta do projeto (para os caminhos `web/*.js` resolverem). Sem `apiKey`, o Firebase **não** inicializa; a app segue só com `localStorage`.
3. `window.AppliqueiFirebase` expõe `ready`, `auth`, `db` quando a config estiver válida. Próximo passo: login UI + sync Firestore (não incluído neste commit).

## 🤝 Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para:
- Reportar bugs
- Sugerir novas funcionalidades
- Enviar pull requests

---

**Appliquei v13.0** - Transformando a gestão financeira em uma experiência simples e elegante.


