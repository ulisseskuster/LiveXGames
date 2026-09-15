-- ---------------------------------------------------------------------------
-- 013 - Colunas das URLs de doação do streamer
--
-- UserModel.updateStreamerSettings grava livepix_url e pixgg_url em public.users,
-- mas essas colunas nunca existiram no schema. O UPDATE falhava sempre, e o erro
-- caía num catch com o comentário "coluna pode não existir em schema legado,
-- fallback gracioso" — então o streamer configurava a própria URL de doação, via
-- a confirmação na tela, e o valor só vivia na cópia em memória: sumia no
-- próximo restart do servidor.
--
-- E mesmo antes disso a leitura já não funcionava: StreamerChannelController lê
-- `streamer.livepix_url`, mas nenhum SELECT do UserModel trazia essa coluna. O
-- valor era sempre undefined e o link caía no padrão montado a partir do
-- username. Ou seja, a personalização nunca chegou a aparecer para ninguém.
--
-- Adicionar as colunas (aqui) e incluí-las nos SELECTs (no UserModel) fecha os
-- dois lados. NULL continua significando "usa o padrão pelo username", que é o
-- comportamento que o controller já implementa.
-- ---------------------------------------------------------------------------

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS livepix_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pixgg_url TEXT;
