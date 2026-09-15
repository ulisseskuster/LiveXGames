# Atualização dos Três Jogos — LiveX Games

## Retomada prioritária — auditoria de 14/09/2026

O objetivo atual passou a ser **mais de 1.000 usuários simultâneos**.
**Escala não aprovada**; seguir [ESCALA.md](ESCALA.md) e o estado atual do
[README.md](README.md). As seções visuais abaixo são histórico e backlog visual.

- `98b7ee6` foi commitado e enviado para `main` com autorização do usuário.
  Corrigiu conquistas repetidas, agregações de rankings/dashboard, consulta de
  itens, remoção de inscrição push alheia, UI de visitante e relatório do CI.
- Validação local concluída: **211 backend + 65 E2E**, PostgreSQL real,
  lint, TypeScript, Prettier e build dos jogos. Não confundir isso com teste de carga.
- CI a consultar: [34860600309](https://github.com/ulisseskuster/LiveXGames/actions/runs/34860600309).
  Na última consulta, backend/lint/jogos verdes; E2E pendente.
- **Ainda não corrigido:** falha após gravar doação deixa crédito perdido;
  queda antes de persistir rodada perde vida e item. Ambos reproduzidos em
  PostgreSQL descartável. Nenhum teste de carga foi disparado em produção.
- Depois dos dois P0: adaptador Socket.IO entre instâncias, controle de fila,
  readiness/migrações, gate de deploy, observabilidade e backup/restauração.
- Push real e quatro conquistas de streamer continuam incompletos.
- Evidências locais: `artifacts/scale-audit-evidence.json`; reprodução:
  `scratch/scale-audit.cjs` (somente banco descartável local, com falhas intencionais).
  PostgreSQL temporário encerrado. O diagnóstico permanente está em `ESCALA.md`.
- Documentação preservada em commit próprio após `98b7ee6`; consultar o histórico
  de `main` para identificar a revisão documental mais recente.

**Ordem de retomada:** verificar CI → corrigir atomicidade do webhook → tornar
abertura de rodada recuperável → testar falhas → preparar operação em múltiplas
instâncias → testar 1.500 sessões em homologação → reavaliar aprovação.

---

## Controle de entrega por etapas — 14/09/2026

Cada etapa deve terminar com validação, commit e push para permitir retomada sem
refazer trabalho. O escopo abaixo organiza os trechos repetidos deste documento.

- [x] **Etapa 1 — Apresentação (14/09/2026):** preparação com identidade e
  miniatura por jogo; galeria manual dos três veículos com SVGs existentes;
  descrição curta dos consumíveis; entrada suave do resultado, tripulação e
  itens usados. Movimento reduzido e cache PWA fazem parte desta entrega.
  Validação: lint, TypeScript, formatação, `games:check` e os cinco cenários de
  `visualArena.spec.js` + `hudShop.spec.js`. Capturas regeneráveis
  (fora do versionamento). Cache PWA v19, sem novos assets de produção.
- [x] **Etapa 2 — Neon Drifter (14/09/2026):** passagem coberta nos trechos
  288–672 m de cada distrito de 1200 m, com prédios baixos, pilares, placas,
  luzes de emergência lentas, iluminação contida e asfalto/reflexo do carro.
  Geometria instanciada e luzes estáticas em movimento reduzido. Build, TypeScript,
  replay com teclado/pulo, filme completo e renderer automático/reduzido validados.
- [x] **Etapa 3 — Void Walker (14/09/2026):** distorção local do disco em TSL,
  arcos finos, pulso contido e aproximação pelo progresso oficial. Entorno mais
  escuro e rastros decorativos inclinados no clímax. Movimento reduzido sem
  distorção animada, pulso ou deslocamento extra; WebGL2 e renderer automático
  validados em três cenários, além de TypeScript/build. WASM permanece idêntico.
- [x] **Etapa 4 — Jet Launcher (14/09/2026):** céu por altitude e fase (amanhecer
  na decolagem até a borda do espaço nos altos, com estrelas acendendo), drones
  com cor de alerta e marcador pulsante (estático em movimento reduzido) e halo
  translúcido de escudo que só acende com evento real + invulnerabilidade e some
  na batida. Validação: typecheck, lint, formatação e `e2e/cenasQa.js` com o WASM
  publicado em WebGL2 e modo reduzido, capturas por resolução (320/390/768/1440) e
  de escudo, regeneráveis fora do versionamento. WASM, `SIM_VERSION`, buffer e recibos
  permanecem idênticos.
- [ ] **Etapa 5 — Medição:** tabela de 320/390/768/1440 px, comparação 30/60 fps,
  tamanho dos assets e ajustes de efeitos. Registrar separadamente emulação e
  aparelhos físicos; não apresentar capturas como medição de desempenho real.

Próxima etapa **visual**, após os bloqueios de confiabilidade: Medição. Preservar Rust, `SIM_VERSION`,
buffer, recibos e regras econômicas. As artes existentes estão em
`frontend/public/images/`; as cenas ficam em `games/client/src/`.

---

> Projeto: `games/` (simulação WASM + cliente Three.js)  
> Âmbito desta atualização: cena, arte, apresentação e medição.  
> Regra de ouro: o navegador só reproduz o filme gerado no servidor. Nada aqui altera
> distância, ponto, moeda, canal, itens consumidos ou hashing. Se uma mudança tocar
> física, roteiro ou `SIM_VERSION`, ela sai desta atualização e vai para uma rodada
> separada, com nova bateria de determinismo.

---

## 1. Onde estamos

### 1.1 Estado do projeto
- Há três jogos na Arena: **Jet Launcher**, **Neon Drifter** e **Void Walker**.
- Cada jogo tem seu módulo de cena no cliente (`games/client/src/<jogo>/cena.ts`) e
  sua renderização no simulador Rust (`games/sim/src/games/<jogo>.rs`).
- A rodada é uma reprodução de 15 a 20 segundos gerada no servidor e paga antes da
  resposta. O navegador recebe semente, loadout e log, e monta o que foi decidido.
- O projeto já tem uma última renovação visual consolidada e documentada, com prévias
  e capturas por resolução nos artefatos.

### 1.2 O que o README já define como próxima atualização
O README lista explicitamente o que a versão visual seguinte deve entregar:

1. **Neon Drifter — passagem coberta**: trecho fechado com placas, poças e luzes de
   emergência.
2. **Void Walker — singularidade**: distorção óptica leve ao disco de acreção e um
   momento de aproximação para o clímax.
3. **Jet Launcher — céu e combate**: variar o horário entre amanhecer e atmosfera alta,
   dar leitura aos drones e criar um escudo translúcido sincronizado com os eventos já
   existentes.
4. **Apresentação**: melhorar a tela de preparação, galeria dos três veículos,
   transições do debrief e prévias dos consumíveis.
5. **Medição**: testar 320, 390, 768 e 1440 px em aparelhos reais, comparar 30/60 fps
   e tamanho dos assets, ajustar efeitos gráficos e atualizar o manifesto PWA.


---

## 2. O que estejai agora e o que posso tocar com segurança

### 2.1 O cliente como cinema
Os três jogos são, no cliente, uma composição cinematográfica sobre um buffer de render
compartilhado. Eles não decidem quem vence, quanto ganha, qual item foi gasto ou qual
canal recebe. Por isso, a maior parte do que dá para renovar agora mora na cena:

- câmera,
- iluminação,
- chuva, névoa, poeira, rastros,
- prédios, anéis, drones, asteroides, planetas,
- efeitos de pós-processo como bloom,
- texto e placas renderizadas localmente.

Se a mudança fica nesse nível, ela não precisa de nova `SIM_VERSION` nem de nova
checagem de determinismo no comportamento da simulação. O risco de regredir regra é
muito menor.

### 2.2 Onde não posso tocar sem nova versão da simulação
- Hash do buffer de render.
- Leitura de eventos do servidor (`EV_*`).
- Física, roteiro, duração, distância, pontos, moedas.
- Itens, estoque, canal, recuperação de rodadas.
- Qualquer coisa que mude o recibo que o servidor joga.

Se quiser adicionar regra nova, como colisão real, recompensa por zona nova ou
combate com consequência, isso sai desta atualização. Aqui entram apenas encenações
que já têm suporte no buffer ou que só reforçam o que já existe.

### 2.3 O Jet Launcher e o escudo

---

## 3. Atualização por jogo

### 3.1 Neon Drifter — passagem coberta

#### O que entrega
Um trecho urbano mais denso, na linha da leitura cinematográfica que o jogo já
constrói, com:

- camada mais baixa e mais contínua de prédios dos dois lados,
- sobrecenário sugerido por estrutura de apoio, luzes de emergência e placas
  temáticas,
- chuva mais lida no chão em determinados blocos, com reflexo do carro e do
  entorno,
- luzes piscando que mudam a intensidade do ambiente sem mudar o plano da corrida.

#### Como quer dizer
A passagem não é um modo novo. É uma **janela da mesma cidade** que já existe,
com densidade maior, mais congestão visual e mais caráter noturno. O jogador não
precisa aprender nada. Ele só nota que, em certa parte da distância, a vibe muda.

#### Elementos concretos
- placas de murais e letreiros com frases temáticas do Neon.
- luzes de emergência com piscar lento e cor contrastante.
- ruas mais escuras, com asfalto úmido mais intenso.
- reflexo leve do carro no chão quando o neon do carro acende.

#### O que não entra
- nova física de derrapagem.
- novo evento de simulação.
- nova cobrança de item ou canal.
- colisão nova ao passar por essa seção.

#### Dica de execução
Use a mesma técnica de instanciamento relativo ao carro que o jogo já usa para
prédios e faixas. A passagem deve surgir quando a distância ou o fase do roteiro
indica, e nunca depender de decisão do cliente.

### 3.2 Void Walker — singularidade

#### O que entrega
A singularidade ganha camadas. Não vira um monstro novo. Vira um ponto de tensão
visual com:

- disco de acreção com leve distorção óptica, rotação e pulso,
- momento de aproximação quando a expedição se aproxima do clímax,
- fundo e luz ao redor que reagem levemente a essa proximidade,
- continuidade aceitável em WebGL2 e em modo movimento reduzido.

#### Como quer dizer
O clímax já existe no roteiro. A atualização dá a ele **corpo visual**. Quando a
expedição chega perto, o espectador sente que o centro gravita mais, sem precisar
de uma regra nova.

#### Elementos concretos
- disco com anéis finos, rotação lenta e leve "sopro" de cor.
- leve escuridão em torno do centro, como se o campo visual se contraísse.

---

## 4. Apresentação geral

### 4.1 Tela de preparação
Cada jogo deve chegar ao espectador com **identidade pronta**, não só com um jato
parado na pista. A preparação pode incluir:

- título do jogo com tipografia própria,
- breve frase de identidade do personagem ou do contexto,
- mini prévia do veículo já em seu papel visual,
- clima de espera suave, com leve animação de motores, neon ou luz de fundo.

### 4.2 Galeria dos três veículos
Uma apresentação curta, visual e não intrusiva, que mostre:

- Jato Orion no voo,
- esportivo Luna no bairro noturno,
- nave Zara/BOB no espaço e perto da singularidade.

A galeria não precisa ser um menu novo caro. Pode ser uma sequência de slides
leve, com transição suave, cada um usando a paleta do jogo.

### 4.3 Transições do debrief
A volta do filme para o recibo deve se sentir como **encerramento**, não como
corte brusco. É possível usar:

- desaceleração de efeitos ao fim da rodada,

---

## 5. Medição e PWA

### 5.1 O que medir
O README pede medição em larguras reais e comparação de fps. A atualização deve
conferir:

- 320 px,
- 390 px,
- 768 px,
- 1440 px,

em aparelhos reais quando possível, e comparar:

- 30 fps e 60 fps,
- tamanho dos assets,
- impacto de efeitos gráficos em cada tamanho.


---

## 6. Arte e identidade

### 6.1 Tom dos três jogos
Cada jogo tem uma atmosfera distinta e deve mantê-la:

- Jet Launcher: velocidade, elevação, combate aéreo, amanhecer e espaço.
- Neon Drifter: cidade noturna, synthwave, chuva, perseguição.
- Void Walker: espaço, expedição, planetas, singularidade.

A atualização não quer unificar os jogos numa mesma vibe. Quer que cada um
completem sua própria identidade, com coerência visual interna.

### 6.2 Prêmio visual
Um efeito de atualização visual bem-sucedido não precisa ser o mais complexo.
Pode ser o mais **penas** para a narrativa do jogo. Neons mais lidos. Céu mais
contado. Singularidade mais presente. Escudo que acende quando deveria.

---

## 7. Paleta de ações para entrega

### Neon Drifter
- inserir passagem coberta com prédios mais densos e luzes de emergência,
- reforçar reflexo de chuva e asfalto úmido,
- adicionar placas e letreiros temáticos,
- manter a mesma lógica de instanciamento relativo ao carro.

### Void Walker
- adicionar disco de acreção com leve distorção e pulso,
- ligar aproximação visual ao progresso do roteiro,
- escurecer levemente o entorno do clímax,
- garantir fallback visual para WebGL2 e movimento reduzido.

### Jet Launcher
- variar o céu por horário/altitude,
- tornar os drones mais legíveis,
- introduzir halo translúcido de escudo sincronizado com `EV_SHIELD` e estado
  de invulnerabilidade,
- manter o combate e o roteiro intactos.

### Apresentação
- renovar a tela de preparação dos três jogos,

---

## 8. O que não é desta atualização

- não toca na simulação Rust nem no `SIM_VERSION`,
- não altera roteiro, pontos, moeda, canal ou itens,
- não insere nova regra de combate ou colisão,
- não quebra a regra de "navegador só reproduz filme",
- não depende de decisão do cliente sobre resultado,
- não exige backend novo.

Se qualquer item acima se tornar desejável, ele sai deste documento e vira outra
trabalho, com versão nova de simulação e checagem própria.

---

## 9. Critérios de aceite

- As mesmas semente, loadout, hash, distância, pontos, moedas, vidas e canal
  devem produzir exatamente o mesmo recibo antes e depois, se a atualização não
  mudar regra.
- Qualquer mudança em regra, física ou roteiro Rust deve ser tratada separadamente,
  com nova `SIM_VERSION` e a bateria de determinismo.
- As novas passagens devem ser visuais, não funcionais.
- O escudo do Jet Launcher deve aparecer como confirmação visual do evento;
  não como arena de controle.
- A singularidade da Void Walker deve aproximar visualmente sem mudar o comportamento
  do jogo.
- A passagem do Neon Drifter deve ser um trecho encenado, não um modo novo.

---

## 10. Próximos passos sugeridos

1. Validar esta atualização com você e escolher a ordem de entrega.
2. Começar pela apresentação dos três jogos, porque ela dá tom para todas as
   demais mudanças.
3. Fazer Neon Drifter e Void Walker em paralelo, já que são cenas puras.
4. Fazer o Jet Launcher por último, porque ele tem a leitura de escudo e o
   reforço de drones, e porque ele carrega a maior tensão de combate.
5. Rodar medição em telas reais e ajustar só efeitos.
6. Atualizar o manifesto PWA e os artefatos visuais se necessário.

---

> Esta atualização é para ficar bonita, sentir consistência e entregar ao
> espectador o que o jogo já diz, só com mais voz.

- adicionar galeria curta dos três veículos,
- melhorar as transições do debrief,
- abrir a loja com prévia mínima de item.

### Medição e deploy
- fazer tabela de medição por largura e fps,
- ajustar apenas efeitos gráficos quando necessário,
- atualizar o manifesto PWA se o bundle mudar.

### 5.2 O que ajustar com base na medição
- só efeitos gráficos, se precisar.
- a resolução de render e a escala do pixel ratio, já que o cliente já tem
  adaptação de qualidade.
- o manifesto PWA, se a atualização introduzir novos assets ou variar
  significativamente o bundle.

### 5.3 Regra prática
Se após a medição o efeito for positivo mas custoso em baixa resolução, o ajuste
deve acontecer no efeito, não na regra do jogo. A cena é flexível; o buffer não é.

- título do resultado com consistência visual com o jogo,
- destaque para pontos, moedas e consumíveis de forma mais legível.

### 4.4 Prévias dos consumíveis
Ao apertar Suprimentos, a loja pode abrir com **prévia mínima do item**, usando:

- ícone,
- nome,
- efeito curto,
- prévia visual só se houver arte já pronta para isso; caso contrário,
  manter texto + ícone e evitar inventar arte nova.

Aqui o importante é que a loja não sinta uma tela administrativa. Ela deve sentir
uma aba da vibe do jogo.

- leve acentuação de brilho na singularidade nos momentos de maior progresso.
- poeira e rastros com um leve arrasto na direção do centro, na medida certa.

#### O que não entra
- novo asteroide, novo planeta, novo evento.
- mudança de pontos ou de trajetória.
- dependência de item.

#### Dica de execução
A singularidade já escala com o progresso do roteiro. A atualização pode ligar a
esse progresso e só acrescentar outra camada de apresentação por cima, com shaders
leves e sem desenho geométrico pesado.

### 3.3 Jet Launcher — céu, combate e escudo

#### O que entrega
O Jet Launcher ganha as três leituras que o README pede:

1. **Céu com variação de horário e altitude**
   - o céu do amanhecer suave e mais quente na decolagem,
   - transição suave para atmosfera mais profunda e mais noturna nos altos,
   - estrelas e partículas que ganham ritmo conforme a altitude e a fase do voo.

2. **Leitura dos drones**
   - os drones ficam mais legíveis como ameaças ativas,
   - leve pulso visual, cor de alerta e/ou orientação mais clara,
   - sem criar novos eventos, apenas reforçar o que o jogo já mostra.

3. **Escudo translúcido sincronizado com os eventos existentes**
   - quando o escudo do item é acionado e absorve, um halo translúcido envolve o jato,
   - o efeito aparece no instante do evento e some no ritmo dele,
   - não há controle de escudo pelo jogador, nem novo comportamento de combate.

#### Como quer dizer
O Jet Launcher não vira um jogo de escudo ativo. Ele vira um jogo com
**presentação mais completa de sua própria tensão**: céu que conta a altitude, drones
que se leem antes de atacar, e um efeito de escudo que confirma, no olho, o que o
servidor já registrou.

#### Elementos concretos
- gradiente de céu com duas ou três atmosferas, não apenas um céu fixo.
- partículas de fundo e estrelas que aparecem de forma mais clara no suborbital.
- drones com leve pulso, anel de alerta ou leve mudança de brilho.
- halos de escudo translúcidos, com leve brilho interno e contorno suave, mais
  forte nos momentos de impacto absorvido.

#### O que não entra
- controlabilidade nova do escudo.
- nova regra de míssil ou drone.
- mudança de hitbox, invulnerabilidade ou cooldown.
- mudança de resultado, moeda ou canal.

#### Dica de execução
O escudo visual pode ler o buffer e só acender quando o evento de escudo está
presente ou quando o estado de invulnerabilidade do jato indica absorção visual.
Tudo isso é encenação. O comportamento de jogo já está no servidor e no buffer.

O simulador do Jet já possui um evento de escudo e uma invulnerabilidade curta. O
cliente pode, portanto, expor um **halo visual** que responde ao mesmo instante que
o servidor já anotou. O efeito deve ser:

- translúcido,
- envolvente,
- discreto quando inativo,
- nítido e breve quando ativo,
- visível no mesmo ritmo do evento que o servidor emitiu.

Isso não transforma o jogo em um jogo de escudo ativo. Transforma ele em um jogo
com **contorno visual coerente** quando o efeito do item joga.

Esta atualização não reinventa o plano. Ela o mostra, completa, com recheio.

> Projeto: `games/` (simulação WASM + cliente Three.js)  
> Âmbito desta atualização: cena, arte, apresentação e medição.  
> Regra de ouro: o navegador só reproduz o filme gerado no servidor. Nada aqui altera
> distância, ponto, moeda, canal, itens consumidos ou hashing. Se uma mudança tocar
> física, roteiro ou `SIM_VERSION`, ela sai desta atualização e vai para uma rodada
> separada, com nova bateria de determinismo.

---

## 1. Onde estamos

---

## 2. O que estejai agora e o que posso tocar com segurança

### 2.1 O cliente como cinema
Os três jogos são, no cliente, uma composição cinematográfica sobre um buffer de render
compartilhado. Eles não decidem quem vence, quanto ganha, qual item foi gasto ou qual
canal recebe. Por isso, a maior parte do que dá para renovar agora mora na cena:

- câmera,
- iluminação,
- chuva, névoa, poeira, rastros,
- prédios, anéis, drones, asteroides, planetas,
- efeitos de pós-processo como bloom,
- texto e placas renderizadas localmente.

Se a mudança fica nesse nível, ela não precisa de nova `SIM_VERSION` nem de nova
checagem de determinismo no comportamento da simulação. O risco de regredir regra é
muito menor.

### 2.2 Onde não posso tocar sem nova versão da simulação
- Hash do buffer de render.
- Leitura de eventos do servidor (`EV_*`).
- Física, roteiro, duração, distância, pontos, moedas.
- Itens, estoque, canal, recuperação de rodadas.
- Qualquer coisa que mude o recibo que o servidor joga.

Se quiser adicionar regra nova, como colisão real, recompensa por zona nova ou
combate com consequência, isso sai desta atualização. Aqui entram apenas encenações
que já têm suporte no buffer ou que só reforçam o que já existe.

---

## 3. Atualização por jogo

### 3.1 Neon Drifter — passagem coberta

#### O que entrega
Um trecho urbano mais denso, na linha da leitura cinematográfica que o jogo já
constrói, com:

- camada mais baixa e mais contínua de prédios dos dois lados,
- sobrecenário sugerido por estrutura de apoio, luzes de emergência e placas
  temáticas,
- chuva mais lida no chão em determinados blocos, com reflexo do carro e do
  entorno,
- luzes piscando que mudam a intensidade do ambiente sem mudar o plano da corrida.

#### Como quer dizer
A passagem não é um modo novo. É uma **janela da mesma cidade** que já existe,
com densidade maior, mais congestão visual e mais caráter noturno. O jogador não
precisa aprender nada. Ele só nota que, em certa parte da distância, a vibe muda.

#### Elementos concretos
- placas de murais e letreiros com frases temáticas do Neon.
- luzes de emergência com piscar lento e cor contrastante.
- ruas mais escuras, com asfalto úmido mais intenso.
- reflexo leve do carro no chão quando o neon do carro acende.

#### O que não entra
- nova física de derrapagem.
- novo evento de simulação.
- nova cobrança de item ou canal.
- colisão nova ao passar por essa seção.

#### Dica de execução
Use a mesma técnica de instanciamento relativo ao carro que o jogo já usa para
prédios e faixas. A passagem deve surgir quando a distância ou o fase do roteiro
indica, e nunca depender de decisão do cliente.

### 3.2 Void Walker — singularidade

#### O que entrega
A singularidade ganha camadas. Não vira um monstro novo. Vira um ponto de tensão
visual com:

- disco de acreção com leve distorção óptica, rotação e pulso,
- momento de aproximação quando a expedição se aproxima do clímax,
- fundo e luz ao redor que reagem levemente a essa proximidade,
- continuidade aceitável em WebGL2 e em modo movimento reduzido.

#### Como quer dizer
O clímax já existe no roteiro. A atualização dá a ele **corpo visual**. Quando a
expedição chega perto, o espectador sente que o centro gravita mais, sem precisar
de uma regra nova.

#### Elementos concretos
- disco com anéis finos, rotação lenta e leve "sopro" de cor.
- leve escuridão em torno do centro, como se o campo visual se contraísse.
- leve acentuação de brilho na singularidade nos momentos de maior progresso.
- poeira e rastros com um leve arrasto na direção do centro, na medida certa.

#### O que não entra
- novo asteroide, novo planeta, novo evento.

---

## 4. Apresentação geral

### 4.1 Tela de preparação
Cada jogo deve chegar ao espectador com **identidade pronta**, não só com um jato
parado na pista. A preparação pode incluir:

- título do jogo com tipografia própria,
- breve frase de identidade do personagem ou do contexto,
- mini prévia do veículo já em seu papel visual,
- clima de espera suave, com leve animação de motores, neon ou luz de fundo.

### 4.2 Galeria dos três veículos
Uma apresentação curta, visual e não intrusiva, que mostre:

- Jato Orion no voo,
- esportivo Luna no bairro noturno,
- nave Zara/BOB no espaço e perto da singularidade.

A galeria não precisa ser um menu novo caro. Pode ser uma sequência de slides
leve, com transição suave, cada um usando a paleta do jogo.

### 4.3 Transições do debrief
A volta do filme para o recibo deve se sentir como **encerramento**, não como
corte brusco. É possível usar:

- desaceleração de efeitos ao fim da rodada,
- título do resultado com consistência visual com o jogo,
- destaque para pontos, moedas e consumíveis de forma mais legível.

### 4.4 Prévias dos consumíveis
Ao apertar Suprimentos, a loja pode abrir com **prévia mínima do item**, usando:

- ícone,
- nome,
- efeito curto,
- prévia visual só se houver arte já pronta para isso; caso contrário,
  manter texto + ícone e evitar inventar arte nova.

Aqui o importante é que a loja não sinta uma tela administrativa. Ela deve sentir
uma aba da vibe do jogo.

---

## 5. Medição e PWA

### 5.1 O que medir
O README pede medição em larguras reais e comparação de fps. A atualização deve
conferir:

- 320 px,
- 390 px,
- 768 px,
- 1440 px,

em aparelhos reais quando possível, e comparar:

- 30 fps e 60 fps,
- tamanho dos assets,
- impacto de efeitos gráficos em cada tamanho.

### 5.2 O que ajustar com base na medição
- só efeitos gráficos, se precisar.
- a resolução de render e a escala do pixel ratio, já que o cliente já tem


---

## 8. O que não é desta atualização

- não toca na simulação Rust nem no `SIM_VERSION`,
- não altera roteiro, pontos, moeda, canal ou itens,
- não insere nova regra de combate ou colisão,
- não quebra a regra de "navegador só reproduz filme",
- não depende de decisão do cliente sobre resultado,
- não exige backend novo.

Se qualquer item acima se tornar desejável, ele sai deste documento e vira outra
trabalho, com versão nova de simulação e checagem própria.

---

## 9. Critérios de aceite

- As mesmas semente, loadout, hash, distância, pontos, moedas, vidas e canal
  devem produzir exatamente o mesmo recibo antes e depois, se a atualização não
  mudar regra.
- Qualquer mudança em regra, física ou roteiro Rust deve ser tratada separadamente,
  com nova `SIM_VERSION` e a bateria de determinismo.
- As novas passagens devem ser visuais, não funcionais.
- O escudo do Jet Launcher deve aparecer como confirmação visual do evento;
  não como arena de controle.
- A singularidade da Void Walker deve aproximar visualmente sem mudar o comportamento
  do jogo.
- A passagem do Neon Drifter deve ser um trecho encenado, não um modo novo.

---

## 10. Próximos passos sugeridos

1. Validar esta atualização com você e escolher a ordem de entrega.
2. Começar pela apresentação dos três jogos, porque ela dá tom para todas as
   demais mudanças.
3. Fazer Neon Drifter e Void Walker em paralelo, já que são cenas puras.
4. Fazer o Jet Launcher por último, porque ele tem a leitura de escudo e o
   reforço de drones, e porque ele carrega a maior tensão de combate.
5. Rodar medição em telas reais e ajustar só efeitos.
6. Atualizar o manifesto PWA e os artefatos visuais se necessário.

---

> Esta atualização é para ficar bonita, sentir consistência e entregar ao
> espectador o que o jogo já diz, só com mais voz.

  adaptação de qualidade.
- o manifesto PWA, se a atualização introduzir novos assets ou variar
  significativamente o bundle.

### 5.3 Regra prática
Se após a medição o efeito for positivo mas custoso em baixa resolução, o ajuste
deve acontecer no efeito, não na regra do jogo. A cena é flexível; o buffer não é.

---

## 6. Arte e identidade

### 6.1 Tom dos três jogos
Cada jogo tem uma atmosfera distinta e deve mantê-la:

- Jet Launcher: velocidade, elevação, combate aéreo, amanhecer e espaço.
- Neon Drifter: cidade noturna, synthwave, chuva, perseguição.
- Void Walker: espaço, expedição, planetas, singularidade.

A atualização não quer unificar os jogos numa mesma vibe. Quer que cada um
completem sua própria identidade, com coerência visual interna.

### 6.2 Prêmio visual
Um efeito de atualização visual bem-sucedido não precisa ser o mais complexo.
Pode ser o mais **penas** para a narrativa do jogo. Neons mais lidos. Céu mais
contado. Singularidade mais presente. Escudo que acende quando deveria.

---

## 7. Paleta de ações para entrega

### Neon Drifter
- inserir passagem coberta com prédios mais densos e luzes de emergência,
- reforçar reflexo de chuva e asfalto úmido,
- adicionar placas e letreiros temáticos,
- manter a mesma lógica de instanciamento relativo ao carro.

### Void Walker
- adicionar disco de acreção com leve distorção e pulso,
- ligar aproximação visual ao progresso do roteiro,
- escurecer levemente o entorno do clímax,
- garantir fallback visual para WebGL2 e movimento reduzido.

### Jet Launcher
- variar o céu por horário/altitude,
- tornar os drones mais legíveis,
- introduzir halo translúcido de escudo sincronizado com `EV_SHIELD` e estado
  de invulnerabilidade,
- manter o combate e o roteiro intactos.

### Apresentação
- renovar a tela de preparação dos três jogos,
- adicionar galeria curta dos três veículos,
- melhorar as transições do debrief,
- abrir a loja com prévia mínima de item.

### Medição e deploy
- fazer tabela de medição por largura e fps,
- ajustar apenas efeitos gráficos quando necessário,
- atualizar o manifesto PWA se o bundle mudar.

- mudança de pontos ou de trajetória.
- dependência de item.

#### Dica de execução
A singularidade já escala com o progresso do roteiro. A atualização pode ligar a
esse progresso e só acrescentar outra camada de apresentação por cima, com shaders
leves e sem desenho geométrico pesado.

### 3.3 Jet Launcher — céu, combate e escudo

#### O que entrega
O Jet Launcher ganha as três leituras que o README pede:

1. **Céu com variação de horário e altitude**
   - o céu do amanhecer suave e mais quente na decolagem,
   - transição suave para atmosfera mais profunda e mais noturna nos altos,
   - estrelas e partículas que ganham ritmo conforme a altitude e a fase do voo.

2. **Leitura dos drones**
   - os drones ficam mais legíveis como ameaças ativas,
   - leve pulso visual, cor de alerta e/ou orientação mais clara,
   - sem criar novos eventos, apenas reforçar o que o jogo já mostra.

3. **Escudo translúcido sincronizado com os eventos existentes**
   - quando o escudo do item é acionado e absorve, um halo translúcido envolve o jato,
   - o efeito aparece no instante do evento e some no ritmo dele,
   - não há controle de escudo pelo jogador, nem novo comportamento de combate.

#### Como quer dizer
O Jet Launcher não vira um jogo de escudo ativo. Ele vira um jogo com
**presentação mais completa de sua própria tensão**: céu que conta a altitude, drones
que se leem antes de atacar, e um efeito de escudo que confirma, no olho, o que o
servidor já registrou.

#### Elementos concretos
- gradiente de céu com duas ou três atmosferas, não apenas um céu fixo.
- partículas de fundo e estrelas que aparecem de forma mais clara no suborbital.
- drones com leve pulso, anel de alerta ou leve mudança de brilho.
- halos de escudo translúcidos, com leve brilho interno e contorno suave, mais
  forte nos momentos de impacto absorvido.

#### O que não entra
- controlabilidade nova do escudo.
- nova regra de míssil ou drone.
- mudança de hitbox, invulnerabilidade ou cooldown.
- mudança de resultado, moeda ou canal.

#### Dica de execução
O escudo visual pode ler o buffer e só acender quando o evento de escudo está
presente ou quando o estado de invulnerabilidade do jato indica absorção visual.
Tudo isso é encenação. O comportamento de jogo já está no servidor e no buffer.


### 2.3 O Jet Launcher e o escudo
O simulador do Jet já possui um evento de escudo e uma invulnerabilidade curta. O
cliente pode, portanto, expor um **halo visual** que responde ao mesmo instante que
o servidor já anotou. O efeito deve ser:

- translúcido,
- envolvente,
- discreto quando inativo,
- nítido e breve quando ativo,
- visível no mesmo ritmo do evento que o servidor emitiu.

Isso não transforma o jogo em um jogo de escudo ativo. Transforma ele em um jogo
com **contorno visual coerente** quando o efeito do item joga.


### 1.1 Estado do projeto
- Há três jogos na Arena: **Jet Launcher**, **Neon Drifter** e **Void Walker**.
- Cada jogo tem seu módulo de cena no cliente (`games/client/src/<jogo>/cena.ts`) e
  sua renderização no simulador Rust (`games/sim/src/games/<jogo>.rs`).
- A rodada é uma reprodução de 15 a 20 segundos gerada no servidor e paga antes da
  resposta. O navegador recebe semente, loadout e log, e monta o que foi decidido.
- O projeto já tem uma última renovação visual consolidada e documentada, com prévias
  e capturas por resolução nos artefatos.

### 1.2 O que o README já define como próxima atualização
O README lista explicitamente o que a versão visual seguinte deve entregar:

1. **Neon Drifter — passagem coberta**: trecho fechado com placas, poças e luzes de
   emergência.
2. **Void Walker — singularidade**: distorção óptica leve ao disco de acreção e um
   momento de aproximação para o clímax.
3. **Jet Launcher — céu e combate**: variar o horário entre amanhecer e atmosfera alta,
   dar leitura aos drones e criar um escudo translúcido sincronizado com os eventos já
   existentes.
4. **Apresentação**: melhorar a tela de preparação, galeria dos três veículos,
   transições do debrief e prévias dos consumíveis.
5. **Medição**: testar 320, 390, 768 e 1440 px em aparelhos reais, comparar 30/60 fps
   e tamanho dos assets, ajustar efeitos gráficos e atualizar o manifesto PWA.

Esta atualização não reinventa o plano. Ela o mostra, completa, com recheio.
