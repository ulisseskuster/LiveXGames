// Gerado por scripts/build-games.js. Registra o carregador dos jogos novos;
// o bundle só é baixado quando a Arena chama window.LiveXJogosCarregar().
window.LiveXJogosCarregar = () => import('./assets/embed-C-_kRfiy.js');
window.dispatchEvent(new Event('livex-jogos-carregador'));
