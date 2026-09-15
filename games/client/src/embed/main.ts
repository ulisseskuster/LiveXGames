import { JogoJet } from '../jet_launcher/jogo';
import { JogoNeon } from '../neon_drifter/jogo';
import { JogoVoid } from '../void_walker/jogo';
import {
  ErroApi,
  finalizarPartida,
  iniciarPartida,
  revelarPartida,
  type AberturaDePartida,
  type ResultadoOficial
} from '../shell/runApi';
import { base64ParaBytes, type ResultadoSim } from '../shell/simWasm';

/**
 * Ponto de entrada dos jogos novos dentro do site (index.html → games/loader.js).
 *
 * O app.js é um script clássico sem build; ele conversa com os jogos só por
 * `window.LiveXJogos`. Aqui fica o ciclo de partida no servidor (abrir, jogar,
 * verificar); o app.js cuida do que é da Arena (vidas, carteira, debrief).
 */

export type VisualDoJogador = { assinante: boolean; lendario: boolean };

export type Desfecho = {
  valendo: boolean;
  local: ResultadoSim;
  /** Resultado do replay no servidor. null quando a partida não valia. */
  oficial: ResultadoOficial | null;
};

export type ControleDeJogo = {
  jogar(opcoes: {
    valendo: boolean;
    itemIds?: string[];
    streamerId?: string;
    userId?: string;
  }): Promise<Desfecho>;
  sair(): void;
  readonly emPartida: boolean;
  readonly temRender: boolean;
  destruir(): void;
};

const MIGRADOS = ['jet_launcher', 'neon_drifter', 'void_walker'];

// A abertura já consome a rodada. Falha de rede deve retomar o mesmo recibo.
function chavePendente(userId: string, streamerId: string, gameId: string): string {
  return `livex:pending:${userId}:${streamerId}:${gameId}`;
}
function temPendente(userId: string, streamerId: string, gameId: string): boolean {
  return Boolean(sessionStorage.getItem(chavePendente(userId, streamerId, gameId)));
}

function sementeLocal(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function montar(
  gameId: string,
  container: HTMLElement,
  visual: VisualDoJogador,
  opcoes: { forcarWebGL?: boolean } = {}
): Promise<ControleDeJogo> {
  const jogo =
    gameId === 'jet_launcher'
      ? await JogoJet.criar(container, visual, opcoes)
      : gameId === 'neon_drifter'
        ? await JogoNeon.criar(
            container,
            { ...visual, reduzirMovimento: matchMedia('(prefers-reduced-motion: reduce)').matches },
            opcoes.forcarWebGL
          )
        : gameId === 'void_walker'
          ? await JogoVoid.criar(
              container,
              {
                ...visual,
                reduzirMovimento: matchMedia('(prefers-reduced-motion: reduce)').matches
              },
              opcoes.forcarWebGL
            )
          : (() => {
              throw new Error(`Jogo ainda não migrado: ${gameId}`);
            })();

  return {
    async jogar({ valendo, itemIds = [], streamerId, userId }) {
      let abertura: AberturaDePartida | null = null;
      const chave = chavePendente(userId || '', streamerId || '', gameId);
      if (valendo) {
        if (!streamerId || !userId) throw new Error('Selecione um canal para jogar');
        const pendente = sessionStorage.getItem(chave);
        if (pendente)
          abertura = await revelarPartida(pendente).catch((err: unknown) => {
            // Rodada que o servidor não tem mais para mostrar: libera uma abertura nova.
            if (err instanceof ErroApi && [404, 409, 410].includes(err.status))
              sessionStorage.removeItem(chave);
            throw err;
          });
        else {
          const compromisso = await iniciarPartida(gameId, itemIds, streamerId);
          sessionStorage.setItem(chave, compromisso.runId);
          abertura = compromisso.commitment ? await revelarPartida(compromisso.runId) : compromisso;
        }
      }

      const fim = await jogo.jogar({
        semente: abertura?.seed || sementeLocal(),
        loadout: abertura ? abertura.loadout : '',
        replayLog: abertura?.replayLog || null,
        scoreMultiplier: abertura?.generatedResult?.scoreMultiplier || 1,
        subscriberMultiplier: abertura?.generatedResult?.subscriberMultiplier || 1,
        ticks: abertura?.generatedResult?.ticks
      });

      if (!abertura) return { valendo: false, local: fim.resultado, oficial: null };
      const logOficial = abertura.replayLog ? base64ParaBytes(abertura.replayLog) : fim.log;
      const hashOficial = abertura.generatedResult?.hash || fim.resultado.hash;
      const oficial = await finalizarPartida(abertura.runId, logOficial, hashOficial);
      sessionStorage.removeItem(chave);
      return { valendo: true, local: fim.resultado, oficial };
    },
    sair: () => jogo.sair(),
    get emPartida() {
      return jogo.emPartida;
    },
    get temRender() {
      return jogo.temRender;
    },
    destruir: () => jogo.destruir()
  };
}

const api = {
  versao: 1,
  suporta: (gameId: string) => MIGRADOS.includes(gameId),
  montar,
  temPendente,
  ErroApi
};

declare global {
  interface Window {
    LiveXJogos?: typeof api;
  }
}

window.LiveXJogos = api;
window.dispatchEvent(new Event('livex-jogos-pronto'));
