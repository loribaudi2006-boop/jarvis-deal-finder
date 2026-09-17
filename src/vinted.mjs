// Vinted reader: fast JSON API access (same technique as Vinted-Deal-Finder).
// 1) hit the homepage to obtain anonymous session cookies
// 2) call the public catalog API with those cookies

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let cookieJar = "";

function baseHeaders(domain) {
  return {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "it-IT,it;q=0.9",
    Referer: `https://${domain}/catalog`,
  };
}

export async function initSession(domain) {
  const res = await fetch(`https://${domain}/`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(20000),
  });
  const raw = res.headers.getSetCookie?.() ?? [];
  const pairs = raw.map((c) => c.split(";")[0]).filter((c) => c.includes("=") && c.split("=")[1]);
  cookieJar = pairs.join("; ");
  if (!cookieJar.includes("access_token_web=eyJ"))
    throw new Error("Vinted: no usable session cookie obtained");
}

async function apiGet(domain, path) {
  const res = await fetch(`https://${domain}/api/v2${path}`, {
    headers: { ...baseHeaders(domain), Cookie: cookieJar },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 403) {
    await initSession(domain);
    const retry = await fetch(`https://${domain}/api/v2${path}`, {
      headers: { ...baseHeaders(domain), Cookie: cookieJar },
      signal: AbortSignal.timeout(20000),
    });
    if (!retry.ok) throw new Error(`Vinted API ${retry.status} on ${path}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`Vinted API ${res.status} on ${path}`);
  return res.json();
}

const num = (v) => (v == null ? null : typeof v === "object" ? Number(v.amount) : Number(v));

// Vinted's public JSON catalog API (/api/v2/catalog/items) was retired when the
// site moved to a Next.js/RSC frontend. Listings are now server-rendered into
// the catalog page HTML as an escaped JSON blob inside `self.__next_f.push(...)`
// chunks, so we fetch that page and pull the item array out of it.
function extractBalancedArray(s, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\") i++;
        i++;
      }
    }
  }
  return null;
}

function parseCatalogItems(html) {
  const re = /self\.__next_f\.push\((\[.*?\])\)\s*<\/script>/gs;
  let m;
  while ((m = re.exec(html))) {
    let arr;
    try {
      arr = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const txt = arr[1];
    if (typeof txt !== "string") continue;
    const marker = '"items":{"items":[';
    const idx = txt.indexOf(marker);
    if (idx === -1) continue;
    const arrText = extractBalancedArray(txt, idx + marker.length - 1);
    if (!arrText) continue;
    try {
      return JSON.parse(arrText);
    } catch {
      continue;
    }
  }
  return [];
}

async function fetchCatalogHtml(domain, params) {
  const res = await fetch(`https://${domain}/catalog?${params.toString()}`, {
    headers: { ...baseHeaders(domain), Cookie: cookieJar },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Vinted catalog page ${res.status}`);
  return res.text();
}

export async function searchItems(domain, { q, priceTo, perPage = 20 }) {
  const params = new URLSearchParams({ search_text: q, order: "newest_first" });
  if (priceTo) params.set("price_to", String(priceTo));
  const html = await fetchCatalogHtml(domain, params);
  const items = parseCatalogItems(html);
  return items.slice(0, perPage).map((entry) => {
    const it = entry.productItem;
    return {
      id: it.id,
      title: it.title,
      brand: it.itemBox?.firstLine || null,
      size: null,
      status: it.itemBox?.secondLine || null,
      price: num(it.price),
      totalItemPrice: num(it.totalItemPrice) ?? num(it.price),
      currency: it.price?.currencyCode || "EUR",
      photo: it.photos?.[0]?.url || it.thumbnailUrl || null,
      photoThumb: it.thumbnailUrl || it.photos?.[0]?.url || null,
      url: it.url ? `https://${domain}${it.url}` : `https://${domain}/items/${it.id}`,
      userId: it.user?.id ?? null,
      seller: { login: null, rating: null, count: null },
    };
  });
}

// seller reputation via the user endpoint (the /items/{id} API is gone)
export async function sellerInfo(domain, userId) {
  try {
    const data = await apiGet(domain, `/users/${userId}`);
    const u = data.user || {};
    return {
      login: u.login || null,
      rating: u.feedback_reputation ?? null, // 0..1
      count: u.feedback_count ?? u.positive_feedback_count ?? null,
      itemCount: u.item_count ?? null,
      city: u.city || null,
    };
  } catch {
    return {};
  }
}

// active-listing median for resale estimation
export async function activePrices(domain, q, priceTo) {
  const params = new URLSearchParams({ search_text: q, order: "relevance" });
  if (priceTo) params.set("price_to", String(priceTo * 4));
  const html = await fetchCatalogHtml(domain, params);
  return parseCatalogItems(html)
    .map((entry) => num(entry.productItem?.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}
