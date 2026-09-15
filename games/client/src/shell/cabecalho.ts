/**
 * Cabeçalho do buffer de render, igual nos três jogos: os 28 primeiros campos que
 * cada jogo escreve em `render()` na crate (games/sim/src/games). Campo que um jogo
 * não usa vem zerado; os nomes próprios de cada jogo ficam no estado.ts dele.
 * Mudou lá, muda aqui.
 *
 * O buffer é plano (Float32Array) porque atravessa o postMessage do worker sem
 * cópia de objeto por entidade.
 */
export const H = {
  X: 0,
  Y: 1,
  Z: 2,
  VELOCIDADE: 3,
  CASCO: 4,
  COMBUSTIVEL: 5,
  FASE: 6,
  ROLAGEM: 7,
  RECARGA_ROLAGEM: 8,
  INVULNERAVEL: 9,
  BOOST: 10,
  BULLET_TIME: 11,
  ESCALA_TEMPO: 12,
  VX: 13,
  VY: 14,
  SCORE: 15,
  ANEIS: 16,
  /** Máscara de bits: evento N ligado = bit N (códigos EV_* de cada jogo). */
  EVENTOS: 17,
  SELECIONADO: 18,
  CARGAS: 19,
  ALTITUDE: 22,
  AVISO_MISSIL: 23,
  PLANEIO: 24,
  TEMPO_MUNDO: 25,
  BOOST_ANEL: 26,
  FLARES: 27,
  FIM_CABECALHO: 28
} as const;

export function temEvento(render: Float32Array, evento: number): boolean {
  return ((render[H.EVENTOS] >>> 0) & (1 << evento)) !== 0;
}
