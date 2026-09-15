// LiveX Games - Frontend Application Core with Multi-Game Switcher, PIX & Simulation Center
const API_URL =
  window.location.protocol === 'file:' ||
  !window.location.origin ||
  window.location.origin === 'null'
    ? 'http://localhost:3000'
    : window.location.origin;

const PROTAGONISTS = {
  jet_launcher: {
    id: 'jet_launcher',
    title: 'Jet Launcher',
    name: 'CAPITÃO ORION',
    role: 'ÁS DOS CÉUS',
    avatar: 'rocket',
    speechReady: 'Turbinas aquecidas em standby. Hangar liberado para decolagem, piloto!',
    speechLaunch: 'Contagem regressiva... 3, 2, 1, DECOLAGEM! Aceleração máxima!',
    hudTitle: 'Jet Launcher',
    statusReady: 'HANGAR PRONTO',
    vehicle: 'ORION-07',
    introduction: 'Do amanhecer à alta atmosfera. Orion está pronto para subir.',
    launchBtnText: 'COMEÇAR',
    launchBtnIcon: 'rocket',
    inventoryTitle: 'Suprimentos de voo',
    debriefTitle: 'Voo Concluído!',
    items: ['nitro_booster', 'shield_deflector', 'extra_fuel']
  },
  neon_drifter: {
    id: 'neon_drifter',
    title: 'Neon Drifter',
    name: 'LUNA VEX',
    role: 'RAINHA DO DRIFT',
    avatar: 'mic-vocal',
    speechReady: 'V8 biturbo roncando alto na noite synthwave. Pista livre, vamos queimar pneu!',
    speechLaunch: 'Embreagem solta, pé no fundo! Arrancada brutal na autoestrada!',
    hudTitle: 'Neon Drifter',
    statusReady: 'GARAGEM PRONTA',
    vehicle: 'VEX-01',
    introduction: 'Asfalto molhado, neon aceso. Luna Vex toma conta da noite.',
    launchBtnText: 'COMEÇAR',
    launchBtnIcon: 'car-front',
    inventoryTitle: 'Oficina de corrida',
    debriefTitle: 'Corrida Synthwave Concluída!',
    items: ['nos_injection', 'drift_tires', 'emp_shield']
  },
  void_walker: {
    id: 'void_walker',
    title: 'Void Walker',
    name: 'COMANDANTE ZARA & BOB',
    role: 'NAVEGADORES QUÂNTICOS',
    avatar: 'bot',
    speechReady: 'Dobra espacial calibrada em 100%. Propulsores de matéria escura em standby!',
    speechLaunch: 'Acionando motores de dobra... Rompendo o horizonte de eventos!',
    hudTitle: 'Void Walker',
    statusReady: 'PORTAL ABERTO',
    vehicle: 'ARK-03',
    introduction: 'Zara e BOB seguem entre planetas, rumo à singularidade.',
    launchBtnText: 'EXPLORAR',
    launchBtnIcon: 'sparkles',
    inventoryTitle: 'Módulos de expedição',
    debriefTitle: 'Missão Hiperespacial Concluída!',
    items: ['quantum_jump', 'plasma_shield', 'dark_matter']
  }
};

const state = {
  token: localStorage.getItem('livex_logged_in') === 'true' ? 'session' : null,
  user: null,
  wallet: { balance: 0, currency_code: 'credits' },
  inventory: [],
  shopItems: [],
  streamerRewards: [],
  rewardFilter: 'all',
  // O catálogo abre mostrando REWARDS_VISIVEIS brindes; o botão de expandir
  // revela o resto sem recarregar nada (a lista inteira já veio na resposta).
  rewardsExpanded: false,
  // Token de redefinicao lido da URL e retirado dela em seguida (ver
  // tratarLinksDeEmail). Fica so em memoria, nunca no localStorage.
  resetToken: null,
  moderationFilter: 'pending',
  moderationSource: 'rewards',
  moderationQueue: [],
  applicationsQueue: [],
  selectedRewardForRedeem: null,
  currentGame: 'jet_launcher',
  isFlying: false,
  equippedByGame: {},
  purchasingItems: new Set(),
  botsActive: false,
  botsInterval: null,
  streamerList: [],
  currentChannel: null,
  channelEpoch: 0,
  channelLives: 0,
  // Jogo e período do ranking; jogo null = acompanha o jogo aberto.
  rankingGame: null,
  rankingPeriod: 'weekly',
  myStreamerApplications: [],
  streamerDashboard: null
};

// Conexão Socket.IO. O token vai no handshake para que o servidor saiba quem
// fala: a identidade do chat e o acesso à sala privada 'user_<id>' derivam dele.
// É uma função porque o socket.io a executa a cada (re)conexão, pegando o token
// atual — no carregamento da página ainda pode não haver sessão.
const socket = io(API_URL, {
  auth: (cb) => cb({})
});

// Refaz o handshake para que o servidor releia o token (login ou logout).
function reconectarSocket() {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

// Elementos do DOM
const landingPage = document.getElementById('landingPage');
const appRoot = document.getElementById('appRoot');
const currentUsernameEl = document.getElementById('currentUsername');
const userRoleBadgeEl = document.getElementById('userRoleBadge');
const livesCounterEl = document.getElementById('livesCounter');
const livesNumericEl = document.getElementById('livesNumeric');
const walletBalanceEl = document.getElementById('walletBalance');
const currentUserChip = document.getElementById('currentUserChip');
const profileDropdown = document.getElementById('profileDropdown');
const authModal = document.getElementById('authModal');
const closeAuthModal = document.getElementById('closeAuthModal');
const soundToggleBtn = document.getElementById('soundToggleBtn');
const soundIcon = document.getElementById('soundIcon');

const shopGrid = document.getElementById('shopGrid');
const refreshShopBtn = document.getElementById('refreshShopBtn');
const launchJetBtn = document.getElementById('launchJetBtn');
const launchIcon = document.getElementById('launchIcon');
const launchText = document.getElementById('launchText');
const flightStatusTag = document.getElementById('flightStatusTag');
const gameZoneTitle = document.getElementById('gameZoneTitle');
const inventoryPanelTitle = document.getElementById('inventoryPanelTitle');

// Debrief Modal & Gráfico
const debriefModal = document.getElementById('debriefModal');
const debriefTitle = document.getElementById('debriefTitle');
const debriefDistance = document.getElementById('debriefDistance');
const debriefAltitude = document.getElementById('debriefAltitude');
const debriefScore = document.getElementById('debriefScore');
const debriefCoins = document.getElementById('debriefCoins');
const closeDebriefBtn = document.getElementById('closeDebriefBtn');
const flightGraphCanvas = document.getElementById('flightGraphCanvas');

// Protagonista Comms
const pilotCommsWidget = document.getElementById('pilotCommsWidget');
const pilotSpeech = document.getElementById('pilotSpeech');
const pilotAvatarImg = document.getElementById('pilotAvatarImg');
const pilotNameTag = document.getElementById('pilotNameTag');
const pilotRoleTag = document.getElementById('pilotRoleTag');

// Chat
const chatFeed = document.getElementById('chatFeed');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const botsStatusBadge = document.getElementById('botsStatusBadge');

// Leaderboard
const leaderboardBody = document.getElementById('leaderboardBody');

// Edição de Perfil
const editProfileModal = document.getElementById('editProfileModal');

// Dev & Simulation Dock
const simDock = document.getElementById('simDock');
const simDockHeader = document.getElementById('simDockHeader');

/* ==========================================================================
   INICIALIZAÇÃO E AUTENTICAÇÃO
   ========================================================================== */
async function init() {
  setupSocketEvents();
  setupEventListeners();
  setupSimulationDock();
  setupSoundControls();
  setupStreamerShopEvents();
  setupArenaTabs();

  // Do debrief direto para o placar: o voo acabou de acontecer e o ranking
  // agora vive em outra aba.
  const viewRankingBtn = document.getElementById('viewRankingBtn');
  if (viewRankingBtn) {
    viewRankingBtn.addEventListener('click', () => {
      const modal = document.getElementById('debriefModal');
      if (modal) modal.classList.add('hidden');
      setArenaView('ranking');
      const bay = document.querySelector('.leaderboard-bay');
      if (bay)
        requestAnimationFrame(() => bay.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  }
  setupStreamerDirectoryEvents();
  setupStreamerChannelEvents();
  setupCreatorHubEvents();
  setupModerationSourceTabs();
  configurarRecuperacaoDeSenha();

  // Dados públicos (catálogo de itens, ranking) podem ser pré-carregados
  // independentemente de o visitante estar autenticado ou ainda na homepage.
  // O catálogo de brindes por streamer só é carregado ao abrir a página de um
  // streamer específico, já que cada um tem sua própria lojinha agora.
  await loadShopItems();
  await loadLeaderboard();

  // Links de e-mail (/redefinir-senha, /confirmar-email) sao tratados depois da
  // restauracao da sessao, porque a confirmacao recarrega o perfil quando ha
  // alguem logado.
  let isAuthenticated = false;
  if (state.token) {
    isAuthenticated = await loadUserProfile();
  }

  await tratarLinksDeEmail();

  if (isAuthenticated) {
    enterApp();

    // Verifica retorno de autorização OAuth da Twitch (só é relevante já logado)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('twitch_linked')) {
      const isSub = urlParams.get('is_sub') === 'true';
      const twitchNick = urlParams.get('username') || '';
      showToast(
        `Twitch @${twitchNick} conectada via OAuth 2.0! ${isSub ? 'Status SUB Confirmado (+2 vidas douradas por dia)!' : ''}`,
        'link'
      );
      if (window.JetSound) window.JetSound.playCoinChime();
      window.history.replaceState({}, document.title, window.location.pathname);
      await loadUserProfile();
      openStreamLinkModal();
    } else if (urlParams.has('twitch_error')) {
      const errorMsg = urlParams.get('twitch_error');
      showToast(`Falha na autorização Twitch: ${errorMsg}`, 'triangle-alert');
      window.history.replaceState({}, document.title, window.location.pathname);
      await loadUserProfile();
      openStreamLinkModal(false, errorMsg);
    } else if (urlParams.has('kick_linked')) {
      const kickNick = urlParams.get('username') || '';
      showToast(
        `Kick @${kickNick} conectada via OAuth 2.1! A confirmação de assinante chega automaticamente assim que a Kick notificar.`,
        'link'
      );
      if (window.JetSound) window.JetSound.playCoinChime();
      window.history.replaceState({}, document.title, window.location.pathname);
      await loadUserProfile();
      openStreamLinkModal();
    } else if (urlParams.has('kick_error')) {
      const errorMsg = urlParams.get('kick_error');
      showToast(`Falha na autorização Kick: ${errorMsg}`, 'triangle-alert');
      window.history.replaceState({}, document.title, window.location.pathname);
      await loadUserProfile();
      openStreamLinkModal();
      showKickModalError(errorMsg);
    } else if (sessionStorage.getItem('return_to_stream_modal') === 'true') {
      sessionStorage.removeItem('return_to_stream_modal');
      openStreamLinkModal();
    }
  } else {
    state.token = null;
    state.user = null;
    state.token = null;
    // Quem abre /game direto (link compartilhado, PWA, refresh) cai na Arena em
    // modo demonstracao, sem passar pela homepage. Qualquer outra rota comeca
    // na homepage.
    if (window.location.pathname === GAME_PATH) {
      enterApp(true);
    } else {
      showLanding();
    }
  }
}

/* ==========================================================================
   HOMEPAGE (LANDING) <-> APLICAÇÃO
   ========================================================================== */
// Unico ponto de troca de tela. Classe e style inline andam juntos: mexer
// so na classe deixa um display:none inline preso no elemento que volta.
const GAME_PATH = '/game';

function showScreen(screen) {
  const onLanding = screen === 'landing';
  if (landingPage) {
    landingPage.classList.toggle('hidden', !onLanding);
    landingPage.style.display = onLanding ? '' : 'none';
  }
  if (appRoot) {
    appRoot.classList.toggle('hidden', onLanding);
    appRoot.style.display = onLanding ? 'none' : 'block';
  }

  // A Arena mora em /game e a homepage em /: mantem a barra de endereco
  // coerente com a tela aberta, para que recarregar ou compartilhar o link
  // devolva a mesma tela. A query string e preservada porque os retornos de
  // OAuth (twitch_linked, kick_error, ...) sao lidos depois desta troca.
  const alvo = onLanding ? '/' : GAME_PATH;
  if (window.location.pathname !== alvo) {
    window.history.replaceState({}, document.title, alvo + window.location.search);
  }
}

function showLanding() {
  showScreen('landing');
  authModal.classList.add('hidden');
  // A homepage tem a topbar de visitante ("Entrar"/"Criar Conta"). Sem isto,
  // quem volta da Arena pelo botao Inicio ve a tela de deslogado e acha que a
  // sessao caiu — ela continua intacta, so a topbar estava desatualizada.
  renderUserStatus();
}

async function enterApp(asVisitor = false) {
  showScreen('app');
  authModal.classList.add('hidden');

  if (asVisitor && !state.user) {
    state.user = {
      id: 'visitor_demo',
      username: 'Piloto Visitante',
      role: 'viewer',
      lives: 3,
      max_lives: 3
    };
    state.wallet = { balance: 150, currency_code: 'credits' };
    showToast('Modo Demonstração Ativo! Teste os 3 jogos à vontade.', 'gamepad-2');
  }

  renderUserStatus();
  loadUserInventory();
  switchGameMode(state.currentGame || 'jet_launcher');

  // Restaura streamer previamente selecionado (persistência entre abas/sessões)
  const savedStreamer = localStorage.getItem('livex_active_streamer');
  if (savedStreamer) {
    await selectStreamer(savedStreamer, false);
  } else if (!asVisitor) {
    openStreamerDirectoryModal();
  }
}

function openAuthModal(mode = 'login') {
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  authModal.classList.remove('hidden');
  if (mode === 'register' && tabRegisterBtn) {
    tabRegisterBtn.click();
  } else if (tabLoginBtn) {
    tabLoginBtn.click();
  }
}

function setupSoundControls() {
  if (!soundToggleBtn || !soundIcon) return;
  const isMuted =
    window.JetSound && typeof window.JetSound.isMuted === 'function'
      ? window.JetSound.isMuted()
      : false;
  soundIcon.innerHTML = isMuted ? icon('volume-x', 'icon-cyan') : icon('volume-2', 'icon-cyan');

  soundToggleBtn.addEventListener('click', () => {
    if (!window.JetSound) return;
    const muted = window.JetSound.toggleMute();
    soundIcon.innerHTML = muted ? icon('volume-x', 'icon-cyan') : icon('volume-2', 'icon-cyan');
    showToast(muted ? 'Som Desativado' : 'Som Ativado');
  });
}

function setSession(_token, user) {
  state.token = 'session';
  state.user = user;
  state.wallet = { balance: 0, currency_code: 'credits' };
  localStorage.setItem('livex_logged_in', 'true');
  // O socket foi aberto antes do login, sem token: refaz o handshake para que o
  // servidor passe a reconhecer o usuário. O join-room da sala pessoal acontece
  // no evento 'connect' (ver setupSocketEvents), já com a identidade validada.
  reconectarSocket();
  enterApp();
}

async function loadUserProfile() {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`);
    const data = await res.json();
    if (data.success) {
      state.user = data.data.user;
      state.streak = data.data.streak || null;
      await loadChannelWallet();
      renderUserStatus();
      renderNotificationBell();
      renderStreak();
      subscribePush();
      loadUserInventory();
      pedirAceiteDeTermosSeNecessario();
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

function signOut() {
  // 1. Limpa dados de sessão
  state.token = null;
  state.user = null;
  state.streak = null;
  state.wallet = { balance: 0, currency: 'coins' };
  state.channelEpoch++;
  state.channelLives = 0;
  state.currentChannel = null;
  state.inventory = [];
  state.equippedByGame = {};
  localStorage.removeItem('livex_logged_in');
  // O cookie de sessão é HttpOnly: só o servidor consegue apagá-lo. Sem esta
  // chamada ele sobreviveria ao "Sair" e continuaria abrindo /tests.html.
  fetch(`${API_URL}/api/auth/logout`, { method: 'POST' }).catch(() => {});

  // Refaz o handshake sem token: o socket sai da sala privada 'user_<id>' e
  // deixa de ser reconhecido como o usuário que acabou de sair.
  reconectarSocket();

  // 2. Interrompe bots se estiverem ativos
  if (state.botsActive) {
    state.botsActive = false;
    clearInterval(state.botsInterval);
    if (botsStatusBadge) {
      botsStatusBadge.textContent = 'BOTS OFF';
      botsStatusBadge.className = 'bots-badge off';
    }
  }

  // 3. Atualiza interface e esconde/desabilita controles privilegiados
  renderUserStatus();
  renderInventory();

  // 4. Volta para a homepage
  showLanding();
  showToast('Você saiu da conta com segurança.');
}

/**
 * Contador de itens ao lado do botão "Inventário" no topo.
 *
 * Só era atualizado dentro de renderUserStatus(), que não roda quando o
 * inventário muda: comprar um item ou ganhá-lo na roleta deixava o selo preso no
 * valor antigo até um recarregamento da página. Soma as quantidades, e não o
 * número de linhas, porque o selo diz "un." — ter 5 Nitros é 5 unidades, não 1.
 */
function updateInventoryBadge() {
  const headerCartCount = document.getElementById('headerCartCount');
  if (!headerCartCount) return;
  const totalUnidades = (state.inventory || []).reduce(
    (soma, item) => soma + Number(item.quantity || 0),
    0
  );
  headerCartCount.textContent = `${totalUnidades} un.`;
}

// Acima disto o indicador viraria uma fileira de corações ocupando a barra
// inteira (a Bateria de Vidas passa do máximo). Passando do limite, o componente
// troca para "um coração + contador", que não cresce com o saldo.
const MAX_CORACOES_DESENHADOS = 5;

function ehVidaIlimitada(user) {
  return user.role === 'streamer' || user.role === 'admin';
}

/**
 * Desenha o indicador de vidas da barra superior.
 *
 * Os corações vazios usam o MESMO ícone dos cheios, só apagados: a fileira lê
 * como um conjunto de lugares, uns ocupados e outros não. O 'heart-crack' que
 * havia antes virava borrão a 1.1em e competia visualmente com os cheios.
 */
function renderLivesIndicator(atual, maximo, ilimitado, douradas = 0, maxDouradas = 0) {
  if (!livesCounterEl || !livesNumericEl) return;

  const caixa = livesCounterEl.closest('.lives-indicator');
  const estados = ['is-unlimited', 'is-full', 'is-low', 'is-empty', 'is-sub'];
  if (caixa) caixa.classList.remove(...estados);

  if (ilimitado) {
    livesCounterEl.innerHTML = icon('infinity', 'icon-cyan');
    livesNumericEl.textContent = 'Ilimitadas';
    if (caixa) {
      caixa.classList.add('is-unlimited');
      caixa.title = 'Streamers e administradores decolam sem gastar vidas';
    }
    return;
  }

  if (maximo > MAX_CORACOES_DESENHADOS) {
    // Saldo alto: um coração e o número. Dez ícones não cabem na barra.
    livesCounterEl.innerHTML = icon('heart', atual > 0 ? 'icon-red' : 'icon-muted');
  } else {
    const cheio = `<span class="life-pip is-filled">${icon('heart')}</span>`;
    const vazio = `<span class="life-pip">${icon('heart')}</span>`;
    livesCounterEl.innerHTML = cheio.repeat(atual) + vazio.repeat(Math.max(0, maximo - atual));
  }

  // Douradas do sub no fim da mesma fileira, na cor delas: decolam igual, mas
  // não são as mesmas vidas — não regeneram e voltam todas à meia-noite.
  const ehSub = maxDouradas > 0;
  if (ehSub) {
    const cheia = `<span class="life-pip is-gold is-filled">${icon('heart')}</span>`;
    const vazia = `<span class="life-pip is-gold">${icon('heart')}</span>`;
    livesCounterEl.innerHTML +=
      cheia.repeat(douradas) + vazia.repeat(Math.max(0, maxDouradas - douradas));
  }

  livesNumericEl.textContent = `${atual}/${maximo}`;
  if (ehSub) {
    const extra = document.createElement('span');
    extra.className = 'lives-gold-count';
    extra.textContent = `+${douradas}`;
    livesNumericEl.append(extra);
  }

  if (caixa) {
    const total = atual + douradas;
    if (total === 0) caixa.classList.add('is-empty');
    else if (total === 1) caixa.classList.add('is-low');
    else if (atual >= maximo && douradas >= maxDouradas) caixa.classList.add('is-full');
    if (ehSub) caixa.classList.add('is-sub');

    caixa.title =
      total === 0
        ? 'Sem vidas: elas voltam sozinhas (+1 a cada 8h) ou pegue a Bateria de Vidas'
        : `${atual} de ${maximo} vidas diárias para decolar`;
    caixa.title += ehSub
      ? ` · ${douradas} de ${maxDouradas} vidas douradas de Sub (voltam à meia-noite)`
      : ' · Seja Sub na Twitch ou na Kick e ganhe +2 vidas douradas por dia';
  }
}

/* ==========================================================================
   NAVEGACAO DA ARENA
   A coluna central era um rolo unico de ~4000px: Arena, duas lojas, mural e
   ranking empilhados. Quem queria o ranking atravessava as lojas inteiras.
   Cada secao agora declara `data-view` e so a aba ativa fica no DOM visivel.
   ========================================================================== */

const ARENA_VIEWS = ['jogar', 'lojas', 'mural', 'ranking'];
const ARENA_VIEW_KEY = 'livex_arena_view';

function getArenaView() {
  const salva = localStorage.getItem(ARENA_VIEW_KEY);
  return ARENA_VIEWS.includes(salva) ? salva : 'jogar';
}

/**
 * Troca a aba visivel da Arena.
 *
 * O mural tem uma segunda condicao alem da aba: o streamer pode ter desligado
 * o mural do canal (wall_enabled). Por isso quem manda no `hidden` da secao e
 * so esta funcao, e o kill-switch age escondendo a ABA — senao os dois
 * disputariam o mesmo atributo e um desfaria o outro.
 */
function setArenaView(view, { salvar = true } = {}) {
  const alvo = ARENA_VIEWS.includes(view) ? view : 'jogar';

  document.querySelectorAll('.game-main-content [data-view]').forEach((secao) => {
    secao.hidden = secao.dataset.view !== alvo;
  });

  document.querySelectorAll('.arena-tab').forEach((aba) => {
    const ativa = aba.dataset.arenaTab === alvo;
    aba.classList.toggle('is-active', ativa);
    aba.setAttribute('aria-selected', String(ativa));
  });

  if (salvar) localStorage.setItem(ARENA_VIEW_KEY, alvo);
  return alvo;
}

/**
 * Leva o usuario ate uma secao, trocando de aba antes de rolar.
 *
 * Os atalhos do rodape e da lateral chamavam scrollIntoView direto. Com as
 * secoes em abas, rolar ate um elemento escondido nao faz nada — e o clique
 * parece quebrado. Aqui a aba dona da secao e ativada primeiro.
 */
function irParaSecao(id) {
  const secao = document.getElementById(id);
  if (!secao) return;

  const dono = secao.closest('[data-view]');
  if (dono && dono.dataset.view) setArenaView(dono.dataset.view);

  // A troca de aba muda o layout; rolar no quadro seguinte evita mirar numa
  // posicao que deixou de existir.
  requestAnimationFrame(() => {
    secao.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function setupArenaTabs() {
  const barra = document.querySelector('.arena-tabs');
  if (!barra) return;

  barra.addEventListener('click', (ev) => {
    const aba = ev.target.closest('[data-arena-tab]');
    if (!aba) return;
    setArenaView(aba.dataset.arenaTab);
    const main = document.querySelector('.game-main-content');
    if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Setas do teclado percorrem as abas, como manda o padrao de tablist.
  barra.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    const abas = [...barra.querySelectorAll('.arena-tab')].filter((b) => !b.hidden);
    const atual = abas.indexOf(document.activeElement);
    if (atual === -1) return;
    ev.preventDefault();
    const passo = ev.key === 'ArrowRight' ? 1 : -1;
    const proxima = abas[(atual + passo + abas.length) % abas.length];
    proxima.focus();
    setArenaView(proxima.dataset.arenaTab);
  });

  setArenaView(getArenaView(), { salvar: false });
}

function renderUserStatus() {
  // Sino de notificações e streak acompanham o estado de autenticação em todo
  // fluxo (login, registro, restauração de sessão), não só no loadUserProfile.
  renderNotificationBell();
  renderStreak();
  const visitorActions = document.getElementById('visitorAuthActions');
  const landingLoginBtn = document.getElementById('landingLoginBtn');
  const landingRegisterBtn = document.getElementById('landingRegisterBtn');
  const landingArenaBtn = document.getElementById('landingArenaBtn');
  updateInventoryBadge();

  if (!state.user) {
    if (visitorActions) visitorActions.classList.remove('hidden');
    if (landingLoginBtn) landingLoginBtn.classList.remove('hidden');
    if (landingRegisterBtn) landingRegisterBtn.classList.remove('hidden');
    if (landingArenaBtn) landingArenaBtn.classList.add('hidden');
    currentUsernameEl.textContent = 'Convidado';
    userRoleBadgeEl.innerHTML = `${icon('key', 'icon-sm')} ENTRAR`;
    userRoleBadgeEl.className = 'role-badge';
    if (currentUserChip) {
      // Sem aria-label: o nome acessivel passa a ser o proprio texto visivel do
      // chip, que ja diz "Minha Conta" e o estado da sessao. Um rotulo diferente
      // do texto na tela quebra comando de voz (WCAG 2.5.3) — o title abaixo
      // segue como descricao complementar.
      currentUserChip.title = 'Minha Conta: Clique para entrar ou cadastrar';
      currentUserChip.removeAttribute('aria-label');
    }
    livesCounterEl.innerHTML = icon('heart-crack', 'icon-muted').repeat(3);
    livesNumericEl.textContent = '(0/0)';
    walletBalanceEl.textContent = '0';

    const topbarTwitchBadge = document.getElementById('topbarTwitchBadge');
    const topbarKickBadge = document.getElementById('topbarKickBadge');
    const topbarSubBadge = document.getElementById('topbarSubBadge');
    if (topbarTwitchBadge) topbarTwitchBadge.classList.add('hidden');
    if (topbarKickBadge) topbarKickBadge.classList.add('hidden');
    if (topbarSubBadge) topbarSubBadge.classList.add('hidden');

    const openCreateRewardBtn = document.getElementById('openCreateRewardBtn');
    const openStreamerOrdersBtn = document.getElementById('openStreamerOrdersBtn');
    const openModerationBtn = document.getElementById('openModerationBtn');
    const openCreatorHubBtn = document.getElementById('openCreatorHubBtn');
    const openTestsE2ELink = document.getElementById('openTestsE2ELink');
    if (openCreateRewardBtn) openCreateRewardBtn.classList.add('hidden');
    if (openStreamerOrdersBtn) openStreamerOrdersBtn.classList.add('hidden');
    if (openModerationBtn) openModerationBtn.classList.add('hidden');
    if (openCreatorHubBtn) openCreatorHubBtn.classList.add('hidden');
    if (openTestsE2ELink) {
      openTestsE2ELink.classList.add('hidden');
      openTestsE2ELink.href = '#';
    }

    const toggleBotsBtn = document.getElementById('toggleBotsBtn');
    if (toggleBotsBtn) {
      toggleBotsBtn.disabled = true;
      toggleBotsBtn.title = 'Acesso restrito a administradores autenticados';
    }

    updateSimDockAccess();
    return;
  }

  if (visitorActions) visitorActions.classList.add('hidden');
  if (landingLoginBtn) landingLoginBtn.classList.add('hidden');
  if (landingRegisterBtn) landingRegisterBtn.classList.add('hidden');
  if (landingArenaBtn) landingArenaBtn.classList.remove('hidden');
  const landingArenaBtnLabel = document.getElementById('landingArenaBtnLabel');
  if (landingArenaBtnLabel) landingArenaBtnLabel.textContent = `Arena · ${state.user.username}`;
  if (currentUserChip) {
    currentUserChip.title = `Minha Conta: ${state.user.username} (${state.user.role.toUpperCase()})`;
    currentUserChip.removeAttribute('aria-label');
  }
  currentUsernameEl.textContent = state.user.username;
  userRoleBadgeEl.textContent = state.user.role.toUpperCase();
  userRoleBadgeEl.className = `role-badge ${state.user.role}`;

  // Email Status Badge
  const emailStatusBadge = document.getElementById('emailStatusBadge');
  const resendBtn = document.getElementById('resendVerificationBtn');
  if (emailStatusBadge && state.user) {
    if (state.user.email_verified) {
      emailStatusBadge.textContent = 'Confirmado';
      emailStatusBadge.className = 'email-status-badge verified';
      if (resendBtn) resendBtn.style.display = 'none';
    } else {
      emailStatusBadge.textContent = 'Não confirmado';
      emailStatusBadge.className = 'email-status-badge unverified';
      if (resendBtn) resendBtn.style.display = 'block';
    }
  }

  // Stream Badges no Topbar
  const topbarTwitchBadge = document.getElementById('topbarTwitchBadge');
  const topbarKickBadge = document.getElementById('topbarKickBadge');
  const topbarSubBadge = document.getElementById('topbarSubBadge');

  if (topbarTwitchBadge) {
    if (state.user.twitch_username) {
      topbarTwitchBadge.classList.remove('hidden');
      topbarTwitchBadge.title = `Twitch: @${state.user.twitch_username}`;
    } else {
      topbarTwitchBadge.classList.add('hidden');
    }
  }

  if (topbarKickBadge) {
    if (state.user.kick_username) {
      topbarKickBadge.classList.remove('hidden');
      topbarKickBadge.title = `Kick: @${state.user.kick_username}`;
    } else {
      topbarKickBadge.classList.add('hidden');
    }
  }

  const isSubActive =
    state.user.is_sub_twitch || state.user.is_sub_kick || state.user.role === 'subscriber';
  if (topbarSubBadge) {
    topbarSubBadge.classList.toggle('hidden', !isSubActive);
  }

  // Controle de visibilidade de botões por cargo
  const isStreamerOrAdmin = state.user.role === 'streamer' || state.user.role === 'admin';
  const isAdmin = state.user.role === 'admin';

  const openCreateRewardBtn = document.getElementById('openCreateRewardBtn');
  const openStreamerOrdersBtn = document.getElementById('openStreamerOrdersBtn');
  const openModerationBtn = document.getElementById('openModerationBtn');
  const openCreatorHubBtn = document.getElementById('openCreatorHubBtn');

  if (openCreateRewardBtn) openCreateRewardBtn.classList.toggle('hidden', !isStreamerOrAdmin);
  if (openStreamerOrdersBtn) openStreamerOrdersBtn.classList.toggle('hidden', !isStreamerOrAdmin);
  if (openModerationBtn) openModerationBtn.classList.toggle('hidden', !isAdmin);
  if (openCreatorHubBtn) {
    openCreatorHubBtn.classList.remove('hidden');
    openCreatorHubBtn.innerHTML = isStreamerOrAdmin
      ? `${icon('clapperboard', 'icon-sm')} Central do Criador`
      : `${icon('rocket', 'icon-sm')} Seja um Streamer LiveX`;
  }
  // O atalho para /tests.html não existe no HTML servido: é criado aqui, só para
  // admins, para que o caminho do painel não apareça no fonte da página pública.
  const testsLinkId = 'openTestsE2ELink';
  const existingTestsLink = document.getElementById(testsLinkId);
  if (isAdmin && !existingTestsLink) {
    const divider = document.querySelector('.profile-menu-divider');
    if (divider) {
      const link = document.createElement('a');
      link.id = testsLinkId;
      link.className = 'profile-menu-item';
      link.target = '_blank';
      link.rel = 'noopener';
      // Rota protegida por papel: a identidade vem do cookie de sessão HttpOnly
      // emitido no login, não de um token na URL.
      link.href = '/tests.html';
      link.innerHTML = `${icon('flask-conical', 'icon-purple')} Testes E2E`;
      divider.parentNode.insertBefore(link, divider);
    }
  } else if (existingTestsLink && !isAdmin) {
    existingTestsLink.remove();
  } else if (existingTestsLink && isAdmin) {
    existingTestsLink.href = '/tests.html';
  }

  const toggleBotsBtn = document.getElementById('toggleBotsBtn');
  if (toggleBotsBtn) {
    toggleBotsBtn.disabled = !isAdmin;
    toggleBotsBtn.title = isAdmin
      ? 'Ativar/Desativar simulador de tráfego de live'
      : 'Acesso restrito a administradores autenticados';
  }

  updateSimDockAccess();

  // Vidas
  const exhaustedBanner = document.getElementById('exhaustedLivesBanner');
  const currentLives =
    (state.user.lives !== undefined ? Number(state.user.lives) : 0) + state.channelLives;
  const maxLives = state.user.max_lives || 3;

  // Streamer não gasta vida: o UPDATE de consumeLife só decrementa para os
  // outros papéis, e o guarda de decolagem aqui no cliente também o isenta. Sem
  // esta condição, um streamer com o contador em zero via caveiras e o alerta de
  // "Vidas Esgotadas!" enquanto continuava decolando normalmente — a interface
  // contradizendo o servidor. (Admin não entra na isenção: ele consome de fato,
  // então para ele o alerta em zero é verdadeiro.)
  // As douradas do sub também decolam: sem elas na conta, quem só tinha
  // douradas veria "Vidas Esgotadas!" com o servidor ainda aceitando o voo.
  const subLives = Number(state.user.sub_lives || 0);
  const semVidasDeVerdade = currentLives + subLives === 0 && state.user.role !== 'streamer';

  if (exhaustedBanner) exhaustedBanner.classList.toggle('hidden', !semVidasDeVerdade);
  renderLivesIndicator(
    currentLives,
    maxLives,
    !semVidasDeVerdade && ehVidaIlimitada(state.user),
    subLives,
    Number(state.user.max_sub_lives || 0)
  );

  // Saldo exclusivo do canal selecionado.
  const unifiedCoins = Number(state.wallet.balance || 0);
  const formattedCoins = unifiedCoins.toLocaleString('pt-BR');
  if (walletBalanceEl) {
    walletBalanceEl.textContent = formattedCoins;
  }

  // Sincroniza saldo de Moedas na lojinha e na sidebar
  const mainBalance = document.getElementById('mainViewWalletBalance');
  if (mainBalance) mainBalance.textContent = formattedCoins;

  const sidebarBalance = document.getElementById('sidebarStreamerFichasBalance');
  if (sidebarBalance) sidebarBalance.textContent = formattedCoins;

  sincronizarVisualDoJogoNovo();
  atualizarSuprimentosHud();
}

/* ==========================================================================
   INVENTÁRIO E EQUIPAMENTOS DINÂMICOS MULTI-JOGOS
   ========================================================================== */
async function loadChannelWallet() {
  const streamerId = state.currentChannel?.id;
  const epoch = state.channelEpoch;
  if (!state.token || !streamerId) return;
  try {
    const res = await fetch(
      `${API_URL}/api/shop/wallet?streamerId=${encodeURIComponent(streamerId)}`
    );
    const data = await res.json();
    if (!data.success || epoch !== state.channelEpoch) return;
    state.wallet = data.data;
    state.channelLives = Number(data.data.extraLives || 0);
    state.currentChannel.viewerWalletBalance = state.wallet.balance;
    renderUserStatus();
    renderChannelHeader();
  } catch (err) {
    console.error('Erro ao carregar carteira do canal:', err);
  }
}

async function loadUserInventory() {
  const streamerId = state.currentChannel?.id;
  const epoch = state.channelEpoch;
  if (!state.token || !streamerId) return;
  try {
    const res = await fetch(
      `${API_URL}/api/shop/inventory?streamerId=${encodeURIComponent(streamerId)}`,
      {
        headers: { Authorization: `Bearer ${state.token}` }
      }
    );
    const data = await res.json();
    if (data.success) {
      if (epoch !== state.channelEpoch) return;
      state.inventory = data.data;
      renderInventory();
      updateInventoryBadge();
      sincronizarVisualDoJogoNovo();
    }
  } catch (err) {
    console.error('Erro ao carregar inventário:', err);
  }
}

function atualizarSuprimentosHud() {
  if (!state.isFlying && launchText) {
    const pendente =
      state.user &&
      state.currentChannel &&
      window.LiveXJogos?.temPendente(state.user.id, state.currentChannel.id, state.currentGame);
    launchText.textContent = pendente
      ? 'Retomar rodada'
      : PROTAGONISTS[state.currentGame]?.launchBtnText || 'Começar';
  }
  const selecionados = itensEquipados();
  const contador = document.getElementById('hudLoadoutCount');
  if (contador) contador.textContent = `${selecionados.length}/3`;
  const slots = document.getElementById('hudLoadoutSlots');
  if (slots)
    slots.innerHTML = (PROTAGONISTS[state.currentGame]?.items || [])
      .map((id) => {
        const item = state.shopItems.find((i) => i.id === id);
        return `<span class="hud-slot ${selecionados.includes(id) ? 'is-equipped' : ''}" title="${escapeHtml(item?.name || 'Consumível')}">${iconFromEmoji(item?.icon, 'package', 'icon-sm')}</span>`;
      })
      .join('');
  const sub = document.getElementById('hudSubscriberBonus');
  if (sub) sub.hidden = !visualDoJogador().assinante;
  const balance = document.getElementById('hudShopBalance');
  if (balance)
    balance.title = state.currentChannel
      ? `Moedas exclusivas de @${state.currentChannel.username}`
      : 'Selecione um streamer';
  if (balance)
    balance.textContent = `${Number(state.wallet.balance || 0).toLocaleString('pt-BR')} moedas`;
  const preview = document.getElementById('hudBonusPreview');
  if (preview) {
    const mult = selecionados.reduce(
      (m, id) => m * Number(state.shopItems.find((i) => i.id === id)?.scoreMultiplier || 1),
      visualDoJogador().assinante ? 1.2 : 1
    );
    preview.textContent = `×${mult.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} pontos na rodada`;
  }
  document.querySelector('.game-viewport')?.classList.toggle('is-playing', state.isFlying);
  const toggle = document.getElementById('hudShopToggle');
  if (toggle) toggle.disabled = state.isFlying;
}

function abrirSuprimentosHud(aberto) {
  const painel = document.getElementById('hudShopPanel');
  const botao = document.getElementById('hudShopToggle');
  if (!painel || !botao) return;
  painel.hidden = !aberto;
  botao.setAttribute('aria-expanded', String(aberto));
  if (aberto) document.getElementById('hudShopClose')?.focus({ preventScroll: true });
}

function renderInventory() {
  const container = document.getElementById('equippedItemsRow');
  if (!container) return;
  const config = PROTAGONISTS[state.currentGame] || PROTAGONISTS.jet_launcher;
  const gameItems = config.items
    .map((id) => state.shopItems.find((i) => i.id === id))
    .filter(Boolean);
  const selecionados = state.equippedByGame[state.currentGame] || [];
  if (!gameItems.length) {
    container.innerHTML = '<p class="hud-shop-empty">Os suprimentos estão sendo carregados.</p>';
    atualizarSuprimentosHud();
    return;
  }
  container.innerHTML = gameItems
    .map((item, index) => {
      const qty = Number(state.inventory.find((i) => i.item_id === item.id)?.quantity || 0);
      const safeId = escapeHtml(item.id);
      const nome = escapeHtml(item.name);
      const equipado = qty > 0 && selecionados.includes(item.id);
      const comprando = state.purchasingItems.has(item.id);
      return `<article class="hud-item ${equipado ? 'is-equipped' : ''}">
      <div class="hud-item-top"><span class="hud-item-icon"><img src="/images/equipment/${escapeHtml(config.items.find((id) => id === item.id))}.svg" alt="" width="160" height="120" loading="lazy"></span><span class="hud-item-stock">${qty} no inventário</span></div>
      <span class="hud-item-category">MÓDULO 0${index + 1}</span>
      <h3>${nome}</h3>
      <p class="hud-item-description">${escapeHtml((item.description || '').split('. ')[0])}</p>
      <p class="hud-item-bonus">×${Number(item.scoreMultiplier || 1).toLocaleString('pt-BR')} pontos <span>+${Number(item.coinBonusPercent || 0)}% moedas</span></p>
      <div class="hud-item-actions">
        <label class="hud-equip"><input type="checkbox" value="${safeId}" id="equip_${safeId}" ${equipado ? 'checked' : ''} ${qty <= 0 || state.isFlying ? 'disabled' : ''}><span>${equipado ? 'Equipado' : 'Equipar'}</span><span class="sr-only"> ${nome}</span></label>
        <button type="button" class="hud-buy" data-item-id="${safeId}" data-item-name="${nome}" data-price="${Number(item.price)}" ${comprando || state.isFlying ? 'disabled' : ''} aria-label="Comprar ${nome} por ${Number(item.price)} moedas">${comprando ? 'Comprando…' : `${icon('plus', 'icon-sm')} ${Number(item.price)} ${icon('coins', 'icon-sm')}`}</button>
      </div>
    </article>`;
    })
    .join('');
  if (!container.dataset.listenerAttached) {
    container.dataset.listenerAttached = 'true';
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.hud-buy');
      if (btn)
        window.quickBuyHangarItem(
          btn.dataset.itemId,
          btn.dataset.itemName,
          Number(btn.dataset.price)
        );
    });
    container.addEventListener('change', (e) => {
      if (!e.target.matches('input[type="checkbox"]')) return;
      if (state.isFlying || itensEquipados().length > MAX_ITENS_POR_PARTIDA)
        e.target.checked = false;
      state.equippedByGame[state.currentGame] = itensEquipados();
      const card = e.target.closest('.hud-item');
      card.classList.toggle('is-equipped', e.target.checked);
      card.querySelector('.hud-equip span').textContent = e.target.checked ? 'Equipado' : 'Equipar';
      atualizarSuprimentosHud();
    });
    document
      .getElementById('hudShopToggle')
      ?.addEventListener('click', () =>
        abrirSuprimentosHud(document.getElementById('hudShopPanel').hidden)
      );
    document.getElementById('hudShopClose')?.addEventListener('click', () => {
      abrirSuprimentosHud(false);
      document.getElementById('hudShopToggle').focus();
    });
    document.getElementById('hudShopPanel')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      abrirSuprimentosHud(false);
      document.getElementById('hudShopToggle').focus();
    });
  }
  atualizarSuprimentosHud();
}

window.quickBuyHangarItem = async function (itemId, itemName, price) {
  if (state.isFlying || state.purchasingItems.has(itemId)) return;
  if (!state.user || !state.token) {
    openAuthModal('login');
    return;
  }
  if (Number(state.wallet.balance || 0) < price) {
    showToast(`Saldo insuficiente. Este item custa ${price} moedas.`, 'coins');
    return;
  }
  state.purchasingItems.add(itemId);
  renderInventory();
  try {
    await handlePurchase(itemId, itemName);
  } finally {
    state.purchasingItems.delete(itemId);
    renderInventory();
  }
};

/* ==========================================================================
   JOGOS JOGÁVEIS (games/client, carregados por games/loader.js)
   ========================================================================== */
// Os três jogos: a rodada é sorteada e liquidada no servidor ao clicar, e a
// simulação WASM só reproduz o filme (README.md, Rodadas da Arena).
const JOGOS_JOGAVEIS = ['jet_launcher', 'neon_drifter', 'void_walker'];
const MAX_ITENS_POR_PARTIDA = 3;
const jogoNovo = {
  gameId: null,
  controle: null,
  montando: null,
  visualChave: '',
  observador: null
};

function ehJogoJogavel(gameId) {
  return JOGOS_JOGAVEIS.includes(gameId);
}

// games/loader.js é um módulo e roda depois deste script. O bundle de verdade
// (Three.js + simulação) só é baixado aqui, na primeira vez que a Arena mostra um
// jogo jogável: quem só visita a homepage não paga esse download.
async function carregarLiveXJogos() {
  if (window.LiveXJogos) return window.LiveXJogos;
  if (!window.LiveXJogosCarregar) {
    await new Promise((resolve) =>
      window.addEventListener('livex-jogos-carregador', resolve, { once: true })
    );
  }
  await window.LiveXJogosCarregar();
  return window.LiveXJogos;
}

function visualDoJogador() {
  const u = state.user;
  return {
    assinante: Boolean(u && (u.role === 'subscriber' || u.is_sub_twitch || u.is_sub_kick)),
    lendario: (state.inventory || []).some(
      (i) =>
        i.item_id ===
          ({ jet_launcher: 'vip_hangar', neon_drifter: 'neon_garage', void_walker: 'cosmo_skin' }[
            state.currentGame
          ] || 'vip_hangar') && Number(i.quantity) > 0
    )
  };
}

async function montarJogoNovo(gameId) {
  const container = document.getElementById('jogoNovoContainer');
  if (!container) throw new Error('Área do jogo ausente na página');
  const visual = visualDoJogador();
  const chave = `${gameId}|${visual.assinante}|${visual.lendario}`;
  if (jogoNovo.controle && jogoNovo.visualChave === chave) return jogoNovo.controle;
  if (jogoNovo.montando) {
    await jogoNovo.montando;
    if (jogoNovo.gameId === gameId && jogoNovo.visualChave === chave) return jogoNovo.controle;
  }

  jogoNovo.montando = (async () => {
    const api = await carregarLiveXJogos();
    if (jogoNovo.controle) {
      jogoNovo.controle.destruir();
      jogoNovo.controle = null;
    }
    const forcarWebGL = new URLSearchParams(window.location.search).has('webgl');
    const controle = await api.montar(gameId, container, visual, { forcarWebGL });
    Object.assign(jogoNovo, { gameId, controle, visualChave: chave });
    return controle;
  })();
  try {
    return await jogoNovo.montando;
  } finally {
    jogoNovo.montando = null;
  }
}

// Monta quando a área do jogo aparece na tela: quem está na homepage ou em outra
// aba da Arena não paga a inicialização do WebGPU.
function agendarMontagemJogoNovo(gameId) {
  const container = document.getElementById('jogoNovoContainer');
  if (!container || typeof IntersectionObserver !== 'function') return;
  if (jogoNovo.observador) jogoNovo.observador.disconnect();
  const observador = new IntersectionObserver((entradas) => {
    if (!entradas.some((e) => e.isIntersecting)) return;
    observador.disconnect();
    montarJogoNovo(gameId).catch((err) => console.warn('[Arena] Jogo indisponível:', err));
  });
  jogoNovo.observador = observador;
  observador.observe(container);
}

// Pintura Dourada (sub) e visual lendário dependem de login e inventário, que
// chegam depois da primeira montagem. Remonta entre partidas quando mudam.
function sincronizarVisualDoJogoNovo() {
  if (!jogoNovo.controle || jogoNovo.controle.emPartida || jogoNovo.montando) return;
  const visual = visualDoJogador();
  const chave = `${jogoNovo.gameId}|${visual.assinante}|${visual.lendario}`;
  if (chave === jogoNovo.visualChave) return;
  montarJogoNovo(jogoNovo.gameId).catch((err) =>
    console.warn('[Arena] Falha ao atualizar o visual do jogo:', err)
  );
}

function itensEquipados() {
  return Array.from(
    document.querySelectorAll('#equippedItemsRow input[type="checkbox"]:checked'),
    (cb) => cb.value
  );
}

function voltarAoHangar(config) {
  state.isFlying = false;
  renderInventory();
  launchJetBtn.disabled = false;
  flightStatusTag.textContent = config.statusReady;
  flightStatusTag.style.borderColor = 'var(--green)';
  flightStatusTag.style.color = 'var(--green)';
}

/**
 * Partida de jogo jogável. Logado, vale moedas: quem abre, verifica e credita é o
 * servidor (games/client/src/embed/main.ts). Visitante joga a partida real, só
 * que local e sem recompensa — é a melhor demonstração que o site pode dar.
 */
async function jogarJogoNovo() {
  const config = PROTAGONISTS[state.currentGame] || PROTAGONISTS.jet_launcher;
  const visitante = !state.token || !state.user || state.user.id === 'visitor_demo';

  if (!visitante) {
    if (!state.currentChannel) {
      showToast('Selecione um streamer para jogar');
      return;
    }
    const pendente = window.LiveXJogos?.temPendente(
      state.user.id,
      state.currentChannel.id,
      state.currentGame
    );
    const vidasParaDecolar =
      state.user.lives + Number(state.user.sub_lives || 0) + state.channelLives;
    if (!pendente && state.user.role !== 'streamer' && vidasParaDecolar <= 0) {
      setPilotComms('Vidas esgotadas! Elas voltam sozinhas, ou pegue a Bateria de Vidas.', 'alert');
      showToast('Você não tem vidas para decolar agora', 'heart-crack');
      return;
    }
  } else if (state.user && state.user.lives <= 0) {
    showToast('Voos de demonstração esgotados! Crie sua conta grátis para jogar valendo moedas.');
    openAuthModal('register');
    return;
  }

  state.isFlying = true;
  abrirSuprimentosHud(false);
  renderInventory();
  launchJetBtn.disabled = true;
  flightStatusTag.textContent = 'IGNIÇÃO DOS SISTEMAS...';
  flightStatusTag.style.borderColor = 'var(--yellow)';
  flightStatusTag.style.color = 'var(--yellow)';
  setPilotComms(config.speechLaunch, 'launch');

  try {
    const controle = await montarJogoNovo(state.currentGame);
    flightStatusTag.textContent = 'MISSÃO EM ANDAMENTO';
    flightStatusTag.style.borderColor = 'var(--cyan)';
    flightStatusTag.style.color = 'var(--cyan)';
    if (visitante && state.user) {
      state.user.lives = Math.max(0, state.user.lives - 1);
      renderUserStatus();
    }

    const desfecho = await controle.jogar({
      valendo: !visitante,
      streamerId: state.currentChannel?.id,
      userId: state.user?.id,
      itemIds: visitante ? [] : itensEquipados()
    });
    // Gancho lido pelos testes e2e (e2e/jetLauncher.spec.js).
    window.__livexUltimaPartida = desfecho;

    if (desfecho.oficial) mostrarResultadoVerificado(config, desfecho.oficial);
    else mostrarResultadoDemo(config, desfecho.local);
  } catch (err) {
    console.error('[Arena] Partida não concluída:', err);
    const mensagem = err && err.message ? err.message : 'Não foi possível concluir a partida';
    setPilotComms(mensagem, 'alert');
    showToast(mensagem, 'triangle-alert');
    // O servidor pode ter devolvido vida e itens (partida recusada por versão,
    // verificador fora do ar): o que a tela mostra precisa vir dele.
    if (!visitante) {
      loadUserProfile();
      loadUserInventory();
    }
  } finally {
    voltarAoHangar(config);
  }
}

function limparGraficoDeVoo() {
  if (!flightGraphCanvas) return;
  flightGraphCanvas
    .getContext('2d')
    .clearRect(0, 0, flightGraphCanvas.width, flightGraphCanvas.height);
}

/** Estatística extra do debrief de cada jogo. Não entra em moeda nem em pontos. */
const PICO_DO_DEBRIEF = {
  jet_launcher: ['Altitude Máxima', ' m'],
  neon_drifter: ['Velocidade Máxima', ' km/h'],
  void_walker: ['Cristais Coletados', '']
};

function mostrarPicoDoDebrief(valor) {
  const [rotulo, unidade] = PICO_DO_DEBRIEF[state.currentGame] || PICO_DO_DEBRIEF.jet_launcher;
  const label = debriefAltitude.previousElementSibling;
  if (label) label.textContent = rotulo;
  debriefAltitude.textContent = `${Math.round(Number(valor)).toLocaleString('pt-BR')}${unidade}`;
}

function mostrarResultadoVerificado(config, r) {
  if (r.livesRemaining !== null && r.livesRemaining !== undefined) {
    state.user.lives = r.livesRemaining;
  }
  state.user.sub_lives = r.subLivesRemaining;
  if (r.streamerId === state.currentChannel?.id) {
    state.channelLives = Number(r.channelLivesRemaining || 0);
    loadChannelWallet();
  }
  renderUserStatus();
  loadUserInventory();

  const distancia = Number(r.distance).toLocaleString('pt-BR');
  setPilotComms(
    `Rodada registrada pelo servidor: ${distancia} m e +${Number(r.coinsEarned)} moedas!`,
    'victory'
  );
  debriefModal.dataset.game = config.id;
  document.getElementById('debriefVehicle').src = `/images/vehicles/${config.id}.svg`;
  document.getElementById('debriefCrew').textContent = `${config.vehicle} / ${config.name}`;
  document.getElementById('debriefItems').textContent = r.itemsUsed?.length
    ? `Consumíveis usados: ${r.itemsUsed.map((id) => state.shopItems.find((item) => item.id === id)?.name || id).join(' · ')}`
    : 'Nenhum consumível usado nesta rodada.';
  document.getElementById('debriefChannel').textContent = state.currentChannel
    ? `Moedas exclusivas de @${state.currentChannel.username}`
    : '';
  if (debriefTitle) debriefTitle.textContent = config.debriefTitle;
  debriefDistance.textContent = `${distancia} m`;
  mostrarPicoDoDebrief(r.peak);
  debriefScore.textContent = Number(r.score).toLocaleString('pt-BR');
  let detalhe = document.getElementById('debriefScoreBreakdown');
  if (!detalhe) {
    detalhe = document.createElement('small');
    detalhe.id = 'debriefScoreBreakdown';
    debriefScore.insertAdjacentElement('afterend', detalhe);
  }
  detalhe.textContent = `${Number(r.baseScore ?? r.score).toLocaleString('pt-BR')} base × ${Number(r.itemScoreMultiplier ?? r.scoreMultiplier ?? 1).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} itens${Number(r.subscriberMultiplier || 1) > 1 ? ' × 1,2 subscriber (+20%)' : ''}`;
  detalhe.title = (r.scoreBonuses || []).map((i) => `${i.name}: ×${i.multiplier}`).join(' · ');
  detalhe.hidden = false;
  const bonusDeMoedas = Number(r.coinsBonus || 0);
  debriefCoins.innerHTML =
    `+${Number(r.coinsEarned)} ${icon('coins', 'icon-yellow')} MOEDAS` +
    (bonusDeMoedas > 0
      ? ` <small>(${Number(r.coinsBase)} base + ${bonusDeMoedas} equipamentos)</small>`
      : '');
  limparGraficoDeVoo();
  drawFlightGraph(r.flightScript || []);
  debriefModal.classList.remove('hidden');
  if (window.JetSound) window.JetSound.playCoinChime();
  loadLeaderboard();
}

function mostrarResultadoDemo(config, local) {
  debriefModal.dataset.game = config.id;
  document.getElementById('debriefVehicle').src = `/images/vehicles/${config.id}.svg`;
  document.getElementById('debriefCrew').textContent = `${config.vehicle} / ${config.name}`;
  document.getElementById('debriefItems').textContent =
    'Demonstração: nenhum item do inventário é consumido.';
  document.getElementById('debriefChannel').textContent = 'DEMONSTRAÇÃO • SEM RECOMPENSAS';
  const detalhe = document.getElementById('debriefScoreBreakdown');
  if (detalhe) detalhe.hidden = true;
  const distancia = Number(local.distancia).toLocaleString('pt-BR');
  setPilotComms(
    `Demonstração: ${distancia} m! Crie sua conta para valer moedas e entrar no ranking.`,
    'victory'
  );
  if (debriefTitle) {
    debriefTitle.innerHTML = `${icon('sparkles', 'icon-purple')} DEMO: ${escapeHtml(config.debriefTitle)}`;
  }
  debriefDistance.textContent = `${distancia} m`;
  mostrarPicoDoDebrief(local.pico);
  debriefScore.textContent = Number(local.score).toLocaleString('pt-BR');
  debriefCoins.innerHTML = `0 ${icon('coins', 'icon-yellow')} (DEMO: crie sua conta para valer)`;
  limparGraficoDeVoo();
  debriefModal.classList.remove('hidden');
}

/* ==========================================================================
   TROCA DE JOGO (LIVEX GAMES HUB)
   ========================================================================== */
function switchGameMode(gameId) {
  if (state.isFlying) {
    showToast('Aguarde a missão atual terminar!');
    return;
  }

  if (jogoNovo.controle && jogoNovo.gameId !== gameId) {
    jogoNovo.controle.destruir();
    jogoNovo.controle = null;
    jogoNovo.gameId = null;
    jogoNovo.visualChave = '';
  }

  const mudouDeJogo = state.currentGame !== gameId;
  state.currentGame = gameId;
  document.querySelector('.game-bay').dataset.game = gameId;
  abrirSuprimentosHud(false);
  // Ranking é por jogo (cada um tem a própria escala): abrir outro jogo mostra o dele.
  if (mudouDeJogo) {
    state.rankingGame = null;
    loadLeaderboard();
  }

  // Atualiza abas do hub
  document.querySelectorAll('.game-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.game === gameId);
  });

  const config = PROTAGONISTS[gameId] || PROTAGONISTS.jet_launcher;

  document.getElementById('arenaIntroTitle').textContent = config.title;
  document.getElementById('arenaIntroCrew').textContent = `${config.vehicle} / ${config.name}`;
  document.getElementById('arenaIntroDescription').textContent = config.introduction;
  document.getElementById('arenaIntroVehicle').src = `/images/vehicles/${config.id}.svg`;

  // Atualiza Comunicador do Protagonista
  if (pilotNameTag) pilotNameTag.textContent = config.name;
  if (pilotRoleTag) pilotRoleTag.textContent = config.role;
  if (pilotAvatarImg) pilotAvatarImg.innerHTML = icon(config.avatar, 'icon-cyan icon-lg');
  setPilotComms(config.speechReady, 'normal');

  // Atualiza Título da Zona e Tags
  if (gameZoneTitle) gameZoneTitle.textContent = config.hudTitle;
  if (inventoryPanelTitle) inventoryPanelTitle.textContent = config.inventoryTitle;
  flightStatusTag.textContent = config.statusReady;
  flightStatusTag.style.borderColor = 'var(--green)';
  flightStatusTag.style.color = 'var(--green)';

  // Atualiza Botão de Ação
  if (launchIcon) launchIcon.innerHTML = icon(config.launchBtnIcon);
  if (launchText) launchText.textContent = config.launchBtnText;

  // Atualiza renderização de inventário e loja
  renderInventory();
  renderShopItems();

  const jogavel = ehJogoJogavel(gameId);
  const containerNovo = document.getElementById('jogoNovoContainer');
  if (containerNovo) containerNovo.hidden = !jogavel;
  if (jogavel) agendarMontagemJogoNovo(gameId);
}

/* ==========================================================================
   LOJA (SUPPLY BAY)
   ========================================================================== */
async function loadShopItems() {
  try {
    const res = await fetch(`${API_URL}/api/shop/items`);
    const data = await res.json();
    if (data.success) {
      state.shopItems = data.data;
      renderShopItems();
      renderInventory();
    }
  } catch (err) {
    console.error('Erro ao carregar loja:', err);
  }
}

function renderShopItems() {
  if (!shopGrid) return;
  // Itens recomendados para o jogo ativo primeiro, depois demais
  let filtered = state.shopItems.filter(
    (item) => !item.gameId || item.gameId === 'all' || item.gameId === state.currentGame
  );

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        (item.name && item.name.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    shopGrid.innerHTML = `
      <div class="empty-state-notice" style="grid-column: 1 / -1;">
        <p>Nenhum acessório encontrado com o termo "${escapeHtml(state.searchQuery || '')}".</p>
      </div>
    `;
    return;
  }

  shopGrid.innerHTML = filtered
    .map((item) => {
      return `
    <article class="shop-card ${escapeHtml(item.rarity)}">
      <div class="shop-card-header">
        <div class="shop-item-icon">${iconFromEmoji(item.icon, 'rocket', 'icon-xl icon-cyan')}</div>
        <div class="shop-item-info">
          <h4>${escapeHtml(item.name)}</h4>
          <span class="rarity-pill">${escapeHtml(item.rarity)}</span>
        </div>
      </div>
      <p class="shop-item-desc">${escapeHtml(item.description)}</p>
      ${Number(item.scoreMultiplier || 1) > 1 ? `<p class="shop-score-bonus">×${Number(item.scoreMultiplier).toLocaleString('pt-BR')} na pontuação · +${Number(item.coinBonusPercent || 0)}% nas moedas da rodada · consumido ao começar</p>` : ''}
      <div class="shop-card-footer">
        <span class="shop-price">${Number(item.price).toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}</span>
        <button class="buy-btn" data-item-id="${escapeHtml(item.id)}" data-item-name="${escapeHtml(item.name)}">
          ${icon('package', 'icon-sm')} Comprar
        </button>
      </div>
    </article>
  `;
    })
    .join('');
}

async function handlePurchase(itemId, itemName) {
  const streamerId = state.currentChannel?.id;
  const epoch = state.channelEpoch;
  if (!streamerId) {
    showToast('Selecione um streamer para comprar');
    return;
  }
  if (!state.token) {
    showToast('Faça login para comprar itens');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/shop/purchase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ itemId, quantity: 1, streamerId })
    });

    const data = await res.json();
    if (data.success) {
      if (epoch !== state.channelEpoch) return;
      // Atualiza o saldo somente no canal onde a compra foi feita.
      state.wallet.balance = Number(data.data.balance);
      if (walletBalanceEl) {
        walletBalanceEl.textContent = Number(data.data.balance).toLocaleString('pt-BR');
      }
      window.JetSound?.playCoinChime();
      showToast(`Comprado: ${itemName}!`);

      // Re-sincroniza o inventário e o perfil completo direto da fonte de dados persistida
      await Promise.all([loadUserInventory(), loadUserProfile()]);

      if (epoch !== state.channelEpoch) return;
      // Marca imediatamente a caixa de equipamento do item adquirido como selecionada
      const equipCb = document.getElementById(`equip_${itemId}`);
      if (equipCb && !state.isFlying && itensEquipados().length < MAX_ITENS_POR_PARTIDA) {
        equipCb.disabled = false;
        equipCb.checked = true;
        state.equippedByGame[state.currentGame] = itensEquipados();
        renderInventory();
      }
    } else {
      showToast(data.message || 'Erro ao comprar item', 'triangle-alert');
    }
  } catch (err) {
    showToast('Erro de conexão ao comprar item', 'triangle-alert');
  }
}

/* ==========================================================================
   COMUNICADOR TÁTICO DO PROTAGONISTA
   ========================================================================== */
function setPilotComms(speech, mood = 'normal') {
  if (!pilotSpeech) return;
  pilotSpeech.textContent = `"${speech}"`;

  if (!pilotCommsWidget) return;
  pilotCommsWidget.classList.remove('alert-mode', 'nitro-mode');

  const config = PROTAGONISTS[state.currentGame] || PROTAGONISTS.jet_launcher;

  if (mood === 'alert') {
    pilotCommsWidget.classList.add('alert-mode');
    if (pilotAvatarImg) pilotAvatarImg.innerHTML = icon('frown', 'icon-red icon-lg');
  } else if (mood === 'nitro') {
    pilotCommsWidget.classList.add('nitro-mode');
    if (pilotAvatarImg) pilotAvatarImg.innerHTML = icon('flame', 'icon-yellow icon-lg');
  } else if (mood === 'victory') {
    if (pilotAvatarImg) pilotAvatarImg.innerHTML = icon('smile', 'icon-green icon-lg');
  } else if (mood === 'launch') {
    if (pilotAvatarImg) pilotAvatarImg.innerHTML = icon(config.avatar, 'icon-cyan icon-lg');
  } else {
    if (pilotAvatarImg) pilotAvatarImg.innerHTML = icon(config.avatar, 'icon-cyan icon-lg');
  }
}

/* ==========================================================================
   GAMEPLAY & DECOLAGEM AUTORITATIVA MULTI-JOGOS
   ========================================================================== */
async function handleJetLaunch() {
  if (state.isFlying || !ehJogoJogavel(state.currentGame)) return;
  await jogarJogoNovo();
}

/* ==========================================================================
   GRÁFICO DE TELEMETRIA (ALTITUDE VS. DISTÂNCIA)
   ========================================================================== */
function drawFlightGraph(keyframes) {
  if (!flightGraphCanvas || !keyframes || keyframes.length === 0) return;

  const ctx = flightGraphCanvas.getContext('2d');
  const w = flightGraphCanvas.width;
  const h = flightGraphCanvas.height;

  ctx.clearRect(0, 0, w, h);

  // Fundo com grid
  ctx.strokeStyle = '#122035';
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += 30) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const maxDist = Math.max(...keyframes.map((k) => k.distance), 1000);
  const maxAlt = Math.max(...keyframes.map((k) => k.altitude), 500);

  // Desenha a curva de voo
  ctx.beginPath();
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(0, 240, 255, 0.7)';
  ctx.shadowBlur = 8;

  keyframes.forEach((kf, idx) => {
    const x = 20 + (kf.distance / maxDist) * (w - 40);
    const y = h - 20 - (kf.altitude / maxAlt) * (h - 40);

    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Marcadores de Eventos
  keyframes.forEach((kf) => {
    if (kf.event && kf.event !== 'flying' && kf.event !== 'gliding') {
      const x = 20 + (kf.distance / maxDist) * (w - 40);
      const y = h - 20 - (kf.altitude / maxAlt) * (h - 40);

      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = kf.event.includes('nitro')
        ? '#ffb800'
        : kf.event.includes('shield')
          ? '#00ff9d'
          : '#ff3366';
      ctx.fill();
    }
  });
}

/* ==========================================================================
   DOCK DE SIMULAÇÕES E TESTES RÁPIDOS
   ========================================================================== */
// O Centro de Simulação injeta moedas e dispara voos e doações de teste, entao
// so fica disponivel para streamers autenticados (e admins, que ja administram
// a plataforma). Esconder o painel e conveniencia de interface: a trava que
// vale esta no servidor, em requireRole na rota /api/payments/simulate.
function isSimDockAllowed() {
  const role = state.user && state.user.role;
  return role === 'streamer' || role === 'admin';
}

function updateSimDockAccess() {
  if (!simDock) return;
  const permitido = isSimDockAllowed();
  simDock.classList.toggle('hidden', !permitido);
  simDock.setAttribute('aria-hidden', String(!permitido));
  if (!permitido) simDock.classList.add('collapsed');
}

/**
 * Ajusta as vidas pelo Centro de Simulação, no servidor.
 *
 * A rota é restrita a streamer/admin e bloqueada em produção (routes/dev.js);
 * o painel já é escondido para viewer (isSimDockAllowed), mas quem manda é a
 * trava do servidor, não a visibilidade do botão.
 */
async function ajustarVidasSim(action) {
  if (!state.user || !state.token) return;
  try {
    const res = await fetch(`${API_URL}/api/dev/lives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'Não foi possível ajustar as vidas', 'triangle-alert');
      return;
    }

    // Relê o perfil em vez de confiar no número local: é essa releitura que
    // impede o painel de voltar a mostrar um estado que o servidor não tem.
    await loadUserProfile();
    showToast(
      action === 'refill' ? 'Vidas restauradas no servidor' : 'Vidas zeradas no servidor',
      action === 'refill' ? 'heart' : 'skull'
    );
  } catch (err) {
    console.error('Erro ao ajustar vidas no simulador:', err);
    showToast('Não foi possível ajustar as vidas', 'triangle-alert');
  }
}

function setupSimulationDock() {
  // Alternar Colapsar/Expandir Dock
  simDockHeader.addEventListener('click', () => {
    simDock.classList.toggle('collapsed');
  });

  // Injetar Moedas
  document.getElementById('simAdd1kCoins').addEventListener('click', async () => {
    await handleDonation(10, 'Injeção rápida +1.000 moedas (Simulador)');
  });

  document.getElementById('simAdd5kCoins').addEventListener('click', async () => {
    await handleDonation(50, 'Injeção rápida +5.000 moedas (Simulador)');
  });

  // Restaurar / Zerar Vidas.
  //
  // Os dois escreviam só em `state.user.lives` e chamavam renderUserStatus().
  // O contador mudava na tela sem que o servidor soubesse de nada, então
  // "Zerar Vidas" não testava a recusa de voo — o backend ainda tinha vidas e
  // a decolagem passava. Agora o ajuste é feito no servidor e o estado local
  // vem de volta de /api/auth/me, que é a fonte da verdade.
  document
    .getElementById('simRefillLives')
    .addEventListener('click', () => ajustarVidasSim('refill'));
  document
    .getElementById('simDrainLives')
    .addEventListener('click', () => ajustarVidasSim('drain'));

  // Presets Rápidos de Missão (adaptáveis a qualquer jogo)
  document.getElementById('presetBasicFlight').addEventListener('click', () => {
    document
      .querySelectorAll('#equippedItemsRow input[type="checkbox"]')
      .forEach((cb) => (cb.checked = false));
    handleJetLaunch();
  });

  document.getElementById('presetHyperNitro').addEventListener('click', async () => {
    const config = PROTAGONISTS[state.currentGame] || PROTAGONISTS.jet_launcher;
    const item1 = config.items[0];
    const item2 = config.items[1];
    await ensureItemPurchased(item1);
    await ensureItemPurchased(item2);
    renderInventory();
    const cb1 = document.getElementById(`equip_${item1}`);
    const cb2 = document.getElementById(`equip_${item2}`);
    if (cb1) cb1.checked = true;
    if (cb2) cb2.checked = true;
    handleJetLaunch();
  });

  document.getElementById('presetLegendary').addEventListener('click', async () => {
    const config = PROTAGONISTS[state.currentGame] || PROTAGONISTS.jet_launcher;
    for (const itemId of config.items) {
      await ensureItemPurchased(itemId);
    }
    renderInventory();
    for (const itemId of config.items) {
      const cb = document.getElementById(`equip_${itemId}`);
      if (cb) cb.checked = true;
    }
    handleJetLaunch();
  });

  // Bots de Live
  document.getElementById('toggleBotsBtn').addEventListener('click', toggleBotsMode);
  document
    .getElementById('triggerBotFlight')
    .addEventListener('click', triggerSimulatedOtherPilotFlight);
  document
    .getElementById('triggerBotDonation')
    .addEventListener('click', triggerSimulatedOtherPilotDonation);
}

async function ensureItemPurchased(itemId) {
  const inv = state.inventory.find((i) => i.item_id === itemId);
  if (!inv || inv.quantity <= 0) {
    await handlePurchase(itemId, itemId);
  }
}

/* ==========================================================================
   SIMULADOR DE TRÁFEGO DE LIVE (BOTS)
   ========================================================================== */
const botNames = [
  'cyber_pilot',
  'stream_fan99',
  'turbina_dourada',
  'pixel_hero',
  'hyper_gal',
  'speed_demon'
];
const botMessages = [
  'Decolagem insana!',
  'Bate o recorde hoje NightPilot!',
  'Olha o nitro desse jato kkkkk',
  'Mandei um apoio no PIX pra ajudar na arena!',
  'Escudo salvou legal da turbulência!'
];

function toggleBotsMode() {
  if (!state.user || state.user.role !== 'admin') {
    showToast('Acesso restrito a administradores', 'triangle-alert');
    alert('Acesso restrito a administradores autenticados.');
    return;
  }

  state.botsActive = !state.botsActive;

  if (state.botsActive) {
    botsStatusBadge.textContent = 'BOTS ON';
    botsStatusBadge.className = 'bots-badge active';
    showToast('Modo Bots Ativado! Gerando tráfego de live...');

    state.botsInterval = setInterval(() => {
      const rand = Math.random();
      if (rand < 0.5) {
        // Envia mensagem no chat
        const name = botNames[Math.floor(Math.random() * botNames.length)];
        const msg = botMessages[Math.floor(Math.random() * botMessages.length)];
        appendChatMessage(name, msg, Math.random() > 0.5 ? 'viewer' : 'subscriber');
      } else if (rand < 0.75) {
        // Simula decolagem de outro espectador
        triggerSimulatedOtherPilotFlight();
      } else {
        // Simula doação LivePix
        triggerSimulatedOtherPilotDonation();
      }
    }, 6000);
  } else {
    botsStatusBadge.textContent = 'BOTS OFF';
    botsStatusBadge.className = 'bots-badge off';
    clearInterval(state.botsInterval);
    showToast('Modo Bots Desativado');
  }
}

function triggerSimulatedOtherPilotFlight() {
  const name = botNames[Math.floor(Math.random() * botNames.length)];
  const distance = Math.round(1500 + Math.random() * 2500);
  const score = Math.round(distance * 1.6);

  // Simulação local: o servidor deriva o autor do JWT e ignora nomes vindos do
  // cliente, então transmitir isso publicaria a mensagem com o nome de quem
  // clicou, não com o do piloto ficticio. O bot fica visivel so nesta aba.
  appendChatMessage(name, `🚀 Decolei meu jato e cheguei a ${distance}m!`, 'subscriber');

  appendSystemMessage(
    `🚀 [VOO] ${name} decolou seu jato e atingiu ${distance}m com ${score} pts!`,
    'launch'
  );
}

function triggerSimulatedOtherPilotDonation() {
  const name = botNames[Math.floor(Math.random() * botNames.length)];
  const amount = [10, 20, 50][Math.floor(Math.random() * 3)];
  const coins = amount * 100;

  appendSystemMessage(
    `💰 [LIVEPIX] ${name} doou R$ ${amount.toFixed(2)} e converteu em ${coins.toLocaleString('pt-BR')} moedas! "Tamo junto na live!"`,
    'donation'
  );
  window.JetSound.playDonationAlert();
}

/* ==========================================================================
   RANKING POR JOGO E PERÍODO
   ========================================================================== */
// [título, trecho da mensagem de vazio]. Janelas móveis, como no mural de doações.
const PERIODOS_RANKING = {
  weekly: ['Ranking Semanal', 'nesta semana'],
  monthly: ['Ranking Mensal', 'nos últimos 30 dias'],
  all: ['Ranking Desde o Início', 'ainda']
};

async function loadLeaderboard() {
  // Sem escolha nos chips, o ranking acompanha o jogo aberto.
  const gameId = state.rankingGame || state.currentGame;
  const periodo = state.rankingPeriod;
  document
    .querySelectorAll('#rankingGameFilters .wall-chip, #rankingPeriodFilters .wall-chip')
    .forEach((chip) => {
      const ativo = chip.dataset.rankingGame === gameId || chip.dataset.rankingPeriod === periodo;
      chip.classList.toggle('is-active', ativo);
      chip.setAttribute('aria-pressed', String(ativo));
    });
  try {
    const res = await fetch(
      `${API_URL}/api/leaderboard/${periodo}?gameId=${encodeURIComponent(gameId)}`
    );
    const data = await res.json();
    // Troca rápida de jogo ou período: a resposta anterior pode chegar depois.
    if (
      data.success &&
      gameId === (state.rankingGame || state.currentGame) &&
      periodo === state.rankingPeriod
    ) {
      renderLeaderboard(data.data, periodo);
      const titulo = document.getElementById('leaderboardTitle');
      const aba = document.querySelector(`.game-tab[data-game="${gameId}"] .tab-title`);
      if (titulo && aba)
        titulo.textContent = `${PERIODOS_RANKING[periodo][0]} · ${aba.textContent}`;
    }
  } catch (err) {
    console.error('Erro ao carregar leaderboard:', err);
  }
}

document.getElementById('rankingGameFilters')?.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-ranking-game]');
  if (!chip) return;
  state.rankingGame = chip.dataset.rankingGame;
  loadLeaderboard();
});

document.getElementById('rankingPeriodFilters')?.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-ranking-period]');
  if (!chip) return;
  state.rankingPeriod = chip.dataset.rankingPeriod;
  loadLeaderboard();
});

function renderLeaderboard(pilots, periodo = 'weekly') {
  if (!pilots || pilots.length === 0) {
    leaderboardBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Nenhum voo registrado ${PERIODOS_RANKING[periodo][1]}. Seja o primeiro a decolar!</td></tr>`;
    return;
  }

  const medals = [
    icon('medal', 'icon-yellow icon-lg'),
    icon('medal', 'icon-silver icon-lg'),
    icon('medal', 'icon-bronze icon-lg')
  ];
  leaderboardBody.innerHTML = pilots
    .map(
      (p, index) => `
    <tr>
      <td><span class="rank-medal">${medals[index] || `#${index + 1}`}</span></td>
      <td><strong class="pilot-name">${escapeHtml(p.username)}</strong></td>
      <td><span class="role-badge ${escapeHtml(p.role)}">${escapeHtml(p.role)}</span></td>
      <td>${Number(p.max_distance).toLocaleString('pt-BR')} m</td>
      <td><span class="score-highlight">${Number(p.best_score).toLocaleString('pt-BR')} pts</span></td>
      <td>${p.total_flights || 1}</td>
    </tr>
  `
    )
    .join('');
}

/* ==========================================================================
   INJEÇÃO DE MOEDAS (Dock de Simulação/Testes — não é fluxo de doação real)
   ========================================================================== */
async function handleDonation(amount, message = '') {
  if (!state.token) {
    showToast('Faça login para usar o simulador de economia');
    return;
  }

  // Espelha o requireRole da rota para dar uma mensagem clara em vez de um 403
  // cru. Quem manda continua sendo o servidor.
  if (!isSimDockAllowed()) {
    showToast('Simulador de economia restrito a streamers autenticados', 'triangle-alert');
    return;
  }

  if (!state.currentChannel) {
    showToast('Abra a página de um streamer primeiro (menu Streamers)', 'triangle-alert');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/payments/simulate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ amount, message, streamerId: state.currentChannel.id })
    });

    const data = await res.json();
    if (data.success) {
      window.JetSound.playDonationAlert();
      showToast(
        `+${data.data.coinsCredited.toLocaleString('pt-BR')} Fichas de Apoio creditadas com ${state.currentChannel.name}!`
      );
      await refreshCurrentChannel();
    } else {
      alert(data.message || 'Erro ao processar doação');
    }
  } catch (err) {
    alert('Erro ao enviar doação');
  }
}

/* ==========================================================================
   RECUPERAÇÃO DE SENHA, CONFIRMAÇÃO DE E-MAIL E ACEITE DE TERMOS
   ========================================================================== */

function mostrarRetorno(elId, mensagem, ok) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = mensagem;
  el.className = ok ? 'form-feedback-ok' : 'form-feedback-erro';
  el.classList.remove('hidden');
}

let lastActiveElement = null;
function abrirModal(id) {
  const el = document.getElementById(id);
  if (el) {
    lastActiveElement = document.activeElement;
    el.classList.remove('hidden');
    const firstInput = el.querySelector('input:not([type="hidden"]), button:not([disabled])');
    if (firstInput) firstInput.focus();
  }
}

document.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape') {
      if (state.isFlying && jogoNovo.controle) jogoNovo.controle.sair();
      const modals = document.querySelectorAll('.modal-overlay:not(.hidden)');
      if (modals.length > 0) {
        const topModal = modals[modals.length - 1];
        topModal.classList.add('hidden');
        if (lastActiveElement) {
          lastActiveElement.focus();
          lastActiveElement = null;
        }
      }
    }
  },
  true
);

function fecharModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('hidden');
    if (lastActiveElement) {
      lastActiveElement.focus();
      lastActiveElement = null;
    }
  }
}

// Fechamento por delegação: qualquer botão com data-close-modal fecha o modal
// que ele nomeia, em vez de um listener por modal.
document.addEventListener('click', (event) => {
  const alvo = event.target.closest('[data-close-modal]');
  if (alvo) fecharModal(alvo.dataset.closeModal);
});

function configurarRecuperacaoDeSenha() {
  const abrirBtn = document.getElementById('openForgotPasswordBtn');
  if (abrirBtn) {
    abrirBtn.addEventListener('click', () => {
      document.getElementById('forgotPasswordFeedback')?.classList.add('hidden');
      abrirModal('forgotPasswordModal');
    });
  }

  const forgotForm = document.getElementById('forgotPasswordForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const identifier = document.getElementById('forgotIdentifier').value.trim();
      if (!identifier) return;

      mostrarRetorno('forgotPasswordFeedback', 'Enviando...', true);
      const submitBtn = forgotForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Enviando...';
      }
      try {
        const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier })
        });
        const data = await res.json();
        // A resposta é a mesma exista a conta ou não, de propósito: dizer
        // "usuário não encontrado" transformaria esta tela num verificador de
        // quem tem cadastro na plataforma.
        mostrarRetorno('forgotPasswordFeedback', data.message, true);
      } catch (err) {
        mostrarRetorno('forgotPasswordFeedback', 'Não foi possível falar com o servidor.', false);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar link';
        }
      }
    });
  }

  const resetForm = document.getElementById('resetPasswordForm');
  if (resetForm) {
    resetForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const senha1 = document.getElementById('resetPassword1').value;
      const senha2 = document.getElementById('resetPassword2').value;

      if (senha1.length < 6 || senha1.length > 200) {
        mostrarRetorno(
          'resetPasswordFeedback',
          'A senha deve ter entre 6 e 200 caracteres.',
          false
        );
        return;
      }
      if (senha1 !== senha2) {
        mostrarRetorno('resetPasswordFeedback', 'As senhas não são iguais.', false);
        return;
      }

      const submitBtn = resetForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Salvando...';
      }
      try {
        const res = await fetch(`${API_URL}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: state.resetToken, password: senha1 })
        });
        const data = await res.json();
        mostrarRetorno('resetPasswordFeedback', data.message, Boolean(data.success));

        if (data.success) {
          resetForm.reset();
          state.resetToken = null;
          setTimeout(() => {
            fecharModal('resetPasswordModal');
            window.location.href = '/';
          }, 2000);
        }
      } catch (err) {
        mostrarRetorno('resetPasswordFeedback', 'Não foi possível falar com o servidor.', false);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Salvar senha';
        }
      }
    });
  }

  const resendBtn = document.getElementById('resendVerificationBtn');
  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      resendBtn.disabled = true;
      resendBtn.textContent = 'Enviando...';
      try {
        const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (data.success) {
          showToast('E-mail de confirmação reenviado.', 'rocket');
        } else {
          showToast(data.message || 'Erro ao enviar e-mail.', 'triangle-alert');
        }
      } catch (err) {
        showToast('Não foi possível conectar ao servidor.', 'triangle-alert');
      } finally {
        resendBtn.disabled = false;
        resendBtn.textContent = 'Reenviar confirmação';
      }
    });
  }

  // Password show/hide logic
  const toggleBtn1 = document.getElementById('toggleResetPassword1');
  const toggleBtn2 = document.getElementById('toggleResetPassword2');
  const input1 = document.getElementById('resetPassword1');
  const input2 = document.getElementById('resetPassword2');
  const strengthEl = document.getElementById('passwordStrength');

  if (toggleBtn1 && input1) {
    toggleBtn1.addEventListener('click', () => {
      const type = input1.getAttribute('type') === 'password' ? 'text' : 'password';
      input1.setAttribute('type', type);
      toggleBtn1.innerHTML =
        type === 'password'
          ? '<svg class="icon icon-gray" aria-hidden="true" focusable="false"><use href="icons/sprite.svg#eye"></use></svg>'
          : '<svg class="icon icon-gray" aria-hidden="true" focusable="false"><use href="icons/sprite.svg#eye-off"></use></svg>';
    });
    input1.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val.length === 0) {
        strengthEl.textContent = '';
        strengthEl.className = 'password-strength';
      } else if (val.length < 6) {
        strengthEl.textContent = 'Muito curta (min 6)';
        strengthEl.className = 'password-strength weak';
      } else if (val.length > 200) {
        strengthEl.textContent = 'Muito longa (max 200)';
        strengthEl.className = 'password-strength weak';
      } else {
        strengthEl.textContent = 'Segura';
        strengthEl.className = 'password-strength good';
      }
    });
  }
  if (toggleBtn2 && input2) {
    toggleBtn2.addEventListener('click', () => {
      const type = input2.getAttribute('type') === 'password' ? 'text' : 'password';
      input2.setAttribute('type', type);
      toggleBtn2.innerHTML =
        type === 'password'
          ? '<svg class="icon icon-gray" aria-hidden="true" focusable="false"><use href="icons/sprite.svg#eye"></use></svg>'
          : '<svg class="icon icon-gray" aria-hidden="true" focusable="false"><use href="icons/sprite.svg#eye-off"></use></svg>';
    });
  }

  const termsForm = document.getElementById('acceptTermsForm');
  if (termsForm) {
    termsForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const birthDate = document.getElementById('acceptTermsBirthDate').value;

      const submitBtn = termsForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Salvando...';
      }
      try {
        const res = await fetch(`${API_URL}/api/auth/accept-terms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`
          },
          body: JSON.stringify({ birthDate })
        });
        const data = await res.json();
        mostrarRetorno('acceptTermsFeedback', data.message, Boolean(data.success));
        if (data.success) {
          if (state.user) state.user.terms_accepted = true;
          setTimeout(() => fecharModal('acceptTermsModal'), 1200);
        }
      } catch (err) {
        mostrarRetorno('acceptTermsFeedback', 'Não foi possível falar com o servidor.', false);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Confirmar e continuar';
        }
      }
    });
  }
}

/**
 * Trata os endereços que chegam pelos links de e-mail.
 *
 * O token sai da URL imediatamente nos dois casos: ele é uma credencial de uso
 * único e não deve ficar no histórico do navegador nem vazar pelo cabeçalho
 * Referer de qualquer recurso que a página venha a carregar.
 */
async function tratarLinksDeEmail() {
  const caminho = window.location.pathname;
  const token = new URLSearchParams(window.location.search).get('token');

  if (caminho === '/redefinir-senha') {
    window.history.replaceState({}, '', '/redefinir-senha');
    if (!token) {
      showToast('Link de redefinição inválido ou incompleto.', 'triangle-alert');
      return;
    }
    state.resetToken = token;
    abrirModal('resetPasswordModal');
    return;
  }

  if (caminho === '/confirmar-email') {
    window.history.replaceState({}, '', '/');
    if (!token) {
      showToast('Link de confirmação inválido ou incompleto.', 'triangle-alert');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();
      showToast(data.message, data.success ? 'circle-check' : 'triangle-alert');
      if (data.success && state.token) await loadUserProfile();
    } catch (err) {
      showToast('Não foi possível confirmar o e-mail agora.', 'triangle-alert');
    }
  }
}

/**
 * Pede o aceite a quem criou conta antes de ele passar a ser obrigatório. A
 * conta continua utilizável — o modal é um lembrete, não um bloqueio, porque
 * travar o acesso de quem já usava a plataforma seria uma punição por uma
 * mudança que não foi escolha dessa pessoa.
 */
function pedirAceiteDeTermosSeNecessario() {
  if (!state.user || state.user.terms_accepted) return;
  abrirModal('acceptTermsModal');
}

/* ==========================================================================
   NOTIFICAÇÕES PUSH + CENTRAL DE NOTIFICAÇÕES + STREAK
   ========================================================================== */

/**
 * Registra a inscrição de Web Push no servidor, a partir da permissão do
 * navegador. Não bloqueia o fluxo se o browser não suportar push ou se o
 * usuário negar.
 */
async function subscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!state.user || !state.token) return;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
    if (!sub) return;

    const { endpoint, keys } = sub.toJSON();
    await fetch(`${API_URL}/api/notifications/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ endpoint, keys })
    });
  } catch (e) {
    // Push negado pelo usuário ou erro de rede: não há o que fazer.
  }
}

let _notifPollTimer = null;

async function loadUnreadNotifications() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (!state.user || !state.token) {
    badge.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/notifications/unread-count`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();
    const unread = data?.data?.unread || 0;
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (e) {
    badge.classList.add('hidden');
  }
}

function toggleNotificationCenter() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');

  if (isOpen) {
    loadNotificationList();
    // Polling leve: a cada 30s atualiza o badge. Socket.IO não tem evento
    // de notificação nova, e push é pelo service worker — o SINO é o viewsync.
    if (_notifPollTimer) clearInterval(_notifPollTimer);
    _notifPollTimer = setInterval(loadUnreadNotifications, 30000);
  } else {
    if (_notifPollTimer) {
      clearInterval(_notifPollTimer);
      _notifPollTimer = null;
    }
  }
}

async function loadNotificationList() {
  const lista = document.getElementById('notifList');
  if (!lista) return;
  lista.innerHTML =
    '<p style="color:var(--muted-foreground);text-align:center;padding:24px;">Carregando...</p>';

  try {
    const res = await fetch(`${API_URL}/api/notifications?limit=20`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();
    const items = data?.data?.items || [];

    if (!items.length) {
      lista.innerHTML =
        '<p style="color:var(--muted-foreground);text-align:center;padding:24px;">Nenhuma notificação ainda.</p>';
      return;
    }

    lista.innerHTML = items
      .map(
        (n) => `
      <div class="notif-item${n.read_at ? '' : ' unread'}" data-notif-id="${escapeHtml(n.id)}">
        <strong>${escapeHtml(n.title)}</strong>
        <span>${escapeHtml(n.body)}</span>
        <time>${new Date(n.created_at).toLocaleString('pt-BR')}</time>
      </div>
    `
      )
      .join('');

    lista.querySelectorAll('.notif-item').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.dataset.notifId;
        await fetch(`${API_URL}/api/notifications/${id}/read`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${state.token}` }
        });
        el.classList.remove('unread');
        loadUnreadNotifications();
      });
    });
  } catch (e) {
    lista.innerHTML =
      '<p style="color:var(--muted-foreground);text-align:center;padding:24px;">Erro ao carregar notificações.</p>';
  }
}

function renderNotificationBell() {
  const bell = document.getElementById('notifBell');
  if (!bell) return;

  if (!state.user || !state.token) {
    bell.classList.add('hidden');
    document.getElementById('notifPanel')?.classList.remove('open');
    if (_notifPollTimer) clearInterval(_notifPollTimer);
    _notifPollTimer = null;
    return;
  }
  bell.classList.remove('hidden');
  loadUnreadNotifications();
}

function renderStreak() {
  const el = document.getElementById('streakDisplay');
  if (!el) return;

  const streak = state.token && (state.user?.streak || state.streak);
  if (!streak || streak.current === 0) {
    el.textContent = '';
    el.title = '';
    return;
  }

  el.textContent = `🔥 ${streak.current}d`;
  el.title = `Streak: ${streak.current} dias seguidos (melhor: ${streak.best})`;
}

function setupSocketEvents() {
  socket.on('connect', () => {
    socket.emit('join-room', 'stream_room');
    if (state.user?.id) socket.emit('join-room', `user_${state.user.id}`);
  });

  // Confirmação assíncrona de assinatura Kick (chega via webhook, não no
  // momento do login OAuth — ver KickService.processSubscriptionEvent)
  socket.on('kick:subscription-confirmed', async (data) => {
    showToast(
      `Assinatura Kick confirmada${data.streamerUsername ? ' com @' + data.streamerUsername : ''}! Você agora é Subscritor.`,
      'star'
    );
    if (window.JetSound) window.JetSound.playCoinChime();
    await loadUserProfile();
  });

  // Mensagem no chat
  socket.on('chat:new-message', (data) => {
    appendChatMessage(data.author, data.message, data.role);
  });

  // Rodada de qualquer jogador do site. O ranking só recarrega se a rodada for do
  // jogo aberto, e no máximo uma vez a cada 5 s: recarregar a cada aviso fazia
  // cada rodada virar uma consulta de ranking por aba conectada.
  let rankingAgendado = null;
  socket.on('game:flight-launched', (data) => {
    const aba = document.querySelector(`.game-tab[data-game="${data.gameId}"] .tab-title`);
    const jogo = aba ? ` no ${aba.textContent}` : '';
    appendSystemMessage(
      `🚀 [RODADA] ${data.user.username} fez ${Math.round(data.distance)} m e ${data.score} pts${jogo}!`,
      'launch'
    );
    if (data.gameId !== (state.rankingGame || state.currentGame) || rankingAgendado) return;
    rankingAgendado = setTimeout(() => {
      rankingAgendado = null;
      loadLeaderboard();
    }, 5000);
  });

  // Alerta de doação LivePix recebida na live
  socket.on('stream:donation-received', (data) => {
    const streamerTag = data.streamerUsername ? ` para ${data.streamerUsername}` : '';
    appendSystemMessage(
      `💰 [LIVEPIX] ${data.username} doou R$ ${data.amountBrl.toFixed(2)}${streamerTag} e converteu em ${data.coinsCredited} Fichas! "${data.message}"`,
      'donation'
    );
    // A mesma doação também desliza para o topo do Mural Social do canal.
    if (window.DonationWall) window.DonationWall.onDonationReceived(data);
  });

  // Mural Social: contador de outro espectador mudou. Quem clicou não espera
  // por aqui — o botão dele já atualizou com a resposta do POST.
  socket.on('donation-wall:reaction-updated', (data) => {
    if (window.DonationWall) window.DonationWall.onReactionUpdated(data);
  });

  // Mural Social: o streamer removeu uma mensagem do próprio mural.
  socket.on('donation-wall:removed', (data) => {
    if (window.DonationWall) window.DonationWall.onRemoved(data);
  });

  // Atualização em tempo real do saldo de Fichas de Apoio (por streamer)
  socket.on('streamer-wallet:balance-updated', (data) => {
    if (
      state.user &&
      state.user.id === data.userId &&
      state.currentChannel &&
      state.currentChannel.id === data.streamerId
    ) {
      loadChannelWallet();
      const channelWalletBalanceEl = document.getElementById('channelWalletBalance');
      if (channelWalletBalanceEl)
        channelWalletBalanceEl.textContent = Number(data.balance).toLocaleString('pt-BR');
    }
  });

  // Prêmio da roleta diária anunciado no chat da live
  socket.on('streamer-roulette:won', (data) => {
    if (state.currentChannel && state.currentChannel.id === data.streamerId) {
      loadRouletteStatus();
    }
  });

  // Eventos da Lojinha do Streamer & Moderação
  socket.on('streamer-reward:moderated', (data) => {
    loadStreamerRewards();
    if (state.user && state.user.role === 'admin') {
      loadModerationQueue();
    }
  });

  socket.on('streamer-reward:redeemed', (data) => {
    loadStreamerRewards();
  });

  // Conquistas desbloqueadas após uma rodada (server emite para user_<id>).
  socket.on('achievements:unlocked', (data) => {
    if (data && Array.isArray(data.novas) && data.novas.length) {
      const nomes = data.novas.map((id) => {
        const map = {
          first_flight: 'Primeiro Voo',
          flights_10: '10 Rodadas',
          flights_50: '50 Rodadas',
          flights_100: '100 Rodadas',
          high_score_1000: '1.000 Pontos',
          high_score_5000: '5.000 Pontos',
          high_score_10000: '10.000 Pontos',
          play_all_games: 'Todos os Jogos',
          first_donation: 'Primeira Doação',
          donations_5: '5 Doações',
          donations_20: '20 Doações',
          big_donation: 'Doação Grande',
          first_reaction: 'Primeira Reação',
          reactions_50: '50 Reações',
          first_redeem: 'Primeiro Resgate',
          redeems_5: '5 Resgates'
        };
        return map[id] || id;
      });
      showToast(`🏆 Conquista desbloqueada: ${nomes.join(', ')}`, 'trophy');
      if (window.JetSound) window.JetSound.playCoinChime();
      loadUnreadNotifications();
    }
  });
}

function appendChatMessage(author, message, role = 'viewer') {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg';
  msgEl.innerHTML = `<span class="author ${escapeHtml(role)}">[${escapeHtml(String(role).toUpperCase())}] ${escapeHtml(author)}:</span> <span class="content">${escapeHtml(message)}</span>`;
  chatFeed.appendChild(msgEl);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function appendSystemMessage(text, type = 'system') {
  const msgEl = document.createElement('div');
  msgEl.className = `chat-msg ${type}`;
  msgEl.innerHTML = `<span class="content">${escapeHtml(text)}</span>`;
  chatFeed.appendChild(msgEl);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;');
}

// Placeholder local para brindes sem imagem. Antes o fallback apontava para uma
// foto do Unsplash: quando o brinde não tinha image_url, o <img> ficava com src
// vazio (que recarrega a própria página como se fosse imagem) e dependia de um
// CDN externo para se recuperar. Agora o vazio já nasce com a arte local.
const REWARD_PLACEHOLDER_IMG = 'icons/reward-placeholder.svg';

// Para atribuir direto em img.src (valor cru, sem escape de HTML).
function rewardImageUrl(url) {
  const limpo = typeof url === 'string' ? url.trim() : '';
  return limpo || REWARD_PLACEHOLDER_IMG;
}

// Para interpolar dentro de uma string de HTML.
function rewardImageSrc(url) {
  return escapeHtml(rewardImageUrl(url));
}

// Se a URL da imagem do brinde estiver quebrada (link externo fora do ar, por
// exemplo), cai no placeholder local. Precisa ser em fase de captura porque o
// evento 'error' de <img> não borbulha. Substitui os antigos onerror inline,
// que exigiam 'unsafe-inline' em script-src-attr na CSP.
document.addEventListener(
  'error',
  (event) => {
    const el = event.target;
    if (!el || el.tagName !== 'IMG' || !el.hasAttribute('data-img-fallback')) return;
    if (el.getAttribute('src') === REWARD_PLACEHOLDER_IMG) return; // evita laço
    el.src = REWARD_PLACEHOLDER_IMG;
  },
  true
);

// Delegação de cliques para os botões renderizados dinamicamente. Antes cada um
// carregava um onclick inline; centralizar aqui permitiu remover
// script-src-attr 'unsafe-inline' da CSP.
document.addEventListener('click', (event) => {
  const alvo = event.target.closest('[data-action]');
  if (!alvo) return;

  const id = alvo.dataset.id;
  switch (alvo.dataset.action) {
    case 'open-create-reward':
      document.getElementById('createRewardModal')?.classList.remove('hidden');
      break;
    case 'update-order-tracking':
      window.updateOrderTracking(id);
      break;
    case 'application-approve':
      window.handleApplicationModeration(id, 'approve');
      break;
    case 'application-reject-toggle':
      window.toggleAppRejectBox(id);
      break;
    case 'application-reject-submit':
      window.submitApplicationRejection(id);
      break;
    case 'reward-approve':
      window.handleModerationAction(id, 'approve');
      break;
    case 'reward-reject-toggle':
      window.toggleRejectBox(id);
      break;
    case 'reward-reject-submit':
      window.submitRejection(id);
      break;
    case 'copy':
      navigator.clipboard.writeText(alvo.dataset.copy || '');
      showToast(alvo.dataset.copyMsg || 'Copiado!');
      break;
  }
});

// Renderiza um ícone da biblioteca Lucide (self-hosted em icons/sprite.svg),
// usado no lugar de emojis nativos do SO em toda a UI. `extraClass` aceita os
// modificadores definidos em styles.css (icon-cyan, icon-dot, icon-lg, etc.).
function icon(name, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true" focusable="false"><use href="icons/sprite.svg#${name}"></use></svg>`;
}

// Alguns dados (itens da loja, brindes, prêmios da roleta) ainda guardam um
// emoji no campo "icon" vindo do backend. Em vez de migrar o schema, o
// frontend traduz esse emoji para o ícone Lucide equivalente na renderização.
// Mantido em sincronia manual com scripts/icon-map.js (fonte do sprite).
const EMOJI_ICON_MAP = {
  '⚡': 'zap',
  '🚀': 'rocket',
  '🪙': 'coins',
  '📦': 'package',
  '⚠️': 'triangle-alert',
  '⚠': 'triangle-alert',
  '🎁': 'gift',
  '❤️': 'heart',
  '❤': 'heart',
  '🟢': 'circle',
  '🔥': 'flame',
  '✅': 'circle-check-big',
  '🛡️': 'shield',
  '🛡': 'shield',
  '⭐': 'star',
  '🎮': 'gamepad-2',
  '⏳': 'hourglass',
  '❌': 'circle-x',
  '⏱️': 'timer',
  '⏱': 'timer',
  '🎥': 'video',
  '🟣': 'circle',
  '🔑': 'key',
  '💀': 'skull',
  '🎡': 'ferris-wheel',
  '🎉': 'party-popper',
  '🏆': 'trophy',
  '🏎️': 'car-front',
  '🏎': 'car-front',
  '🌌': 'sparkles',
  '👑': 'crown',
  '⚪': 'circle',
  '↗️': 'arrow-up-right',
  '↗': 'arrow-up-right',
  '🖤': 'heart-crack',
  '💥': 'zap',
  '🔴': 'circle',
  '🔊': 'volume-2',
  '🧑': 'user',
  '⚖️': 'scale',
  '⚖': 'scale',
  '🔄': 'refresh-cw',
  '✨': 'sparkles',
  '🌀': 'orbit',
  '📊': 'bar-chart-3',
  '🪪': 'id-card',
  '🎨': 'palette',
  '🧪': 'flask-conical',
  '🔁': 'repeat',
  '💜': 'heart',
  '🛠️': 'wrench',
  '🛠': 'wrench',
  '🤖': 'bot',
  '📋': 'clipboard-list',
  '📨': 'mail',
  '📖': 'book-open',
  '🔍': 'search',
  '🌐': 'globe',
  '➕': 'plus',
  '🔇': 'volume-x',
  '🎬': 'clapperboard',
  '🪐': 'orbit',
  '💰': 'wallet',
  '🟡': 'circle',
  '✓': 'check',
  '✕': 'x',
  '🎫': 'ticket',
  '🏠': 'home',
  '🔗': 'link',
  '🚪': 'log-out',
  '🚫': 'ban',
  '🎛️': 'sliders-horizontal',
  '🎛': 'sliders-horizontal',
  '💾': 'save',
  '🔐': 'lock',
  '👕': 'shirt',
  '🎧': 'headphones',
  '🧢': 'shirt',
  '☕': 'coffee',
  '👁️': 'eye',
  '👁': 'eye',
  '📍': 'map-pin',
  '💎': 'gem',
  '🔒': 'lock',
  '👩': 'user',
  '🎤': 'mic',
  '♾️': 'infinity',
  '♾': 'infinity',
  '😱': 'frown',
  '😎': 'smile',
  '🚨': 'siren',
  '🏁': 'flag',
  '💨': 'wind',
  '🕳️': 'circle-dashed',
  '🕳': 'circle-dashed',
  '🔮': 'wand-2',
  '🥇': 'medal',
  '🥈': 'medal',
  '🥉': 'medal',
  '🚚': 'truck',
  '←': 'arrow-left',
  '⬅️': 'arrow-left',
  '⬅': 'arrow-left',
  '✔️': 'check',
  '✔': 'check',
  '✖️': 'x',
  '✖': 'x',
  '⛽': 'fuel',
  '🛞': 'disc',
  '💠': 'diamond',
  '🧑‍🚀': 'rocket',
  '👩‍🎤': 'mic-vocal'
};

// Traduz um emoji vindo de dados do backend (item.icon, prize.icon, etc.)
// para o ícone Lucide correspondente. Se o valor já não for um emoji
// reconhecido (ex.: dado legado ou customizado), cai no `fallback`.
function iconFromEmoji(emoji, fallback = 'package', extraClass = '') {
  const name = EMOJI_ICON_MAP[emoji] || fallback;
  return icon(name, extraClass);
}

/**
 * Inventário do piloto: tudo o que ele possui, agrupado por jogo.
 *
 * O painel de equipamentos da Arena não serve para isto porque só lista os itens
 * do jogo aberto no momento — quem comprou um Salto Quântico não tinha onde vê-lo
 * enquanto estivesse no Jet Launcher.
 */
function openInventoryModal() {
  const modal = document.getElementById('inventoryModal');
  if (!modal) return;

  if (!state.token) {
    showToast('Faça login para ver o seu inventário de equipamentos!', 'key');
    openAuthModal('login');
    return;
  }

  renderInventoryModal();
  modal.classList.remove('hidden');

  // Busca a versão fresca do servidor e redesenha: compras e prêmios da roleta
  // podem ter entrado desde o último carregamento.
  loadUserInventory().then(() => {
    if (!modal.classList.contains('hidden')) renderInventoryModal();
  });
}

function renderInventoryModal() {
  const emptyState = document.getElementById('inventoryEmptyState');
  const listEl = document.getElementById('inventoryItemsList');
  if (!listEl) return;

  const itens = (state.inventory || []).filter((i) => Number(i.quantity) > 0);

  if (itens.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    listEl.classList.add('hidden');
    listEl.innerHTML = '';
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  listEl.classList.remove('hidden');

  const grupos = new Map();
  for (const item of itens) {
    const jogo = item.game_id || item.gameId || 'all';
    if (!grupos.has(jogo)) grupos.set(jogo, []);
    grupos.get(jogo).push(item);
  }

  const tituloDoJogo = (jogo) =>
    jogo === 'all' ? 'Universais (todos os jogos)' : PROTAGONISTS[jogo]?.title || jogo;

  const permanente = (item) => item.type === 'cosmetic' || item.flight_bonus?.isPermanent === true;

  listEl.innerHTML = [...grupos.entries()]
    .map(
      ([jogo, lista]) => `
      <div style="margin-bottom: 16px;">
        <span style="display: block; font-family: var(--font-hud); font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--neon-cyan, #05d9e8); margin-bottom: 8px;">${escapeHtml(tituloDoJogo(jogo))}</span>
        ${lista
          .map(
            (i) => `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <span aria-hidden="true" style="font-size: 20px;">${escapeHtml(i.icon || '📦')}</span>
              <div style="min-width: 0;">
                <strong style="color: #fff; font-size: 14px;">${escapeHtml(i.name || i.item_id)}</strong>
                <span style="display: block; font-size: 11px; color: #94a3b8;">${escapeHtml(i.description || '')}</span>
              </div>
            </div>
            <span style="flex-shrink: 0; font-family: var(--font-hud); font-size: 13px; color: ${permanente(i) ? '#fbbf24' : '#05d9e8'};">
              ${permanente(i) ? 'PERMANENTE' : `${Number(i.quantity)} un.`}
            </span>
          </div>
        `
          )
          .join('')}
      </div>
    `
    )
    .join('');
}

function closeInventoryModal() {
  const modal = document.getElementById('inventoryModal');
  if (modal) modal.classList.add('hidden');
}

/* ==========================================================================
   LISTENERS DE EVENTOS DE UI
   ========================================================================== */
function setupEventListeners() {
  // Barra de Busca Rápida do Header (E-Commerce)
  const headerGlobalSearch = document.getElementById('headerGlobalSearch');
  if (headerGlobalSearch) {
    headerGlobalSearch.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      renderShopItems();
      renderStreamerRewards();
    });
    headerGlobalSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        irParaSecao('streamerShopSection');
      }
    });
  }

  // Indicador de Inventário / Cesta
  //
  // O handler antigo procurava #shopGrid ou #inventoryGrid para rolar até lá.
  // Nenhum dos dois existe no HTML, então a condição nunca era verdadeira e o
  // clique não fazia absolutamente nada — nem rolagem, nem aviso.
  const headerCartSummaryBtn = document.getElementById('headerCartSummaryBtn');
  if (headerCartSummaryBtn) {
    headerCartSummaryBtn.addEventListener('click', openInventoryModal);
  }

  const closeInventoryModalBtn = document.getElementById('closeInventoryModalBtn');
  if (closeInventoryModalBtn) {
    closeInventoryModalBtn.addEventListener('click', closeInventoryModal);
  }

  const inventoryModal = document.getElementById('inventoryModal');
  if (inventoryModal) {
    inventoryModal.addEventListener('click', (e) => {
      if (e.target === inventoryModal) closeInventoryModal();
    });
  }

  // Botões do Rodapé (Navegação Interna)
  const footerStreamersBtn = document.getElementById('footerStreamersBtn');
  if (footerStreamersBtn) {
    footerStreamersBtn.addEventListener('click', openStreamerDirectoryModal);
  }
  const footerRouletteBtn = document.getElementById('footerRouletteBtn');
  if (footerRouletteBtn) {
    footerRouletteBtn.addEventListener('click', () => {
      if (typeof openCyberRouletteModal === 'function') {
        openCyberRouletteModal();
      } else {
        const widget = document.getElementById('mainViewRouletteWidget');
        if (widget) widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
  const footerCreatorBtn = document.getElementById('footerCreatorBtn');
  if (footerCreatorBtn) {
    footerCreatorBtn.addEventListener('click', () => {
      if (!state.user) {
        showToast('Faça login para acessar a Central do Criador');
        openAuthModal('login');
        return;
      }
      openCreatorHubModal();
    });
  }

  // Botões da Homepage: abrem o modal de autenticação já na aba correta
  const landingLoginBtn = document.getElementById('landingLoginBtn');
  const landingRegisterBtn = document.getElementById('landingRegisterBtn');
  const heroLoginBtn = document.getElementById('heroLoginBtn');
  const heroRegisterBtn = document.getElementById('heroRegisterBtn');
  const landingFinalRegisterBtn = document.getElementById('landingFinalRegisterBtn');
  const landingStreamersBtn = document.getElementById('landingStreamersBtn');

  if (landingLoginBtn) landingLoginBtn.addEventListener('click', () => openAuthModal('login'));
  if (heroLoginBtn) heroLoginBtn.addEventListener('click', () => openAuthModal('login'));
  if (landingRegisterBtn)
    landingRegisterBtn.addEventListener('click', () => openAuthModal('register'));
  // Listener em vez de onclick no HTML: a CSP do servidor manda
  // script-src-attr 'none', entao handler inline nao dispara (ver server.js).
  const landingArenaBtn = document.getElementById('landingArenaBtn');
  if (landingArenaBtn) landingArenaBtn.addEventListener('click', () => enterApp());
  if (heroRegisterBtn) heroRegisterBtn.addEventListener('click', () => openAuthModal('register'));
  if (landingFinalRegisterBtn)
    landingFinalRegisterBtn.addEventListener('click', () => openAuthModal('register'));
  if (landingStreamersBtn)
    landingStreamersBtn.addEventListener('click', openStreamerDirectoryModal);

  // Botão Hero "Jogar na Arena Agora (Grátis)"
  const heroPlayFreeBtn = document.getElementById('heroPlayFreeBtn');
  if (heroPlayFreeBtn) {
    heroPlayFreeBtn.addEventListener('click', () => {
      enterApp(true);
      const bay = document.getElementById('gameZoneTitle');
      if (bay) bay.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Cards de Jogos na Landing Page: clique direto entra no jogo na Arena
  document.querySelectorAll('.landing-game-card, .landing-play-card-btn').forEach((elem) => {
    elem.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetCard = elem.closest('.landing-game-card') || elem;
      const gameId = elem.dataset.game || (targetCard ? targetCard.dataset.game : 'jet_launcher');
      if (gameId) {
        switchGameMode(gameId);
        enterApp(true);
        const bay = document.getElementById('gameZoneTitle');
        if (bay) bay.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Navegação Global Topbar
  const navHomeBtn = document.getElementById('navHomeBtn');
  if (navHomeBtn) navHomeBtn.addEventListener('click', showLanding);

  const appBrandBtn = document.getElementById('appBrandBtn');
  if (appBrandBtn) appBrandBtn.addEventListener('click', showLanding);

  const topbarLoginBtn = document.getElementById('topbarLoginBtn');
  if (topbarLoginBtn) topbarLoginBtn.addEventListener('click', () => openAuthModal('login'));

  const topbarRegisterBtn = document.getElementById('topbarRegisterBtn');
  if (topbarRegisterBtn)
    topbarRegisterBtn.addEventListener('click', () => openAuthModal('register'));

  // Navegação Rápida da Sidebar (Arena de Jogos <-> Lojinha)
  const sidebarGoToGamesBtn = document.getElementById('sidebarGoToGamesBtn');
  if (sidebarGoToGamesBtn) {
    sidebarGoToGamesBtn.addEventListener('click', () => {
      const bay = document.getElementById('gameZoneTitle');
      if (bay) bay.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const sidebarGoToShopBtn = document.getElementById('sidebarGoToShopBtn');
  if (sidebarGoToShopBtn) {
    sidebarGoToShopBtn.addEventListener('click', () => {
      irParaSecao('streamerShopSection');
    });
  }

  // Ação Rápida do Banner de Vidas Esgotadas.
  //
  // Este botão restaurava as vidas escrevendo `state.user.lives = max_lives` e
  // nada mais: nenhuma chamada ao servidor. O contador enchia na tela, o banner
  // sumia, e a decolagem seguinte era recusada com NO_LIVES_REMAINING, porque o
  // débito de vida é autoritativo no backend (ver GameRunService.iniciar).
  // Era só a interface mentindo — e ela aparecia para qualquer viewer.
  //
  // A Bateria de Vidas credita +2 vidas extras do canal no ato da compra (ver
  // ChannelInventoryModel.purchase), então o botão leva o piloto até ela. O resto volta pela
  // regeneração e pela roleta, que o texto do banner agora explica.
  const quickRefillLivesBtn = document.getElementById('quickRefillLivesBtn');
  if (quickRefillLivesBtn) {
    quickRefillLivesBtn.addEventListener('click', () => {
      if (!state.user) {
        showToast('Faça login para comprar a Bateria de Vidas', 'key');
        openAuthModal('login');
        return;
      }
      irParaSecao('platformShopSection');
    });
  }

  // Menu de Perfil (clique no nome/avatar abre/fecha o dropdown ou abre login para visitante)
  if (currentUserChip) {
    currentUserChip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!state.user) {
        openAuthModal('login');
        return;
      }
      if (profileDropdown) profileDropdown.classList.toggle('hidden');
    });

    if (profileDropdown) {
      // Fecha o menu ao clicar em qualquer opção dentro dele
      profileDropdown.addEventListener('click', () => profileDropdown.classList.add('hidden'));
      // Fecha o menu ao clicar fora
      document.addEventListener('click', (e) => {
        if (
          !profileDropdown.classList.contains('hidden') &&
          !profileDropdown.contains(e.target) &&
          e.target !== currentUserChip
        ) {
          profileDropdown.classList.add('hidden');
        }
      });
    }
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      signOut();
    });
  }

  if (closeAuthModal) {
    closeAuthModal.addEventListener('click', () => {
      authModal.classList.add('hidden');
    });
  }

  // Modal de Edição de Perfil
  const openEditProfileBtn = document.getElementById('openEditProfileBtn');
  const closeEditProfileModal = document.getElementById('closeEditProfileModal');
  const editProfileForm = document.getElementById('editProfileForm');

  if (openEditProfileBtn) {
    openEditProfileBtn.addEventListener('click', () => {
      if (!state.user || !editProfileModal) return;
      const nameInput = document.getElementById('editProfileNameInput');
      const phoneInput = document.getElementById('editProfilePhoneInput');
      const usernameDisplay = document.getElementById('editProfileUsernameDisplay');
      const emailDisplay = document.getElementById('editProfileEmailDisplay');
      const roleDisplay = document.getElementById('editProfileRoleDisplay');

      if (nameInput) nameInput.value = state.user.name || '';
      if (phoneInput) phoneInput.value = state.user.phone || '';
      if (usernameDisplay) usernameDisplay.textContent = state.user.username;
      if (emailDisplay) emailDisplay.textContent = state.user.email;
      if (roleDisplay) {
        roleDisplay.textContent = state.user.role.toUpperCase();
        roleDisplay.className = `role-badge ${state.user.role}`;
      }
      editProfileModal.classList.remove('hidden');
    });
  }

  if (closeEditProfileModal && editProfileModal) {
    closeEditProfileModal.addEventListener('click', () => editProfileModal.classList.add('hidden'));
    editProfileModal.addEventListener('click', (e) => {
      if (e.target === editProfileModal) editProfileModal.classList.add('hidden');
    });
  }

  if (editProfileForm) {
    editProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('editProfileNameInput').value.trim();
      const phone = document.getElementById('editProfilePhoneInput').value.trim();

      try {
        const res = await fetch(`${API_URL}/api/auth/profile`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ name, phone })
        });
        const data = await res.json();
        if (data.success) {
          state.user = data.data.user;
          renderUserStatus();
          showToast('Perfil atualizado com sucesso!');
          if (editProfileModal) editProfileModal.classList.add('hidden');
        } else {
          alert(data.message || 'Erro ao atualizar perfil');
        }
      } catch (err) {
        alert('Erro ao conectar ao servidor para atualizar o perfil');
      }
    });
  }

  // Alternância de abas de autenticação (Login vs Cadastro)
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabRegisterBtn = document.getElementById('tabRegisterBtn');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const authModalTitle = document.getElementById('authModalTitle');

  if (tabLoginBtn && tabRegisterBtn && loginForm && registerForm) {
    tabLoginBtn.addEventListener('click', () => {
      tabLoginBtn.classList.add('active');
      tabRegisterBtn.classList.remove('active');
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
      if (authModalTitle) authModalTitle.textContent = 'Acesso de Piloto';
    });

    tabRegisterBtn.addEventListener('click', () => {
      tabRegisterBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      registerForm.classList.remove('hidden');
      loginForm.classList.add('hidden');
      if (authModalTitle) authModalTitle.textContent = 'Criar Conta de Piloto';
    });
  }

  // Envio do formulário de login (para pilotos, streamers e administradores)
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;

      try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
          setSession(data.data.token, data.data.user, data.data.wallet);
          showToast(`Bem-vindo de volta, ${data.data.user.username}!`);
        } else {
          alert(data.message || 'Credenciais inválidas');
        }
      } catch (err) {
        alert('Erro ao conectar ao servidor para autenticação');
      }
    });
  }

  // Telefone / WhatsApp com máscara automática
  const regPhoneInput = document.getElementById('regPhone');
  if (regPhoneInput) {
    regPhoneInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 11) val = val.slice(0, 11);
      if (val.length > 10) {
        e.target.value = `(${val.slice(0, 2)}) ${val.slice(2, 7)}-${val.slice(7)}`;
      } else if (val.length > 6) {
        e.target.value = `(${val.slice(0, 2)}) ${val.slice(2, 6)}-${val.slice(6)}`;
      } else if (val.length > 2) {
        e.target.value = `(${val.slice(0, 2)}) ${val.slice(2)}`;
      } else {
        e.target.value = val;
      }
    });
  }

  // Cadastro Nativo de Novo Usuário com Redirecionamento Fluido
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('regName')
        ? document.getElementById('regName').value.trim()
        : null;
      const phone = document.getElementById('regPhone')
        ? document.getElementById('regPhone').value.trim()
        : null;
      const username = document.getElementById('regUsername').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;
      const birthDateEl = document.getElementById('regBirthDate');
      const birthDate = birthDateEl ? birthDateEl.value : '';
      const acceptEl = document.getElementById('regAcceptTerms');
      const acceptedTerms = acceptEl ? acceptEl.checked : false;

      // O `required` do formulário já barra o envio vazio; estas checagens
      // cobrem quem manipula o DOM. A trava que vale está no servidor
      // (AuthService.register), que recusa cadastro sem aceite e sem idade.
      if (!acceptedTerms) {
        mostrarRetorno(
          'regFeedback',
          'É necessário aceitar os Termos de Uso para criar a conta.',
          false
        );
        if (acceptEl) acceptEl.focus();
        return;
      }
      if (!birthDate) {
        mostrarRetorno('regFeedback', 'Informe sua data de nascimento.', false);
        if (birthDateEl) birthDateEl.focus();
        return;
      }
      document.getElementById('regFeedback')?.classList.add('hidden');
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Cadastrando...';
      }

      try {
        const res = await fetch(`${API_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, username, email, password, birthDate, acceptedTerms })
        });
        const data = await res.json();
        if (data.success) {
          setSession(data.data.token, data.data.user, data.data.wallet);
          showToast(`Conta criada com sucesso! Bem-vindo, ${username}!`);
          // Redirecionamento fluido para o modal de vinculação de stream
          openStreamLinkModal(true);
        } else {
          mostrarRetorno('regFeedback', data.message || 'Erro ao registrar usuário.', false);
        }
      } catch (err) {
        mostrarRetorno('regFeedback', 'Erro ao conectar ao servidor para cadastro.', false);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Cadastrar e Entrar';
        }
      }
    });
  }

  // Modal de Vinculação de Stream (Twitch & Kick)
  const openStreamLinkBtn = document.getElementById('openStreamLinkBtn');
  const streamLinkModal = document.getElementById('streamLinkModal');
  const closeStreamLinkModal = document.getElementById('closeStreamLinkModal');
  const finishStreamLinkBtn = document.getElementById('finishStreamLinkBtn');

  if (openStreamLinkBtn) {
    openStreamLinkBtn.addEventListener('click', () => openStreamLinkModal());
  }

  if (closeStreamLinkModal) {
    closeStreamLinkModal.addEventListener('click', () => streamLinkModal.classList.add('hidden'));
  }
  if (finishStreamLinkBtn) {
    finishStreamLinkBtn.addEventListener('click', () => {
      streamLinkModal.classList.add('hidden');
    });
  }

  const oauthTwitchBtn = document.getElementById('oauthTwitchBtn');
  if (oauthTwitchBtn) {
    oauthTwitchBtn.addEventListener('click', () => {
      const authUrl = `${API_URL}/api/auth/twitch/authorize`;

      const twitchErrorNotice = document.getElementById('twitchErrorNotice');
      if (twitchErrorNotice) twitchErrorNotice.classList.add('hidden');

      const twitchPending = document.getElementById('twitchOAuthPendingNotice');
      if (twitchPending) twitchPending.classList.remove('hidden');

      const width = 600;
      const height = 750;
      const left = Math.max(0, (window.innerWidth - width) / 2 + (window.screenX || 0));
      const top = Math.max(0, (window.innerHeight - height) / 2 + (window.screenY || 0));

      const popup = window.open(
        authUrl,
        'twitch_oauth_window',
        `width=${width},height=${height},top=${top},left=${left},status=no,resizable=yes,scrollbars=yes`
      );

      // Se o navegador bloquear o popup, utiliza fallback via navegação preservando estado
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        if (twitchPending) twitchPending.classList.add('hidden');
        sessionStorage.setItem('return_to_stream_modal', 'true');
        window.location.href = authUrl;
      } else {
        watchOAuthPopup(popup, twitchPending);
      }
    });
  }

  const oauthKickBtn = document.getElementById('oauthKickBtn');
  if (oauthKickBtn) {
    oauthKickBtn.addEventListener('click', () => {
      const authUrl = `${API_URL}/api/auth/kick/authorize`;

      const kickErrorNotice = document.getElementById('kickErrorNotice');
      if (kickErrorNotice) kickErrorNotice.classList.add('hidden');

      const kickPending = document.getElementById('kickOAuthPendingNotice');
      if (kickPending) kickPending.classList.remove('hidden');

      const width = 600;
      const height = 750;
      const left = Math.max(0, (window.innerWidth - width) / 2 + (window.screenX || 0));
      const top = Math.max(0, (window.innerHeight - height) / 2 + (window.screenY || 0));

      const popup = window.open(
        authUrl,
        'kick_oauth_window',
        `width=${width},height=${height},top=${top},left=${left},status=no,resizable=yes,scrollbars=yes`
      );

      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        if (kickPending) kickPending.classList.add('hidden');
        sessionStorage.setItem('return_to_stream_modal', 'true');
        window.location.href = authUrl;
      } else {
        watchOAuthPopup(popup, kickPending);
      }
    });
  }

  const unlinkTwitchBtn = document.getElementById('unlinkTwitchBtn');
  if (unlinkTwitchBtn) {
    unlinkTwitchBtn.addEventListener('click', async () => {
      if (!confirm('Deseja realmente desvincular sua conta da Twitch?')) return;
      try {
        const res = await fetch(`${API_URL}/api/auth/unlink-stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`
          },
          body: JSON.stringify({ provider: 'twitch' })
        });
        const data = await res.json();
        if (data.success) {
          state.user = data.data.user;
          renderUserStatus();
          openStreamLinkModal();
          showToast('Conta Twitch desvinculada');
        } else {
          alert(data.message || 'Erro ao desvincular Twitch');
        }
      } catch (err) {
        alert('Erro ao conectar ao servidor para desvincular Twitch');
      }
    });
  }

  // Ações de Desvincular Kick
  const unlinkKickBtn = document.getElementById('unlinkKickBtn');
  if (unlinkKickBtn) {
    unlinkKickBtn.addEventListener('click', async () => {
      if (!confirm('Deseja realmente desvincular sua conta da Kick?')) return;
      try {
        const res = await fetch(`${API_URL}/api/auth/unlink-stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`
          },
          body: JSON.stringify({ provider: 'kick' })
        });
        const data = await res.json();
        if (data.success) {
          state.user = data.data.user;
          renderUserStatus();
          openStreamLinkModal();
          showToast('Conta Kick desvinculada');
        } else {
          alert(data.message || 'Erro ao desvincular Kick');
        }
      } catch (err) {
        alert('Erro ao conectar ao servidor para desvincular Kick');
      }
    });
  }

  // Chat submit
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;

    // Só a mensagem: autor e papel sao definidos pelo servidor a partir do JWT.
    socket.emit('chat:send', { message: msg });
    chatInput.value = '';
  });

  // Decolagem do Jato
  launchJetBtn.addEventListener('click', handleJetLaunch);

  // Compra na Loja (Supply Bay legado, se presente)
  if (shopGrid) {
    shopGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.buy-btn');
      if (btn) {
        handlePurchase(btn.dataset.itemId, btn.dataset.itemName);
      }
    });
  }

  if (refreshShopBtn) {
    refreshShopBtn.addEventListener('click', loadShopItems);
  }
  if (closeDebriefBtn) {
    closeDebriefBtn.addEventListener(
      'click',
      () => debriefModal && debriefModal.classList.add('hidden')
    );
  }

  // Alternância de Jogos no LiveX Games Hub
  document.querySelectorAll('.game-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const gameId = tab.dataset.game;
      if (gameId) switchGameMode(gameId);
    });
  });
}

function showTwitchModalError(errorMsg) {
  const modal = document.getElementById('streamLinkModal');
  if (modal) modal.classList.remove('hidden');

  const twitchErrorNotice = document.getElementById('twitchErrorNotice');
  const twitchErrorMessage = document.getElementById('twitchErrorMessage');
  if (twitchErrorNotice && twitchErrorMessage) {
    twitchErrorMessage.textContent = errorMsg;
    twitchErrorNotice.classList.remove('hidden');
  }

  const twitchPending = document.getElementById('twitchOAuthPendingNotice');
  if (twitchPending) twitchPending.classList.add('hidden');

  const twitchBadge = document.getElementById('twitchStatusBadge');
  if (twitchBadge) {
    twitchBadge.className = 'stream-status-pill disconnected';
    twitchBadge.textContent = 'Falha na Conexão';
  }
}

function showKickModalError(errorMsg) {
  const modal = document.getElementById('streamLinkModal');
  if (modal) modal.classList.remove('hidden');

  const kickErrorNotice = document.getElementById('kickErrorNotice');
  const kickErrorMessage = document.getElementById('kickErrorMessage');
  if (kickErrorNotice && kickErrorMessage) {
    kickErrorMessage.textContent = errorMsg;
    kickErrorNotice.classList.remove('hidden');
  }

  const kickPending = document.getElementById('kickOAuthPendingNotice');
  if (kickPending) kickPending.classList.add('hidden');

  const kickBadge = document.getElementById('kickStatusBadge');
  if (kickBadge) {
    kickBadge.className = 'stream-status-pill disconnected';
    kickBadge.textContent = 'Falha na Conexão';
  }
}

function openStreamLinkModal(isNewRegistration = false, errorMsg = null) {
  const modal = document.getElementById('streamLinkModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  const twitchPending = document.getElementById('twitchOAuthPendingNotice');
  if (twitchPending) twitchPending.classList.add('hidden');
  const kickPendingNotice = document.getElementById('kickOAuthPendingNotice');
  if (kickPendingNotice) kickPendingNotice.classList.add('hidden');

  const twitchErrorNotice = document.getElementById('twitchErrorNotice');
  const twitchErrorMessage = document.getElementById('twitchErrorMessage');

  if (errorMsg) {
    if (twitchErrorNotice && twitchErrorMessage) {
      twitchErrorMessage.textContent = errorMsg;
      twitchErrorNotice.classList.remove('hidden');
    }
    const twitchBadge = document.getElementById('twitchStatusBadge');
    if (twitchBadge) {
      twitchBadge.className = 'stream-status-pill disconnected';
      twitchBadge.textContent = 'Falha na Conexão';
    }
  } else {
    if (twitchErrorNotice) twitchErrorNotice.classList.add('hidden');
  }

  if (!state.user) return;

  const twitchBadge = document.getElementById('twitchStatusBadge');
  const oauthTwitchBtn = document.getElementById('oauthTwitchBtn');
  const unlinkTwitchBtn = document.getElementById('unlinkTwitchBtn');

  const kickBadge = document.getElementById('kickStatusBadge');
  const unlinkKickBtn = document.getElementById('unlinkKickBtn');
  const oauthKickBtn = document.getElementById('oauthKickBtn');

  const subBanner = document.getElementById('subCelebrationBanner');

  // Estado Twitch
  if (state.user.twitch_username) {
    if (twitchBadge) {
      twitchBadge.className = state.user.is_sub_twitch
        ? 'stream-status-pill sub-active'
        : 'stream-status-pill connected';
      twitchBadge.innerHTML = state.user.is_sub_twitch
        ? `Conectado: @${escapeHtml(state.user.twitch_username)} ${icon('star', 'icon-yellow')} SUB`
        : `Conectado: @${escapeHtml(state.user.twitch_username)}`;
    }
    if (unlinkTwitchBtn) unlinkTwitchBtn.classList.remove('hidden');
    if (oauthTwitchBtn) oauthTwitchBtn.classList.add('hidden');
  } else {
    if (twitchBadge && !errorMsg) {
      twitchBadge.className = 'stream-status-pill disconnected';
      twitchBadge.textContent = 'Desconectado';
    }
    if (unlinkTwitchBtn) unlinkTwitchBtn.classList.add('hidden');
    if (oauthTwitchBtn) oauthTwitchBtn.classList.remove('hidden');
  }

  // Estado Kick
  if (state.user.kick_username) {
    if (kickBadge) {
      kickBadge.className = state.user.is_sub_kick
        ? 'stream-status-pill sub-active'
        : 'stream-status-pill connected';
      kickBadge.innerHTML = state.user.is_sub_kick
        ? `Conectado: @${escapeHtml(state.user.kick_username)} ${icon('star', 'icon-yellow')} SUB`
        : `Conectado: @${escapeHtml(state.user.kick_username)}`;
    }
    if (unlinkKickBtn) unlinkKickBtn.classList.remove('hidden');
    if (oauthKickBtn) oauthKickBtn.classList.add('hidden');
  } else {
    if (kickBadge) {
      kickBadge.className = 'stream-status-pill disconnected';
      kickBadge.textContent = 'Desconectado';
    }
    if (unlinkKickBtn) unlinkKickBtn.classList.add('hidden');
    if (oauthKickBtn) oauthKickBtn.classList.remove('hidden');
  }

  // Banner comemorativo de Subscritor
  const isSub =
    state.user.role === 'subscriber' || state.user.is_sub_twitch || state.user.is_sub_kick;
  if (subBanner) {
    subBanner.classList.toggle('hidden', !isSub);
  }
}

// Chave usada no localStorage como canal de reserva para o resultado do OAuth.
// Necessária porque alguns provedores (Twitch/Kick) enviam o cabeçalho
// Cross-Origin-Opener-Policy nas telas de login, o que faz o navegador
// desvincular "window.opener" da popup — o postMessage direto some nesse caso.
// O evento 'storage' independe de window.opener (é por origem), então
// funciona como rede de segurança mesmo com o COOP ativo.
const OAUTH_RESULT_STORAGE_KEY = 'livex_oauth_result';
let oauthResultHandled = false;

// Processa o resultado do OAuth vindo por postMessage OU pelo canal de
// reserva (localStorage), o que chegar primeiro; ignora o segundo.
async function handleOAuthResult(data) {
  if (!data || typeof data !== 'object' || !data.type) return;
  if (oauthResultHandled) return;
  oauthResultHandled = true;
  setTimeout(() => {
    oauthResultHandled = false;
  }, 2000);

  const twitchPending = document.getElementById('twitchOAuthPendingNotice');
  if (twitchPending) twitchPending.classList.add('hidden');
  const kickPending = document.getElementById('kickOAuthPendingNotice');
  if (kickPending) kickPending.classList.add('hidden');

  if (data.type === 'TWITCH_AUTH_SUCCESS') {
    const { username, isSub } = data;
    showToast(
      `Twitch @${username} vinculada com sucesso! ${isSub ? 'Status SUB Confirmado (+2 vidas douradas por dia)!' : ''}`,
      'link'
    );
    if (window.JetSound) window.JetSound.playCoinChime();
    await loadUserProfile();
    openStreamLinkModal();
  } else if (data.type === 'TWITCH_AUTH_ERROR') {
    const errorMsg = data.error || 'A autorização da Twitch não pôde ser concluída.';
    showToast(`Falha na autorização Twitch: ${errorMsg}`, 'triangle-alert');
    showTwitchModalError(errorMsg);
  } else if (data.type === 'KICK_AUTH_SUCCESS') {
    const { username } = data;
    showToast(
      `Kick @${username} vinculada com sucesso! A confirmação de assinante chega automaticamente assim que a Kick notificar.`,
      'link'
    );
    if (window.JetSound) window.JetSound.playCoinChime();
    await loadUserProfile();
    openStreamLinkModal();
  } else if (data.type === 'KICK_AUTH_ERROR') {
    const errorMsg = data.error || 'A autorização da Kick não pôde ser concluída.';
    showToast(`Falha na autorização Kick: ${errorMsg}`, 'triangle-alert');
    showKickModalError(errorMsg);
  }
}

// Acompanha a popup de OAuth enquanto ela estiver aberta: se ela for fechada
// (pelo usuário ou via window.close() no callback) sem nenhum resultado ter
// chegado ainda por postMessage/storage, revalida o perfil mesmo assim para
// não deixar o aviso "aguardando autorização" preso na tela.
function watchOAuthPopup(popup, pendingNoticeEl) {
  const pollTimer = setInterval(async () => {
    if (!popup || popup.closed) {
      clearInterval(pollTimer);
      // Dá uma pequena folga para o postMessage/storage (se já a caminho) processar primeiro.
      setTimeout(async () => {
        if (pendingNoticeEl) pendingNoticeEl.classList.add('hidden');
        if (!oauthResultHandled && state.token) {
          await loadUserProfile();
        }
      }, 400);
    }
  }, 500);
}

// Receptor de Mensagens da Janela Popup de OAuth (Twitch / Kick / Stream Providers)
//
// A checagem de origem não é formalidade: sem ela, qualquer página que consiga
// uma referência a esta janela (abrindo-a numa popup, por exemplo) podia mandar
// um TWITCH_AUTH_SUCCESS forjado e fazer o app anunciar "conta vinculada, status
// SUB confirmado" para uma conta que não existe. Nada disso muda o servidor,
// mas é uma tela convincente para enganar quem está olhando. Os callbacks que
// legitimamente postam aqui são servidos por este mesmo backend, então a origem
// é sempre a nossa.
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (!event.data || typeof event.data !== 'object') return;
  handleOAuthResult(event.data);
});

// Canal de reserva: a popup grava o resultado no localStorage antes de fechar
// (ver twitchCallback/kickCallback no backend), o que dispara 'storage' aqui
// nesta janela mesmo quando window.opener foi desvinculado pelo provedor.
window.addEventListener('storage', (event) => {
  if (event.key !== OAUTH_RESULT_STORAGE_KEY || !event.newValue) return;
  try {
    const data = JSON.parse(event.newValue);
    handleOAuthResult(data);
  } catch (e) {
    // valor inválido/corrompido no storage: ignora
  }
  try {
    localStorage.removeItem(OAUTH_RESULT_STORAGE_KEY);
  } catch (e) {}
});

function showToast(msg, iconName = null) {
  const t = document.createElement('div');
  t.className = 'toast-msg';
  // Sem isto o aviso e puramente visual: e a unica confirmacao de doacao,
  // compra, erro de login e resultado de voo, e leitores de tela nao anunciam
  // um <div> comum inserido no corpo. 'polite' espera a leitura em curso
  // terminar, em vez de interromper o usuario no meio de uma frase.
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.innerHTML = (iconName ? icon(iconName, 'icon-cyan') + ' ' : '') + escapeHtml(msg);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

/* ==========================================================================
   LOJINHA DO STREAMER & PAINEL DE MODERAÇÃO DOS DESENVOLVEDORES
   ========================================================================== */

async function loadStreamerRewards(filterType = null) {
  if (!state.currentChannel) return;
  const epoch = state.channelEpoch;

  try {
    const activeFilter = filterType !== null ? filterType : state.rewardFilter;
    const params = new URLSearchParams({ streamerId: state.currentChannel.id });
    if (activeFilter && activeFilter !== 'all') {
      params.set('type', activeFilter);
    }
    const res = await fetch(`${API_URL}/api/streamer-shop/catalog?${params.toString()}`);
    const data = await res.json();
    // Catálogo de um canal que o jogador já deixou não pode cobrir o atual.
    if (data.success && epoch === state.channelEpoch) {
      state.streamerRewards = data.data;
      renderStreamerRewards();
    }
  } catch (err) {
    console.error('Erro ao carregar catálogo da lojinha do streamer:', err);
  }
}

// Quantos brindes o catálogo mostra antes de precisar expandir. Oito preenche
// duas fileiras no grid mais comum sem transformar a lojinha num rolo infinito
// que empurra o resto da página (mural, ranking) para fora do alcance.
const REWARDS_VISIVEIS = 8;

function renderStreamerRewards() {
  const grid = document.getElementById('streamerRewardsGrid');
  if (!grid) return;

  let list = state.streamerRewards || [];
  if (state.rewardFilter === 'physical') {
    list = list.filter((r) => r.delivery_type === 'physical');
  } else if (state.rewardFilter === 'digital') {
    list = list.filter((r) => r.delivery_type === 'digital');
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(
      (r) =>
        (r.title && r.title.toLowerCase().includes(q)) ||
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.streamer_username && r.streamer_username.toLowerCase().includes(q))
    );
  }

  if (list.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-notice" style="grid-column: 1 / -1;">
        <p>Nenhum brinde encontrado no momento.</p>
        <p style="font-size: 12px; margin-top: 6px;">Streamers parceiros podem cadastrar novos brindes para aprovação dos desenvolvedores!</p>
      </div>
    `;
    renderRewardsToggle(0);
    return;
  }

  const total = list.length;
  if (!state.rewardsExpanded) {
    list = list.slice(0, REWARDS_VISIVEIS);
  }

  grid.innerHTML = list
    .map((reward) => {
      const isOutOfStock = reward.stock <= 0;
      const isLowStock = reward.stock > 0 && reward.stock <= 5;
      const deliveryLabel =
        reward.delivery_type === 'physical'
          ? `${icon('package', 'icon-sm')} FÍSICO`
          : `${icon('zap', 'icon-sm')} DIGITAL`;

      return `
      <article class="reward-card">
        <div class="reward-thumb-wrap">
          <img src="${rewardImageSrc(reward.image_url)}" alt="${escapeHtml(reward.title)}" class="reward-thumb" data-img-fallback />
          <span class="delivery-pill ${reward.delivery_type}">${deliveryLabel}</span>
        </div>
        <div class="reward-card-body">
          <div class="reward-streamer-line">
            <span>Canal: <strong class="reward-streamer-name">${escapeHtml(reward.streamer_username || 'nightpilot')}</strong></span>
            <span class="reward-stock-badge ${isLowStock ? 'low' : ''}">
              ${isOutOfStock ? 'ESGOTADO' : `${reward.stock} un.`}
            </span>
          </div>
          <div class="product-rating-row" title="Produto verificado">
            <span class="star-filled">${icon('star', 'icon-yellow')}</span>
            <span class="rating-score">5.0</span>
            <span class="rating-count">(Canal Oficial Aprovado)</span>
          </div>
          <h4 class="reward-title">${escapeHtml(reward.title)}</h4>
          <p class="reward-desc">${escapeHtml(reward.description)}</p>
          <div class="reward-footer">
            <span class="reward-price-val">${Number(reward.price_coins).toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}</span>
            <button class="redeem-btn" data-reward-id="${reward.id}" ${isOutOfStock ? 'disabled' : ''}>
              ${isOutOfStock ? 'Esgotado' : `${icon('gift', 'icon-sm')} Resgatar`}
            </button>
          </div>
        </div>
      </article>
    `;
    })
    .join('');

  renderRewardsToggle(total);
}

/**
 * Mostra o botão de expandir só quando há brinde escondido.
 *
 * O rótulo diz quantos faltam porque "Ver mais" sozinho não deixa claro se
 * sobraram dois brindes ou quarenta.
 */
function renderRewardsToggle(total) {
  const btn = document.getElementById('toggleRewardsCatalogBtn');
  const label = document.getElementById('toggleRewardsCatalogLabel');
  if (!btn || !label) return;

  const escondidos = total - REWARDS_VISIVEIS;
  if (escondidos <= 0) {
    btn.hidden = true;
    return;
  }

  btn.hidden = false;
  btn.setAttribute('aria-expanded', String(state.rewardsExpanded));
  label.textContent = state.rewardsExpanded
    ? 'Mostrar menos brindes'
    : `Ver catálogo completo (+${escondidos})`;

  const uso = btn.querySelector('use');
  if (uso) {
    uso.setAttribute(
      'href',
      `icons/sprite.svg#${state.rewardsExpanded ? 'chevron-up' : 'chevron-down'}`
    );
  }
}

function setupStreamerShopEvents() {
  const grid = document.getElementById('streamerRewardsGrid');
  const filterAllBtn = document.getElementById('filterAllRewardsBtn');
  const filterPhysicalBtn = document.getElementById('filterPhysicalRewardsBtn');
  const filterDigitalBtn = document.getElementById('filterDigitalRewardsBtn');
  const refreshBtn = document.getElementById('refreshStreamerShopBtn');

  // Filtros de Categoria
  if (filterAllBtn) {
    filterAllBtn.addEventListener('click', () => {
      state.rewardFilter = 'all';
      state.rewardsExpanded = false;
      filterAllBtn.classList.add('active');
      filterPhysicalBtn.classList.remove('active');
      filterDigitalBtn.classList.remove('active');
      renderStreamerRewards();
    });
  }

  if (filterPhysicalBtn) {
    filterPhysicalBtn.addEventListener('click', () => {
      state.rewardFilter = 'physical';
      state.rewardsExpanded = false;
      filterPhysicalBtn.classList.add('active');
      filterAllBtn.classList.remove('active');
      filterDigitalBtn.classList.remove('active');
      renderStreamerRewards();
    });
  }

  if (filterDigitalBtn) {
    filterDigitalBtn.addEventListener('click', () => {
      state.rewardFilter = 'digital';
      state.rewardsExpanded = false;
      filterDigitalBtn.classList.add('active');
      filterAllBtn.classList.remove('active');
      filterPhysicalBtn.classList.remove('active');
      renderStreamerRewards();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadStreamerRewards();
      showToast('Catálogo de brindes atualizado!');
    });
  }

  // Expandir / recolher o catálogo de brindes
  const toggleRewardsBtn = document.getElementById('toggleRewardsCatalogBtn');
  if (toggleRewardsBtn) {
    toggleRewardsBtn.addEventListener('click', () => {
      state.rewardsExpanded = !state.rewardsExpanded;
      renderStreamerRewards();
      // Ao recolher, devolve a vista ao topo da lojinha: sem isto o usuário
      // ficaria olhando para o espaço vazio que os cards removidos deixaram.
      if (!state.rewardsExpanded) {
        irParaSecao('streamerShopSection');
      }
    });
  }

  // Clique em "Resgatar" em algum card do catálogo
  if (grid) {
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.redeem-btn');
      if (btn && btn.dataset.rewardId) {
        const reward = (state.streamerRewards || []).find((r) => r.id === btn.dataset.rewardId);
        if (reward) openRedeemRewardModal(reward);
      }
    });
  }

  // Modal: Criar Brinde (Streamer Studio)
  const openCreateRewardBtn = document.getElementById('openCreateRewardBtn');
  const createRewardModal = document.getElementById('createRewardModal');
  const closeCreateRewardModal = document.getElementById('closeCreateRewardModal');
  const createRewardForm = document.getElementById('createRewardForm');
  const rewardImageFileInput = document.getElementById('rewardImageFileInput');
  const rewardImageUrlInput = document.getElementById('rewardImageUrlInput');
  const submitRewardBtn = document.getElementById('submitRewardBtn');

  // Elementos do Live Holographic Preview
  const livePreviewImg = document.getElementById('livePreviewImg');
  const livePreviewDeliveryPill = document.getElementById('livePreviewDeliveryPill');
  const livePreviewStreamer = document.getElementById('livePreviewStreamer');
  const livePreviewStock = document.getElementById('livePreviewStock');
  const livePreviewTitle = document.getElementById('livePreviewTitle');
  const livePreviewDesc = document.getElementById('livePreviewDesc');
  const livePreviewPrice = document.getElementById('livePreviewPrice');

  let currentUploadedImageDataUrl = '';

  const PRESET_REWARDS = {
    tshirt: {
      title: 'Camiseta Oficial Streamer 2026',
      delivery_type: 'physical',
      price: 1200,
      stock: 20,
      image_url:
        'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600&auto=format&fit=crop&q=80',
      description:
        'Camiseta 100% algodão penteado com estampa exclusiva da live. Enviada com rastreio para todo o Brasil.'
    },
    discord: {
      title: 'VIP Pass Permanente no Discord',
      delivery_type: 'digital',
      price: 600,
      stock: 50,
      image_url:
        'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80',
      description:
        'Cargo exclusivo de VIP no servidor oficial do Discord com acesso a salas exclusivas, sorteios e call com o streamer.'
    },
    cap: {
      title: 'Boné Gamer Snapback Neon',
      delivery_type: 'physical',
      price: 850,
      stock: 15,
      image_url:
        'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=600&auto=format&fit=crop&q=80',
      description:
        'Boné snapback premium com bordado holográfico em alta definição. Confortável, resistente e visual futurista.'
    },
    mug: {
      title: 'Caneca Térmica Pixel Art',
      delivery_type: 'physical',
      price: 450,
      stock: 30,
      image_url:
        'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&auto=format&fit=crop&q=80',
      description:
        'Caneca cerâmica resinada 325ml com arte retrofuturista de naves espaciais. Ideal para o café nas transmissões.'
    },
    steam: {
      title: 'Card Digital Steam R$ 50,00',
      delivery_type: 'digital',
      price: 2500,
      stock: 10,
      image_url:
        'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80',
      description:
        'Voucher digital com código de ativação oficial na plataforma Steam para resgate de saldo na carteira.'
    }
  };

  function updateLiveRewardPreview() {
    const title = document.getElementById('rewardTitleInput')?.value.trim() || 'Nome do Brinde';
    const delivery = document.getElementById('rewardDeliveryTypeSelect')?.value || 'physical';
    const price = Number(document.getElementById('rewardPriceInput')?.value) || 1200;
    const stock = Number(document.getElementById('rewardStockInput')?.value) || 15;
    const desc =
      document.getElementById('rewardDescInput')?.value.trim() ||
      'Descrição dos benefícios e envio do brinde...';
    // Vazio cai no placeholder local via rewardImageUrl, mais abaixo.
    const imgUrl =
      currentUploadedImageDataUrl ||
      document.getElementById('rewardImageUrlInput')?.value.trim() ||
      '';

    if (livePreviewTitle) livePreviewTitle.textContent = title;
    if (livePreviewPrice)
      livePreviewPrice.innerHTML = `${price.toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}`;
    if (livePreviewStock) livePreviewStock.textContent = `${stock} un.`;
    if (livePreviewDesc) livePreviewDesc.textContent = desc;
    if (livePreviewStreamer)
      livePreviewStreamer.textContent = `@${state.user?.username || 'nightpilot'}`;

    if (livePreviewDeliveryPill) {
      livePreviewDeliveryPill.innerHTML =
        delivery === 'physical'
          ? `${icon('package', 'icon-sm')} FÍSICO`
          : `${icon('zap', 'icon-sm')} DIGITAL`;
      livePreviewDeliveryPill.className = `delivery-pill ${delivery}`;
    }

    if (livePreviewImg) {
      // O elemento tem data-img-fallback: se a URL digitada não carregar, o
      // listener global troca pelo placeholder local, sem depender de um CDN
      // externo para mostrar a prévia.
      livePreviewImg.src = rewardImageUrl(imgUrl);
    }
  }
  window.updateLiveRewardPreview = updateLiveRewardPreview;

  function applyRewardPreset(presetKey) {
    const preset = PRESET_REWARDS[presetKey];
    if (!preset) return;

    const titleInput = document.getElementById('rewardTitleInput');
    const deliverySelect = document.getElementById('rewardDeliveryTypeSelect');
    const priceInput = document.getElementById('rewardPriceInput');
    const stockInput = document.getElementById('rewardStockInput');
    const descInput = document.getElementById('rewardDescInput');
    const urlInput = document.getElementById('rewardImageUrlInput');

    if (titleInput) titleInput.value = preset.title;
    if (deliverySelect) deliverySelect.value = preset.delivery_type;
    if (priceInput) priceInput.value = preset.price;
    if (stockInput) stockInput.value = preset.stock;
    if (descInput) descInput.value = preset.description;
    if (urlInput) urlInput.value = preset.image_url;
    currentUploadedImageDataUrl = '';

    updateLiveRewardPreview();
    showToast(`Preset "${preset.title}" aplicado!`, 'zap');
  }

  // Registra listeners nos inputs para Live Holographic Preview
  [
    'rewardTitleInput',
    'rewardDeliveryTypeSelect',
    'rewardPriceInput',
    'rewardStockInput',
    'rewardDescInput',
    'rewardImageUrlInput'
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateLiveRewardPreview);
      el.addEventListener('change', updateLiveRewardPreview);
    }
  });

  // Botões de Presets
  document.querySelectorAll('.preset-pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyRewardPreset(btn.dataset.preset));
  });

  if (openCreateRewardBtn) {
    openCreateRewardBtn.addEventListener('click', () => {
      createRewardModal?.classList.remove('hidden');
      updateLiveRewardPreview();
    });
  }

  if (closeCreateRewardModal) {
    closeCreateRewardModal.addEventListener('click', () => {
      createRewardModal?.classList.add('hidden');
    });
  }

  // Upload de Imagem com FileReader e Validação
  if (rewardImageFileInput) {
    rewardImageFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          showToast('A imagem deve ter no máximo 5MB', 'triangle-alert');
          return;
        }
        const reader = new FileReader();
        reader.onload = (evt) => {
          currentUploadedImageDataUrl = evt.target.result;
          if (rewardImageUrlInput) rewardImageUrlInput.value = '';
          updateLiveRewardPreview();
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Submissão do Formulário de Criação de Brinde
  if (createRewardForm) {
    createRewardForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.token) {
        showToast('Faça login como streamer para cadastrar brindes');
        return;
      }

      const title = document.getElementById('rewardTitleInput').value.trim();
      const delivery_type = document.getElementById('rewardDeliveryTypeSelect').value;
      const price_coins = Number(document.getElementById('rewardPriceInput').value);
      const stock = Number(document.getElementById('rewardStockInput').value);
      const description = document.getElementById('rewardDescInput').value.trim();

      let image_url =
        currentUploadedImageDataUrl ||
        (rewardImageUrlInput ? rewardImageUrlInput.value.trim() : '');
      if (!image_url) {
        // O backend exige URL http(s) ou data URI, então o placeholder precisa
        // ir como URL absoluta do próprio site — e não como caminho relativo.
        image_url = new URL(REWARD_PLACEHOLDER_IMG, window.location.origin).href;
      }

      if (submitRewardBtn) {
        submitRewardBtn.disabled = true;
        submitRewardBtn.innerHTML = `${icon('hourglass', 'icon-sm')} Enviando Brinde...`;
      }

      try {
        const res = await fetch(`${API_URL}/api/streamer-shop/rewards`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`
          },
          body: JSON.stringify({
            title,
            delivery_type,
            price_coins,
            stock,
            description,
            image_url
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          showToast(
            'Brinde enviado para fila de moderação dos Desenvolvedores!',
            'circle-check-big'
          );
          try {
            if (window.JetSound && typeof window.JetSound.playSuccessChime === 'function') {
              window.JetSound.playSuccessChime();
            }
          } catch (_) {}
          createRewardModal?.classList.add('hidden');
          createRewardForm.reset();
          currentUploadedImageDataUrl = '';

          await Promise.all([
            loadStreamerRewards(),
            loadStreamerDashboard(),
            loadModerationQueue()
          ]);
        } else {
          const errorMsg = data.message || `Erro ${res.status}: Falha ao cadastrar brinde`;
          showToast(`${errorMsg}`, 'triangle-alert');
          alert(errorMsg);
        }
      } catch (err) {
        console.error('Erro na requisição de cadastro de brinde:', err);
        const errMsg = err.message || 'Erro ao conectar ao servidor para enviar brinde';
        showToast(`${errMsg}`, 'triangle-alert');
        alert(errMsg);
      } finally {
        if (submitRewardBtn) {
          submitRewardBtn.disabled = false;
          submitRewardBtn.innerHTML = `${icon('rocket', 'icon-sm')} Enviar Brinde para Aprovação dos Desenvolvedores`;
        }
      }
    });
  }

  // Modal: Moderação dos Desenvolvedores
  const openModerationBtn = document.getElementById('openModerationBtn');
  const moderationModal = document.getElementById('moderationModal');
  const closeModerationModal = document.getElementById('closeModerationModal');
  const refreshModerationBtn = document.getElementById('refreshModerationBtn');

  if (openModerationBtn) {
    openModerationBtn.addEventListener('click', () => {
      moderationModal.classList.remove('hidden');
      loadModerationQueue();
    });
  }

  if (closeModerationModal) {
    closeModerationModal.addEventListener('click', () => {
      moderationModal.classList.add('hidden');
    });
  }

  if (refreshModerationBtn) {
    refreshModerationBtn.addEventListener('click', () => {
      loadModerationQueue();
      showToast('Fila de moderação atualizada!');
    });
  }

  // Abas de Filtro da Moderação
  document.querySelectorAll('.mod-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mod-tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.moderationFilter = btn.dataset.filter || 'pending';
      loadModerationQueue();
    });
  });

  // Modal: Resgate de Brinde
  const closeRedeemRewardModal = document.getElementById('closeRedeemRewardModal');
  const redeemRewardForm = document.getElementById('redeemRewardForm');

  if (closeRedeemRewardModal) {
    closeRedeemRewardModal.addEventListener('click', () => {
      document.getElementById('redeemRewardModal').classList.add('hidden');
    });
  }

  const closeRedeemSuccessBtn = document.getElementById('closeRedeemSuccessBtn');
  if (closeRedeemSuccessBtn) {
    closeRedeemSuccessBtn.addEventListener('click', () => {
      document.getElementById('redeemRewardModal').classList.add('hidden');
    });
  }

  const copyRedeemVoucherBtn = document.getElementById('copyRedeemVoucherBtn');
  if (copyRedeemVoucherBtn) {
    copyRedeemVoucherBtn.addEventListener('click', () => {
      const code = document.getElementById('redeemVoucherCode')?.textContent;
      if (code && code !== '---') {
        navigator.clipboard.writeText(code);
        showToast('Código de voucher copiado!');
      }
    });
  }

  if (redeemRewardForm) {
    redeemRewardForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!state.token) {
        showToast('Faça login para resgatar');
        return;
      }

      const rewardId = document.getElementById('redeemTargetRewardId').value;
      const recipient_name = document.getElementById('shippingNameInput').value.trim();
      const shipping_phone_el = document.getElementById('shippingPhoneInput');
      const recipient_phone = shipping_phone_el ? shipping_phone_el.value.trim() : '';
      const shipping_address = document.getElementById('shippingAddressInput').value.trim();

      const reward = (state.streamerRewards || []).find((r) => r.id === rewardId);
      if (reward && reward.delivery_type === 'physical') {
        if (!recipient_name || !shipping_address) {
          alert(
            'Para entrega física, preencha o nome completo do destinatário e endereço completo com CEP.'
          );
          return;
        }
      }

      try {
        const res = await fetch(`${API_URL}/api/streamer-shop/redeem`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.token}`
          },
          body: JSON.stringify({
            rewardId,
            recipient_name,
            recipient_phone,
            shipping_address: recipient_phone
              ? `${shipping_address} (Tel: ${recipient_phone})`
              : shipping_address
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          if (state.currentChannel?.id === data.streamerId) {
            loadChannelWallet();
            state.currentChannel.viewerWalletBalance = data.remainingBalance;
            const channelWalletBalanceEl = document.getElementById('channelWalletBalance');
            if (channelWalletBalanceEl)
              channelWalletBalanceEl.textContent = Number(data.remainingBalance).toLocaleString(
                'pt-BR'
              );
          }
          try {
            if (window.JetSound && typeof window.JetSound.playSuccessChime === 'function')
              window.JetSound.playSuccessChime();
          } catch (_) {}

          const successBlock = document.getElementById('redeemSuccessBlock');
          const voucherArea = document.getElementById('redeemVoucherArea');
          const voucherCodeEl = document.getElementById('redeemVoucherCode');
          const successMsgEl = document.getElementById('redeemSuccessMsg');

          if (successBlock) {
            redeemRewardForm.classList.add('hidden');
            successBlock.classList.remove('hidden');

            if (data.redemption.digital_code) {
              if (voucherArea) voucherArea.classList.remove('hidden');
              if (voucherCodeEl) voucherCodeEl.textContent = data.redemption.digital_code;
              if (successMsgEl)
                successMsgEl.textContent =
                  'Voucher digital gerado com sucesso! Utilize o código abaixo ou consulte em "Meus Resgates".';
            } else {
              if (voucherArea) voucherArea.classList.add('hidden');
              if (successMsgEl)
                successMsgEl.textContent =
                  'Pedido de envio físico registrado! O streamer postará o brinde e o código de rastreio aparecerá em "Meus Resgates".';
            }
          } else {
            document.getElementById('redeemRewardModal').classList.add('hidden');
          }

          showToast('Resgate efetuado com sucesso!', 'party-popper');

          await Promise.all([loadStreamerRewards(), loadUserProfile()]);
        } else {
          const errorMsg = data.message || `Erro ${res.status}: Falha ao resgatar brinde`;
          showToast(`${errorMsg}`, 'triangle-alert');
          alert(errorMsg);
        }
      } catch (err) {
        console.error('Erro na requisição de resgate de brinde:', err);
        const errMsg = err.message || 'Erro ao processar resgate';
        showToast(`${errMsg}`, 'triangle-alert');
        alert(errMsg);
      }
    });
  }

  // Modal: Meus Resgates
  const openMyRedemptionsBtn = document.getElementById('openMyRedemptionsBtn');
  const myRedemptionsModal = document.getElementById('myRedemptionsModal');
  const closeMyRedemptionsModal = document.getElementById('closeMyRedemptionsModal');

  if (openMyRedemptionsBtn) {
    openMyRedemptionsBtn.addEventListener('click', () => {
      myRedemptionsModal.classList.remove('hidden');
      loadMyRedemptions();
    });
  }

  if (closeMyRedemptionsModal) {
    closeMyRedemptionsModal.addEventListener('click', () => {
      myRedemptionsModal.classList.add('hidden');
    });
  }

  // Modal: Pedidos do Streamer
  const openStreamerOrdersBtn = document.getElementById('openStreamerOrdersBtn');
  const streamerOrdersModal = document.getElementById('streamerOrdersModal');
  const closeStreamerOrdersModal = document.getElementById('closeStreamerOrdersModal');

  if (openStreamerOrdersBtn) {
    openStreamerOrdersBtn.addEventListener('click', () => {
      streamerOrdersModal.classList.remove('hidden');
      loadStreamerOrders();
    });
  }

  if (closeStreamerOrdersModal) {
    closeStreamerOrdersModal.addEventListener('click', () => {
      streamerOrdersModal.classList.add('hidden');
    });
  }
}

/* ==========================================================================
   DIRETÓRIO DE STREAMERS & PÁGINA DO STREAMER (Fichas de Apoio + Roleta)
   ========================================================================== */
async function loadStreamerDirectory() {
  try {
    const res = await fetch(`${API_URL}/api/streamer/list`);
    const data = await res.json();
    if (data.success) {
      state.streamerList = data.data;
      renderStreamerDirectory();
    }
  } catch (err) {
    console.error('Erro ao carregar diretório de streamers:', err);
  }
}

function renderStreamerDirectory() {
  const grid = document.getElementById('streamerDirectoryGrid');
  if (!grid) return;

  const list = state.streamerList || [];
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty-state-notice">Nenhum streamer disponível no momento.</div>`;
    return;
  }

  grid.innerHTML = list
    .map((s) => {
      const safeUser = escapeHtml(s.username);
      const safeName = escapeHtml(s.name || s.username);
      return `
      <article class="streamer-directory-card" data-username="${safeUser}">
        <div class="streamer-directory-avatar">${icon('zap', 'icon-cyan icon-lg')}</div>
        <div class="streamer-directory-info">
          <h4>${safeName}</h4>
          <span class="streamer-directory-handle">@${safeUser}</span>
        </div>
        <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
          <button type="button" class="primary-btn open-channel-btn" data-username="${safeUser}" title="Jogar na Arena deste streamer">${icon('gamepad-2', 'icon-sm')} Jogar</button>
          <button type="button" class="secondary-btn open-shop-btn" data-username="${safeUser}" title="Ver Lojinha de Brindes">${icon('gift', 'icon-sm')} Lojinha</button>
        </div>
      </article>
    `;
    })
    .join('');
}

function openStreamerDirectoryModal() {
  const modal = document.getElementById('streamerDirectoryModal');
  if (modal) modal.classList.remove('hidden');
  loadStreamerDirectory();
}

function setupStreamerDirectoryEvents() {
  const navStreamersBtn = document.getElementById('navStreamersBtn');
  const openStreamerDirectoryBtn = document.getElementById('openStreamerDirectoryBtn');
  const closeStreamerDirectoryModal = document.getElementById('closeStreamerDirectoryModal');
  const modal = document.getElementById('streamerDirectoryModal');
  const grid = document.getElementById('streamerDirectoryGrid');

  if (navStreamersBtn) navStreamersBtn.addEventListener('click', openStreamerDirectoryModal);
  if (openStreamerDirectoryBtn)
    openStreamerDirectoryBtn.addEventListener('click', openStreamerDirectoryModal);
  if (closeStreamerDirectoryModal && modal) {
    closeStreamerDirectoryModal.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }

  if (grid) {
    grid.addEventListener('click', (e) => {
      const shopBtn = e.target.closest('.open-shop-btn');
      if (shopBtn && shopBtn.dataset.username) {
        if (modal) modal.classList.add('hidden');
        selectStreamer(shopBtn.dataset.username, true);
        return;
      }
      const cardOrBtn =
        e.target.closest('.open-channel-btn') || e.target.closest('.streamer-directory-card');
      if (cardOrBtn && cardOrBtn.dataset.username) {
        if (modal) modal.classList.add('hidden');
        selectStreamer(cardOrBtn.dataset.username, false);
      }
    });
  }
}

async function selectStreamer(username, shouldScrollToShop = false) {
  if (!username) return;
  if (state.isFlying) {
    showToast('Conclua a rodada antes de trocar de streamer');
    return;
  }
  const epoch = ++state.channelEpoch;
  // Reabrir o canal atual (restauração pós-login, clique repetido) não esvazia nada:
  // zerar aqui abria uma janela sem canal em que "Começar" era ignorado.
  const mesmoCanal =
    String(state.currentChannel?.username || '').toLowerCase() === String(username).toLowerCase();
  if (!mesmoCanal) {
    state.currentChannel = null;
    state.wallet = { balance: 0, currency_code: 'credits' };
    state.channelLives = 0;
    state.inventory = [];
    state.equippedByGame = {};
    renderUserStatus();
    renderInventory();
    updateInventoryBadge();
  }

  // Fecha o modal de diretório imediatamente para feedback instantâneo
  const modal = document.getElementById('streamerDirectoryModal');
  if (modal) modal.classList.add('hidden');

  // Se o usuário estiver na Landing Page (não autenticado ou explorando),
  // transiciona para o appRoot para poder visualizar os dados, jogos e lojinha do streamer
  if (appRoot && appRoot.classList.contains('hidden')) {
    showScreen('app');
    renderUserStatus();
    loadUserInventory();
    switchGameMode(state.currentGame || 'jet_launcher');
  }

  try {
    const headers = state.token ? { Authorization: `Bearer ${state.token}` } : {};
    const res = await fetch(`${API_URL}/api/streamer/${encodeURIComponent(username)}`, { headers });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || 'Erro ao carregar dados do streamer');
      return;
    }

    if (epoch !== state.channelEpoch) return;
    state.currentChannel = data.data;
    state.wallet = {
      balance: Number(data.data.viewerWalletBalance || 0),
      streamerId: data.data.id
    };
    state.channelLives = Number(data.data.viewerExtraLives || 0);
    renderUserStatus();
    await loadUserInventory();
    if (epoch !== state.channelEpoch) return;
    localStorage.setItem('livex_active_streamer', state.currentChannel.username);

    // Renderiza o cabeçalho do canal e status da roleta
    try {
      renderChannelHeader();
    } catch (e) {
      console.warn('Falha ao renderizar cabeçalho do streamer:', e);
    }

    try {
      renderRouletteStatus();
    } catch (e) {
      console.warn('Falha ao renderizar status da roleta:', e);
    }

    // Carrega catálogo de brindes específicos do streamer
    try {
      await loadStreamerRewards('all');
    } catch (e) {
      console.warn('Falha ao carregar brindes do streamer:', e);
    }

    // Monta o Mural Social de Doações deste canal
    try {
      if (window.DonationWall) window.DonationWall.mount();
    } catch (e) {
      console.warn('Falha ao montar o mural de doações:', e);
    }

    // Feedback visual para o usuário
    const displayName = state.currentChannel.name || state.currentChannel.username;
    showToast(`Canal de @${displayName} selecionado!`, 'video');

    if (shouldScrollToShop) {
      setTimeout(() => irParaSecao('streamerShopSection'), 120);
    } else {
      const gameSec =
        document.getElementById('gameZoneTitle') || document.getElementById('gameHubNav');
      if (gameSec && typeof gameSec.scrollIntoView === 'function') {
        setTimeout(() => {
          gameSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
    }
  } catch (err) {
    console.error('Erro ao selecionar streamer:', err);
    showToast('Erro ao carregar canal do streamer');
  }
}

async function openStreamerChannel(username) {
  await selectStreamer(username, false);
}

async function refreshCurrentChannel() {
  if (!state.currentChannel) return;
  const username = state.currentChannel.username;
  const epoch = state.channelEpoch;
  try {
    const headers = state.token ? { Authorization: `Bearer ${state.token}` } : {};
    const res = await fetch(`${API_URL}/api/streamer/${encodeURIComponent(username)}`, { headers });
    const data = await res.json();
    if (data.success) {
      if (epoch !== state.channelEpoch) return;
      state.currentChannel = data.data;
      await loadChannelWallet();
      renderChannelHeader();
      renderRouletteStatus();
    }
  } catch (err) {
    console.error('Erro ao atualizar canal do streamer:', err);
  }
}

function renderChannelHeader() {
  const channel = state.currentChannel;
  if (!channel) return;

  const displayName = channel.name || channel.username;
  const formattedBalance = Number(channel.viewerWalletBalance || 0).toLocaleString('pt-BR');

  // 1. Sidebar do Streamer Selecionado
  const sidebarName = document.getElementById('sidebarStreamerName');
  if (sidebarName) sidebarName.textContent = displayName;
  const userCoinsFormatted = Number(state.wallet.balance || 0).toLocaleString('pt-BR');
  const sidebarBalance = document.getElementById('sidebarStreamerFichasBalance');
  if (sidebarBalance) sidebarBalance.textContent = userCoinsFormatted;

  // 2. Seção da Lojinha no Conteúdo Central
  const mainName = document.getElementById('mainViewStreamerName');
  if (mainName) mainName.textContent = displayName;
  const mainBalance = document.getElementById('mainViewWalletBalance');
  if (mainBalance) mainBalance.textContent = userCoinsFormatted;

  const mainLivepix = document.getElementById('mainViewLivepixLink');
  const mainPixgg = document.getElementById('mainViewPixggLink');
  if (mainLivepix) mainLivepix.href = channel.donation_links ? channel.donation_links.livepix : '#';
  if (mainPixgg) mainPixgg.href = channel.donation_links ? channel.donation_links.pixgg : '#';

  // 3. Fallback para elementos de modal antigo (se existirem)
  const nameEl = document.getElementById('channelStreamerName');
  if (nameEl) nameEl.textContent = displayName;

  const badgesEl = document.getElementById('channelSubBadges');
  if (badgesEl) {
    const badges = [];
    if (channel.twitch_username)
      badges.push(
        `<span class="mini-stream-badge twitch" title="Twitch">${icon('link', 'icon-sm icon-purple')} ${escapeHtml(channel.twitch_username)}</span>`
      );
    if (channel.kick_username)
      badges.push(
        `<span class="mini-stream-badge kick" title="Kick">${icon('link', 'icon-sm icon-green')} ${escapeHtml(channel.kick_username)}</span>`
      );
    if (channel.role === 'admin')
      badges.push(`<span class="role-badge admin">OFICIAL LIVEX</span>`);
    badgesEl.innerHTML = badges.join('');
  }

  const walletEl = document.getElementById('channelWalletBalance');
  if (walletEl) walletEl.textContent = formattedBalance;

  const livepixLink = document.getElementById('channelLivepixLink');
  const pixggLink = document.getElementById('channelPixggLink');
  if (livepixLink) livepixLink.href = channel.donation_links ? channel.donation_links.livepix : '#';
  if (pixggLink) pixggLink.href = channel.donation_links ? channel.donation_links.pixgg : '#';
}

function renderRouletteStatus() {
  const channel = state.currentChannel;
  const statusTexts = [
    document.getElementById('mainViewRouletteStatusText'),
    document.getElementById('rouletteStatusText')
  ].filter(Boolean);
  const spinBtns = [
    document.getElementById('mainViewRouletteSpinBtn'),
    document.getElementById('rouletteSpinBtn')
  ].filter(Boolean);

  if (statusTexts.length === 0 && spinBtns.length === 0) return;

  const updateUI = (text, disabled, btnText) => {
    statusTexts.forEach((el) => {
      el.textContent = text;
    });
    spinBtns.forEach((el) => {
      el.disabled = disabled;
      el.innerHTML = btnText;
    });
  };

  if (!state.token) {
    updateUI(
      'Faça login para girar a roleta diária deste streamer!',
      true,
      `${icon('ferris-wheel', 'icon-sm')} Girar Roleta`
    );
    return;
  }

  const roulette = channel ? channel.viewerRoulette : null;
  if (!roulette || roulette.canSpin) {
    updateUI(
      'Gire uma vez por dia e ganhe Moedas (ou uma vida extra)!',
      false,
      `${icon('ferris-wheel', 'icon-sm')} Girar Roleta`
    );
    return;
  }

  // Texto puro: updateUI usa textContent, e o HTML do ícone aparecia como código.
  const prize = roulette.lastPrize;
  let prizeLabel = '';
  if (prize?.type === 'extra_life') prizeLabel = '+1 Vida Extra';
  else if (prize?.type === 'item') {
    const segmento = (roulette.segments || []).find((s) => s.itemId === prize.itemId);
    prizeLabel = segmento?.name || 'um item para a partida';
  } else if (prize) prizeLabel = `${prize.amount} Moedas`;
  updateUI(
    prizeLabel
      ? `Você já girou hoje e ganhou ${prizeLabel}! Volte amanhã para girar de novo.`
      : 'Você já girou hoje! Volte amanhã para girar de novo.',
    true,
    `${icon('circle-check-big', 'icon-sm')} Já Girou Hoje`
  );
}

async function loadRouletteStatus() {
  if (!state.currentChannel || !state.token) return;
  const epoch = state.channelEpoch;
  try {
    const res = await fetch(`${API_URL}/api/streamer/${state.currentChannel.id}/roulette/status`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success && epoch === state.channelEpoch) {
      state.currentChannel.viewerRoulette = data.data;
      if (cyberWheelInstance && data.data.segments) {
        cyberWheelInstance.setSegments(data.data.segments);
      }
      renderRouletteStatus();
    }
  } catch (err) {
    console.error('Erro ao consultar status da roleta:', err);
  }
}

let cyberWheelInstance = null;

function openCyberRouletteModal() {
  if (!state.token) {
    showToast('Faça login para girar a roleta diária e concorrer a prêmios!', 'key');
    openAuthModal('login');
    return;
  }
  if (!state.currentChannel) {
    showToast('Selecione um streamer para girar a roleta diária!', 'video');
    openStreamerDirectoryModal();
    return;
  }

  const modal = document.getElementById('cyberRouletteModal');
  if (!modal) return;

  const streamerTitle = document.getElementById('cyberRouletteStreamerTitle');
  const spinBtn = document.getElementById('cyberRouletteSpinActionBtn');
  const spinLabel = document.getElementById('cyberRouletteSpinActionLabel');
  const prizeOverlay = document.getElementById('cyberRoulettePrizeOverlay');

  if (prizeOverlay) prizeOverlay.classList.add('hidden');
  if (streamerTitle) {
    streamerTitle.innerHTML = `${icon('ferris-wheel', 'icon-sm')} Roleta Diária: ${escapeHtml(state.currentChannel.name || state.currentChannel.username)}`;
  }

  modal.classList.remove('hidden');

  // Inicializa o motor Canvas 2D se ainda não foi criado
  if (!cyberWheelInstance && window.CyberRouletteWheel) {
    cyberWheelInstance = new window.CyberRouletteWheel('cyberRouletteCanvas');
  }

  // Se já temos a lista de segmentos do backend, atualiza a roda
  const roulette = state.currentChannel.viewerRoulette;
  if (roulette && roulette.segments && cyberWheelInstance) {
    cyberWheelInstance.setSegments(roulette.segments);
  }

  // Atualiza estado do botão de ação
  if (roulette && !roulette.canSpin) {
    if (spinBtn) spinBtn.disabled = true;
    if (spinLabel)
      spinLabel.innerHTML = `${icon('circle-check-big', 'icon-sm')} JÁ GIROU HOJE (VOLTE AMANHÃ)`;
  } else {
    if (spinBtn) spinBtn.disabled = false;
    if (spinLabel) spinLabel.textContent = 'GIRAR ROLETA AGORA';
  }
}

function closeCyberRouletteModal() {
  const modal = document.getElementById('cyberRouletteModal');
  if (modal) modal.classList.add('hidden');
  const prizeOverlay = document.getElementById('cyberRoulettePrizeOverlay');
  if (prizeOverlay) prizeOverlay.classList.add('hidden');
}

async function executeCyberRouletteSpin() {
  if (!state.token || !state.currentChannel) return;
  if (!cyberWheelInstance || cyberWheelInstance.isSpinning) return;

  const spinBtn = document.getElementById('cyberRouletteSpinActionBtn');
  const spinLabel = document.getElementById('cyberRouletteSpinActionLabel');

  if (spinBtn) spinBtn.disabled = true;
  if (spinLabel) spinLabel.textContent = 'SORTEANDO...';

  try {
    const res = await fetch(`${API_URL}/api/streamer/${state.currentChannel.id}/roulette/spin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();

    if (!data.success) {
      showToast(data.message || 'Erro ao girar a roleta');
      if (spinBtn) spinBtn.disabled = false;
      if (spinLabel) spinLabel.textContent = 'GIRAR ROLETA AGORA';
      return;
    }

    const { prize, segmentIndex } = data.data;
    if (spinLabel) spinLabel.textContent = 'GIRANDO A RODA...';

    // Anima o giro com desaceleração e áudio sincronizado até o índice definido pelo servidor
    cyberWheelInstance.spinTo(segmentIndex, async (wonSegment) => {
      showPrizeCelebration(prize);

      // Atualiza perfis, inventários e moedas. O perfil é recarregado para
      // qualquer prêmio: é ele que traz o saldo da carteira única exibido no
      // topo. Só os prêmios de vida e de item o recarregavam, então quem ganhava
      // moedas via o saldo antigo até a próxima navegação.
      await loadUserProfile();
      if (prize.type === 'item' && typeof loadShopItems === 'function') {
        loadShopItems();
      }
      await refreshCurrentChannel();
      renderRouletteStatus();

      if (spinBtn) spinBtn.disabled = true;
      if (spinLabel) spinLabel.innerHTML = `${icon('circle-check-big', 'icon-sm')} JÁ GIROU HOJE`;
    });
  } catch (err) {
    console.error('Erro ao executar giro da roleta:', err);
    showToast('Erro de conexão ao girar a roleta');
    if (spinBtn) spinBtn.disabled = false;
    if (spinLabel) spinLabel.textContent = 'GIRAR ROLETA AGORA';
  }
}

function showPrizeCelebration(prize) {
  const overlay = document.getElementById('cyberRoulettePrizeOverlay');
  const iconEl = document.getElementById('cyberPrizeIcon');
  const title = document.getElementById('cyberPrizeName');
  const desc = document.getElementById('cyberPrizeDescription');
  const tag = document.getElementById('cyberPrizeTypeTag');

  if (!overlay) return;

  if (iconEl) iconEl.innerHTML = iconFromEmoji(prize.icon, 'gift', 'icon-xl icon-yellow');
  if (title) title.textContent = prize.name || 'Prêmio Conquistado!';

  if (desc) {
    if (prize.type === 'item') {
      desc.textContent = `Você conquistou um item especial para ${prize.game || 'seus jogos'}! Ele já está disponível no seu inventário para equipar e voar.`;
    } else if (prize.type === 'extra_life') {
      desc.textContent =
        'Você ganhou +1 Vida Extra! Seu limite diário foi recarregado para você continuar participando na live.';
    } else {
      desc.textContent = `Você ganhou ${prize.amount} Moedas! Elas foram adicionadas à sua carteira única para utilizar nos jogos ou nos resgates da lojinha!`;
    }
  }

  if (tag) {
    if (prize.type === 'item') {
      tag.textContent = `Item Raro • ${prize.game || 'Jogo'}`;
      tag.style.borderColor = '#ff705e';
      tag.style.color = '#ff705e';
    } else if (prize.type === 'extra_life') {
      tag.innerHTML = `${icon('heart')} Vida Extra`;
      tag.style.borderColor = '#ec4899';
      tag.style.color = '#ec4899';
    } else {
      tag.innerHTML = `${icon('coins')} Moedas LiveX`;
      tag.style.borderColor = '#fbbf24';
      tag.style.color = '#fbbf24';
    }
  }

  overlay.classList.remove('hidden');
}

function setupStreamerChannelEvents() {
  const closeStreamerChannelModal = document.getElementById('closeStreamerChannelModal');
  const modal = document.getElementById('streamerChannelModal');
  const rouletteSpinBtn = document.getElementById('rouletteSpinBtn');
  const mainViewRouletteSpinBtn = document.getElementById('mainViewRouletteSpinBtn');
  const sidebarChangeStreamerBtn = document.getElementById('sidebarChangeStreamerBtn');

  const closeCyberRouletteModalBtn = document.getElementById('closeCyberRouletteModalBtn');
  const cyberRouletteModal = document.getElementById('cyberRouletteModal');
  const cyberRouletteSpinActionBtn = document.getElementById('cyberRouletteSpinActionBtn');
  const cyberPrizeClaimBtn = document.getElementById('cyberPrizeClaimBtn');
  const canvas = document.getElementById('cyberRouletteCanvas');

  if (closeStreamerChannelModal && modal) {
    closeStreamerChannelModal.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }

  if (rouletteSpinBtn) {
    rouletteSpinBtn.addEventListener('click', openCyberRouletteModal);
  }
  if (mainViewRouletteSpinBtn) {
    mainViewRouletteSpinBtn.addEventListener('click', openCyberRouletteModal);
  }
  if (sidebarChangeStreamerBtn) {
    sidebarChangeStreamerBtn.addEventListener('click', openStreamerDirectoryModal);
  }

  if (closeCyberRouletteModalBtn) {
    closeCyberRouletteModalBtn.addEventListener('click', closeCyberRouletteModal);
  }
  if (cyberRouletteModal) {
    cyberRouletteModal.addEventListener('click', (e) => {
      if (e.target === cyberRouletteModal) closeCyberRouletteModal();
    });
  }
  if (cyberRouletteSpinActionBtn) {
    cyberRouletteSpinActionBtn.addEventListener('click', executeCyberRouletteSpin);
  }
  if (canvas) {
    canvas.addEventListener('click', executeCyberRouletteSpin);
  }
  if (cyberPrizeClaimBtn) {
    cyberPrizeClaimBtn.addEventListener('click', closeCyberRouletteModal);
  }
}

/* ==========================================================================
   CENTRAL DO CRIADOR (Candidatura a Streamer & Painel do Streamer)
   ========================================================================== */
function openCreatorHubModal() {
  const modal = document.getElementById('creatorHubModal');
  if (!modal || !state.user) return;
  modal.classList.remove('hidden');
  renderCreatorHubTabs();
}

function renderCreatorHubTabs() {
  const isStreamerOrAdmin =
    state.user && (state.user.role === 'streamer' || state.user.role === 'admin');
  const applyTab = document.getElementById('creatorHubApplyTab');
  const streamerTab = document.getElementById('creatorHubStreamerTab');
  const title = document.getElementById('creatorHubTitle');

  if (title)
    title.innerHTML = isStreamerOrAdmin
      ? `${icon('clapperboard', 'icon-sm')} Central do Criador`
      : `${icon('rocket', 'icon-sm')} Seja um Streamer LiveX`;
  if (applyTab) applyTab.classList.toggle('hidden', isStreamerOrAdmin);
  if (streamerTab) streamerTab.classList.toggle('hidden', !isStreamerOrAdmin);

  if (isStreamerOrAdmin) {
    loadStreamerDashboard();
  } else {
    loadMyStreamerApplications();
  }
}

async function loadMyStreamerApplications() {
  if (!state.token) return;
  try {
    const res = await fetch(`${API_URL}/api/streamer-applications/mine`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      state.myStreamerApplications = data.data;
      renderApplicationStatusCard();
    }
  } catch (err) {
    console.error('Erro ao carregar candidaturas do usuário:', err);
  }
}

function renderApplicationStatusCard() {
  const card = document.getElementById('applicationStatusCard');
  const form = document.getElementById('streamerApplicationForm');
  if (!card) return;

  const latest = (state.myStreamerApplications || [])[0];
  if (!latest) {
    card.classList.add('hidden');
    if (form) form.classList.remove('hidden');
    return;
  }

  const statusLabels = {
    pending: `${icon('hourglass', 'icon-sm')} Em análise pela equipe LiveX`,
    approved: `${icon('circle-check-big', 'icon-sm icon-green')} Aprovado! Sua Central do Criador já está liberada`,
    rejected: `${icon('circle-x', 'icon-sm icon-red')} Não aprovado desta vez`
  };

  card.classList.remove('hidden');
  card.innerHTML = `
    <span class="application-status-badge ${latest.status}">${statusLabels[latest.status] || latest.status}</span>
    <p style="margin-top:8px;">Canal: <strong>${escapeHtml(latest.channel_url)}</strong></p>
    ${latest.review_notes ? `<p style="margin-top:6px;font-size:12px;color:var(--text-muted);">${escapeHtml(latest.review_notes)}</p>` : ''}
    ${latest.status === 'rejected' ? '<p style="margin-top:6px;font-size:12px;">Você pode enviar uma nova candidatura quando quiser.</p>' : ''}
  `;

  // Se estiver pendente, oculta o formulário (já existe candidatura em análise);
  // se rejeitada, mantém o formulário visível para permitir reenvio.
  if (form) form.classList.toggle('hidden', latest.status === 'pending');
}

async function submitStreamerApplication(e) {
  e.preventDefault();
  if (!state.token) {
    showToast('Faça login para se candidatar');
    return;
  }

  const channelPlatform = document.getElementById('applicationPlatformSelect').value;
  const channelUrl = document.getElementById('applicationChannelUrlInput').value.trim();
  const pitch = document.getElementById('applicationPitchInput').value.trim();

  try {
    const res = await fetch(`${API_URL}/api/streamer-applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ channelPlatform, channelUrl, pitch })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Candidatura enviada para análise!', 'mail');
      try {
        if (window.JetSound && typeof window.JetSound.playSuccessChime === 'function')
          window.JetSound.playSuccessChime();
      } catch (_) {}
      document.getElementById('streamerApplicationForm').reset();
      await loadMyStreamerApplications();
    } else {
      showToast(data.message || 'Erro ao enviar candidatura');
    }
  } catch (err) {
    showToast('Erro ao enviar candidatura');
  }
}

async function loadStreamerDashboard() {
  if (!state.token) return;
  try {
    const res = await fetch(`${API_URL}/api/streamer/dashboard/me`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      state.streamerDashboard = data.data;
      renderStreamerDashboard();
    }
  } catch (err) {
    console.error('Erro ao carregar painel do criador:', err);
  }
}

function renderStreamerDashboard() {
  const dash = state.streamerDashboard;
  if (!dash) return;

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  setText('dashboardLivepixUrl', dash.livepix.webhookUrl);
  setText('dashboardLivepixSecret', dash.livepix.secret);
  setText('dashboardPixggUrl', dash.pixgg.webhookUrl);
  setText('dashboardPixggSecret', dash.pixgg.secret);
  setText(
    'dashboardRewardsCount',
    String(dash.rewardsCount || (dash.rewards ? dash.rewards.length : 0))
  );
  setText(
    'dashboardOrdersCount',
    String(dash.ordersCount || (dash.orders ? dash.orders.length : 0))
  );
  setText('dashboardPendingOrdersCount', String(dash.pendingOrdersCount || 0));

  // Renderiza listas de brindes e pedidos dentro do Studio
  if (dash.rewards) {
    renderStudioRewards(dash.rewards);
  }
  if (dash.orders) {
    renderStudioOrders(dash.orders);
  }

  // Badges e campos de credenciais de API
  const pixggBadge = document.getElementById('pixggConnectionBadge');
  if (pixggBadge) {
    if (dash.pixgg.connected) {
      pixggBadge.className = 'stream-status-pill connected';
      pixggBadge.innerHTML = `${icon('circle', 'icon-dot icon-green')} Conectado`;
    } else {
      pixggBadge.className = 'stream-status-pill disconnected';
      pixggBadge.innerHTML = `${icon('circle', 'icon-dot icon-muted')} Não configurado`;
    }
  }

  const livepixBadge = document.getElementById('livepixConnectionBadge');
  if (livepixBadge) {
    if (dash.livepix.connected) {
      livepixBadge.className = 'stream-status-pill connected';
      livepixBadge.innerHTML = `${icon('circle', 'icon-dot icon-green')} Conectado`;
    } else {
      livepixBadge.className = 'stream-status-pill disconnected';
      livepixBadge.innerHTML = `${icon('circle', 'icon-dot icon-muted')} Não configurado`;
    }
  }

  const pixggClientInput = document.getElementById('pixggClientIdInput');
  if (pixggClientInput && dash.pixgg.clientId) {
    pixggClientInput.value = dash.pixgg.clientId;
  }
  const livepixClientInput = document.getElementById('livepixClientIdInput');
  if (livepixClientInput && dash.livepix.clientId) {
    livepixClientInput.value = dash.livepix.clientId;
  }

  renderWallToggle(dash.wallEnabled !== false);
}

/**
 * Interruptor do Mural Social de Doações na Central do Criador.
 *
 * O listener é registrado uma vez só: renderStudioDashboard roda a cada abertura
 * do painel, e sem a marca o mesmo clique dispararia um PUT por abertura.
 */
function renderWallToggle(ligado) {
  const toggle = document.getElementById('wallEnabledToggle');
  if (!toggle) return;

  toggle.checked = ligado;
  const rotulo = document.getElementById('wallEnabledLabel');
  if (rotulo) rotulo.textContent = ligado ? 'Mural ligado' : 'Mural desligado';

  if (toggle.dataset.bound === 'true') return;
  toggle.dataset.bound = 'true';

  toggle.addEventListener('change', async () => {
    const desejado = toggle.checked;
    toggle.disabled = true;
    try {
      const res = await fetch(`${API_URL}/api/streamer/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
        body: JSON.stringify({ wallEnabled: desejado })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Falha ao salvar');

      const efetivo = data.data.wall_enabled !== false;
      renderWallToggle(efetivo);
      showToast(
        efetivo ? 'Mural de doações ligado no seu canal' : 'Mural de doações desligado',
        efetivo ? 'circle-check-big' : 'circle-x'
      );
    } catch (err) {
      console.error('Erro ao alternar o mural de doações:', err);
      // Sem rollback o interruptor mentiria: ficaria na posição nova com o
      // servidor ainda no valor antigo.
      toggle.checked = !desejado;
      showToast('Não foi possível salvar a configuração do mural', 'triangle-alert');
    } finally {
      toggle.disabled = false;
    }
  });
}

function renderStudioRewards(rewards) {
  const container = document.getElementById('studioRewardsListContainer');
  if (!container) return;
  if (!rewards || rewards.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 30px; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 8px;">
        <p style="margin: 0 0 10px 0; font-size: 14px;">Você ainda não cadastrou nenhum brinde para seus espectadores.</p>
        <button type="button" class="config-btn" data-action="open-create-reward">${icon('plus', 'icon-sm')} Criar Primeiro Brinde</button>
      </div>
    `;
    return;
  }

  container.innerHTML = rewards
    .map((r) => {
      const isApproved = r.status === 'approved';
      const isPending = r.status === 'pending';
      const statusLabel = isApproved
        ? `${icon('circle', 'icon-dot icon-green')} Aprovado`
        : isPending
          ? `${icon('hourglass', 'icon-sm')} Em Análise`
          : `${icon('circle', 'icon-dot icon-red')} Rejeitado`;
      const statusColor = isApproved
        ? 'rgba(0,255,157,0.15)'
        : isPending
          ? 'rgba(255,170,0,0.15)'
          : 'rgba(255,51,102,0.15)';
      const textColor = isApproved ? '#91ffb6' : isPending ? '#ffb454' : '#ff7f8d';

      return `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
          <strong style="color: #fff; font-size: 13px;">${escapeHtml(r.title)}</strong>
          <span style="background: ${statusColor}; color: ${textColor}; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; white-space: nowrap;">${statusLabel}</span>
        </div>
        <div style="font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between;">
          <span>${r.delivery_type === 'physical' ? `${icon('package', 'icon-sm')} Físico` : `${icon('zap', 'icon-sm')} Digital`}</span>
          <span style="color: var(--cyan); font-weight: bold;">${icon('coins', 'icon-cyan')} ${(Number(r.price_coins) || 0).toLocaleString('pt-BR')} Moedas</span>
        </div>
        <div style="font-size: 11px; color: #888;">Estoque: ${r.stock} un.</div>
      </div>
    `;
    })
    .join('');
}

function renderStudioOrders(orders) {
  const container = document.getElementById('studioOrdersListContainer');
  if (!container) return;
  if (!orders || orders.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 8px;">
        Nenhum pedido de resgate recebido até o momento.
      </div>
    `;
    return;
  }

  container.innerHTML = orders
    .map((ord) => {
      const isPhysical = ord.delivery_type === 'physical';
      return `
      <div class="streamer-order-card" style="margin-bottom: 10px;">
        <div class="order-header-line">
          <div>
            <strong style="font-family: var(--font-hud); color: #fff;">${escapeHtml(ord.reward_title)}</strong>
            <div style="font-size: 12px; color: var(--text-muted);">
              Ganhador: <strong style="color: var(--cyan);">${escapeHtml(ord.viewer_username)}</strong> &bull;
              ${new Date(ord.created_at).toLocaleString('pt-BR')}
            </div>
          </div>
          <span class="delivery-pill ${ord.delivery_type}" style="position: static;">
            ${isPhysical ? `${icon('package', 'icon-sm')} Físico` : `${icon('zap', 'icon-sm')} Digital`}
          </span>
        </div>
        ${
          isPhysical
            ? `
          <div style="background: #060d19; padding: 10px; border-radius: 6px; font-size: 12px; margin: 8px 0;">
            <div><strong>Destinatário:</strong> ${escapeHtml(ord.recipient_name || 'Não informado')}</div>
            <div style="margin-top: 4px;"><strong>Endereço:</strong> ${escapeHtml(ord.shipping_address || 'Não informado')}</div>
          </div>
          <div class="tracking-form-row">
            <input type="text" id="trackingInput_${ord.id}" placeholder="Código de rastreio Correios" value="${escapeHtml(ord.tracking_code || '')}" />
            <button class="config-btn" style="padding: 6px 12px; font-size: 11px;" data-action="update-order-tracking" data-id="${escapeHtml(ord.id)}">
              Salvar Rastreio / Despachar
            </button>
          </div>
        `
            : `
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">
            Voucher digital entregue: <code>${escapeHtml(ord.digital_code)}</code>
          </div>
        `
        }
      </div>
    `;
    })
    .join('');
}

async function verifyGatewayApi(provider) {
  if (!state.token) return;
  const clientIdInput = document.getElementById(`${provider}ClientIdInput`);
  const clientSecretInput = document.getElementById(`${provider}ClientSecretInput`);
  const statusBox = document.getElementById(`${provider}VerificationBox`);
  const badge = document.getElementById(`${provider}VerificationBadge`);

  const clientId = (clientIdInput?.value || '').trim();
  const clientSecret = (clientSecretInput?.value || '').trim();

  if (statusBox) {
    statusBox.className = 'verification-status-card untested';
    statusBox.innerHTML = `<span>${icon('hourglass', 'icon-sm')} Testando conexão com ${provider.toUpperCase()}...</span>`;
  }
  if (badge) {
    badge.className = 'stream-status-pill disconnected';
    badge.innerHTML = `${icon('hourglass', 'icon-sm')} Testando...`;
  }

  try {
    const res = await fetch(`${API_URL}/api/streamer/dashboard/verify-api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ provider, clientId, clientSecret })
    });
    const data = await res.json();
    if (data.success && data.data?.verified) {
      if (statusBox) {
        statusBox.className = 'verification-status-card verified';
        statusBox.innerHTML = `<span>${data.data.message || `${icon('circle-check-big', 'icon-green')} Conexão verificada com sucesso!`}</span>`;
      }
      if (badge) {
        badge.className = 'stream-status-pill connected';
        badge.innerHTML = `${icon('circle', 'icon-dot icon-green')} Verificado & Ativo`;
      }
      try {
        if (window.JetSound && typeof window.JetSound.playSuccessChime === 'function') {
          window.JetSound.playSuccessChime();
        } else if (window.JetSound && typeof window.JetSound.playCoinChime === 'function') {
          window.JetSound.playCoinChime();
        }
      } catch (_) {}
      showToast(`API ${provider.toUpperCase()} verificada e funcionando!`, 'circle-check-big');
    } else {
      const errMsg = data.data?.message || data.message || 'Falha na verificação das credenciais';
      if (statusBox) {
        statusBox.className = 'verification-status-card error';
        // Pode trazer o texto de erro do LivePix/PixGG: nunca vira HTML.
        statusBox.innerHTML = `<span>${escapeHtml(errMsg)}</span>`;
      }
      if (badge) {
        badge.className = 'stream-status-pill disconnected';
        badge.innerHTML = `${icon('circle', 'icon-dot icon-red')} Falha na Verificação`;
      }
      showToast(`Erro na verificação da ${provider.toUpperCase()}`);
    }
  } catch (err) {
    if (statusBox) {
      statusBox.className = 'verification-status-card error';
      statusBox.innerHTML = `<span>${icon('circle-x', 'icon-red')} Erro de conexão ao testar API: ${escapeHtml(err.message)}</span>`;
    }
    showToast('Erro de rede ao verificar API');
  }
}

async function saveGatewayApiCredentials(provider) {
  if (!state.token) return;
  const clientIdInput = document.getElementById(`${provider}ClientIdInput`);
  const clientSecretInput = document.getElementById(`${provider}ClientSecretInput`);

  const clientId = (clientIdInput?.value || '').trim();
  const clientSecret = (clientSecretInput?.value || '').trim();

  if (!clientId || !clientSecret) {
    showToast(`Preencha o Client ID e o Client Secret da ${provider.toUpperCase()}`);
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/streamer/dashboard/api-credentials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ provider, clientId, clientSecret })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || `API ${provider.toUpperCase()} conectada com sucesso!`);
      if (clientSecretInput) clientSecretInput.value = '';
      try {
        if (window.JetSound && typeof window.JetSound.playSuccessChime === 'function') {
          window.JetSound.playSuccessChime();
        } else if (window.JetSound && typeof window.JetSound.playCoinChime === 'function') {
          window.JetSound.playCoinChime();
        }
      } catch (_) {}
      await loadStreamerDashboard();
    } else {
      showToast(data.message || 'Erro ao conectar API');
    }
  } catch (err) {
    showToast('Erro ao conectar ao servidor para salvar credenciais');
  }
}

async function regenerateWebhookSecret(provider) {
  if (!state.token) return;
  if (
    !confirm(
      'Regenerar o segredo invalida a URL antiga imediatamente. Você precisará atualizar o webhook no painel do LivePix/PixGG. Continuar?'
    )
  )
    return;

  try {
    const res = await fetch(`${API_URL}/api/streamer/dashboard/regenerate-secret`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ provider })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Segredo regenerado! Atualize seu webhook no LivePix/PixGG.', 'refresh-cw');
      await loadStreamerDashboard();
    } else {
      showToast(data.message || 'Erro ao regenerar segredo');
    }
  } catch (err) {
    showToast('Erro ao regenerar segredo de webhook');
  }
}

function setupCreatorStudioTabs() {
  const tabBtns = document.querySelectorAll('.creator-studio-tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.studioTab;
      document.querySelectorAll('.studio-tab-panel').forEach((p) => p.classList.add('hidden'));

      if (target === 'gateways') {
        document.getElementById('studioPanelGateways')?.classList.remove('hidden');
      } else if (target === 'rewards') {
        document.getElementById('studioPanelRewards')?.classList.remove('hidden');
      } else if (target === 'orders') {
        document.getElementById('studioPanelOrders')?.classList.remove('hidden');
      } else if (target === 'simulator') {
        document.getElementById('studioPanelSimulator')?.classList.remove('hidden');
      }
    });
  });
}

function setupCreatorHubEvents() {
  const openCreatorHubBtn = document.getElementById('openCreatorHubBtn');
  const closeCreatorHubModal = document.getElementById('closeCreatorHubModal');
  const modal = document.getElementById('creatorHubModal');
  const form = document.getElementById('streamerApplicationForm');

  if (openCreatorHubBtn) openCreatorHubBtn.addEventListener('click', openCreatorHubModal);
  if (closeCreatorHubModal && modal) {
    closeCreatorHubModal.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }
  if (form) form.addEventListener('submit', submitStreamerApplication);

  // Botões de Salvar Credenciais
  const savePixggApiBtn = document.getElementById('savePixggApiBtn');
  if (savePixggApiBtn) {
    savePixggApiBtn.addEventListener('click', () => saveGatewayApiCredentials('pixgg'));
  }
  const saveLivepixApiBtn = document.getElementById('saveLivepixApiBtn');
  if (saveLivepixApiBtn) {
    saveLivepixApiBtn.addEventListener('click', () => saveGatewayApiCredentials('livepix'));
  }

  // Botões de Testar Conexão / Verificar Status
  const verifyPixggApiBtn = document.getElementById('verifyPixggApiBtn');
  if (verifyPixggApiBtn) {
    verifyPixggApiBtn.addEventListener('click', () => verifyGatewayApi('pixgg'));
  }
  const verifyLivepixApiBtn = document.getElementById('verifyLivepixApiBtn');
  if (verifyLivepixApiBtn) {
    verifyLivepixApiBtn.addEventListener('click', () => verifyGatewayApi('livepix'));
  }

  // Botões de Ação do Studio
  const studioOpenCreateRewardBtn = document.getElementById('studioOpenCreateRewardBtn');
  if (studioOpenCreateRewardBtn) {
    studioOpenCreateRewardBtn.addEventListener('click', () => {
      const createRewardModal = document.getElementById('createRewardModal');
      if (createRewardModal) {
        createRewardModal.classList.remove('hidden');
        if (typeof updateLiveRewardPreview === 'function') updateLiveRewardPreview();
      }
    });
  }

  // Inicializa Abas do Studio
  setupCreatorStudioTabs();

  if (modal) {
    modal.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('[data-copy-target]');
      if (copyBtn) {
        const el = document.getElementById(copyBtn.dataset.copyTarget);
        if (el) {
          navigator.clipboard.writeText(el.textContent);
          showToast('URL copiada!');
        }
        return;
      }
      const regenBtn = e.target.closest('[data-regen-provider]');
      if (regenBtn) {
        regenerateWebhookSecret(regenBtn.dataset.regenProvider);
      }
    });
  }
}

/* ==========================================================================
   MODERAÇÃO: ABAS DE ORIGEM (BRINDES x CANDIDATURAS DE STREAMER)
   ========================================================================== */
function setupModerationSourceTabs() {
  document.querySelectorAll('.mod-source-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mod-source-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.moderationSource = btn.dataset.source || 'rewards';
      loadModerationQueue();
    });
  });
}

async function loadApplicationsModerationQueue() {
  const listContainer = document.getElementById('moderationQueueList');
  const badge = document.getElementById('pendingCountBadge');
  if (!listContainer) return;

  try {
    const res = await fetch(
      `${API_URL}/api/admin/streamer-applications/queue?status=${state.moderationFilter}`,
      {
        headers: { Authorization: `Bearer ${state.token}` }
      }
    );
    const data = await res.json();
    if (data.success) {
      state.applicationsQueue = data.data;
      const allPending = (data.data || []).filter((i) => i.status === 'pending');
      if (badge) badge.textContent = allPending.length;
      renderApplicationsModerationQueue();
    }
  } catch (err) {
    console.error('Erro ao buscar fila de candidaturas de streamer:', err);
  }
}

function renderApplicationsModerationQueue() {
  const listContainer = document.getElementById('moderationQueueList');
  if (!listContainer) return;

  const items = state.applicationsQueue || [];
  if (items.length === 0) {
    listContainer.innerHTML = `<div class="empty-state-notice"><p>Nenhuma candidatura encontrada nesta aba.</p></div>`;
    return;
  }

  const platformLabels = { twitch: 'Twitch', kick: 'Kick', youtube: 'YouTube', other: 'Outra' };

  listContainer.innerHTML = items
    .map((item) => {
      const isPending = item.status === 'pending';
      const statusLabel =
        item.status === 'approved'
          ? `APROVADO ${icon('circle', 'icon-dot icon-green')}`
          : item.status === 'rejected'
            ? `REJEITADO ${icon('circle', 'icon-dot icon-red')}`
            : `PENDENTE ${icon('circle', 'icon-dot icon-yellow')}`;

      return `
      <div class="mod-card" data-application-id="${item.id}">
        <div class="mod-info">
          <div class="mod-header-row">
            <span class="status-pill ${item.status}">${statusLabel}</span>
            <span class="mod-meta">Candidato: <strong>${escapeHtml(item.applicant_username || 'usuário')}</strong></span>
            <span class="mod-meta">Plataforma: <strong>${platformLabels[item.channel_platform] || item.channel_platform}</strong></span>
          </div>
          <h4 class="mod-title"><a href="${escapeHtml(item.channel_url)}" target="_blank" rel="noopener">${escapeHtml(item.channel_url)}</a></h4>
          <p style="font-size: 13px; color: var(--text-muted); line-height: 1.4;">${escapeHtml(item.pitch)}</p>
          ${
            item.review_notes
              ? `
            <div class="mod-review-notes"><strong>Parecer da Moderação:</strong> ${escapeHtml(item.review_notes)}</div>
          `
              : ''
          }
        </div>
        <div class="mod-actions">
          ${
            isPending
              ? `
            <button class="mod-approve-btn" data-action="application-approve" data-id="${escapeHtml(item.id)}">${icon('check', 'icon-sm')} Aprovar Candidatura</button>
            <button class="mod-reject-btn" data-action="application-reject-toggle" data-id="${escapeHtml(item.id)}">${icon('x', 'icon-sm')} Rejeitar...</button>
          `
              : `
            <span style="font-size: 11px; color: var(--text-muted); text-align: center;">Auditado por ${escapeHtml(item.reviewer_username || 'Admin')}</span>
          `
          }
        </div>
        <div id="appRejectBox_${item.id}" class="mod-reject-box hidden">
          <label style="font-size: 11px; font-weight: bold; color: var(--red);">Motivo da rejeição:</label>
          <textarea id="appRejectReason_${item.id}" rows="2" placeholder="Explique por que a candidatura não foi aprovada..." style="background: #0b1522; border: 1px solid var(--border); color: #fff; padding: 6px; border-radius: 4px; font-size: 12px;"></textarea>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button class="ghost-btn" style="padding: 4px 10px; font-size: 11px;" data-action="application-reject-toggle" data-id="${escapeHtml(item.id)}">Cancelar</button>
            <button class="mod-reject-btn" style="padding: 4px 12px; font-size: 11px;" data-action="application-reject-submit" data-id="${escapeHtml(item.id)}">Confirmar Rejeição</button>
          </div>
        </div>
      </div>
    `;
    })
    .join('');
}

window.toggleAppRejectBox = function (applicationId) {
  const box = document.getElementById(`appRejectBox_${applicationId}`);
  if (box) box.classList.toggle('hidden');
};

window.submitApplicationRejection = async function (applicationId) {
  const textarea = document.getElementById(`appRejectReason_${applicationId}`);
  const notes = textarea ? textarea.value.trim() : '';
  if (!notes || notes.length < 5) {
    alert('A justificativa de rejeição é obrigatória (mínimo 5 caracteres).');
    return;
  }
  await handleApplicationModeration(applicationId, 'reject', notes);
};

window.handleApplicationModeration = async function (applicationId, action, notes = '') {
  if (!state.token) return;
  try {
    const res = await fetch(
      `${API_URL}/api/admin/streamer-applications/${applicationId}/moderate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.token}`
        },
        body: JSON.stringify({ action, notes })
      }
    );
    const data = await res.json();
    if (data.success) {
      window.JetSound.playCoinChime();
      showToast(
        action === 'approve' ? 'Streamer aprovado!' : 'Candidatura rejeitada.',
        action === 'approve' ? 'circle-check-big' : 'circle-x'
      );
      await loadApplicationsModerationQueue();
    } else {
      alert(data.message || 'Erro na moderação da candidatura');
    }
  } catch (err) {
    alert('Erro ao enviar ação de moderação');
  }
};

// Abre Modal de Resgate com dados do brinde
async function openRedeemRewardModal(reward) {
  state.selectedRewardForRedeem = reward;

  // Garante sincronização recente com o backend antes de exibir os saldos
  if (state.token) {
    await refreshCurrentChannel();
    await loadUserProfile();
  }

  const modal = document.getElementById('redeemRewardModal');
  const targetIdInput = document.getElementById('redeemTargetRewardId');
  const imgEl = document.getElementById('redeemItemImage');
  const nameEl = document.getElementById('redeemItemName');
  const streamerEl = document.getElementById('redeemItemStreamer');
  const costEl = document.getElementById('redeemItemCost');
  const delivEl = document.getElementById('redeemItemDelivery');
  const curBalEl = document.getElementById('redeemCurrentBalance');
  const postBalEl = document.getElementById('redeemPostBalance');
  const physicalFields = document.getElementById('physicalShippingFields');
  const digitalNotice = document.getElementById('digitalNoticeField');

  targetIdInput.value = reward.id;
  imgEl.src = rewardImageUrl(reward.image_url);
  nameEl.textContent = reward.title;
  streamerEl.textContent = `Canal: ${reward.streamer_username || 'nightpilot'}`;
  costEl.innerHTML = `${Number(reward.price_coins).toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}`;

  const isPhysical = reward.delivery_type === 'physical';
  delivEl.innerHTML = isPhysical
    ? `${icon('package', 'icon-sm')} Físico`
    : `${icon('zap', 'icon-sm')} Digital`;
  delivEl.className = `delivery-pill ${reward.delivery_type}`;

  if (physicalFields) physicalFields.classList.toggle('hidden', !isPhysical);
  if (digitalNotice) digitalNotice.classList.toggle('hidden', isPhysical);

  const currentBal = Number(state.wallet.balance || 0);
  const postBal = currentBal - Number(reward.price_coins);
  curBalEl.innerHTML = `${currentBal.toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}`;
  // Saldo insuficiente não vira saldo negativo: ninguém fica devendo moedas na
  // plataforma. Mostra quanto falta, que é a informação acionável.
  if (postBal < 0) {
    postBalEl.innerHTML = `Faltam ${Math.abs(postBal).toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}`;
    postBalEl.style.color = 'var(--red)';
  } else {
    postBalEl.innerHTML = `${postBal.toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}`;
    postBalEl.style.color = 'var(--green)';
  }

  const confirmBtn = document.getElementById('confirmRedeemBtn');
  if (confirmBtn) {
    confirmBtn.disabled = postBal < 0;
    confirmBtn.innerHTML =
      postBal < 0
        ? 'Moedas Insuficientes'
        : `${icon('gift', 'icon-sm')} Confirmar Resgate (${reward.price_coins} ${icon('coins', 'icon-yellow')})`;
  }

  // Reseta visualização do modal para o formulário
  const redeemForm = document.getElementById('redeemRewardForm');
  const successBlock = document.getElementById('redeemSuccessBlock');
  if (redeemForm) redeemForm.classList.remove('hidden');
  if (successBlock) successBlock.classList.add('hidden');

  modal.classList.remove('hidden');
}

// Carrega fila de moderação dos desenvolvedores
async function loadModerationQueue() {
  if (!state.token) return;

  if (state.moderationSource === 'applications') {
    return loadApplicationsModerationQueue();
  }

  const listContainer = document.getElementById('moderationQueueList');
  const badge = document.getElementById('pendingCountBadge');
  if (!listContainer) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/rewards/queue?status=${state.moderationFilter}`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      state.moderationQueue = data.data;

      // Atualiza badge de pendentes
      const allPending = (data.data || []).filter((i) => i.status === 'pending');
      if (badge) badge.textContent = allPending.length;

      renderModerationQueue();
    }
  } catch (err) {
    console.error('Erro ao buscar fila de moderação:', err);
  }
}

function renderModerationQueue() {
  const listContainer = document.getElementById('moderationQueueList');
  if (!listContainer) return;

  const items = state.moderationQueue || [];
  if (items.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state-notice">
        <p>Nenhum brinde encontrado nesta aba de auditoria.</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = items
    .map((item) => {
      const isPending = item.status === 'pending';
      const statusLabel =
        item.status === 'approved'
          ? `APROVADO ${icon('circle', 'icon-dot icon-green')}`
          : item.status === 'rejected'
            ? `REJEITADO ${icon('circle', 'icon-dot icon-red')}`
            : `PENDENTE ${icon('circle', 'icon-dot icon-yellow')}`;

      return `
      <div class="mod-card" data-reward-id="${item.id}">
        <img src="${rewardImageSrc(item.image_url)}" alt="${escapeHtml(item.title)}" class="mod-thumb" data-img-fallback />
        <div class="mod-info">
          <div class="mod-header-row">
            <span class="status-pill ${item.status}">${statusLabel}</span>
            <span class="delivery-pill ${item.delivery_type}" style="position: static;">${item.delivery_type === 'physical' ? `${icon('package', 'icon-sm')} Físico` : `${icon('zap', 'icon-sm')} Digital`}</span>
            <span class="mod-meta">Streamer: <strong>${escapeHtml(item.streamer_username || 'streamer')}</strong></span>
            <span class="mod-meta">Preço: <strong>${Number(item.price_coins).toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}</strong></span>
            <span class="mod-meta">Estoque: <strong>${item.stock} un.</strong></span>
          </div>
          <h4 class="mod-title">${escapeHtml(item.title)}</h4>
          <p style="font-size: 13px; color: var(--text-muted); line-height: 1.4;">${escapeHtml(item.description)}</p>
          ${
            item.review_notes
              ? `
            <div class="mod-review-notes">
              <strong>Parecer da Moderação:</strong> ${escapeHtml(item.review_notes)}
            </div>
          `
              : ''
          }
        </div>
        <div class="mod-actions">
          ${
            isPending
              ? `
            <button class="mod-approve-btn" data-action="reward-approve" data-id="${escapeHtml(item.id)}">
              ${icon('check', 'icon-sm')} Aprovar Brinde
            </button>
            <button class="mod-reject-btn" data-action="reward-reject-toggle" data-id="${escapeHtml(item.id)}">
              ${icon('x', 'icon-sm')} Rejeitar...
            </button>
          `
              : `
            <span style="font-size: 11px; color: var(--text-muted); text-align: center;">
              Auditado por ${escapeHtml(item.reviewer_username || 'Admin')}
            </span>
          `
          }
        </div>
        <div id="rejectBox_${item.id}" class="mod-reject-box hidden">
          <label style="font-size: 11px; font-weight: bold; color: var(--red);">Selecione ou digite o motivo da rejeição (Conformidade Legal):</label>
          <select id="presetRejectReason_${item.id}" style="background: #0b1522; border: 1px solid var(--border); color: #fff; padding: 6px; border-radius: 4px; font-size: 12px;" onchange="applyRejectPreset('${item.id}')">
            <option value="">-- Escolha uma justificativa padrão --</option>
            <option value="Violação da Lei nº 14.790/2023: Saldo de apostas/cassinos ou premiação monetária ilícita é expressamente proibido.">Violação de Lei (Apostas / Saldo de Cassino)</option>
            <option value="Arte com baixa resolução, inadequada ou sem licença comprovada.">Qualidade de Imagem Insuficiente</option>
            <option value="Descrição insuficiente dos materiais ou falta de detalhes para envio.">Descrição Incompleta do Produto</option>
            <option value="Preço em moedas desproporcional ao regulamento da plataforma.">Preço Fora das Diretrizes</option>
          </select>
          <textarea id="customRejectReason_${item.id}" rows="2" placeholder="Justificativa técnica detalhada para o streamer..." style="background: #0b1522; border: 1px solid var(--border); color: #fff; padding: 6px; border-radius: 4px; font-size: 12px;"></textarea>
          <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button class="ghost-btn" style="padding: 4px 10px; font-size: 11px;" data-action="reward-reject-toggle" data-id="${escapeHtml(item.id)}">Cancelar</button>
            <button class="mod-reject-btn" style="padding: 4px 12px; font-size: 11px;" data-action="reward-reject-submit" data-id="${escapeHtml(item.id)}">Confirmar Rejeição</button>
          </div>
        </div>
      </div>
    `;
    })
    .join('');
}

window.toggleRejectBox = function (rewardId) {
  const box = document.getElementById(`rejectBox_${rewardId}`);
  if (box) box.classList.toggle('hidden');
};

window.applyRejectPreset = function (rewardId) {
  const select = document.getElementById(`presetRejectReason_${rewardId}`);
  const textarea = document.getElementById(`customRejectReason_${rewardId}`);
  if (select && textarea && select.value) {
    textarea.value = select.value;
  }
};

window.submitRejection = async function (rewardId) {
  const textarea = document.getElementById(`customRejectReason_${rewardId}`);
  const notes = textarea ? textarea.value.trim() : '';

  if (!notes || notes.length < 5) {
    alert(
      'A justificativa de rejeição é obrigatória (mínimo 5 caracteres) para fins de compliance e auditoria.'
    );
    return;
  }

  await handleModerationAction(rewardId, 'reject', notes);
};

window.handleModerationAction = async function (rewardId, action, notes = '') {
  if (!state.token) return;

  try {
    const res = await fetch(`${API_URL}/api/admin/rewards/${rewardId}/moderate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ action, notes })
    });

    const data = await res.json();
    if (data.success) {
      window.JetSound.playCoinChime();
      showToast(
        action === 'approve'
          ? 'Brinde APROVADO para a lojinha!'
          : 'Brinde REJEITADO com justificativa gravada.',
        action === 'approve' ? 'circle-check-big' : 'circle-x'
      );
      await loadModerationQueue();
      await loadStreamerRewards();
    } else {
      alert(data.message || 'Erro na moderação');
    }
  } catch (err) {
    alert('Erro ao enviar ação de moderação');
  }
};

// Histórico de Resgates do Espectador
async function loadMyRedemptions() {
  if (!state.token) return;
  const container = document.getElementById('myRedemptionsList');
  if (!container) return;

  try {
    const res = await fetch(`${API_URL}/api/streamer-shop/my-redemptions`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      renderMyRedemptions(data.data || []);
    }
  } catch (err) {
    console.error('Erro ao buscar meus resgates:', err);
  }
}

function renderMyRedemptions(items) {
  const container = document.getElementById('myRedemptionsList');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state-notice">
        <p>Você ainda não resgatou nenhum brinde.</p>
        <p style="font-size: 12px; margin-top: 6px;">Junte moedas nas transmissões e escolha seus brindes na Lojinha Oficial!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = items
    .map((red) => {
      const isDigital = red.delivery_type === 'digital';
      const statusMap = {
        pending_fulfillment: `Aguardando Envio pelo Streamer ${icon('package', 'icon-sm')}`,
        shipped: `Enviado / Em Trânsito ${icon('truck', 'icon-sm')}`,
        completed: `Concluído / Entregue ${icon('circle-check-big', 'icon-sm icon-green')}`,
        cancelled: `Cancelado ${icon('circle-x', 'icon-sm icon-red')}`
      };

      return `
      <div class="redemption-card">
        <div class="order-header-line">
          <div>
            <strong style="font-family: var(--font-hud); color: #fff;">${escapeHtml(red.reward_title)}</strong>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">
              Canal: <strong style="color: var(--cyan);">${escapeHtml(red.streamer_username || 'streamer')}</strong> •
              Moedas gastas: <span style="color: var(--yellow); font-weight: bold;">${Number(red.coins_spent).toLocaleString('pt-BR')} ${icon('coins', 'icon-yellow')}</span> •
              Data: ${new Date(red.created_at).toLocaleDateString('pt-BR')}
            </div>
          </div>
          <span class="delivery-pill ${red.delivery_type}" style="position: static;">
            ${isDigital ? `${icon('zap', 'icon-sm')} Digital` : `${icon('package', 'icon-sm')} Físico`}
          </span>
        </div>

        <div style="font-size: 13px;">
          Status: <strong>${statusMap[red.status] || red.status}</strong>
        </div>

        ${
          isDigital && red.digital_code
            ? `
          <div class="order-code-display">
            <div>
              <span style="font-size: 11px; color: var(--text-muted); display: block;">Código do Voucher VIP:</span>
              <span class="order-code-text">${escapeHtml(red.digital_code)}</span>
            </div>
            <button class="secondary-btn copy-btn" data-action="copy" data-copy="${escapeHtml(red.digital_code)}" data-copy-msg="Código copiado!">
              Copiar
            </button>
          </div>
        `
            : ''
        }

        ${
          !isDigital && red.tracking_code
            ? `
          <div class="order-code-display">
            <div>
              <span style="font-size: 11px; color: var(--text-muted); display: block;">Código de Rastreio dos Correios:</span>
              <span class="order-code-text" style="color: var(--green);">${escapeHtml(red.tracking_code)}</span>
            </div>
            <button class="secondary-btn copy-btn" data-action="copy" data-copy="${escapeHtml(red.tracking_code)}" data-copy-msg="Código de rastreio copiado!">
              Copiar
            </button>
          </div>
        `
            : ''
        }
      </div>
    `;
    })
    .join('');
}

// Gestão de Pedidos para o Streamer
async function loadStreamerOrders() {
  if (!state.token) return;
  const container = document.getElementById('streamerOrdersList');
  if (!container) return;

  try {
    const res = await fetch(`${API_URL}/api/streamer-shop/orders`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      renderStreamerOrders(data.data || []);
    }
  } catch (err) {
    console.error('Erro ao carregar pedidos do streamer:', err);
  }
}

function renderStreamerOrders(orders) {
  const container = document.getElementById('streamerOrdersList');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="empty-state-notice">
        <p>Nenhum pedido de brinde recebido até o momento.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = orders
    .map((ord) => {
      const isPhysical = ord.delivery_type === 'physical';

      return `
      <div class="streamer-order-card">
        <div class="order-header-line">
          <div>
            <strong style="font-family: var(--font-hud); color: #fff;">${escapeHtml(ord.reward_title)}</strong>
            <div style="font-size: 12px; color: var(--text-muted);">
              Ganhador: <strong style="color: var(--cyan);">${escapeHtml(ord.viewer_username)}</strong> (${escapeHtml(ord.viewer_email)}) •
              Data: ${new Date(ord.created_at).toLocaleString('pt-BR')}
            </div>
          </div>
          <span class="delivery-pill ${ord.delivery_type}" style="position: static;">
            ${isPhysical ? `${icon('package', 'icon-sm')} Físico` : `${icon('zap', 'icon-sm')} Digital`}
          </span>
        </div>

        ${
          isPhysical
            ? `
          <div style="background: #060d19; padding: 10px; border-radius: 6px; font-size: 13px;">
            <div><strong>Destinatário:</strong> ${escapeHtml(ord.recipient_name || 'Não informado')}</div>
            <div style="margin-top: 4px;"><strong>Endereço de Envio:</strong> ${escapeHtml(ord.shipping_address || 'Não informado')}</div>
          </div>

          <div style="font-size: 13px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <span>Status Atual: <strong>${ord.status}</strong></span>
            ${ord.tracking_code ? `<span>Rastreio: <strong style="color: var(--green);">${escapeHtml(ord.tracking_code)}</strong></span>` : ''}
          </div>

          <div class="tracking-form-row">
            <input type="text" id="trackingInput_${ord.id}" placeholder="Informe o código de rastreamento (Ex: BR123456789BR)" value="${escapeHtml(ord.tracking_code || '')}" />
            <button class="config-btn" style="padding: 6px 14px; font-size: 12px;" data-action="update-order-tracking" data-id="${escapeHtml(ord.id)}">
              Salvar Rastreio / Marcar Enviado
            </button>
          </div>
        `
            : `
          <div style="font-size: 13px; color: var(--text-muted);">
            Voucher digital entregue automaticamente ao espectador: <code>${escapeHtml(ord.digital_code)}</code>
          </div>
        `
        }
      </div>
    `;
    })
    .join('');
}

window.updateOrderTracking = async function (redemptionId) {
  const input = document.getElementById(`trackingInput_${redemptionId}`);
  const tracking_code = input ? input.value.trim() : '';

  if (!tracking_code) {
    alert('Por favor, informe o código de rastreio.');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/streamer-shop/orders/${redemptionId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({
        status: 'shipped',
        tracking_code
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast('Código de rastreio salvo e pedido atualizado!');
      await loadStreamerOrders();
    } else {
      alert(data.message || 'Erro ao atualizar pedido');
    }
  } catch (err) {
    alert('Erro ao atualizar rastreamento');
  }
};

// Funções expostas no escopo global para acesso por atributos onclick e dev tools
window.selectStreamer = selectStreamer;
window.openStreamerChannel = openStreamerChannel;
window.openStreamerDirectoryModal = openStreamerDirectoryModal;

// ── Notificações: listeners do sino ─────────────────────────────────────
function initNotificationUI() {
  const bellBtn = document.getElementById('notifBellBtn');
  if (bellBtn) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNotificationCenter();
    });
  }

  const markAllBtn = document.getElementById('notifMarkAllBtn');
  if (markAllBtn) {
    markAllBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await fetch(`${API_URL}/api/notifications/read-all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${state.token}` }
        });
        loadUnreadNotifications();
        const lista = document.getElementById('notifList');
        if (lista)
          lista.querySelectorAll('.notif-item').forEach((el) => el.classList.remove('unread'));
      } catch (err) {
        /* silencioso */
      }
    });
  }

  // Clicar fora fecha o painel
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notifPanel');
    if (panel && panel.classList.contains('open') && !e.target.closest('.notif-bell-wrap')) {
      panel.classList.remove('open');
    }
  });
}

// Inicializa a aplicação
window.addEventListener('DOMContentLoaded', () => {
  initNotificationUI();
  init();
});

// Registra Service Worker para PWA
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[PWA] Falha ao registrar Service Worker:', err);
    });
  });
}
