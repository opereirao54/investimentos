# Imagens: o que pode usar e onde achar

Vale para Reel, capa, carrossel, post e story. Ler antes de pôr qualquer foto
ou imagem que não seja feita por nós: telas do app, ilustração, mascote ou
gerada pelo fundador.

## A regra

- **Só imagem própria ou de licença livre, com crédito.** Própria: telas do
  app, ilustração feita em código, o mascote, foto ou imagem gerada pelo
  fundador. Livre: domínio público ou Creative Commons que permita uso
  comercial (ver tabela).
- **Print, arte, logo ou personagem de terceiros não entram:** jogo, filme,
  série, banco, corretora, outro app, veículo de imprensa. É o mesmo princípio
  das manchetes recriadas no visual da marca (`COMBINADOS.md`).
- **"Fazer uma pequena modificação" não libera.** Cor trocada, corte, espelho,
  filtro ou texto por cima continuam sendo obra derivada, e usar sem
  autorização é a mesma infração (Lei 9.610/98, art. 29). As redes comparam o
  conteúdo da imagem, não o arquivo, e acham a versão modificada.
- **O risco:** a denúncia derruba o Reel, dá strike e, numa conta de marca às
  vésperas do lançamento, custa alcance e credibilidade. Logo de banco ou
  corretora ainda sugere parceria que não existe (CONAR).
- **Para lembrar um assunto sem usar nada dele:** elementos genéricos (ícones,
  cores, objetos do dia a dia), ilustração própria e foto livre de um lugar
  ou objeto real parecido.
- **Exceção só por decisão do fundador**, avisado do risco. Ela tem de ficar
  registrada com data no `COMBINADOS.md`, com crédito "reprodução" e um plano
  B (versão com imagem livre guardada).

## Licenças

Uso comercial: a Appliquei é empresa, então toda peça conta como comercial.

| Licença | Pode? | Crédito |
|---|---|---|
| Domínio público / CC0 | sim | não obrigatório, mas dar |
| CC BY | sim | obrigatório: autor + licença |
| CC BY-SA | sim | autor + licença; a imagem modificada (recorte, coisas por cima) fica na mesma licença |
| qualquer NC (não comercial) | **não** | — |
| qualquer ND (sem derivações) | evitar: até recorte pode contar como modificação | — |
| sem licença / "todos os direitos reservados" | não | — |

**Crédito:** `Foto: Autor (CC BY 2.0), via Wikimedia Commons`, pequeno na
própria imagem e completo na legenda.

## Onde achar: Wikimedia Commons

- **Rede:** `commons.wikimedia.org` e `upload.wikimedia.org` estão liberados
  no ambiente Default (22/11/2026). Pexels e Unsplash são bloqueados pelo
  proxy (403).
- **Busca (`list=search`) quase sempre dá 429:** o IP é compartilhado. Use
  categorias:
  1. achar o nome da categoria:
     `action=query&list=allcategories&acprefix=<começo do nome>`
  2. listar os arquivos dela:
     `action=query&list=categorymembers&cmtype=file&cmlimit=40&cmtitle=Category:<nome>`
  3. licença, autor e miniatura:
     `action=query&titles=File:<a>|File:<b>&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1280&iiextmetadatafilter=LicenseShortName|Artist`
- **Baixar:**
  - Pegue a **miniatura de tamanho padrão** (1280 ou 1920 px de largura) em
    `https://upload.wikimedia.org/wikipedia/commons/thumb/...`. O `thumburl`
    vem com o host `thumb.wikimedia.org`, que não é liberado: troque para
    `upload.wikimedia.org`.
  - O original e os tamanhos fora do padrão (960, 2560) costumam dar 429.
  - Use um User-Agent descritivo e repita até 5 vezes, com ~15 s de espera.
- **Confira cada arquivo com `file`:** tem de dizer JPEG. Uma resposta 429 é
  uma página HTML salva com nome `.jpg`.
- **Nunca deixe dois downloads gravando o mesmo arquivo:** um job antigo em
  segundo plano pode sobrescrever fotos boas com páginas de erro.
- **Antes de escolher, olhe tudo junto:** monte uma folha de contato com as
  candidatas. Guarde a escolhida na pasta da peça, com autor, licença e link.
