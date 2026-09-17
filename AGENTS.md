# Instruções obrigatórias para trabalhar no LiveX Games

**Leia este arquivo inteiro antes de analisar, editar, testar, instalar dependências,
fazer commit ou publicar alterações neste repositório.** Ao retomar uma tarefa,
confira se ele mudou. Estas instruções valem para todo o projeto; verifique também
se existem instruções adicionais na pasta que será alterada.

Este documento orienta agentes de IA e desenvolvedores. Instruções do sistema e
pedidos explícitos do usuário têm precedência. Não use uma recomendação daqui para
contrariar o usuário ou pedir novamente uma autorização já concedida.

## 1. Antes de começar — não pule esta etapa

1. Leia o pedido atual e identifique o resultado esperado. Não transforme uma
   correção pontual em reescrita, mudança visual ou migração de infraestrutura.
2. Execute `git status --short`, `git branch --show-current`, `git log -8 --oneline`
   e `git diff --stat`. Preserve alterações existentes e identifique o commit real.
3. Leia [README.md](README.md) para produto e arquitetura. Para confiabilidade ou
   escala, leia [ESCALA.md](ESCALA.md). Para trabalho visual, leia
   [atualizacao.md](atualizacao.md).
4. Confira os arquivos envolvidos, seus chamadores, testes, `package.json` e
   [.github/workflows/ci.yml](.github/workflows/ci.yml). Use `rg` para localizar código.
5. Compare documentação com código e evidências recentes. Datas, contagens de
   testes e listas de pendências em documentos antigos não comprovam o estado atual.
6. Informe brevemente o que vai verificar. Se faltar informação indispensável,
   pergunte apenas o necessário e prossiga com o trabalho independente da resposta.

**Não diga que uma falha foi corrigida apenas porque existe um commit com esse nome,
um comentário afirmando atomicidade ou uma execução local antiga aprovada.**

## 2. Produto e regras que devem ser preservadas

- A plataforma atende visitantes, espectadores, subs, streamers e admins da Twitch
  e da Kick. Verifique permissões no servidor, inclusive em chamadas diretas à API.
- As moedas são créditos de fidelidade por canal. Não implemente saque ou conversão
  dessas moedas em dinheiro.
- Carteira, inventário, vida extra, loja, doação e resgate pertencem ao par
  **usuário + streamer**. Operar no canal A nunca pode gastar ou creditar o canal B.
- Os três jogos são **Jet Launcher**, **Neon Drifter** e **Void Walker**. Preserve
  sua identidade visual e seus consumíveis próprios.
- A rodada oficial é sorteada no servidor e liquidada antes da resposta de abertura.
  O navegador reproduz um filme de aproximadamente 15–20 segundos. Não reintroduza
  pilotagem interativa como forma de decidir o resultado dos três jogos oficiais.
- Teclado, toque, pular o filme, fechar a aba, alterar JavaScript ou adulterar o
  payload não podem mudar pontos, distância, moedas, itens ou canal do recibo.
- `reveal` consulta a rodada salva; `finish` devolve o recibo idempotente. Repetir
  uma requisição não pode pagar novamente.
- Preserve recuperação de rodada pendente e isolamento das chaves de recuperação
  por usuário, canal e jogo. Recarregar após falha não deve consumir outra vida.
- Mudanças em preços, vidas, regeneração, bônus, probabilidade ou recompensas são
  mudanças de produto: só faça quando integrarem o pedido. Consulte a implementação
  atual em vez de copiar números de uma documentação antiga.

## 3. Mapa do repositório

| Local                                           | Responsabilidade                                       |
| ----------------------------------------------- | ------------------------------------------------------ |
| `backend/src/server.js`                         | Express, rotas, middleware, Socket.IO e inicialização  |
| `backend/src/config/database.js`                | Pool PostgreSQL, disponibilidade e conexão             |
| `backend/src/models/`                           | Persistência PostgreSQL e caminhos em memória          |
| `backend/src/services/`                         | Regras de negócio, economia, integrações e rodadas     |
| `backend/src/services/gameRunService.js`        | Abertura, geração, recuperação e liquidação de rodadas |
| `backend/src/services/sim/`                     | Workers e verificação da simulação                     |
| `backend/test/`                                 | Testes Node e integração PostgreSQL                    |
| `database/schema.sql`, `database/seed.sql`      | Estrutura inicial e dados de catálogo/demonstração     |
| `database/migrations/`                          | Evolução do banco existente                            |
| `frontend/public/app.js`, `frontend/public/js/` | Interface web e integração com a API                   |
| `frontend/public/sw.js`                         | Cache e funcionamento offline da PWA                   |
| `games/sim/`                                    | Simulação determinística em Rust compilada para WASM   |
| `games/client/src/`                             | Cenas Three.js, HUD, áudio e reprodução no navegador   |
| `frontend/public/games/`                        | Build dos jogos versionado e servido em produção       |
| `e2e/`                                          | Testes de navegador Playwright                         |
| `scripts/`                                      | Build, carimbo de assets e verificações                |
| `render.yaml`                                   | Configuração declarada de deploy no Render             |
| `scratch/`, `artifacts/`                        | Evidências locais ignoradas pelo Git                   |

## 4. Como fazer alterações

- Reproduza o defeito ou obtenha evidência concreta antes de editar.
- Corrija a causa com a menor alteração suficiente. Reaproveite funções existentes;
  não adicione bibliotecas, abstrações, serviços ou caches sem necessidade demonstrada.
- Leia a função inteira e seus chamadores. Confira os caminhos de sucesso, erro,
  repetição, concorrência e acesso indevido quando forem relevantes.
- Preserve o estilo do arquivo: backend CommonJS; frontend principal em scripts
  clássicos; cliente dos jogos em TypeScript. Não migre de framework por conveniência.
- Escreva comentários em português explicando o motivo, sem prometer garantias que
  o código não oferece. Não renomeie arquivos ou formate o repositório inteiro em
  uma correção pontual.
- Não enfraqueça permissões, validação de payload, isolamento de canal, HMAC,
  integridade econômica ou verificação do servidor para fazer testes passarem.
- Não use `skip`, retire asserções, desative TypeScript/ESLint ou aumente todos os
  timeouts para esconder uma falha. Ajuste uma espera específica somente com evidência
  de carregamento lento, mantendo a validação funcional.
- Para regressões de lógica, prefira um teste que reproduza o defeito e valide o
  comportamento observado. Não crie testes que apenas copiem a implementação.

## 5. Banco, economia e migrações

- Nunca execute testes, resets, seeds destrutivos, injeção de falhas ou carga contra
  produção. Use banco descartável local e confira host, porta e nome antes de executar.
- Não imprima `.env`, strings reais de conexão, tokens ou senhas. Consulte nomes de
  variáveis em `backend/.env.example`; use credenciais fictícias nos exemplos.
- O dotenv pode carregar o `.env` local. Para testes em memória, defina explicitamente
  `$env:DATABASE_URL = ''` **antes** de iniciar Node. Variável ausente não é equivalente
  a variável vazia neste projeto.
- O `InMemoryStore` é para desenvolvimento/testes sem banco. Falha de PostgreSQL
  configurado não deve virar sucesso com dados gravados apenas em memória.
- Com `DATABASE_URL` definida, `db.isAvailable()` é sempre verdadeiro (desde
  17/09/2026): os models usam o banco ou falham, nunca a memória. Uma suíte feita
  para o InMemoryStore (IDs fictícios, fixtures na memória) declara
  `process.env.DATABASE_URL = ''` antes dos `require`. Suítes que usam o banco
  aguardam `db.whenReady()` quando dependem do schema/seed já aplicados.
- Dentro de uma transação, **toda** leitura e escrita usa o `client` dela. Uma
  consulta por outra conexão enquanto a transação segura locks pode travar
  (migração concorrente ou pool esgotado).
- **Uma transação só cobre queries executadas no mesmo `client`.** Fazer `BEGIN`
  e depois chamar um model que usa `db.query()` não inclui essa query na transação.
  Passe o client às operações que precisam ser atômicas e confira cada implementação.
- Doação, crédito e extrato devem ser consistentes; falha e reentrega não podem
  perder nem duplicar crédito. Valide também recuperação de registros legados.
- Reserva de vida, itens e intenção de rodada deve sobreviver a falha de processo.
  Um `catch` que devolve recursos não protege contra encerramento abrupto.
- Teste falhas antes/depois do commit, pedidos concorrentes, repetição e recuperação
  em PostgreSQL real quando mexer nesses fluxos. Memória não reproduz locks e índices SQL.
- Não mantenha uma transação longa aberta enquanto o worker gera a simulação.
- Use SQL parametrizado. `ON CONFLICT` precisa corresponder ao índice existente;
  índices parciais podem exigir o mesmo predicado na cláusula de conflito.
- Preserve histórico econômico. Não apague doações para ocultá-las; confira cascatas
  antes de alterar exclusão de usuários ou relacionamentos.
- Para banco já implantado, crie uma nova migration numerada. Não dependa de editar
  uma migration antiga: `schema_migrations` registra aplicação por nome.
- Verifique instalação limpa e atualização de banco existente, ordem de criação de
  colunas/índices, reexecução e concorrência de inicialização.
- O helper `db.query` precisa manter a tipagem de SQL em texto. A dependência
  `@socket.io/postgres-adapter` traz `@types/pg`; sem tipar os argumentos, o TypeScript
  pode inferir linhas como arrays e quebrar os models que acessam `row.id` etc.

## 6. Jogos, frontend e cache

- Regras, física, roteiro e PRNG pertencem ao Rust. TypeScript lê o estado e desenha.
- Preserve tick de 60 Hz, ordem estável e determinismo. Não introduza relógio,
  `Math.random()` ou `relaxed-simd` na simulação.
- Se mudar o comportamento da simulação, atualize `SIM_VERSION` e valide replay/hash
  no Node e no navegador. Ajuste referências econômicas se a mudança autorizada exigir.
- Não edite bundles minificados ou `.wasm` à mão. Mudança em fontes dos jogos,
  inclusive comentários usados no hash das fontes, exige regenerar o build completo.
- Não use apenas o build do Vite: use `npm run games:build`. A saída em
  `frontend/public/games/` é versionada porque o deploy não compila Rust.
- Rode Cargo dentro de `games/sim`. Não execute build e testes Cargo simultaneamente
  sobre o mesmo diretório `target`.
- Quando mudar assets públicos, execute `npm run assets:stamp` e atualize o
  `CACHE_NAME` em `frontend/public/sw.js` conforme necessário para publicar a nova versão.
- Preserve fallback WebGL2 e movimento reduzido. Não ative COOP/COEP ou
  `SharedArrayBuffer` sem resolver a incompatibilidade com login OAuth por popup.
- Escape dados externos antes de inseri-los em HTML; prefira `textContent` quando
  não precisar de marcação. Não confie em texto vindo da API.
- Em mudanças visuais, confira 320, 390, 768 e 1440 px, foco/teclado, modais, overflow,
  loja e debrief. Captura em emulação não comprova desempenho em aparelho físico.

## 7. Chat, autenticação e múltiplas instâncias

- A identidade do chat vem do JWT do handshake; ignore `username` e `role` enviados
  pelo cliente. Preserve a renovação do socket depois do login.
- O chat público usa `stream_room`. Clientes de teste também precisam emitir
  `join-room` antes de esperar `chat:new-message`. Não restaure broadcast global
  para compensar um teste que esqueceu de entrar na sala.
- Preserve o limite por socket e a restrição de salas privadas `user_<id>` ao
  usuário autenticado correspondente.
- O adaptador PostgreSQL é opt-in via `SOCKET_ADAPTER=postgres`. Sua presença no
  código não prova que está habilitado no ambiente nem que duas instâncias funcionam.
- Ao trabalhar em escala, teste eventos entre instâncias, transporte/afinidade,
  orçamento de conexões, limite de fila, timeout, desligamento e retomada.
- Não desative autenticação/rate limit em produção para facilitar testes. Overrides
  de OAuth, banco e autenticação de teste ficam no ambiente de teste.

## 8. Instalação e validação

Use Node 22 para reproduzir o CI. Se usar outra versão local, informe a diferença.
As dependências da raiz, backend e cliente são independentes; preserve os lockfiles.
Instale com `npm ci` quando necessário. Não atualize dependências incidentalmente.

```powershell
npm ci
npm ci --prefix backend
npm ci --prefix games/client

npm run lint
npm run typecheck
npx prettier --check "backend/**/*.js" "database/**/*.js" "frontend/public/**/*.js" "e2e/**/*.js" "scripts/**/*.js" "*.js" "*.json"

$env:DATABASE_URL = ''
npm --prefix backend test

npm --prefix games/client run typecheck
npm run games:test
npm run games:check
npm --prefix backend audit --omit=dev --audit-level=moderate
```

Não trate um bloco de comandos como aprovado só porque o último retornou zero.
Confira o código de saída de cada comando. No PowerShell, use `$LASTEXITCODE` logo
após o comando nativo. Para formatar, passe apenas os arquivos alterados ao Prettier;
ele espera LF por padrão e conversão CRLF local pode causar avisos.

### PostgreSQL real

O CI usa PostgreSQL 15. Crie uma instância local descartável, um banco de testes
backend e outro exclusivo para a integração. Nunca reaproveite dados importantes.
O script abaixo exige host local e nome começando com `livex_channel_test`.

```powershell
# Substitua apenas por host/porta/credenciais do banco descartável que você criou.
$env:TEST_DATABASE_URL = 'postgresql://USUARIO:SENHA@127.0.0.1:PORTA/livex_channel_test'
node backend/test/channelPostgres.integration.js
```

Para reproduzir a suíte backend do workflow, rode `npm --prefix backend test` com
`DATABASE_URL` apontando ao banco descartável backend. Alguns testes forçam memória
por projeto; por isso rode também a integração PostgreSQL explicitamente.

### Navegador

```powershell
npm run test:e2e
# Diagnóstico focado:
npx playwright test e2e/smoke.spec.js --project=core
npx playwright test e2e/visualArena.spec.js --project=visual
```

- Playwright usa o Chrome instalado e sobe o backend. Confira que a porta 3000 não
  pertence a outro serviço; não encerre processos alheios para liberar a porta.
- Fora do CI, a configuração força banco em memória e pode reutilizar servidor
  existente. Confirme que está validando o código e o ambiente corretos.
- Para testar com PostgreSQL como no CI, defina `CI=true` e `DATABASE_URL` para um
  banco local descartável exclusivo do E2E. A configuração lê essas variáveis.
- Leia `test-results/`, `playwright-report/`, screenshot e trace em caso de falha.
  O timeout total do teste não aumenta automaticamente os 5 s padrão das asserções.
- Não execute duas suítes Playwright simultâneas na mesma porta/pasta de resultados.

### Build dos jogos

```powershell
$env:Path = "$env:USERPROFILE/.cargo/bin;$env:Path"
npm run games:build
npm run assets:stamp
npm run games:check

# Dentro de games/sim:
cargo fmt --check
cargo test --release
cargo build --release --target wasm32-unknown-unknown

# De volta à raiz:
node scripts/check-games-build.js --wasm-novo games/sim/target/wasm32-unknown-unknown/release/livex_sim.wasm
```

### Escolha dos testes

| Alteração                              | Verificação necessária                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Documentação                           | Links, comandos, coerência com código e formatação do arquivo                  |
| Backend                                | Lint, TypeScript, formatação e testes backend relevantes                       |
| Economia, SQL, migrations, recuperação | Backend + PostgreSQL real, concorrência e falhas pertinentes                   |
| Frontend/fluxo de usuário              | Lint, formatação e E2E do fluxo; suíte completa se afetar estado compartilhado |
| Chat/autenticação                      | Testes backend e E2E de identidade, salas e interface                          |
| Fontes dos jogos                       | Build completo, tipos, Rust, determinismo, assets e E2E dos jogos afetados     |
| Correção geral de CI                   | Etapas do workflow; não confundir aprovação local com execução remota          |

Não rode a suíte inteira por uma correção exclusivamente documental. Amplie testes
quando houver risco de regressão compartilhada, novas falhas ou requisito do CI.

## 9. Diagnóstico do GitHub Actions

```powershell
gh run list --limit 10 --json databaseId,headSha,conclusion,status,displayTitle,url
gh run view ID_DA_EXECUCAO --json jobs,conclusion
gh run view ID_DA_EXECUCAO --log-failed
# Se não houver logs e os jobs nem tiverem etapas:
gh api repos/ulisseskuster/LiveXGames/commits/SHA/check-runs
gh api repos/ulisseskuster/LiveXGames/check-runs/ID_DO_CHECK/annotations
```

- Confirme o SHA: uma execução verde antiga não valida o commit atual.
- Separe erro de infraestrutura/conta de erro de teste. `log not found` com jobs
  sem etapas exige ler annotations; não invente falha no código.
- Em 15/09/2026, as execuções `34925498261`, `34925823177` e `34926898948` foram
  bloqueadas antes dos testes por pagamento da conta ou limite de gastos do GitHub.
  Consulte novamente antes de afirmar que o bloqueio continua.
- Esse bloqueio exige regularização da conta pelo responsável. Não aumente limites,
  contrate recursos, desative checks ou faça commits vazios repetidos para contorná-lo.
- Só repita uma execução quando houver mudança relevante. Informe bloqueios externos
  e o que foi efetivamente validado localmente.

## 10. Pendências e evidências — referência de 15/09/2026

Esta seção registra o que foi observado sobre `7bc8513` e correções locais desta
data. **Revalide antes de agir; não é autorização para implementar todo o backlog.**

- README, ESCALA e atualizacao contêm retratos de commits anteriores. Há código novo
  para doação transacional, intenção de rodada, compensação e adaptador Socket.IO;
  não os trate como inexistentes nem como garantia de conclusão dos P0/P1.
- **Abertura de rodada (revisada em 17/09/2026, AUDITORIA.md C1/C2):** vida, itens
  e intenção `reserving` são gravados numa única transação com
  `pg_advisory_xact_lock(hashtext(userId))` (`GameRunService.reservar`). Todo
  estorno passa por `abandonarEEstornar`, que só devolve se abandonou a intenção,
  e sempre ao `user_id` da própria rodada. Órfãs são recuperadas por
  `recuperarOrfas` (boot, a cada minuto e na abertura do próprio usuário).
  `requestId` do cliente dos jogos torna a repetição idempotente. Coberto por
  `gameRunIntention.test.js`, que roda no PostgreSQL do CI.
- `/health` exige conexão viva (ping a cada 15 s em `database.js`) e schema
  aplicado. Um erro de conexão ociosa não marca mais o banco como fora; um banco
  fora no boot é tentado de novo até o autoMigrate rodar.
- Escala acima de 1.000 usuários segue sem comprovação registrada. Testes unitários,
  E2E e benchmark isolado de WASM não substituem carga representativa em homologação.
- Antes de concluir segurança/operação, revalide revogação de sessão, fila de workers,
  desligamento controlado, observabilidade, backup/restauração, Web Push e conquistas
  incompletas citadas nos documentos históricos.
- Correções desta tarefa de CI: tipagem do helper PostgreSQL, espera de montagem 3D
  no teste visual e entrada na sala no teste E2E de identidade do chat. Preserve
  asserções de identidade e resultado; confirme a versão final e seus resultados.
- Validação local desta tarefa, Windows/Node 24.19.0: 222 testes backend passaram
  tanto sem banco quanto com PostgreSQL 15; a integração PostgreSQL e os 16 testes
  Rust passaram. Lint, tipos do backend/cliente, formatação dos arquivos verificados,
  auditoria de dependências de produção e comparação WASM publicado/recompilado passaram.
  No E2E com PostgreSQL 15, a execução completa teve 64 aprovados e a falha de sala
  do chat descrita acima; após a correção, os 13 testes de `smoke.spec.js` passaram.
  Os 65 cenários foram assim exercitados com sucesso entre as duas execuções, sem
  uma nova execução completa após a última edição. Isso não equivale a CI remoto verde.

## 11. Git, publicação e encerramento

- Não descarte alterações do usuário. Não use `reset --hard`, limpeza recursiva,
  rebase destrutivo ou force push para simplificar o trabalho.
- Só crie commit quando solicitado ou incluído no fluxo autorizado. **Push e deploy
  precisam de autorização explícita**, aproveitando autorização já dada na sessão.
  O pedido de corrigir código local não implica publicar em produção.
- Quando houver autorização de publicação, prepare e valide a alteração concreta;
  confira diff, testes e segredos antes de enviar. Não peça confirmação duplicada.
- `render.yaml` declara `autoDeployTrigger: checksPass`, mas isso não prova a
  configuração efetiva do painel. Confirme checks do SHA e commit implantado.
- Um asset com hash novo ou `/health` respondendo 200 não identifica sozinho toda
  a versão do backend nem comprova segurança, escala ou integridade do schema.
- Guarde logs e capturas em pastas ignoradas. Registre descobertas importantes em
  documento versionado; arquivos em `scratch/` podem não existir na próxima máquina.
- Encerre apenas servidores, containers e processos temporários criados para sua
  tarefa. Não pare serviços do usuário. Confira caminhos antes de apagar arquivos.
- Antes de terminar: `git diff --check`, revisão do diff, lista dos arquivos alterados
  e verificação de que não entrou segredo, artefato acidental ou mudança fora de escopo.
- Na resposta final, diga **o que mudou, por que, quais testes passaram e o que falta**.
  Diferencie local/remoto, memória/PostgreSQL e implementado/comprovado. Nunca afirme
  que publicou, que o CI ficou verde ou que produção foi validada sem evidência.
- Atualize este arquivo quando uma decisão permanente mudar. Date informações de
  estado e retire pendências somente depois de verificar sua resolução.
