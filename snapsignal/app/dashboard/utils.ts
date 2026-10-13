import type { SigTab } from "./data";

export interface LiveSignal {
  cats: string[];
  src: string;
  srcName: string;
  badge: string[];
  title: string;
  why: string;
  score: number;
  scoreLbl: string;
  actions: Record<string, string>;
  stats: string[][];
  time: string;
  url: string;
}

export function catToTab(cats: string[]): SigTab {
  if (cats.includes("rates")) return "Rates";
  if (cats.includes("buyerpain") || cats.includes("sellerpain")) return "Pain";
  if (cats.includes("market")) return "Market";
  if (cats.includes("news")) return "News";
  return "Trends";
}

export function inferContentType(sig: LiveSignal): string {
  const t = sig.title.toLowerCase();
  const cats = (sig.cats ?? []).join(" ").toLowerCase();
  // Use category from signal first — more reliable than keyword matching title
  if (cats.includes("seller")) return "seller_alert";
  if (cats.includes("buyer")) return "buyer_pain";
  if (cats.includes("agent")) return "agent_insight";
  if (cats.includes("investment")) return "investment_tip";
  if (cats.includes("tech")) return "news_flash";
  if (cats.includes("legal")) return "news_flash";
  // Title keywords as fallback — broader matching
  if (t.includes("inventory") || t.includes("listing") || t.includes("supply")) return "seller_alert";
  if (t.includes("buyer") || t.includes("buydown") || t.includes("afford")) return "buyer_pain";
  if (t.includes("agent") || t.includes("commission")) return "agent_insight";
  if (t.includes("invest") || t.includes("rental")) return "investment_tip";
  if (t.includes("market") || t.includes("direction") || t.includes("cooling") || t.includes("heating")) return "market_pulse";
  // rate/mortgage → market_pulse not rate_alert (rate_alert causes generic rate script)
  if (t.includes("rate") || t.includes("mortgage")) return "market_pulse";
  return "news_flash";
}

export function sparkSVG(vals: number[], accent?: boolean): string {
  const W = 100, H = 32, mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - mn) / r) * (H - 4) - 2}`).join(" ");
  const lx = W, ly = H - ((vals[vals.length - 1] - mn) / r) * (H - 4) - 2;
  const col = accent ? "#F57F2E" : "#C5C1BA";
  return `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="2.5" fill="${col}"/></svg>`;
}
