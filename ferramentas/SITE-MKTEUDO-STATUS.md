# Site Mkteúdo — o que mudou hoje

29 de outubro de 2026

---

## Resumo

O site deixou de ser uma brochura e virou um sistema de captura.
Antes de hoje, **o formulário de contato não tinha destino** — o
`action` estava vazio e a tela de sucesso aparecia 150ms depois do
clique, independentemente de qualquer coisa ter acontecido. A
calculadora tentava entregar os leads numa API antiga do RD Station
sem token, dentro de um `try/catch` silencioso.

Quem preencheu qualquer um dos dois nos últimos meses, você
provavelmente nunca viu.

Hoje os dois gravam numa planilha, pontuam o lead e disparam eventos
de qualificação. E o site foi corrigido no celular.

---

## 1. A arquitetura nova

Um único módulo — `/js/mkt-leads.js` — cuida de tudo que os dois
formulários precisam:

| Peça | O que faz |
|---|---|
| **Sessão** | Identificador próprio, 1ª parte, 90 dias. Costura as respostas da mesma pessoa numa linha só. |
| **Atribuição** | Primeiro toque (como descobriu a Mkteúdo) **e** último toque (o que trouxe nesta visita). |
| **Pontuação** | Motor de ICP configurável, 100 pontos. |
| **Eventos** | `dataLayer` para GTM / GA4 / Meta, sem nenhum dado pessoal. |
| **Entrega** | POST para a planilha com **fila de retentativa**. |
| **Anti-spam** | Cloudflare Turnstile. |

### A regra que importa: nenhum lead morre em silêncio

Se o envio falhar — rede caída, planilha fora do ar, qualquer coisa —
o lead entra numa fila no navegador do visitante e é reenviado na
próxima página que ele abrir. O visitante nunca vê erro: ele fez a
parte dele.

---

## 2. Formulário de contato: agora em dois passos

Essa é a mudança estratégica mais importante do dia.

**Antes:** um formulário de 17 campos numa tela só. Quem desistia no
meio não deixava nada.

**Agora:**

- **Passo 1** — nome, e-mail, telefone, empresa, site. Quatro campos
  obrigatórios. Ao clicar em "Continuar", **o contato já é gravado**.
- **Passo 2** — a qualificação inteira, enriquecendo a mesma linha.

O ganho: se a pessoa abandonar no passo 2, você **ainda tem o
contato** e sabe que ela chegou a se interessar. Antes, abandono era
perda total. E um formulário que começa com 4 campos converte mais
que um que começa com 17.

### Perguntas reorganizadas

O campo `cargo` misturava senioridade com departamento ("Sócio /
Diretor" ao lado de "Marketing"). Foi separado em dois:

- **`nivel_decisao`** — Sócio, CEO, Diretor, Gerente, Coordenador,
  Analista, Outro
- **`area`** — Diretoria, Marketing, Comercial, Operações,
  Financeiro, Tecnologia, Outra

E foram acrescentados **`setor`** (15 opções, agronegócio primeiro,
que é Ribeirão) e **`site`** da empresa — normalizado para host
limpo, para você chegar na reunião já conhecendo o negócio.

---

## 3. Pontuação de leads

Você pediu: *"quero empresa e pessoa com poder de decisão grande."*
O modelo tem duas partes por causa disso.

**A soma** — 100 pontos:

| Critério | Peso |
|---|---|
| Nível de decisão | **30** |
| Faturamento | 22 |
| Verba de marketing | 20 |
| Prazo para começar | 12 |
| Colaboradores | 8 |
| Já investe em marketing | 8 |

**A porta** — para ser **ICP-A** não basta somar 70+: a pessoa
precisa ser decisor **e** a empresa precisa ter porte.

A porta existe porque um modelo só somativo deixaria um analista de
empresa grande com verba alta chegar ao topo da sua fila — e esse
lead não decide nada. A soma mede interesse; a porta mede se vale a
reunião.

### Testado contra cenários reais

| Perfil | Pontos | Faixa |
|---|---|---|
| Sócio, empresa +R$1mi, verba alta, imediato | 99 | ICP-A |
| Diretor, empresa média, verba média, 30 dias | 76 | ICP-A |
| **Analista de empresa grande com verba alta** | 73 | **ICP-B** ← a porta funcionou |
| Gerente, empresa média-alta | 70 | ICP-B |
| Sócio de empresa pequena, pesquisando | 40 | ICP-C |

### Um detalhe de conversão

Quem pontua ICP-A recebe uma mensagem de sucesso diferente: *"Vamos
priorizar seu contato e retornar ainda hoje."* Prometer o mesmo prazo
para todo mundo é como não prometer nada.

---

## 4. Calculadora: captura progressiva

A estrutura já estava certa — o portão de entrada pede nome, e-mail e
telefone antes de liberar a ferramenta. O que faltava era a entrega.

Agora, **cada passo concluído atualiza a mesma linha da planilha**:

| Momento | O que grava |
|---|---|
| Passa o portão | Contato + sessão |
| Termina cada painel | Os números que digitou |
| Vê o resultado | Receita projetada, gargalos, pontuação |
| Pede o diagnóstico | Marca a etapa de alta intenção |

Se a pessoa abandonar no meio, você tem o contato **e até onde ela
foi** — e isso é informação comercial: quem para no painel de
capacidade tem um problema diferente de quem para no funil.

### A pontuação sai dos números, não de mais perguntas

A calculadora já sabe o faturamento, a verba de mídia e a estrutura —
a pessoa acabou de digitar. Então as faixas de qualificação são
**derivadas** desses números. Só restam duas perguntas na tela final:
**nível de decisão** e **prazo**.

### O diagnóstico aprofundado

O resultado aparece de graça. Abaixo dele, um convite:

> *A calculadora usa benchmarks do seu segmento. O diagnóstico
> aprofundado olha os **seus** números: seu site, suas campanhas, seu
> funil e seus concorrentes.*

E a frase que fecha: *"Já temos tudo que você preencheu aqui. A
conversa começa do ponto onde você parou."*

O envio final carrega **60 campos**. Quando alguém pedir o
diagnóstico, você abre a linha e já sabe faturamento, ticket, taxas
do funil, tamanho do time e onde está o gargalo.

---

## 5. O que foi corrigido no site

### Mobile

Os títulos usam `clamp()` com piso alto — `clamp(2.8rem, 6vw, 4.8rem)`.
O piso trava em 44,8px e **para de encolher abaixo de ~746px**. Num
celular de 360px a fonte era a mesma de um tablet, e palavras longas
como "crescimento" estouravam a tela.

Corrigido com uma media query só para celular: **desktop e tablet
ficaram exatamente como estavam.**

### O arrasto lateral

A linha de estatísticas do hero era um flex de 3 colunas com
`gap: 3rem` que não quebrava. Empurrava a home **21px para fora da
tela**. O `overflow-x: hidden` do body escondia o estouro — e no iOS
é justamente isso que produz a sensação de arrastar a página como se
fosse uma imagem.

Corrigido na origem, e o `hidden` virou `clip`, que não cria área de
rolagem. **Rolagem horizontal real: 0px em todas as páginas.**

### Contraste dos botões

| Página | Botão | Antes | Depois |
|---|---|---|---|
| rd-station | "Falar com um especialista" | **1.08:1** (preto no preto) | aprovado |
| servicos | "Fale com a Mkteúdo" | 3.14:1 | aprovado |

A causa do primeiro: `.btn--outline` forçava a cor global do texto e
não sabia em que fundo estava. Existiam correções pontuais para
*algumas* seções escuras, mas não para todas — e esse botão ficou de
fora. Agora a classe **herda a cor do contexto**: em seção clara fica
escuro, em seção escura fica claro, sozinho. Não volta a acontecer.

O segundo era um `style="background:#ff00ff"` cravado inline. O
brandbook define Vivid Violet (#9428e4) para botões e lista "não usar
sem contraste" como uso incorreto — removido, voltou ao padrão.

### Banner de cookies

De **mais de meia tela** para **14%** no celular. Faixa rente ao
rodapé, botões lado a lado, texto encurtado (dizia "cookies" três
vezes em duas linhas).

---

## 6. A planilha

**Apps Script implantado e ligado ao site.** Testado de ponta a ponta:
o passo 1 do formulário gravou na planilha e a fila zerou.

A planilha faz *upsert* por sessão — chamar várias vezes não cria
linhas duplicadas. E um envio parcial **nunca apaga** o que já estava
preenchido.

Leads ICP-A ficam destacados em roxo automaticamente.

---

## 7. O que falta — e precisa de você

### a) Chave secreta do Turnstile (5 minutos) — importante

Descobri testando: a propriedade `TURNSTILE_SECRET` **nunca foi
salva** no Apps Script. O anti-spam do servidor não está validando
nada hoje.

> Apps Script → Configurações do projeto → Propriedades do script →
> Adicionar: `TURNSTILE_SECRET` = a chave secreta da Cloudflare

Eu não faço esse passo de propósito: a chave secreta não deve passar
por mim.

### b) Importar a medição no Tag Manager (30 segundos)

O pacote está pronto e **validado pelo próprio GTM** (ele leu o
arquivo e confirmou "24 adicionadas, 0 excluídas"). Faltou só o
clique final, que a automação não alcançou.

> GTM → Administrador → Importar contêiner → escolher
> `ferramentas/medicao-mkteudo.json` (está no repositório) →
> **Combinar** → **Renomear conflitantes** → Confirmar → Publicar

São 12 variáveis, 6 acionadores e 6 tags de evento apontando para
**G-CRG2F5SJ6R**.

> ⚠️ Escolha **Combinar**, nunca "Substituir". Substituir apagaria a
> tag do RD Station e a configuração do GA4.

### c) Apagar 3 linhas de teste da planilha

As linhas com sessão começando em `s-TESTE-` e o lead "TESTE PONTA A
PONTA" são meus. Pode apagar.

---

## 8. O que encontrei e você vai querer decidir

**Duas propriedades GA4 recebendo os mesmos dados.** `G-CRG2F5SJ6R`
("Mkteúdo - Principal") e `G-Z9TDX4673G`. Os dados estão partidos
entre duas contas — nenhuma tem o quadro completo. Configurei tudo
para a primeira. A segunda precisa ser identificada e desligada.

**Tag do Universal Analytics disparando há 6 anos.** O Google
desligou o Universal Analytics em julho de 2023. A tag não coleta
nada desde então, só pesa.

**Remarketing apontando para `AW-409-492-0529`**, que é a conta
administradora (MCC) da agência — não uma conta de anúncios da
Mkteúdo. Tag órfã.

**Hotjar de 4 anos atrás** disparando em todas as páginas.

**Duas implantações do Apps Script** ativas. A antiga pode ser
arquivada.

**Duas imagens faltando** no repositório: `imagens/hero-bg.jpg` e
`imagens/case-intelli.jpg`. As duas têm alternativa automática, então
não quebram nada visualmente — mas se existirem em algum lugar, vale
subir.

---

## Arquivos

| Arquivo | O que é |
|---|---|
| `js/mkt-leads.js` | Módulo central de captura |
| `ferramentas/apps-script-leads.gs` | Código da planilha (cópia versionada) |
| `ferramentas/medicao-mkteudo.json` | Pacote para importar no GTM |

Tudo publicado em `www.mkteudo.com.br` e versionado no repositório.

---

# Adendo — revisão de SEO e limpeza visual

Mesmo dia, depois da reconstrução da captura.

## Emojis: 511 ocorrências removidas

Varri o site inteiro. Saíram troféu, gráfico, aperto de mão, estrelas
de avaliação, prancheta, interrogação, relógio, calendário, chave,
lápis, certo e errado.

No lugar entraram **ícones SVG desenhados na identidade da marca** e
marcadores de lista em CSS. As avaliações em estrela da tabela
comparativa de CRM viraram nota numérica (`5/5`, `4/5`).

**Mantidos de propósito:** a seta `→` dos links "Ler mais", a seta `←`
de voltar e o `✕` de fechar o menu. São tipografia de interface, não
emoticon — removê-los quebraria a navegação.

## Faixa de prêmios

Era um flex que quebrava mal: no celular empilhava com ícone grande e
título em duas linhas; no desktop quebrava 2 em cima e 1 centralizado
embaixo. Virou **grade de 3 colunas** no desktop e **lista alinhada à
esquerda** no celular, com ícone menor.

## SEO — o que estava errado

### Títulos (37 de 42 acima do limite)

O Google corta o título por volta de 60 caracteres. Havia títulos de
**117 caracteres**. Na prática, metade do título nunca aparecia no
resultado de busca.

Reescrevi os 37 à mão, com a palavra-chave na frente. Exemplos:

| Antes | Depois |
|---|---|
| IA não vai substituir humanos — mas quem não usar IA em todos os processos vai ser substituído por quem usa \| Mkteúdo (117) | IA não substitui humanos. Quem não usa, sim \| Mkteúdo (53) |
| Dashboard de Marketing Digital: como a Mkteúdo monitora CPL, CAC, ROI e ROAS em tempo real com Lovable \| Mkteúdo (112) | Dashboard de Marketing: CPL, CAC, ROI e ROAS \| Mkteúdo (54) |
| MQL e SQL: o que são, a diferença crucial e como qualificar leads para vender mais com menos esforço \| Mkteúdo (110) | MQL e SQL: a diferença e como qualificar \| Mkteúdo (50) |

Não tentei truncar automaticamente: a regra cortava no meio de frases
("Clube do", "otimizar e"). Título é a primeira coisa que a pessoa lê
no Google — precisa ser escrito, não cortado.

**O H1 de cada página continua completo**, então nenhum conteúdo se
perdeu. `og:title` e `twitter:title` acompanharam.

### Descrições (36 acima do limite)

Havia descrições de 200 caracteres onde cabem 160. Encurtadas sempre
na última frase completa.

### Canonical — o problema mais sério

O site misturava **três formatos de URL para a mesma página**:

| Página | Canonical | Sitemap | Links internos |
|---|---|---|---|
| metodo-picc | `/metodo-picc` | `/metodo-picc.html` | `/metodo-picc` |
| rd-station | `/rd-station` | `/rd-station.html` | `/rd-station` |
| servicos | **nenhum** | `/servicos.html` | `/servicos` |

Cada página era alcançável em dois endereços. Isso é conteúdo
duplicado: o Google divide a autoridade entre as duas versões em vez
de concentrar numa só.

Padronizei no formato `.html`, que **37 das 42 páginas e o sitemap já
usavam** — alinhei as 4 divergentes em vez de mexer em 37. Decisão de
menor risco. A política de privacidade usa a forma de pasta
(`/politica-de-privacidade/`), que é o correto para índice de
diretório.

### Schema FAQPage — a maior oportunidade

**35 posts tinham bloco de Perguntas Frequentes e nenhum tinha a
marcação que o Google lê.** São 175 perguntas e respostas que o
buscador não conseguia interpretar.

Adicionei `FAQPage` em todos. Isso habilita o **resultado rico** — o
bloco expansível de perguntas que aparece direto na busca e ocupa
muito mais espaço na tela que um resultado comum.

Também ganharam schema próprio: `blog.html` (Blog), `servicos.html`
(ItemList de serviços) e a política de privacidade (WebPage). E
completei Open Graph e Twitter Card onde faltavam.

## O que já estava certo

Vale registrar, porque é mérito do trabalho anterior:

- Nenhuma página sem título, descrição ou H1
- Nenhuma página com H1 duplicado
- **338 imagens, todas com texto alternativo**
- Nenhum `noindex` acidental
- `robots.txt` correto, apontando para o sitemap
- Sitemap sem nenhuma URL quebrada
- **1.141 links internos verificados, zero quebrados**
- Nenhum título ou descrição duplicado entre páginas

## Auditoria final

| Item | Antes | Depois |
|---|---|---|
| Título acima de 60 car. | 37 | **0** |
| Descrição acima de 160 car. | 36 | **0** |
| Canonical ausente ou divergente | 4 | **0** |
| Páginas sem dados estruturados | 3 | **0** |
| FAQ sem marcação FAQPage | 35 | **0** |
| Imagem sem texto alternativo | 0 | 0 |
| Link interno quebrado | 0 | 0 |

## O que ainda depende de você

Reenviar o sitemap no Search Console. Os canonicais mudaram em 4
páginas e 35 posts ganharam dados estruturados — vale pedir
reindexação para o Google ver isso logo.

> Search Console → Sitemaps → enviar `sitemap.xml` novamente

Depois, em alguns dias, acompanhe em **Aprimoramentos → Perguntas
frequentes**: é onde o Google mostra quantas das 175 perguntas ele
validou.
