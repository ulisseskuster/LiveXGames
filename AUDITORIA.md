# Auditoria técnica — LiveX Games

**Data:** 17/09/2026 · **Commit auditado:** `3dd0046` (`main`, árvore limpa)
**Escopo:** backend (Express/Socket.IO/PostgreSQL), economia, autenticação,
integrações de pagamento e OAuth, banco/migrações, operação e prontidão para
mais de 1.000 usuários simultâneos. Frontend avaliado quanto a XSS.
**Fora do escopo:** cenas e simulação dos jogos (Rust/Three.js), E2E, carga,
ambiente de produção e painel do Render/Supabase (sem acesso).

## Parecer

**Não aprovado para produção em escala.** O ESCALA.md dá o P0-B (abertura
recuperável) como resolvido, mas esta auditoria encontrou e **reproduziu** dois
defeitos econômicos nesse mesmo fluxo:

- os recursos de uma intenção órfã são devolvidos ao usuário errado;
- um clique duplo destrói itens do jogador.

Também foi reproduzida uma falha de disponibilidade: o `/health` passa a
responder 503 para sempre depois de qualquer queda de conexão ociosa com o banco.

A base tem boas práticas de segurança (ver [Pontos fortes](#pontos-fortes)). Os
problemas se concentram na recuperação de falhas, que é a parte mais difícil de
testar só em memória.

| Severidade | Qtde |
| ---------- | ---- |
| Crítico    | 2    |
| Alto       | 4    |
| Médio      | 11   |
| Baixo      | 11   |

## Verificações executadas

| Verificação                                                      | Resultado                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run lint`                                                   | ✅ 0                                                                          |
| `npm run typecheck`                                              | ✅ 0                                                                          |
| `npm --prefix backend test` (memória)                            | ✅ 229/229                                                                    |
| `npm audit` (raiz, backend `--omit=dev`, games/client)           | ✅ 0 vulnerabilidades                                                         |
| Prettier                                                         | ⚠️ falha local em 5 arquivos por CRLF (`core.autocrlf=true`); o CI está verde |
| CI remoto do commit (`35032054054`)                              | ✅ success                                                                    |
| Varredura de segredos no histórico git (repositório **público**) | ✅ nenhum segredo real encontrado por padrão                                  |
| Reprodução C1 (memória)                                          | ❌ confirmado                                                                 |
| Reprodução C2 (PostgreSQL 18 descartável, porta 5439)            | ❌ confirmado                                                                 |
| Reprodução A1 (PostgreSQL 18 descartável)                        | ❌ confirmado                                                                 |

Os scripts de reprodução ficaram fora do repositório. A instância PostgreSQL
temporária foi encerrada e apagada. Nenhum dado de produção foi acessado.

---

## Críticos

### C1 — Devolução de intenções órfãs vai para o usuário errado

[gameRunService.js:121-127](backend/src/services/gameRunService.js#L121-L127) ·
[gameRunModel.js:417-426](backend/src/models/gameRunModel.js#L417-L426)

`abandonarReservingStale()` abandona as intenções `reserving` com mais de 60 s
**de todos os usuários**. Em seguida, `iniciar()` devolve itens e vidas dessas
intenções ao **usuário que está abrindo a rodada** (`userId`), não ao dono de
cada uma.

**Reproduzido:** a vítima tem 1 item e 1 intenção órfã. Outro usuário abre uma
rodada qualquer.

- Resultado: `item vítima = 0 | item outro = 1`; a vida da vítima não volta.
- A intenção fica `abandoned`, e o dono nunca recupera o que perdeu.

**Agravante:**

- Com 1 worker, fila de até 32 e timeout de 10 s ([runVerifier.js:15-21](backend/src/services/sim/runVerifier.js#L15-L21)),
  uma geração legítima pode ficar mais de 60 s em `reserving` sob saturação.
- Nesse caso, outra abertura toma os recursos dela.
- Depois, `confirmarIntencao` falha e a compensação devolve os mesmos recursos
  também ao dono: **itens e vidas passam a existir em dobro**.

**Correção:**

- Usar `devolverItens(orfa.user_id, …)` e as vidas de `orfa.user_id`, na mesma
  transação do `UPDATE`.
- Varrer órfãs num job de boot/intervalo, não dentro da requisição de outro
  usuário.
- Usar um limiar de idade maior que `fila × timeout`.

### C2 — Clique duplo destrói itens (reserva fora da transação)

[gameRunService.js:155-175](backend/src/services/gameRunService.js#L155-L175) ·
[channelInventoryModel.js:52-60](backend/src/models/channelInventoryModel.js#L52-L60)

O comentário diz que vida, itens e intenção são "tudo ou nada", mas:

- `ChannelInventory.reserve()` e `ShopModel.reservarItem()` usam `db.query()`
  (outra conexão, com autocommit), não o `client` da transação;
- a vida é debitada antes do `BEGIN`.

Quando `criarIntencao` falha antes do `COMMIT`, o `ROLLBACK` não desfaz nada e o
`catch` ([L323-329](backend/src/services/gameRunService.js#L323-L329)) devolve
só a vida. Exemplo de falha: o índice único `idx_game_runs_uma_aberta_por_usuario`
num segundo clique ou numa segunda aba.

**Reproduzido no PostgreSQL 18:** usuário com 2 × `nitro_booster` e 5 vidas de
canal, duas aberturas simultâneas.

```
pedido 1 fulfilled
pedido 2 rejected  duplicar valor da chave viola a restrição de unicidade "idx_game_runs_uma_aberta_por_usuario"
rodadas: verified
DEPOIS itens= 0 (esperado 1)   vidas canal= 4 (esperado 4)
```

Além da perda do item, o erro do Postgres sobe cru (HTTP 500), em vez de
`RUN_ALREADY_OPEN`.

**Correção:**

- Passar `client` para `consumeLife`/`reserve`/`reservarItem` e executá-los depois do `BEGIN`.
- Tratar `23505` em `criarIntencao` como `RUN_ALREADY_OPEN`.
- Criar um teste em PostgreSQL real com duas aberturas simultâneas.

**Consequência para a documentação:** o P0-B do ESCALA.md não pode continuar
marcado como resolvido. Motivos:

- os testes de intenção ([gameRunIntention.test.js](backend/test/gameRunIntention.test.js))
  forçam `DATABASE_URL=''` e rodam só em memória;
- o teste de "crash" faz a devolução manualmente, ao dono, sem passar pelo serviço;
- o teste de idempotência apenas copia a regra de validação do `requestId`.

---

## Altos

### A1 — O flag de conexão nunca volta; `/health` fica em 503 permanente

[database.js:64-68](backend/src/config/database.js#L64-L68)

Qualquer evento `error` do pool faz `isDbConnected = false`, e **nada o
devolve para `true`**: `checkConnection` só roda no boot. Esse evento ocorre
quando o banco encerra uma conexão ociosa (restart, failover, pooler).

**Reproduzido:**

```
antes: connected= true
depois: banco responde= true | connected= false => /health em produção: 503
30s depois: connected= false
```

**Efeitos:**

- **Em produção:** o `/health` fica em 503 com o banco saudável. O Render tira a
  instância de rotação ou a reinicia, o que dá indisponibilidade recorrente.
- **Fora de produção:** `isAvailable()` passa a `false` e os models passam a
  gravar **silenciosamente no InMemoryStore** com o banco configurado, contrariando
  a regra do AGENTS.md. Isso também explica parte da instabilidade do CI.

**Correção:**

- Marcar `isDbConnected = true` a cada query bem-sucedida (ou num ping periódico que
  atualize o flag).
- Em ambiente configurado, nunca cair em memória: `isAvailable()` deve ser
  `isConfigured()`.

### A2 — Sessões revogadas continuam valendo em vários caminhos

O `requireAuth` confere `token_version`, mas estes caminhos só verificam a
assinatura do JWT:

| Caminho                                                                                                                                          | Efeito com token revogado (após logout/troca de senha, até 24 h)                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `optionalAuth` ([auth.js:177](backend/src/middlewares/auth.js#L177)) → `POST /api/dev/sign-webhook` ([dev.js:30](backend/src/routes/dev.js#L30)) | **Ativo em produção.** Token de admin assina webhook de **qualquer** streamer, o que permite emitir moedas em qualquer canal |
| Handshake do Socket.IO ([server.js:757-788](backend/src/server.js#L757-L788))                                                                    | Identidade no chat e entrada em `user_<id>` (saldo e eventos privados)                                                       |
| `isAdminRequest` ([server.js:203-211](backend/src/server.js#L203-L211))                                                                          | Diagnóstico detalhado do `/health`                                                                                           |
| `usuarioDoFluxoOAuth` ([authController.js](backend/src/controllers/authController.js))                                                           | Vincular Twitch/Kick à conta                                                                                                 |

Além disso, `role` vem do JWT, não do banco: um rebaixamento só vale depois que
o token expira.

**Correção:**

- Criar uma única função `verificarSessao(token)`, com consulta de `token_version`
  e `role`, usada por todos esses pontos.
- Exigir `requireAuth` + `requireRole` em `sign-webhook`, ou bloquear a rota em produção.

### A3 — O plano multi-instância (P1-C) quebra com o pooler documentado

O exemplo do [.env.example](backend/.env.example) usa o pooler do Supabase na
porta **6543** (modo transação). Nesse modo:

- **`pg_try_advisory_lock` / `pg_advisory_unlock` de sessão** ([autoMigrate.js](backend/src/db/autoMigrate.js))
  podem cair em backends diferentes, o que pode vazar o lock e travar os boots seguintes.
- **`LISTEN/NOTIFY`**, base do `@socket.io/postgres-adapter`, não funciona.

Além disso:

- o adaptador precisa da tabela `socket_io_attachments` para payloads acima de
  8 KB, e ela **não existe** em schema nem em migração;
- o adaptador reserva uma conexão do pool (`max: 10`);
- não há nenhum teste com `SOCKET_ADAPTER=postgres`.

**Ação:** confirmar no painel qual `DATABASE_URL` a produção usa. Para o
adaptador e para as migrações, usar conexão direta (5432) ou o pooler em modo
sessão. Depois, criar a tabela e testar A→B antes de ligar o adaptador.

### A4 — Ambientes que não são produção ficam abertos (fail-open)

Tudo que depende de `NODE_ENV !== 'production'` afrouxa a segurança:

- `requireAuth` aceita token de usuário inexistente ([auth.js:52-63](backend/src/middlewares/auth.js#L52-L63));
- contas de demonstração têm senhas públicas no repositório, incluindo o streamer
  `nightpilot`/`streamer123`, que pode assinar webhooks e emitir moedas;
- a Twitch devolve `isSub: true` simulado e o OAuth é falso;
- `/api/payments/simulate` e `/api/dev/lives` ficam ativos;
- mensagens de exceção vão para o cliente.

A homologação pública planejada para o teste de carga ficaria exposta.
**Ação:** rodar a homologação com `NODE_ENV=production` (e configurar tudo que isso
exige) ou restringir o acesso por rede. Remover o bypass do `requireAuth`: o
problema de formato que ele contornava já foi corrigido em `findById`.

---

## Médios

| #   | Achado                                                                                                                                                                                                                                                                                                    | Onde                                                                                                                                                                          | Recomendação                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| M1  | **Injeção de HTML no callback OAuth.** `error_description` da query entra cru no `<p>` da página de erro. A CSP bloqueia scripts, mas `<meta http-equiv="refresh">` permite redirecionar para phishing no domínio da plataforma.                                                                          | [authController.js:390](backend/src/controllers/authController.js#L390), [:554](backend/src/controllers/authController.js#L554)                                               | Escapar `errorMsg` no HTML; no `<script>`, trocar `<` por `<` no JSON                                         |
| M2  | **Idempotência da abertura não é efetiva.** O frontend não envia `requestId`. Com a mesma chave, `criarIntencao` devolve a intenção existente e o fluxo debita e gera de novo. Repetir após sucesso dá erro em vez do recibo.                                                                             | [gameRunService.js:141-153](backend/src/services/gameRunService.js#L141-L153), [gameRunModel.js:330](backend/src/models/gameRunModel.js#L330)                                 | Com a chave conhecida, devolver o recibo/rodada existente **antes** de debitar; enviar `requestId` do cliente |
| M3  | **Roleta não é atômica.** O giro é gravado e depois o prêmio é concedido em outra conexão: uma queda entre os dois gasta o giro sem prêmio. O dia é UTC (vira às 21h de Brasília), diferente das vidas douradas. A elegibilidade de vida usa vidas globais, mas concede vida de canal.                    | [streamerRouletteService.js:212-229](backend/src/services/streamerRouletteService.js#L212-L229), [streamerRouletteModel.js:5](backend/src/models/streamerRouletteModel.js#L5) | Mesma transação; `diaDeBrasilia()`; elegibilidade pela carteira do canal                                      |
| M4  | **Broadcasts globais.** São 15 `io.emit` para todos os sockets (rodadas, doações com `userId`, roleta, loja), e o chat é uma sala única para todos os canais. Com 1.500 conexões, cada evento vira 1.500 mensagens, e canais diferentes se misturam.                                                      | `grep "io.emit("`                                                                                                                                                             | Salas por canal (`channel_<id>`); não expor `userId` em evento público                                        |
| M5  | **Sem timeouts.** 14 chamadas `fetch` externas não têm `AbortSignal` (o webhook LivePix consulta a API dentro da requisição), o pool não tem `statement_timeout` e o servidor HTTP não tem timeouts ajustados.                                                                                            | `backend/src/services/*`                                                                                                                                                      | `AbortSignal.timeout(5000)`; `statement_timeout` no pool                                                      |
| M6  | **bcryptjs (JS puro) com custo 10 no processo principal**, num plano de 0,5 CPU. Picos de login disputam CPU com rodadas e sockets.                                                                                                                                                                       | [userModel.js:496](backend/src/models/userModel.js#L496)                                                                                                                      | Medir na carga; se virar gargalo, usar `bcrypt` nativo (usa o threadpool)                                     |
| M7  | **TLS do banco sem validar certificado por padrão** (`rejectUnauthorized:false`).                                                                                                                                                                                                                         | [database.js:33-55](backend/src/config/database.js#L33-L55)                                                                                                                   | Definir `DATABASE_SSL_CA` em produção                                                                         |
| M8  | **Admin por nome de usuário.** O `render.yaml` (público) declara `ADMIN_USERNAMES=ukc___`, e o **cadastro** promove esse nome a admin sem e-mail verificado. Em qualquer ambiente onde a conta não exista, quem cadastrar esse nome primeiro vira admin.                                                  | [render.yaml:43](render.yaml#L43), [authService.js:227](backend/src/services/authService.js#L227)                                                                             | Promover só no login de conta com e-mail verificado, ou por ID; nunca no cadastro                             |
| M9  | **Segredos de gateway** (`*_client_secret`, `*_webhook_secret`) guardados em texto puro no banco.                                                                                                                                                                                                         | `streamer_payment_configs`                                                                                                                                                    | Cifrar com chave do ambiente                                                                                  |
| M10 | **Conciliação de doações inexistente.** A rotina de reconciliação citada no código não existe: doação `pending` só é recuperada se o gateway reenviar. `external_id` é único globalmente, não por provedor/canal.                                                                                         | [livepixService.js](backend/src/services/livepixService.js), schema `donations`                                                                                               | Job de reconciliação; índice único `(provider, streamer_id, external_id)`                                     |
| M11 | **Status de sub global e permanente.** É global, não por canal. A Twitch depende de `TWITCH_BROADCASTER_ID`, que não está no `render.yaml` (em produção, ninguém vira sub pela Twitch). Não há revalidação nem tratamento de cancelamento na Kick. Afeta o bônus de 10% nas doações e o 1,2× nas rodadas. | [twitchService.js:143-152](backend/src/services/twitchService.js#L143-L152)                                                                                                   | Decisão de produto: sub por canal e com validade                                                              |

## Baixos

1. O `schema.sql` roda a cada boot com 10 `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, que tomam lock exclusivo mesmo sem alterar nada.
2. As conquistas contam rodadas de qualquer status (`abandoned`, `rejected`, `reserving`) como voos, e o recorde considera essas rodadas também ([achievementService.js:111-118](backend/src/services/achievementService.js#L111-L118)).
3. `promoteToAdmin`/`promoteToStreamer` engolem erros de banco com `console.warn`, em vez de usar `fallbackOrThrow`.
4. Na devolução de órfãs, qualquer rodada com `streamer_id` recebe vida de canal, mesmo que tenha gastado vida global (ignora `used_channel_life`).
5. O chat aceita anônimos, e o limite por socket se contorna abrindo várias conexões.
6. `SHUTDOWN_PORT`, se definido, escuta em todas as interfaces: qualquer conexão TCP derruba o processo.
7. A documentação diverge do código: a fila padrão é 32 (o ESCALA diz 50), e os comentários de `gameRunService`/`criarIntencao` afirmam uma atomicidade que não existe.
8. A senha mínima é de 6 caracteres.
9. O Prettier falha localmente por CRLF: adicionar um `.gitattributes` com `* text=auto eol=lf`.
10. O logout revoga as sessões de **todos** os dispositivos (confirmar se é a intenção).
11. O encerramento não fecha o pool, e `server.close` espera as conexões keep-alive: na prática, sempre leva os 10 s.

---

## Pontos fortes

- CSP com nonce, sem `unsafe-inline` em scripts; `script-src-attr 'none'`.
- Sessão em cookie `HttpOnly` + `SameSite=Strict` + `Secure`; checagem de `Origin` em mutações.
- Rate limit compartilhado no banco, que fecha (503) se o contador falhar em produção; usa `req.ip` com `trust proxy`.
- HMAC de webhook com `timingSafeEqual` sobre o corpo bruto; webhook da Kick com RSA e janela de 5 min.
- SQL parametrizado em todo o código lido; limites de corpo por rota.
- Liquidação de rodada transacional, com advisory lock por usuário e recibo idempotente.
- Doação, crédito e extrato numa única transação; resgate com `FOR UPDATE` no estoque e na carteira.
- Rodada sorteada no servidor, com semente HMAC derivada e commit-reveal.
- Bcrypt fictício contra enumeração por tempo; idade mínima; versão dos termos gravada.
- Frontend escapa o conteúdo externo (`escapeHtml`) nos pontos verificados.
- Dockerfile sem root; `npm ci`; deploy só com checks verdes; CI com PostgreSQL real; 0 vulnerabilidades.

## Plano de melhorias (aprovado em 17/09/2026)

**Decisões do responsável:**

- **Promoção a admin:** continua por `ADMIN_USERNAMES`, mas **só no login**. Sai do cadastro.
- **Status de sub por canal (M11):** vai para o backlog, é decisão de produto.
- **Publicação:** commit + push em `main` ao fim de cada fase, acompanhando o CI. Não começar uma fase nova com CI aberto ou vermelho.

Cada fase termina com lint, typecheck, testes do backend e CI verde.

### Fase 1 — Integridade da economia (C1, C2, M2, B4) — ✅ concluída em 17/09/2026

1. **Pedido repetido:** `requestId` já conhecido devolve a rodada ou o recibo existente **antes** de qualquer débito.
2. **Transação única:** `BEGIN` → consumir vida → reservar itens → `criarIntencao` → `COMMIT`, tudo com o mesmo `client`. `UserModel.consumeLife`, `ChannelInventory.consumeLife/reserve` e `ShopModel.reservarItem` passam a aceitar `client`.
3. **Clique duplo:** `23505` em `criarIntencao` vira `RUN_ALREADY_OPEN` (409).
4. **Rodadas presas:** `GameRunService.recuperarOrfas()` substitui a varredura dentro de `iniciar`.
   - Cada órfã é tratada em transação própria (`FOR UPDATE SKIP LOCKED`).
   - A devolução vai para `orfa.user_id`, respeitando `used_channel_life` e `used_sub_life`.
   - Roda no boot e a cada minuto, com limiar de 10 min.
5. **Frontend:** envia um `requestId` por clique e reaproveita o mesmo em nova tentativa.
6. **Testes em PostgreSQL real, no CI:** clique duplo, órfã de outro usuário, queda entre `COMMIT` e confirmação, repetição com o mesmo `requestId`.
7. **Documentação:** P0-B reaberto e depois fechado no ESCALA.md; comentários corrigidos.

### Fase 2 — Disponibilidade (A1)

- `query()` bem-sucedida marca a conexão como ativa, e um ping periódico fica em `database.js`.
- `isAvailable()` passa a ser `isConfigured()`: banco configurado nunca cai em memória.
- Teste: derrubar uma conexão ociosa → `/health` volta a 200.

### Fase 3 — Segurança (A2, M1, M8, A4)

- **`verificarSessao(token)`** (JWT + `token_version` + `role` do banco), usada por:
  - `requireAuth` e `optionalAuth`;
  - o handshake do Socket.IO;
  - `isAdminRequest`, o fluxo OAuth e o `/tests.html`.
  - O atalho que aceita usuário inexistente fora de produção é removido.
- **`/api/dev/sign-webhook`:** bloqueado em produção e com `requireAuth` + `requireRole`. Só o `tests.html` usa a rota.
- **OAuth:** escape de `errorMsg` no HTML e `<` → `<` no JSON inline.
- **Admin:** promoção removida do cadastro.
- **Homologação:** documentar que roda com `NODE_ENV=production`.

### Fase 4 — Várias instâncias (A3, M4)

- **Pré-requisito:** confirmar no painel a porta do `DATABASE_URL` (6543 ou 5432). Se for pooler em modo transação, criar `DATABASE_DIRECT_URL` para as migrações e para o adaptador.
- **Migração 029:** tabela `socket_io_attachments`.
- **Salas por canal:** `channel_<streamerId>` no chat e nos eventos; os `io.emit` globais passam a ter sala; o `userId` sai dos eventos públicos.
- **Validação com 2 instâncias locais:** evento de A chega em B, e uma instância é reiniciada durante partidas.

### Fase 5 — Pronto para carga (M5, M6, operação)

- **Timeouts:** `AbortSignal.timeout` nos `fetch` externos, `statement_timeout` no pool e timeouts do servidor HTTP.
- **Métricas:** endpoint só para admin (pool, fila, p95, erros); alertas externos.
- **Medições na carga:** bcrypt e as consultas de conquistas.
- **Carga e backup:** 1.500 sessões em homologação; exercício de restauração de backup.

### Fase 6 — Economia e higiene

- **M3, roleta:** giro e prêmio numa transação, dia no horário de Brasília, elegibilidade pela carteira do canal.
- **M10, doações:** job de conciliação e índice único `(provider, streamer_id, external_id)`.
- **Itens baixos:** 1–11.

### Backlog

- **M11:** status de sub por canal, com validade e revalidação.
- **M9:** cifrar os segredos dos gateways.
- **M7:** `DATABASE_SSL_CA` em produção (configuração de ambiente).
