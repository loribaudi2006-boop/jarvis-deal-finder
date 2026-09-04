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

export async function searchItems(domain, { q, priceTo, perPage = 20 }) {
  const params = new URLSearchParams({
    search_text: q,
    order: "newest_first",
    per_page: String(perPage),
    page: "1",
  });
  if (priceTo) params.set("price_to", String(priceTo));
  const data = await apiGet(domain, `/catalog/items?${params.toString()}`);
  return (data.items || []).map((it) => ({
    id: it.id,
    title: it.title,
    brand: it.brand_title || null,
    size: it.size_title || null,
    status: it.status || null,
    price: num(it.price),
    totalItemPrice: num(it.total_item_price) ?? num(it.price),
    currency: it.currency || "EUR",
    photo: it.photo?.full_size_url || it.photo?.url || null,
    photoThumb:
      it.photo?.thumbnails?.find((t) => t.type === "thumb310")?.url ||
      it.photo?.url ||
      it.photo?.full_size_url ||
      null,
    url: it.url || `https://${domain}/items/${it.id}`,
    userId: it.user?.id ?? null,
    seller: {
      login: it.user?.login || null,
      rating: it.user?.feedback_reputation ?? null,
      count: it.user?.positive_feedback_count ?? it.user?.feedback_count ?? null,
    },
  }));
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
  const params = new URLSearchParams({
    search_text: q,
    order: "relevance",
    per_page: "40",
    page: "1",
  });
  if (priceTo) params.set("price_to", String(priceTo * 4));
  const data = await apiGet(domain, `/catalog/items?${params.toString()}`);
  return (data.items || [])
    .map((it) => num(it.price))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}
