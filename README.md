# ZaBot — Arquitetura e Plano do Projeto

> Este documento define **arquitetura, stack técnica, infraestrutura e etapas de desenvolvimento**.
> Não contém implementação de código nem definição dos menus/telas — os menus serão incorporados depois, em etapa própria, quando você enviar as referências visuais e a especificação final.

---

## 1. Visão geral da decisão de stack

| Camada | Escolha recomendada | Por quê |
|---|---|---|
| App mobile | **Flutter + Dart** | Definido pelo seu fluxo de tradução (ARB + `flutter gen-l10n` + `arb_translator_gen_z`), que é uma ferramenta exclusiva do ecossistema Flutter — não existe equivalente direto em React Native. Todo texto do app nasce como chave em `lib/l10n/app_pt.arb`, nunca como string solta no código (ver seção 11). |
| Backend | **Node.js + NestJS + TypeScript** | Estrutura modular com injeção de dependência, pronta para crescer de "monólito modular" para microsserviços sem reescrever tudo. Mesma linguagem da lib do WhatsApp. |
| Integração WhatsApp | **Baileys (@whiskeysockets/baileys)** atrás de uma **camada de abstração própria** (`WhatsAppProvider`) | Fala o protocolo multi-device diretamente via WebSocket (sem navegador/Puppeteer), leve o suficiente para rodar várias sessões por instância. A camada de abstração permite trocar de provedor (ex.: WhatsApp Cloud API oficial) no futuro sem afetar o resto do sistema. |
| Banco principal | **PostgreSQL** | Relacional, suporta Row-Level Security (isolamento por tenant/usuário nativo no banco), maduro para escrita pesada e consistência. |
| Cache / filas / estado efêmero | **Redis** | Base do BullMQ, cache de contadores em tempo real, pub/sub interno, rate limiting. |
| Fila de processamento | **BullMQ (sobre Redis)** | Filas dedicadas por função (importação, validação, envio, retries), com backoff exponencial e dead-letter queue. |
| Tempo real (app ↔ backend) | **WebSocket (Socket.io) com "rooms" por usuário/sessão** | Atualização de status de envio e contadores do resumo em tempo real, sem polling. |
| Armazenamento de mídia | **Object storage compatível com S3** (S3 real, Cloudflare R2 ou MinIO se autogerenciado) | Mídias (imagem/áudio/documento) não devem ficar no banco nem no disco da aplicação. |
| Observabilidade | **Pino (logs estruturados) + OpenTelemetry + Prometheus/Grafana + Sentry** | Logs pesquisáveis, métricas, tracing distribuído e alerta de erro em produção. |
| Infraestrutura | **Railway** (Postgres + Redis gerenciados, múltiplos serviços em rede privada) | Cobre exatamente a separação que a arquitetura pede — API, workers de fila e workers de sessão como serviços independentes, cada um com deploy e escala próprios, sem precisar operar Kubernetes nesta fase. |
| Proxy por sessão | **DataImpulse** (residential / mobile / datacenter, HTTP(S) e SOCKS5) | Fornece proxy dedicado por sessão. Ponto de atenção arquitetural: sessões "sticky" residenciais/mobile duram no máximo ~120 min — o sistema precisa tratar a renovação como evento controlado (ver seção 4), não como reconexão inesperada. |

---

## 2. Visão de arquitetura (alto nível)

```
[ App Mobile (Flutter) ]
        │  HTTPS + WebSocket
        ▼
[ API Gateway / Backend NestJS ]
   ├─ Módulo Auth & Usuários (JWT, RLS por tenant)
   ├─ Módulo Contatos (importação, normalização)
   ├─ Módulo Mensagens/Campanhas (composição, personalização, mídia)
   ├─ Módulo Planos/Uso (limites, métricas de consumo)
   └─ Módulo Sessões WhatsApp (orquestração, não conecta diretamente)
        │
        ▼
[ Fila (Redis + BullMQ) ]
   ├─ queue:import-contacts
   ├─ queue:validate-numbers
   ├─ queue:send-message (uma por sessão, com rate limit)
   └─ queue:dead-letter (falhas definitivas)
        │
        ▼
[ Workers de Sessão WhatsApp ]
   (1 processo isolado por sessão, via Baileys)
   ├─ Conexão persistente + reconexão automática
   ├─ Proxy dedicado por sessão (HTTP/SOCKS)
   ├─ Auth state persistido em banco/armazenamento (não só em disco local)
   └─ Emite eventos: conectado, desconectado, qr, status de mensagem
        │
        ▼
[ PostgreSQL ]  [ Redis (cache/estado) ]  [ Object Storage (mídia) ]
        │
        ▼
[ Observabilidade: logs, métricas, tracing, alertas ]
```

A ideia central: **o app mobile nunca fala diretamente com o WhatsApp**. Ele fala com o backend, que orquestra sessões, filas e workers. Isso permite múltiplos usuários, múltiplas sessões, proxy por sessão e reconexão sem que nada disso vaze para a interface.

---

## 3. Gestão de sessões WhatsApp

- Cada sessão (conexão do WhatsApp) roda em um **worker isolado** — se uma sessão travar ou cair, não derruba as outras.
- **Auth state** (credenciais/chaves da sessão) fica persistido em banco (ou storage compartilhado), não apenas em arquivo local do processo — isso permite mover uma sessão para outro servidor/instância se necessário (essencial para escalar horizontalmente).
- **Reconexão automática** com backoff exponencial; distingue quedas temporárias (rede) de logout definitivo (usuário desconectou pelo celular).
- Eventos de conexão (QR gerado, conectado, desconectado, sessão expirada) são publicados internamente (Redis pub/sub) e repassados ao app via WebSocket.
- **Escalabilidade horizontal:** sessões são distribuídas entre instâncias/workers por *sharding* (hash da sessão), com um registro central (banco) dizendo "sessão X está na instância Y". Isso evita depender de "sticky session" simples, que é frágil quando o servidor cai.

---

## 4. Proxy por sessão (DataImpulse)

- Cada sessão tem sua própria configuração de proxy (HTTP/SOCKS5, DataImpulse), armazenada **criptografada** no banco, associada à sessão — nunca ao usuário como um todo.
- O worker da sessão injeta o proxy na conexão com o WhatsApp no momento de abrir o socket.
- Toda a gestão (cadastro, teste de conectividade, rotação, falha de proxy) fica **inteiramente no backend**. O app mostra apenas "conectado/desconectado" — nenhum detalhe técnico de proxy é exposto ao usuário, conforme pedido.
- Falha de proxy é tratada como falha de conexão da sessão (aciona o fluxo de reconexão/alerta), não como erro genérico.
- **Ponto de atenção específico do DataImpulse:** as sessões "sticky" (IP fixo por um período) dos planos residencial/mobile duram no máximo ~120 minutos (30 min por padrão) — não existe IP estático permanente nesses planos. Como uma conexão WhatsApp idealmente mantém o mesmo IP durante toda a vida da sessão, a arquitetura trata isso assim:
  - o worker **agenda a renovação do IP** um pouco antes do limite da sessão sticky expirar, junto com um ciclo de reconexão controlado do socket — em vez de deixar o IP mudar "por baixo" no meio de uma conexão ativa;
  - para sessões que precisem ficar no ar por muito tempo sem qualquer troca de IP, avaliar o plano **datacenter** do DataImpulse (IP dedicado por alocação, sem expiração por tempo) como alternativa às sticky sessions residenciais — com o trade-off de IP de datacenter ser, em tese, mais identificável como não residencial;
  - essa lógica de renovação fica isolada na camada de proxy do worker de sessão, sem vazar para o restante do sistema nem para o app.

---

## 5. Motor inteligente de números de telefone

Este é o núcleo mais delicado do sistema, então merece um desenho próprio.

**Passo 1 — Canonicalização:** o número informado é limpo (remove espaços, traços, parênteses) e validado estruturalmente com base em regras por país (biblioteca base: `libphonenumber-js`, com tabela de regras específicas para o Brasil, já que a lib genérica não cobre bem o caso do 9º dígito).

**Passo 2 — Geração de candidatos:** quando há ambiguidade, o sistema gera variações válidas, por exemplo:
- Com e sem o 9º dígito (a regra muda por DDD: DDDs 11 a 19, 21, 22, 24, 27 e 28 exigem o 9; a maioria dos demais DDDs não usa);
- Com e sem código do país (+55);
- Correção de DDD ausente ou duplicado;
- Remoção de zeros à esquerda indevidos.

**Passo 3 — Verificação controlada:** antes de tentar enviar a mensagem de fato, o sistema consulta a própria API do WhatsApp (checagem de existência do número) para cada candidato, em ordem de probabilidade — e **para na primeira que responder positivo**. Isso evita disparos desnecessários e digitais desperdiçadas.

**Passo 4 — Cache do formato validado:** uma vez descoberto o formato correto para um contato, ele é salvo e reutilizado — o motor não testa tudo de novo a cada envio.

**Passo 5 — Registro auditável:** cada contato guarda: formato original informado, formato que funcionou (ou motivo da falha), quantas tentativas foram feitas e quando. Isso é o que permite dizer com precisão, depois, "este contato falhou porque o número não existe no WhatsApp" vs. "porque estava em formato errado".

Limite de tentativas é configurável (ex.: no máximo 3 variações por contato) para não gerar tentativas infinitas nem sobrecarregar a sessão.

---

## 6. Pipeline de mensagens

```
Importação de contatos
   → Normalização/validação (motor acima, assíncrono, em fila própria)
   → Contatos prontos para campanha
        ↓
Composição da mensagem (até 5 mensagens por contato + mídia)
   → Personalização (substituição de ID1, ID2, ... pelos dados do contato)
        ↓
Criação da campanha → gera 1 job por (contato × mensagem) na fila de envio
        ↓
Fila de envio (BullMQ, uma fila por sessão, com limite de taxa)
   → Worker consome o job → envia via sessão do WhatsApp
   → Resultado (sucesso/falha) grava no banco
   → Atualiza contadores em tempo real (Redis) → emite evento WebSocket
        ↓
Reprocessamento controlado de falhas recuperáveis (retry com backoff)
Falhas definitivas vão para fila "dead-letter" para análise
```

Pontos de robustez:
- Envio é **idempotente** (reenviar o mesmo job não duplica mensagem no destinatário).
- Taxa de envio por sessão é limitada e configurável, para reduzir risco de bloqueio pelo WhatsApp.
- Contadores do card de resumo (importados, enviados, pendentes, falhas, total) são atualizados incrementalmente, não recalculados do zero a cada mudança — importante para funcionar bem com grande volume de contatos.
- Mídia é processada (validação de tipo/tamanho, compressão de imagem quando aplicável) antes de entrar na fila de envio.

---

## 7. Modelo de dados (entidades principais, alto nível)

`Usuários` · `Planos/Assinaturas` · `Sessões WhatsApp` · `Configurações de Proxy` (1:1 com sessão) · `Contatos` (com campos dinâmicos ID1..IDn) · `Campanhas` · `Mensagens da Campanha` (até 5 por campanha) · `Mídias` · `Envios` (1 por contato × mensagem, com status e histórico de tentativas) · `Logs de Auditoria`.

Isolamento multi-tenant via **Row-Level Security no PostgreSQL**: cada usuário só enxerga suas próprias linhas, reforçado pelo banco (não só pela aplicação) — protege mesmo contra bug de código.

---

## 8. Tempo real, logs e monitoramento

- **Tempo real:** WebSocket com uma "room" por usuário/sessão; o app se inscreve e recebe atualizações de status de envio e dos contadores do resumo sem precisar dar refresh.
- **Logs:** estruturados (JSON), com nível e contexto (sessão, campanha, contato), centralizados para busca.
- **Métricas:** taxa de envio, taxa de falha, latência de entrega, sessões ativas/caídas — visualizável em dashboard técnico (Grafana).
- **Rastreamento de erros:** captura automática de exceções com contexto (Sentry ou equivalente).
- **Alertas:** sessão caiu e não reconectou em X minutos, fila de envio travada, taxa de falha acima do normal.

---

## 9. Segurança

- Autenticação via JWT (access + refresh token), senhas com hash forte (argon2/bcrypt).
- Isolamento de dados por tenant reforçado no banco (RLS), não só na API.
- Credenciais de proxy e dados sensíveis de sessão **criptografados em repouso**.
- Segredos (chaves, tokens) fora do código, em gerenciador de segredos do ambiente de deploy.
- Rate limiting nas rotas de autenticação e de importação/envio em massa.
- Backups automáticos do banco e plano de recuperação de desastre.

---

## 10. Infraestrutura e escalabilidade (Railway)

- Cada processo da arquitetura vira um **serviço Railway separado**: API (NestJS), worker(s) de fila (BullMQ) e worker(s) de sessão WhatsApp — todos no mesmo projeto, comunicando-se por **rede privada** (sem expor Redis/Postgres publicamente).
- **Postgres** e **Redis** como addons gerenciados do próprio Railway (backup automático, sem precisar operar banco manualmente).
- Serviços da API e dos workers de fila são **stateless** e escalam por réplicas conforme a carga; os workers de sessão WhatsApp são o único ponto com estado local relevante (a conexão ativa), por isso seguem o modelo de *sharding* descrito na seção 3 (registro central de "qual worker cuida de qual sessão").
- Variáveis sensíveis (chaves JWT, credenciais DataImpulse, chaves de criptografia) ficam nas variáveis de ambiente do Railway, nunca no repositório.
- Caminho de crescimento: Railway cobre confortavelmente a fase inicial e o crescimento intermediário; se o volume de sessões simultâneas ou de tráfego um dia exigir controle mais fino de infraestrutura (regiões, autoscaling avançado, Kubernetes), a separação em serviços independentes feita desde já é o que torna essa migração futura possível sem redesenhar a aplicação.
- CI/CD automatizado (build, testes, deploy automático a partir do repositório) desde as primeiras etapas, não deixado para o fim.

---

## 11. Internacionalização (i18n) — nenhum texto solto no código

Ponto crítico que você trouxe: o app precisa nascer pronto para tradução automática via `arb_translator_gen_z`, sem nunca exigir reescrever telas depois. Isso é uma regra de arquitetura, não um detalhe de UI — por isso entra aqui, mesmo antes de existirem os menus.

- **Fonte única de verdade:** `lib/l10n/app_pt.arb`, em português, com todas as chaves de texto do app. É o único lugar onde o texto "de verdade" é escrito.
- **Regra de código:** nenhuma tela, componente ou serviço do Flutter escreve string de interface diretamente (`Text('Conectar WhatsApp')` nunca acontece). Todo texto visível vem de `AppLocalizations.of(context)!.chave`, gerado automaticamente por `flutter gen-l10n`.
- **Convenção de nomes de chave:** definida desde já (ex.: `home_whatsapp_connected`, `messages_import_button`, `menu_account_delete`), para que, quando os menus forem implementados, cada tela já nasça usando chaves — nunca texto fixo que precisaria ser "arrancado" do código depois.
- **Plural/gênero:** o formato ARB suporta sintaxe ICU (`{count, plural, ...}`) para casos como "1 contato" vs. "2 contatos" — usado desde a primeira tela que precisar disso, para não ter que reescrever a chave depois de já traduzida.
- **Fluxo de tradução (seu comando, sem mudanças):**
  1. Você escreve/edita textos e chaves só em `app_pt.arb`.
  2. Roda `arb_translator_gen_z` com os idiomas desejados → gera `app_en.arb`, `app_de.arb`, etc. automaticamente via Google Translate.
  3. Roda `flutter gen-l10n` → gera as classes Dart de acesso às traduções.
  4. Nenhum arquivo `.dart` de tela precisa ser tocado nesse processo.
- **Consequência prática para o plano:** o scaffolding de l10n (pasta `lib/l10n`, `l10n.yaml`, `app_pt.arb` inicial, configuração no `pubspec.yaml`) entra na **Etapa 1 (Fundação do projeto)**, e toda tela futura — mesmo antes de vocês definirem o design final — já é escrita usando chaves. Assim, quando os menus forem implementados, tradução vira só rodar o comando, sem refazer nada.

Respondendo direto: sim, está correto — feito assim desde o início, traduzir depois é só rodar `arb_translator_gen_z` + `flutter gen-l10n`, sem tocar em código de tela.

---

## 12. Observação importante sobre a biblioteca do WhatsApp

Bibliotecas não oficiais (como Baileys) permitem exatamente o fluxo que você descreveu (conectar por QR code/número, sem necessidade de aprovação prévia do Meta, mensagens de texto livre). Isso é o que torna esse tipo de produto viável comercialmente, mas vale registrar dois pontos para decisão consciente, não para travar o projeto:

1. **Risco de bloqueio de número** existe e aumenta com volume alto, conteúdo idêntico em massa e contatos frios — por isso o desenho acima já prevê limite de taxa por sessão, backoff e cache de validação (evita testes desnecessários que "cheiram" a automação).
2. A camada de abstração (`WhatsAppProvider`) do item 1 é o que permite, no futuro, oferecer a **API oficial do WhatsApp Business (Cloud API)** como alternativa para clientes que precisem de zero risco de bloqueio — sem redesenhar o sistema.

---

## 13. Plano de etapas de desenvolvimento

Ordem definida: **front-end primeiro, back-end depois**, com uma etapa final de integração. Total: **8 etapas de front + 8 etapas de back + 1 etapa de integração = 17 etapas**.

Isso só funciona sem retrabalho porque o front nasce em cima de duas regras fixas desde a Etapa 1: (a) nenhuma string solta no código — tudo por chave ARB, conforme seção 11; (b) nenhuma tela fala direto com uma API — toda tela consome uma **camada de repositório abstrata** (`ZapRepository`, `MessageRepository`, `AuthRepository` etc.) que, nas etapas de front, devolve dados mockados, e que na etapa de integração final é trocada pela implementação real, sem tocar em nenhum widget.

### Front-end (Flutter)

1. **Fundação do front** — scaffold do projeto Flutter, i18n (`lib/l10n`, `app_pt.arb` inicial, `flutter gen-l10n`), tema/`ColorScheme` com a paleta da seção 14, e organização de todos os `.riv` baixados em `assets/animations/` com nomes técnicos (ex.: `connection_pulse.riv`, `qr_scan_frame.riv`, `robot_idle.riv`, `button_tap_burst.riv`).
2. **Design system de componentes** — botões (incluindo o efeito de clique com círculos que se dispersam), cards, inputs (incluindo campo de senha com ícone de olho para mostrar/ocultar), badges de status, nav bar inferior com as 3 abas — todos isolados em uma tela de showcase/storybook interna, sem dado real.
3. **Telas de autenticação** — Cadastro, Confirmação de código e Login (ver fluxo detalhado logo abaixo desta lista); tudo sobre o `AuthRepository` mockado.
4. **Tela Início** — mascote robô em destaque (hero) no topo da tela, grande, reagindo ao status da conexão (animação idle quando conectado, alerta quando cai/desconecta); abaixo dele, card de conexão do WhatsApp, resumo/estatísticas e fluxo de QR code (parte visual — geração/exibição); tudo consumindo o repositório mockado.
5. **Tela Mensagens** — lista e importação de contatos, criação/composição de campanha, seleção de mídia — UI completa sobre dados mockados.
6. **Tela Menu** — conta, plano/assinatura, configurações, conexões — UI completa sobre dados mockados.
7. **Estados e tempo real (mockados)** — loading, vazio (mascote reaparecendo em empty states), erro, e simulação de atualização "ao vivo" dos contadores (para já validar a UX antes do WebSocket real existir).
8. **Polimento visual** — integração fina das animações Rive nas transições entre telas, microinterações, revisão de consistência com a paleta e o design system.

#### Fluxo de autenticação (Etapa 3, detalhado)

- **Cadastro** (uma tela): campos Nome, Email, Senha e Confirmar senha — as duas senhas com ícone de olho para mostrar/ocultar. **Sem o robô nesta tela.** Ao enviar, o backend dispara um código de verificação para o email informado.
- **Confirmação de código** (tela separada, aberta em seguida): campo único para digitar o código recebido por email. Ao confirmar, a conta é criada e o usuário **entra automaticamente** — não precisa passar pela tela de Login depois de se cadastrar.
- **Login** (tela separada, para quem já tem conta): Email + Senha. **Robô grande em destaque aqui.**
- No front (etapas 1–8), esse fluxo todo roda sobre um `AuthRepository` mockado (código fixo tipo `"123456"`, validação e "criação de conta" simuladas em memória) — a chamada real ao backend só entra na Etapa 17 (integração final).

### Back-end (NestJS)

9. **Fundação do back** — projeto Railway (dev/staging/produção), addons Postgres/Redis, CI/CD, estrutura do monólito modular, módulo Auth base.
10. **Autenticação e usuários** — cadastro (nome/email/senha com hash argon2/bcrypt), envio e verificação de código por email, login (email/senha), JWT, isolamento multi-tenant (RLS).
11. **Núcleo de sessões WhatsApp** — Baileys por trás do `WhatsAppProvider`, geração de QR/pareamento, persistência de auth state, reconexão automática.
12. **Proxy e resiliência de conexão** — DataImpulse por sessão, criptografia de credenciais, renovação controlada antes do limite de sticky session (~120 min).
13. **Motor de contatos e normalização de números** — importação, variações/tentativas controladas, verificação no WhatsApp, cache de formato validado.
14. **Motor de mensagens e personalização** — múltiplas mensagens por contato, tokens ID1..IDn, upload/processamento de mídia.
15. **Fila e processamento de envio** — BullMQ, filas por sessão, rate limiting, retries, dead-letter queue.
16. **Tempo real e observabilidade** — WebSocket real, logs estruturados, métricas, alertas.

### Integração final

17. **Front + Back conectados** — troca dos repositórios mockados (incluindo `AuthRepository`) pelas chamadas reais à API/WebSocket, testes ponta a ponta, ajustes finos de segurança e preparação para produção.

Cada etapa entrega algo testável isoladamente. O front avança 8 etapas inteiras sem nenhuma dependência do backend existir.

---

## 14. Identidade visual — paleta de cores (proposta inicial)

Registro antecipado, mesmo sem os menus definidos, porque a paleta é usada no design system (temas, componentes) desde as primeiras telas do app. Ajustável quando você mandar referências finais.

Base: roxo como cor de identidade principal, superfícies foscas em preto/cinza, branco para texto, e **verde como cor secundária de status** (uso pontual — "conectado", "enviado com sucesso" —, nunca em botões principais, navegação ou identidade geral, pra não competir com o roxo).

| Papel | Cor (proposta) | Uso |
|---|---|---|
| Roxo principal | `#7C5CFC` | Botões de ação, destaques, ícones ativos, gradientes de identidade |
| Roxo escuro (gradiente) | `#2E1F52` | Transições sutis fundo→roxo em cards e headers |
| Fundo (base) | `#121016` | Fundo geral fosco do app |
| Superfície de card | `#1C1926` | Cards, modais, elementos elevados |
| Cinza de borda/divisor | `#322D3D` | Linhas, separadores, bordas discretas |
| Cinza texto secundário | `#A8A3B3` | Legendas, labels, texto de apoio |
| Branco (texto principal) | `#F5F3F7` | Texto principal sobre fundo escuro |
| Verde de status (secundário) | `#34D399` | Só para indicar sucesso/conectado — nunca como cor de marca |

Essa tabela é ponto de partida técnico (para já configurar o tema no Flutter — `ThemeData`/`ColorScheme` — desde a Etapa 1), não a palavra final de design; ela é substituída sem esforço quando vier a especificação visual definitiva.

---

### Fontes consultadas na pesquisa

- [Baileys — npm](https://www.npmjs.com/package/@whiskeysockets/baileys)
- [Evolution API — arquitetura para SaaS multi-tenant](https://wasenderapi.com/blog/evolution-api-in-production-architecture-guide-for-scaling-multi-tenant-saas)
- [BullMQ — documentação oficial](https://docs.bullmq.io/)
- [Multi-Tenant WhatsApp API Architecture for SaaS](https://wasenderapi.com/blog/how-to-build-a-multi-tenant-whatsapp-api-architecture-for-saas-and-agencies)
- [WhatsApp Business API vs. ferramentas não oficiais — riscos](https://omnifox.io/blog/whatsapp-official-api-vs-unofficial-modified-whatsapp-risks?lang=en)
- [React Native vs Flutter em 2026](https://bettercallmo.dev/pt/blog/react-native-vs-flutter-which-one-to-choose-for-your-mobile-app-in-2026)
- [NestJS — arquitetura de microsserviços 2026](https://encore.dev/articles/nestjs-microservices-guide)
- [Normalização de números do Brasil (9º dígito) para WhatsApp](https://wassenger.com/blog/en/how-to-normalize-international-phone-numbers-for-whatsapp)
- [Escalabilidade horizontal de sessões WhatsApp (WAHA)](https://waha.devlike.pro/blog/waha-scaling-how-to-handle-500-sessions/)
- [Row-Level Security multi-tenant no PostgreSQL](https://queryplane.com/blog/postgres-row-level-security-in-practice/)
- [Railway — deploy de backend SaaS com Postgres, workers e webhooks](https://docs.railway.com/guides/saas-backend)
- [DataImpulse — planos, sessões sticky e proxies estáticos vs. rotativos](https://dataimpulse.com/blog/static-vs-rotating-proxies/)
