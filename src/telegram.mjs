const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

export async function sendPhoto(photoUrl, caption) {
  const body = {
    chat_id: CHAT_ID,
    photo: photoUrl,
    caption: caption.slice(0, 1024),
    parse_mode: "HTML",
  };
  let res = await fetch(api("sendPhoto"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    // fallback: photo rejected -> send as text
    await sendMessage(caption + (photoUrl ? `\n\n${photoUrl}` : ""));
    return;
  }
}

export async function sendMessage(text) {
  const res = await fetch(api("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: text.slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) console.error("Telegram sendMessage failed:", await res.text());
}

export function configured() {
  return Boolean(TOKEN && CHAT_ID);
}
