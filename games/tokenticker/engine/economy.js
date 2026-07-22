// Money is pure abstraction: prizes credit it, the shop debits it for
// compute (governor rate) via the COMPUTE_SHOP ladder. Models are free to
// use — their cost is speed (weight), not money. No real-dollar mapping —
// the ops cap in llm.js handles real spend.

import { COMPUTE_SHOP } from "./config.js";

export function itemPrice(item, purchases) {
  return Math.round(item.basePrice * Math.pow(item.growth, purchases));
}

export function shopFor(player) {
  return COMPUTE_SHOP.map((item) => {
    const owned = player.purchases[item.id] ?? 0;
    return {
      id: item.id,
      title: `${item.title} (+${item.gain} compute)`,
      price: itemPrice(item, owned),
      owned,
    };
  });
}

/** @returns {{ok: true} | {ok: false, error: string}} */
export function buy(player, itemId) {
  const item = COMPUTE_SHOP.find((i) => i.id === itemId);
  if (!item) return { ok: false, error: `unknown item ${itemId}` };
  const owned = player.purchases[item.id] ?? 0;
  const price = itemPrice(item, owned);
  if (player.money < price) return { ok: false, error: `need $${price}, have $${player.money}` };
  player.money -= price;
  player.purchases[item.id] = owned + 1;
  player.compute += item.gain;
  return { ok: true };
}
