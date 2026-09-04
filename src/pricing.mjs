// Profit math for a candidate Vinted listing.

export function buyerProtection(itemPrice, cfg) {
  return +(itemPrice * cfg.buyerProtectionRate + cfg.buyerProtectionFixedEUR).toFixed(2);
}

function median(sorted) {
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// resale estimate from active-listing prices (they sit above true market -> apply factor)
export function resaleFromActive(prices, resaleCfg) {
  if (prices.length < resaleCfg.minComparables) return null;
  // conservative "quick flip" price: a low percentile of active listings,
  // discounted further (active listings sit above what actually sells fast).
  const pct = resaleCfg.activePercentile ?? 0.3;
  const p = prices[Math.floor(prices.length * pct)];
  return p == null ? null : +(p * resaleCfg.activeMedianFactor).toFixed(2);
}

export function evaluate(item, detail, resaleEUR, cfg) {
  const vintedCfg = cfg.vinted;
  const itemPrice = item.price;
  const protection = buyerProtection(itemPrice, vintedCfg);
  const shipping = detail.shipping ?? vintedCfg.defaultShippingEUR;
  const buyTotal = +(itemPrice + protection + shipping).toFixed(2);

  if (resaleEUR == null) return { ok: false, reason: "no_resale_estimate" };

  const margin = +(resaleEUR - buyTotal).toFixed(2);
  return {
    ok: margin >= cfg.minProfitEUR,
    itemPrice,
    protection,
    shipping,
    buyTotal,
    resaleEUR,
    margin,
  };
}
