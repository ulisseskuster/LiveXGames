import { PainelDebug } from '../shell/debug';
import { Controles } from '../shell/input';
import { QualidadeAdaptativa, criarRenderer, nomeDoBackend } from '../shell/renderer';
import {
  ErroApi,
  finalizarPartida,
  iniciarPartida,
  type AberturaDePartida,
  type ResultadoOficial
} from '../shell/runApi';
import { SimHost, type FimDePartida } from '../shell/simHost';
import { bytesParaBase64 } from '../shell/simWasm';
import { CenaSandbox, R } from './cena';

const CODIGO_SANDBOX = 0;
const params = new URLSearchParams(location.search);

function elemento<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} ausente em sandbox.html`);
  return el as T;
}

const status = elemento<HTMLPreElement>('status');
const hud = elemento<HTMLDivElement>('hud');
const palco = elemento<HTMLCanvasElement>('palco');
const toque = elemento<HTMLDivElement>('toque');
const btnServidor = elemento<HTMLButtonElement>('jogarServidor');
const btnLocal = elemento<HTMLButtonElement>('jogarLocal');
const btnSair = elemento<HTMLButtonElement>('sair');

/** Ganchos lidos pelos testes e2e (e2e/simFundacao.spec.js). */
const janela = window as Window & { __simSelfTest?: unknown; __ultimoResultado?: unknown };

const controles = new Controles(toque);
let partida: SimHost | null = null;
let cena: CenaSandbox | null = null;
let qualidade: QualidadeAdaptativa | null = null;
let debug: PainelDebug | null = null;
let backend = 'sem render';

function escrever(texto: string): void {
  status.textContent = texto;
}

function sementeAleatoria(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Joga uma partida inteira com o bot da crate, sem relógio e sem render, e expõe
 * hash e log. O teste e2e compara com o mesmo cálculo feito pelo Node.
 */
async function autoTeste(): Promise<void> {
  const host = new SimHost();
  try {
    await host.preparar({
      codigoJogo: CODIGO_SANDBOX,
      semente: params.get('seed') ?? '00'.repeat(32),
      loadout: '',
      botSemente: Number(params.get('bot') ?? '7'),
      imediato: true
    });
    const fim = await host.terminou();
    const saida = {
      versao: fim.versao,
      hash: fim.resultado.hash,
      distancia: fim.resultado.distancia,
      ticks: fim.resultado.ticks,
      log: bytesParaBase64(fim.log)
    };
    janela.__simSelfTest = saida;
    escrever(`Autoteste concluído\n${JSON.stringify(saida, null, 2)}`);
  } catch (err) {
    janela.__simSelfTest = { erro: String(err) };
    escrever(`Autoteste falhou: ${String(err)}`);
  } finally {
    host.encerrar();
  }
}

function relatorio(fim: FimDePartida, oficial?: ResultadoOficial): string {
  const r = fim.resultado;
  const linhas = [
    oficial ? 'Partida verificada pelo servidor.' : 'Partida local (não vale moedas).',
    `Distância: ${r.distancia} m · Score: ${r.score} · Ticks: ${r.ticks} · Fim: ${r.motivoFim}`,
    `Hash local: ${r.hash}`
  ];
  if (oficial) {
    linhas.push(
      `Hash do servidor: ${oficial.hash} (${oficial.clientHashMatches ? 'confere' : 'DIVERGE'})`,
      `Moedas: +${oficial.coinsEarned} · Saldo: ${oficial.newBalance ?? '-'} · Vidas: ${oficial.livesRemaining ?? '-'}`,
      `Verificação: ${oficial.verifyMs} ms`
    );
  }
  return linhas.join('\n');
}

function atualizarHud(render: Float32Array): void {
  const cargas = [0, 1, 2]
    .map((i) => render[R.CARGAS + i])
    .filter((c) => c >= 0)
    .join('/');
  hud.textContent = [
    `Casco ${'■'.repeat(render[R.CASCO])}`,
    `Combustível ${render[R.COMBUSTIVEL].toFixed(0)}%`,
    `Velocidade ${render[R.VELOCIDADE].toFixed(1)}`,
    cargas ? `Cargas ${cargas}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function jogar(valendo: boolean): Promise<void> {
  if (partida) return;
  btnServidor.disabled = true;
  btnLocal.disabled = true;
  const host = new SimHost();
  partida = host;

  try {
    let abertura: AberturaDePartida | null = null;
    let semente = sementeAleatoria();
    let loadout = '';
    if (valendo) {
      escrever('Abrindo partida no servidor…');
      abertura = await iniciarPartida('sandbox');
      if (!abertura.seed) throw new Error('A semente do sandbox não foi revelada');
      semente = abertura.seed;
      loadout = abertura.loadout;
    }

    await host.preparar({ codigoJogo: CODIGO_SANDBOX, semente, loadout });
    controles.ativo = true;
    hud.hidden = false;
    btnSair.hidden = false;
    host.comecar();
    escrever(
      `Partida em andamento${valendo ? ' (valendo)' : ' (sem servidor)'} — A/D ou setas desviam, E usa item, Esc encerra.`
    );

    const fim = await host.terminou();
    controles.ativo = false;

    if (!abertura) {
      janela.__ultimoResultado = { local: fim.resultado };
      escrever(relatorio(fim));
      return;
    }

    escrever('Verificando a partida no servidor…');
    const oficial = await finalizarPartida(abertura.runId, fim.log, fim.resultado.hash);
    janela.__ultimoResultado = { local: fim.resultado, oficial };
    escrever(relatorio(fim, oficial));
  } catch (err) {
    const mensagem =
      err instanceof ErroApi
        ? `${err.message} (HTTP ${err.status})`
        : err instanceof Error
          ? err.message
          : String(err);
    escrever(`Falhou: ${mensagem}`);
  } finally {
    controles.ativo = false;
    hud.hidden = true;
    btnSair.hidden = true;
    host.encerrar();
    partida = null;
    btnServidor.disabled = false;
    btnLocal.disabled = false;
  }
}

let ultimoQuadro = performance.now();

function laco(agora: number): void {
  const ms = agora - ultimoQuadro;
  ultimoQuadro = agora;
  let tick = 0;

  if (partida) {
    const entrada = controles.ler();
    partida.definirEntrada(entrada.botoes, entrada.ax, entrada.ay);
    const quadro = partida.quadro(agora);
    if (quadro) {
      tick = quadro.tick;
      atualizarHud(quadro.atual);
      cena?.atualizar(quadro, agora);
    }
  }

  if (cena) {
    cena.desenhar();
    qualidade?.registrar(ms);
  }
  debug?.quadro({
    backend,
    tick,
    escala: qualidade ? qualidade.escalaAtual.toFixed(1) : '-',
    drawCalls: cena ? cena.drawCalls : 0
  });
  requestAnimationFrame(laco);
}

async function iniciar(): Promise<void> {
  if (params.has('selftest')) {
    await autoTeste();
    return;
  }

  if (params.has('debug')) debug = new PainelDebug(palco.parentElement ?? document.body);

  let pronto = true;
  try {
    const renderer = await criarRenderer(palco, params.has('webgl'));
    backend = nomeDoBackend(renderer);
    cena = new CenaSandbox(renderer, palco);
    await cena.aquecer();
    qualidade = new QualidadeAdaptativa(renderer);
  } catch (err) {
    // Sem GPU (máquina virtual, navegador headless) a simulação e a verificação
    // continuam funcionando — só não há o que ver.
    pronto = false;
    backend = 'indisponível';
    escrever(`Sem aceleração gráfica (${String(err)}). A simulação roda mesmo assim.`);
  }

  if (matchMedia('(pointer: coarse)').matches) toque.hidden = false;
  document.addEventListener('visibilitychange', () => partida?.pausar(document.hidden));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && partida) partida.sair();
  });
  btnServidor.addEventListener('click', () => void jogar(true));
  btnLocal.addEventListener('click', () => void jogar(false));
  btnSair.addEventListener('click', () => partida?.sair());
  btnServidor.disabled = false;
  btnLocal.disabled = false;

  if (pronto) escrever(`Pronto. Renderer: ${backend}.`);
  requestAnimationFrame(laco);
}

void iniciar();
