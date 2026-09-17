import { bytesParaBase64 } from './simWasm';

/** Chamadas ao ciclo de partida do backend. */

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string
  ) {
    super(mensagem);
  }
}

export type AberturaDePartida = {
  runId: string;
  gameId: string;
  streamerId?: string;
  gameCode: number;
  seed: string | null;
  simVersion: number;
  loadout: string;
  replayLog: string | null;
  items: Array<{ id: string; name: string; effect: string; activation: string; charges: number }>;
  maxTicks: number;
  expiresAt: string;
  commitment?: string | null;
  generatedResult?: {
    hash: string;
    score: number;
    baseScore: number;
    serverGenerated: boolean;
    scoreMultiplier: number;
    subscriberMultiplier?: number;
    ticks?: number;
  } | null;
};

export type ResultadoOficial = {
  runId: string;
  gameId: string;
  streamerId?: string;
  distance: number;
  score: number;
  peak: number;
  ticks: number;
  endReason: string;
  hash: string;
  clientHashMatches: boolean | null;
  coinsEarned: number;
  itemsUsed: string[];
  itemsReturned: string[];
  livesRemaining: number | null;
  subLivesRemaining: number;
  newBalance: number | null;
  channelLivesRemaining?: number;
  verifyMs: number;
};

async function post<T>(url: string, corpo: unknown): Promise<T> {
  // A sessão vai no cookie HttpOnly emitido no login; nenhum token passa pelo JS.
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo)
  });
  let dados: { success?: boolean; message?: string; data?: T };
  try {
    dados = await res.json();
  } catch {
    throw new ErroApi(res.status, 'Resposta inválida do servidor');
  }
  if (!res.ok || !dados.success) {
    throw new ErroApi(res.status, dados.message || 'Falha na comunicação com o servidor');
  }
  return dados.data as T;
}

export async function iniciarPartida(
  gameId: string,
  itemIds: string[] = [],
  streamerId?: string
): Promise<AberturaDePartida> {
  // Um requestId por clique. Se a rede cair antes da resposta, o servidor pode
  // já ter aberto (e cobrado) a rodada: repetir com o MESMO id devolve essa
  // rodada em vez de gastar outra vida. Resposta HTTP (ErroApi) não se repete.
  const corpo = { gameId, itemIds, streamerId, requestId: crypto.randomUUID() };
  try {
    return await post<AberturaDePartida>('/api/game/runs', corpo);
  } catch (erro) {
    if (erro instanceof ErroApi) throw erro;
    return post<AberturaDePartida>('/api/game/runs', corpo);
  }
}

export function revelarPartida(runId: string): Promise<AberturaDePartida> {
  return get(`/api/game/runs/${encodeURIComponent(runId)}/reveal`);
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const dados = await res.json();
  if (!res.ok || !dados.success)
    throw new ErroApi(res.status, dados.message || 'Falha ao revelar a rodada');
  return dados.data as T;
}

export function finalizarPartida(
  runId: string,
  log: Uint8Array,
  clientHash: string
): Promise<ResultadoOficial> {
  return post(`/api/game/runs/${encodeURIComponent(runId)}/finish`, {
    log: bytesParaBase64(log),
    clientHash
  });
}
