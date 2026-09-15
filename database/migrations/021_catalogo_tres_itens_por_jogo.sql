-- Retira os excedentes de venda sem apagar compras, inventários ou replays.
UPDATE shop_items
SET is_active = false
WHERE game_id IN ('jet_launcher', 'neon_drifter', 'void_walker')
  AND id NOT IN (
    'nitro_booster', 'shield_deflector', 'extra_fuel',
    'nos_injection', 'drift_tires', 'emp_shield',
    'quantum_jump', 'plasma_shield', 'dark_matter'
  );
