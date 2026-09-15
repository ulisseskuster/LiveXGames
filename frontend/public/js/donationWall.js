/**
 * Mural Social de Doações.
 *
 * Vive fora do app.js (que já passa de 240 KB) pelo mesmo motivo do
 * js/cyberRoulette.js. Depende de globais definidos no app.js — `state`,
 * `API_URL`, `escapeHtml`, `icon`, `showToast` — e só os lê dentro das funções,
 * nunca no carregamento, porque este arquivo é servido antes do app.js.
 *
 * Regra inegociável deste arquivo: TODA string vinda do backend passa por
 * escapeHtml() antes de entrar em innerHTML. A mensagem de doação vem de webhook
 * externo, é conteúdo não confiável, e no mural ela fica pública e permanente —
 * não mais um flash no chat.
 */
(function () {
  const PAGE_SIZE = 20;

  const wall = {
    items: [],
    // Ranking "Maiores Doadores": uma linha por doador, não por doação. Fica
    // separado de `items` para o painel rolante continuar mostrando doações.
    donors: [],
    sort: 'recent',
    period: 'all',
    offset: 0,
    hasMore: false,
    loading: false
  };

  const ROTULOS_RANKING = {
    likes: 'Mais Amadas',
    dislikes: 'Mais Polêmicas',
    donors: 'Maiores Doadores'
  };

  const el = (id) => document.getElementById(id);

  function ehDonoDoCanal() {
    if (!state.user || !state.currentChannel) return false;
    return state.user.role === 'admin' || state.user.id === state.currentChannel.id;
  }

  function formatarBrl(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function badgeDoPapel(role) {
    if (role === 'subscriber') return '<span class="role-badge subscriber">SUB</span>';
    if (role === 'streamer') return '<span class="role-badge streamer">STREAMER</span>';
    if (role === 'admin') return '<span class="role-badge">ADMIN</span>';
    return '';
  }

  const quantasDoacoes = (n) => `${n} ${n === 1 ? 'doação' : 'doações'}`;

  // ─── Render ────────────────────────────────────────────────────────────────

  function cardHtml(item, posicao = null) {
    const curtido = item.myReaction === 'like';
    const descurtido = item.myReaction === 'dislike';
    const medalha = posicao !== null ? `<span class="wall-rank">${posicao + 1}º</span>` : '';

    const botaoRemover = ehDonoDoCanal()
      ? `<button type="button" class="wall-remove" data-action="remove"
           title="Remover esta mensagem do mural"
           aria-label="Remover a mensagem de ${escapeHtml(item.donor.username)} do mural">
           ${icon('trash-2', 'icon-sm')}
         </button>`
      : '';

    return `
      <article class="wall-card${curtido ? ' is-loved' : ''}" data-id="${escapeHtml(item.id)}">
        <header class="wall-card-head">
          ${medalha}
          <span class="wall-avatar">${icon('user', 'icon-cyan')}</span>
          <span class="wall-donor">
            <span class="wall-donor-name">${escapeHtml(item.donor.username)}</span>
            ${badgeDoPapel(item.donor.role)}
          </span>
          <span class="wall-amount">${escapeHtml(formatarBrl(item.amountBrl))}</span>
        </header>

        <blockquote class="wall-message">${escapeHtml(item.message)}</blockquote>

        <footer class="wall-card-actions">
          <button type="button" class="wall-react${curtido ? ' is-active' : ''}"
            data-action="like" aria-pressed="${curtido}"
            aria-label="Curtir. ${item.likesCount} ${item.likesCount === 1 ? 'curtida' : 'curtidas'}">
            ${icon('thumbs-up', 'icon-sm')}
            <span class="wall-count" data-count="like">${item.likesCount}</span>
          </button>

          <button type="button" class="wall-react wall-react-down${descurtido ? ' is-active' : ''}"
            data-action="dislike" aria-pressed="${descurtido}"
            aria-label="Descurtir. ${item.dislikesCount} ${item.dislikesCount === 1 ? 'descurtida' : 'descurtidas'}">
            ${icon('thumbs-down', 'icon-sm')}
            <span class="wall-count" data-count="dislike">${item.dislikesCount}</span>
          </button>

          ${botaoRemover}
        </footer>
      </article>
    `;
  }

  /** Linha do ranking de doadores: sem mensagem nem reações, só o total. */
  function doadorHtml(doador, posicao) {
    return `
      <article class="wall-card wall-donor-card">
        <header class="wall-card-head">
          <span class="wall-rank">${posicao + 1}º</span>
          <span class="wall-avatar">${icon('user', 'icon-cyan')}</span>
          <span class="wall-donor">
            <span class="wall-donor-name">${escapeHtml(doador.donor.username)}</span>
            ${badgeDoPapel(doador.donor.role)}
          </span>
          <span class="wall-amount">${escapeHtml(formatarBrl(doador.totalBrl))}</span>
        </header>
        <p class="wall-donor-count">${quantasDoacoes(doador.donationsCount)}</p>
      </article>
    `;
  }

  function renderPodio() {
    const podio = el('wallPodium');
    if (!podio) return;

    // O pódio só faz sentido num ranking: em "Recentes" ele destacaria três
    // doações por nada mais que terem chegado por último.
    const rotulo = ROTULOS_RANKING[wall.sort];
    const doadores = wall.sort === 'donors';
    const top = (doadores ? wall.donors : wall.items).slice(0, 3);

    if (!rotulo || top.length === 0) {
      podio.hidden = true;
      podio.innerHTML = '';
      return;
    }

    const contagem = (item) => (wall.sort === 'likes' ? item.likesCount : item.dislikesCount);

    // Ordem visual prata-ouro-bronze (2º, 1º, 3º), como pódio de verdade.
    const ordemVisual = [1, 0, 2].filter((i) => top[i]);
    const lugares = ['gold', 'silver', 'bronze'];

    podio.hidden = false;
    podio.innerHTML = `
      <h3 class="wall-podium-title">
        ${icon('trophy', 'icon-yellow')} Pódio: ${escapeHtml(rotulo)}
      </h3>
      <div class="wall-podium-row">
        ${ordemVisual
          .map((i) => {
            const item = top[i];
            const detalhe = doadores
              ? `<span class="wall-podium-msg">${quantasDoacoes(item.donationsCount)}</span>
                 <span class="wall-podium-amount">${escapeHtml(formatarBrl(item.totalBrl))}</span>`
              : `<span class="wall-podium-msg">${escapeHtml(item.message)}</span>
                 <span class="wall-podium-score">
                   ${icon(wall.sort === 'likes' ? 'thumbs-up' : 'thumbs-down', 'icon-sm')}
                   ${contagem(item)}
                 </span>
                 <span class="wall-podium-amount">${escapeHtml(formatarBrl(item.amountBrl))}</span>`;
            return `
              <div class="wall-podium-slot wall-podium-${lugares[i]}"${doadores ? '' : ` data-id="${escapeHtml(item.id)}"`}>
                <span class="wall-podium-medal">${icon('medal', 'icon-sm')} ${i + 1}º</span>
                <span class="wall-podium-name">${escapeHtml(item.donor.username)}</span>
                ${detalhe}
              </div>
            `;
          })
          .join('')}
      </div>
    `;
  }

  function render() {
    const feed = el('wallFeed');
    if (!feed) return;

    feed.setAttribute('aria-busy', String(wall.loading));

    const doadores = wall.sort === 'donors';
    const lista = doadores ? wall.donors : wall.items;

    if (lista.length === 0) {
      const vazio = doadores
        ? `${icon('trophy', 'icon-cyan')} Nenhum doador identificado neste período ainda.`
        : `${icon('message-square-quote', 'icon-cyan')} Nenhuma mensagem no mural ainda. Seja o primeiro a apoiar o canal com uma mensagem!`;
      feed.innerHTML = wall.loading
        ? '<p class="wall-empty">Carregando o mural...</p>'
        : `<p class="wall-empty">${vazio}</p>`;
    } else if (doadores) {
      // O pódio já mostra o top 3: a lista continua a partir do 4º lugar.
      feed.innerHTML = lista
        .slice(3)
        .map((doador, i) => doadorHtml(doador, i + 3))
        .join('');
    } else {
      // Num ranking o pódio já mostra o top 3: repeti-los no feed logo abaixo
      // seria a mesma doação duas vezes na mesma tela.
      const resto = ROTULOS_RANKING[wall.sort] ? lista.slice(3) : lista;
      feed.innerHTML = resto.map((item) => cardHtml(item)).join('');
    }

    renderPodio();
    renderTicker();

    const btn = el('wallLoadMoreBtn');
    if (btn) {
      btn.hidden = doadores || !wall.hasMore;
      btn.disabled = wall.loading;
    }
  }

  // ─── Painel de doações ao vivo (estilo placa de LED) ─────────────────────

  // Quantas doações entram na rotação. Poucas demais e a volta fica óbvia;
  // muitas e o ciclo demora tanto que o painel parece parado.
  const TICKER_MAX = 12;

  function itemTickerHtml(item) {
    const curtido = item.myReaction === 'like';
    const descurtido = item.myReaction === 'dislike';

    return `
      <span class="ticker-item" data-id="${escapeHtml(item.id)}">
        <span class="ticker-donor">${escapeHtml(item.donor.username)}</span>
        <span class="ticker-amount">${escapeHtml(formatarBrl(item.amountBrl))}</span>
        <span class="ticker-msg">${escapeHtml(item.message)}</span>
        <button type="button" class="ticker-react${curtido ? ' is-active' : ''}"
          data-action="like" aria-pressed="${curtido}"
          aria-label="Curtir a doação de ${escapeHtml(item.donor.username)}. ${item.likesCount} curtidas">
          ${icon('thumbs-up', 'icon-sm')}<span data-count="like">${item.likesCount}</span>
        </button>
        <button type="button" class="ticker-react ticker-react-down${descurtido ? ' is-active' : ''}"
          data-action="dislike" aria-pressed="${descurtido}"
          aria-label="Descurtir a doação de ${escapeHtml(item.donor.username)}. ${item.dislikesCount} descurtidas">
          ${icon('thumbs-down', 'icon-sm')}<span data-count="dislike">${item.dislikesCount}</span>
        </button>
      </span>
    `;
  }

  /**
   * Desenha a faixa rolante.
   *
   * O conteúdo é escrito DUAS vezes: a animação desloca a trilha em -50% e
   * volta ao início, então a segunda cópia é o que faz a emenda passar
   * despercebida. Com uma cópia só, a faixa esvaziaria a tela antes de repetir.
   *
   * A duração cresce com o número de itens para a velocidade de leitura ficar
   * constante — senão 3 doações passariam voando e 12 se arrastariam.
   */
  function renderTicker() {
    const painel = el('donationTicker');
    const trilha = el('donationTickerTrack');
    if (!painel || !trilha) return;

    const itens = wall.items.slice(0, TICKER_MAX);
    if (itens.length === 0) {
      painel.hidden = true;
      trilha.innerHTML = '';
      return;
    }

    painel.hidden = false;
    const bloco = itens.map(itemTickerHtml).join('');

    // Uma passada para medir quanto ocupa UM bloco.
    trilha.style.animation = 'none';
    trilha.innerHTML = bloco;
    const larguraBloco = trilha.scrollWidth;
    const larguraJanela = trilha.parentElement.clientWidth || 1;

    // Com tres doacoes o bloco fica menor que a janela e o loop mostraria um
    // buraco atravessando a tela. Repete o bloco ate cobrir a janela, e soma
    // uma copia extra: e ela que ja esta em posicao quando a volta acontece.
    const copias = Math.max(2, Math.ceil(larguraJanela / Math.max(larguraBloco, 1)) + 1);
    trilha.innerHTML = bloco.repeat(copias);

    // Desloca exatamente a largura de um bloco: no fim da animacao a copia
    // seguinte ocupa o pixel exato onde a anterior comecou, e a emenda some.
    trilha.style.setProperty('--ticker-deslocamento', `-${larguraBloco}px`);

    // Velocidade constante (~55px/s) em vez de duracao fixa: senao um bloco
    // curto passaria voando e um longo se arrastaria.
    trilha.style.setProperty('--ticker-duracao', `${Math.max(12, larguraBloco / 55)}s`);
    trilha.style.animation = '';
  }

  let tickerLigado = false;

  function aplicarPausaTicker(painel, btnPausa, pausado) {
    painel.classList.toggle('is-paused', pausado);
    if (btnPausa) {
      btnPausa.setAttribute('aria-pressed', String(pausado));
      btnPausa.title = pausado ? 'Retomar o painel' : 'Pausar o painel';
      const uso = btnPausa.querySelector('use');
      if (uso) uso.setAttribute('href', `icons/sprite.svg#${pausado ? 'play' : 'pause'}`);
    }
  }

  function tentarLerMensagemTicker(item) {
    const msg = item && item.querySelector('.ticker-msg');
    if (!msg || !('speechSynthesis' in window)) return;

    const texto = (msg.textContent || '').trim();
    if (!texto) return;

    window.speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(texto);
    fala.lang = 'pt-BR';
    fala.rate = 0.92;
    fala.pitch = 1;
    window.speechSynthesis.speak(fala);
  }

  function ligarTicker() {
    if (tickerLigado) return;
    tickerLigado = true;

    const painel = el('donationTicker');
    if (!painel) return;

    const btnPausa = el('tickerPauseBtn');

    // Delegação: a trilha é reescrita a cada atualização.
    painel.addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-action]');
      const item = ev.target.closest('.ticker-item');

      if (botao && item) {
        aplicarPausaTicker(painel, btnPausa, true);
        reagir(item.dataset.id, botao.dataset.action);
        return;
      }

      if (item) {
        aplicarPausaTicker(painel, btnPausa, true);
        tentarLerMensagemTicker(item);
      }
    });

    // Pausa manual, para quem navega por teclado ou quer ler com calma.
    if (btnPausa) {
      btnPausa.addEventListener('click', () => {
        const pausado = painel.classList.toggle('is-paused');
        aplicarPausaTicker(painel, btnPausa, pausado);
      });
    }
  }

  // ─── Rede ──────────────────────────────────────────────────────────────────

  function headersAuth() {
    return state.token ? { Authorization: `Bearer ${state.token}` } : {};
  }

  async function carregar({ append = false } = {}) {
    if (!state.currentChannel) return;
    if (wall.loading) return;

    const doadores = wall.sort === 'donors';
    wall.loading = true;
    if (doadores) {
      wall.donors = [];
    } else if (!append) {
      wall.offset = 0;
      wall.items = [];
    }
    render();

    try {
      const base = `${API_URL}/api/streamer/${state.currentChannel.id}/wall`;
      const url = doadores
        ? `${base}/top-donors?${new URLSearchParams({ period: wall.period, limit: String(PAGE_SIZE) })}`
        : `${base}?${new URLSearchParams({
            sort: wall.sort,
            period: wall.period,
            limit: String(PAGE_SIZE),
            offset: String(wall.offset)
          })}`;

      const res = await fetch(url, { headers: headersAuth() });
      const data = await res.json();

      if (!data.success) {
        // 403 aqui é o kill-switch do canal: some a seção inteira em vez de
        // deixar um mural vazio com cara de erro.
        if (res.status === 403) {
          const secao = el('donationWallSection');
          if (secao) secao.hidden = true;
          return;
        }
        throw new Error(data.message || 'Falha ao carregar o mural');
      }

      if (doadores) {
        wall.donors = data.data;
      } else {
        wall.items = append ? wall.items.concat(data.data.items) : data.data.items;
        wall.hasMore = Boolean(data.data.hasMore);
        wall.offset = wall.items.length;
      }
    } catch (err) {
      console.error('Erro ao carregar o mural de doações:', err);
      showToast('Não foi possível carregar o mural de doações', 'triangle-alert');
    } finally {
      wall.loading = false;
      render();
    }
  }

  /**
   * Atualiza um card sem redesenhar o feed inteiro.
   *
   * Redesenhar tudo perderia o foco do teclado no botão que acabou de ser
   * clicado, e faria a lista piscar a cada reação de outro espectador.
   */
  function aplicarContagem(donationId, { likesCount, dislikesCount, myReaction }) {
    const item = wall.items.find((i) => i.id === donationId);
    if (item) {
      item.likesCount = likesCount;
      item.dislikesCount = dislikesCount;
      if (myReaction !== undefined) item.myReaction = myReaction;
    }

    // A mesma doação aparece no card do mural E nas duas cópias do painel
    // rolante (a segunda cópia é o que emenda o loop). querySelectorAll, não
    // querySelector: atualizar só a primeira deixaria as outras mentindo.
    const alvos = document.querySelectorAll(
      `.wall-card[data-id="${CSS.escape(donationId)}"], .ticker-item[data-id="${CSS.escape(donationId)}"]`
    );

    alvos.forEach((alvo) => {
      const like = alvo.querySelector('[data-action="like"]');
      const dislike = alvo.querySelector('[data-action="dislike"]');
      if (!like || !dislike) return;

      like.querySelector('[data-count="like"]').textContent = likesCount;
      dislike.querySelector('[data-count="dislike"]').textContent = dislikesCount;
      like.setAttribute(
        'aria-label',
        `Curtir. ${likesCount} ${likesCount === 1 ? 'curtida' : 'curtidas'}`
      );
      dislike.setAttribute(
        'aria-label',
        `Descurtir. ${dislikesCount} ${dislikesCount === 1 ? 'descurtida' : 'descurtidas'}`
      );

      if (myReaction !== undefined) {
        like.classList.toggle('is-active', myReaction === 'like');
        dislike.classList.toggle('is-active', myReaction === 'dislike');
        like.setAttribute('aria-pressed', String(myReaction === 'like'));
        dislike.setAttribute('aria-pressed', String(myReaction === 'dislike'));
        alvo.classList.toggle('is-loved', myReaction === 'like');
      }
    });
  }

  async function reagir(donationId, type) {
    if (!state.token) {
      showToast('Faça login para reagir às doações do mural!', 'key');
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/api/streamer/${state.currentChannel.id}/wall/${donationId}/react`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headersAuth() },
          body: JSON.stringify({ type })
        }
      );
      const data = await res.json();

      if (!data.success) {
        showToast(data.message || 'Não foi possível registrar sua reação', 'triangle-alert');
        return;
      }

      // A resposta do POST é a fonte da verdade para quem clicou — não o socket,
      // que chega depois e faria o botão parecer travado.
      aplicarContagem(donationId, data.data);
    } catch (err) {
      console.error('Erro ao reagir no mural:', err);
      showToast('Não foi possível registrar sua reação', 'triangle-alert');
    }
  }

  async function remover(donationId) {
    try {
      const res = await fetch(
        `${API_URL}/api/streamer/${state.currentChannel.id}/wall/${donationId}`,
        { method: 'DELETE', headers: headersAuth() }
      );
      const data = await res.json();

      if (!data.success) {
        showToast(data.message || 'Não foi possível remover a mensagem', 'triangle-alert');
        return;
      }

      wall.items = wall.items.filter((i) => i.id !== donationId);
      render();
      showToast('Mensagem removida do mural', 'circle-check-big');
    } catch (err) {
      console.error('Erro ao remover mensagem do mural:', err);
      showToast('Não foi possível remover a mensagem', 'triangle-alert');
    }
  }

  // ─── Eventos ───────────────────────────────────────────────────────────────

  function marcarChipAtivo(grupo, botaoAtivo) {
    grupo.querySelectorAll('.wall-chip').forEach((b) => {
      const ativo = b === botaoAtivo;
      b.classList.toggle('is-active', ativo);
      b.setAttribute('aria-pressed', String(ativo));
    });
  }

  let ligado = false;

  function ligarEventos() {
    if (ligado) return;
    ligado = true;

    // Delegação: os cards são recriados a cada render, então o listener mora no
    // container e não em cada botão.
    const feed = el('wallFeed');
    if (feed) {
      feed.addEventListener('click', (ev) => {
        const botao = ev.target.closest('[data-action]');
        if (!botao) return;
        const card = botao.closest('.wall-card');
        if (!card) return;

        const id = card.dataset.id;
        const acao = botao.dataset.action;

        if (acao === 'remove') {
          remover(id);
        } else if (acao === 'like' || acao === 'dislike') {
          reagir(id, acao);
        }
      });
    }

    const sortGroup = el('wallSortFilters');
    if (sortGroup) {
      sortGroup.addEventListener('click', (ev) => {
        const botao = ev.target.closest('[data-sort]');
        if (!botao) return;
        wall.sort = botao.dataset.sort;
        marcarChipAtivo(sortGroup, botao);
        carregar();
      });
    }

    const periodGroup = el('wallPeriodFilters');
    if (periodGroup) {
      periodGroup.addEventListener('click', (ev) => {
        const botao = ev.target.closest('[data-period]');
        if (!botao) return;
        wall.period = botao.dataset.period;
        marcarChipAtivo(periodGroup, botao);
        carregar();
      });
    }

    const btn = el('wallLoadMoreBtn');
    if (btn) btn.addEventListener('click', () => carregar({ append: true }));

    ligarTicker();
  }

  // ─── API pública, consumida pelo app.js ────────────────────────────────────

  window.DonationWall = {
    /** Chamado quando um canal é selecionado. */
    mount() {
      const secao = el('donationWallSection');
      if (!secao || !state.currentChannel) return;

      // Com a Arena em abas, quem controla o `hidden` da seção é o setArenaView.
      // O kill-switch do canal age escondendo a ABA — se os dois mexessem no
      // mesmo atributo, um desfaria o outro a cada troca de aba.
      const aba = el('arenaTabMural');
      const desligado = state.currentChannel.wall_enabled === false;
      if (aba) aba.hidden = desligado;
      if (desligado) {
        secao.hidden = true;
        // A aba sumiu debaixo do usuário: devolve para a Arena.
        if (typeof setArenaView === 'function' && aba && aba.classList.contains('is-active')) {
          setArenaView('jogar');
        }
        return;
      }

      const nome = el('wallStreamerName');
      if (nome) {
        nome.textContent = state.currentChannel.name || state.currentChannel.username;
      }

      ligarEventos();
      carregar();
    },

    /**
     * Doação nova chegando pelo socket. Só entra no topo quando o mural está em
     * "Recentes": num ranking, empurrar uma doação sem reação nenhuma para o
     * primeiro lugar seria mentira. No ranking de doadores ela muda os totais,
     * então o ranking é recarregado.
     */
    onDonationReceived(data) {
      if (!state.currentChannel || data.streamerId !== state.currentChannel.id) return;
      if (wall.sort === 'donors') {
        carregar();
        return;
      }
      if (!data.donationId || !data.message) return;
      if (wall.sort !== 'recent' || wall.period !== 'all') return;

      wall.items.unshift({
        id: data.donationId,
        donor: {
          id: data.userId || null,
          username: data.username || 'Apoiador Anônimo',
          role: null,
          anonymous: !data.userId
        },
        amountBrl: Number(data.amountBrl) || 0,
        message: data.message,
        likesCount: 0,
        dislikesCount: 0,
        myReaction: null,
        createdAt: data.timestamp || new Date().toISOString()
      });
      wall.offset = wall.items.length;
      render();
    },

    /** Reação de OUTRO espectador: atualiza só os contadores deste card. */
    onReactionUpdated(data) {
      if (!state.currentChannel || data.streamerId !== state.currentChannel.id) return;
      aplicarContagem(data.donationId, {
        likesCount: data.likesCount,
        dislikesCount: data.dislikesCount
      });
    },

    /** O streamer removeu uma mensagem: some da tela de todo mundo. */
    onRemoved(data) {
      if (!state.currentChannel || data.streamerId !== state.currentChannel.id) return;
      const antes = wall.items.length;
      wall.items = wall.items.filter((i) => i.id !== data.donationId);
      if (wall.items.length !== antes) render();
    }
  };
})();
