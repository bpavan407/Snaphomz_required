"""
Snaphomz Premium Video Engine
Structure: Hook -> Problem -> Insight -> Snaphomz Angle -> CTA
Format: 9:16 vertical MP4, 35-50s, burned captions, dark premium brand
"""

import os
import re
import json
import asyncio
import textwrap
import urllib.request
import urllib.parse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from moviepy import (
    ImageSequenceClip, AudioFileClip, concatenate_videoclips,
    VideoFileClip, CompositeVideoClip, ColorClip
)
from groq import Groq
from src.data.fetcher import fetch_all_data, CONTENT_TEMPLATES

OUTPUT_DIR = Path("output")
ASSETS_DIR = Path("assets")
FONTS_DIR  = Path("assets/fonts")
OUTPUT_DIR.mkdir(exist_ok=True)
ASSETS_DIR.mkdir(exist_ok=True)
FONTS_DIR.mkdir(exist_ok=True)

W, H = 1080, 1920

# Premium dark brand palette
BG_DARK    = (7,   17,  31)
BG_CARD    = (17,  24,  39)
BLUE       = (10,  132, 255)
ORANGE     = (255, 107,  0)   # Snaphomz brand orange — update hex if brand guide differs
WHITE      = (255, 255, 255)
GRAY       = (167, 176, 190)
AMBER      = (245, 158, 11)
GREEN      = (34,  197, 94)
BRAND      = ORANGE            # all Snaphomz brand elements use this

# Scene durations (seconds) — balanced for short-form pacing
SCENE_HOOK      = 6
SCENE_PROBLEM   = 8
SCENE_INSIGHT   = 12
SCENE_SNAPHOMZ  = 9
SCENE_CTA       = 7
TOTAL_DUR       = SCENE_HOOK + SCENE_PROBLEM + SCENE_INSIGHT + SCENE_SNAPHOMZ + SCENE_CTA  # 42s


# ─────────────────────────────────────────
# Font loader (downloads Inter if missing)
# ─────────────────────────────────────────
_font_cache = {}

def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]

    variant   = "Bold" if bold else "Regular"
    font_path = FONTS_DIR / f"Inter-{variant}.ttf"

    if not font_path.exists():
        urls = {
            "Inter-Regular.ttf": "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Regular.ttf",
            "Inter-Bold.ttf":    "https://github.com/rsms/inter/raw/master/docs/font-files/Inter-Bold.ttf",
        }
        url = urls[f"Inter-{variant}.ttf"]
        try:
            urllib.request.urlretrieve(url, str(font_path))
        except Exception:
            pass

    try:
        f = ImageFont.truetype(str(font_path), size)
    except Exception:
        f = ImageFont.load_default(size=size)

    _font_cache[key] = f
    return f


# ─────────────────────────────────────────
# Neural TTS — Microsoft Jenny (free)
# ─────────────────────────────────────────
def _generate_edge_tts(text: str, output_path: str,
                       voice: str = "en-US-JennyNeural") -> None:
    import edge_tts

    async def _run():
        communicate = edge_tts.Communicate(text, voice, rate="+5%", volume="+10%")
        await communicate.save(output_path)

    asyncio.run(_run())


# ─────────────────────────────────────────
# Script generator — structured 5-scene JSON
# ─────────────────────────────────────────
TEMPLATES = {
    "market_pulse": {
        "label":   "MARKET PULSE",
        "bg":      "real estate neighborhood aerial city",
        "hook_ex": "Buyers are waiting.",
        "cta_ex":  "Comment your city for a market breakdown.",
    },
    "buyer_pain": {
        "label":   "BUYER INSIGHT",
        "bg":      "couple looking at house frustrated",
        "hook_ex": "Home buying feels confusing.",
        "cta_ex":  "Follow for smarter home-buying decisions.",
    },
    "listing_breakdown": {
        "label":   "LISTING BREAKDOWN",
        "bg":      "modern house exterior real estate",
        "hook_ex": "This home looks simple.",
        "cta_ex":  "Would you offer above or below asking?",
    },
    "agent_insight": {
        "label":   "AGENT INSIGHT",
        "bg":      "real estate agent professional",
        "hook_ex": "Agents should watch this.",
        "cta_ex":  "Share this with a buyer or seller.",
    },
    "myth_reality": {
        "label":   "MYTH VS REALITY",
        "bg":      "house for sale affordable",
        "hook_ex": "Lower price is not always better.",
        "cta_ex":  "Save this before touring homes.",
    },
    # Legacy types mapped to closest template
    "rate_alert":       {"label": "RATE ALERT",    "bg": "mortgage interest rate house",         "hook_ex": "Rates just moved.",                     "cta_ex": "Use Snaphomz before your next offer."},
    "news_flash":       {"label": "NEWS FLASH",    "bg": "real estate market news",              "hook_ex": "This news changes things.",              "cta_ex": "Follow for daily market insights."},
    "seller_alert":     {"label": "SELLER ALERT",  "bg": "house for sale sign neighborhood",     "hook_ex": "Sellers need to know this.",             "cta_ex": "Comment your city for a seller signal."},
    "hot_market":       {"label": "HOT MARKET",    "bg": "competitive real estate bidding",      "hook_ex": "This market is moving fast.",            "cta_ex": "Search smarter at snaphomz.com."},
    "buyer_tip":        {"label": "BUYER TIP",     "bg": "family new home keys happy",           "hook_ex": "Most buyers miss this.",                 "cta_ex": "Follow for smarter buying decisions."},
    "investment_tip":   {"label": "INVEST SMART",  "bg": "investment property apartment",        "hook_ex": "Investors are doing this right now.",    "cta_ex": "Find investment properties on Snaphomz."},
    "affordability":    {"label": "REAL NUMBERS",  "bg": "couple budget calculator home",        "hook_ex": "The math might surprise you.",           "cta_ex": "Run your numbers free at snaphomz.com."},
    "school_spotlight": {"label": "SCHOOL INTEL",  "bg": "suburban family home school district", "hook_ex": "School district changes everything.",    "cta_ex": "Check school ratings at snaphomz.com."},
    "market_update":    {"label": "MARKET UPDATE", "bg": "housing market neighborhood aerial",   "hook_ex": "Here is what the market is doing now.", "cta_ex": "Search smarter on Snaphomz."},
}

SCENE_KEYS = ["hook", "problem", "insight", "snaphomz_angle", "cta"]


def generate_script_groq(data: dict, content_type: str, api_key: str) -> dict:
    import hashlib, time
    client      = Groq(api_key=api_key)
    tmpl        = TEMPLATES.get(content_type, TEMPLATES["market_pulse"])

    # Variation seed — ensures each generation produces a unique angle on the same signal
    signal_ctx_raw = data.get("signal_context", "")
    _seed = int(hashlib.md5(f"{signal_ctx_raw}{time.time()}".encode()).hexdigest()[:8], 16) % 1000
    ANGLES = [
        "Lead with the buyer perspective — what does this mean for someone trying to buy right now?",
        "Lead with the seller perspective — what action should a seller take based on this?",
        "Lead with the agent perspective — what opportunity does this create for real estate agents?",
        "Lead with a surprising statistic or counterintuitive angle from this signal.",
        "Lead with an emotional story angle — what is someone feeling when they face this situation?",
    ]
    variation_angle = ANGLES[_seed % len(ANGLES)]
    rate        = data["rates"]
    market      = data["market"]
    tip         = data["tip"]
    today       = data.get("today", "today")
    news        = data.get("news") or {}
    articles    = news.get("articles", [])
    # Build live news block — inject into every script for freshness
    news_lines  = "\n".join(
        f'- "{a["title"]}"' + (f': {a["description"][:120]}' if a.get("description") else "")
        for a in articles[:3]
    ) if articles else ""
    news_block  = f"\nLive news as of {today}:\n{news_lines}" if news_lines else ""

    context_map = {
        "rate_alert":       f"Date: {today}. Rate: {rate['rate']}% ({rate['change']:+.2f}% {rate['direction']}). {market['city']} median: ${market['median_price']:,}.{news_block}",
        "market_update":    f"Date: {today}. {market['city']}: median ${market['median_price']:,}, {market['inventory']} homes, {market['days_on_market']} avg days, +{market['yoy_change']}% YoY.{news_block}",
        "market_pulse":     f"Date: {today}. {market['city']}: median ${market['median_price']:,}, {market['inventory']} homes, {market['days_on_market']} avg days, +{market['yoy_change']}% YoY.{news_block}",
        "hot_market":       f"Date: {today}. {market['city']}: {market['inventory']} homes, selling in {market['days_on_market']} days, up {market['yoy_change']}% YoY.{news_block}",
        "buyer_tip":        f"Date: {today}. Tip: {tip['tip']}. Savings: {tip['savings']}. Rate: {rate['rate']}%.{news_block}",
        "buyer_pain":       f"Date: {today}. Rate: {rate['rate']}%. {market['city']} median: ${market['median_price']:,}. {tip['tip']}{news_block}",
        "investment_tip":   f"Date: {today}. {market['city']} up {market['yoy_change']}% YoY. Rate {rate['rate']}%. Inventory: {market['inventory']}.{news_block}",
        "affordability":    f"Date: {today}. Rate: {rate['rate']}%. {market['city']} median: ${market['median_price']:,}. Monthly: ~${int(market['median_price']*rate['rate']/100/12):,}.{news_block}",
        "school_spotlight": f"Date: {today}. ZIP {data['zip']} school: {data['schools']['top_school']}, rated {data['schools']['rating']}/10. Homes near top schools avg 20% premium.{news_block}",
        "news_flash":       f"Date: {today}. Rate: {rate['rate']}%.{news_block}",
        "seller_alert":     f"Date: {today}. {market['city']}: {market['inventory']} homes, {market['days_on_market']} days.{news_block}",
        "myth_reality":     f"Date: {today}. Rate: {rate['rate']}%. {market['city']} median: ${market['median_price']:,}. {tip['tip']}{news_block}",
        "listing_breakdown":f"Date: {today}. {market['city']}: median ${market['median_price']:,}, {market['days_on_market']} avg days. Rate: {rate['rate']}%.{news_block}",
        "agent_insight":    f"Date: {today}. {market['city']}: {market['inventory']} homes. {market['days_on_market']} avg days. Rate: {rate['rate']}%.{news_block}",
    }
    context = context_map.get(content_type, context_map.get("market_update", ""))

    # Reddit-sourced script: base script on real community discussions
    reddit_posts = data.get("reddit_posts", [])
    signal_ctx   = data.get("signal_context", "")

    if reddit_posts:
        reddit_lines = "\n".join(
            f'- r/{p.get("subreddit","?")} — "{p.get("title","")}"'
            + (f' ({p.get("selftext","")[:100]}...)' if p.get("selftext") else "")
            for p in reddit_posts[:12]
        )
        prompt = f"""You are a premium real estate content strategist for Snaphomz (snaphomz.com).

You are writing a video script BASED ON what real buyers and sellers are discussing RIGHT NOW on Reddit.

Signal that triggered this video:
"{signal_ctx}"

Real Reddit posts from this week (use these as your primary source — quote themes, not usernames):
{reddit_lines}

Market context: {context}

Write a STRICT 30-second video script (5 scenes × 10 words spoken MAX = ~50 words total TTS audio). Final video must be under 40 seconds.
Reference Reddit discussions as insights. Be real, not corporate. Do NOT say "Reddit" more than twice.

5 scenes. Rules per scene:
- headline: 5-7 BOLD words — stops the scroll, references the community discussion theme
- body: 1-2 sentences with the specific theme from Reddit posts + any real data
- image_query: 4-5 word visual search term matching the scene
- spoken: voiceover EXACTLY 1 sentence, MAX 12 words — punchy, sounds like breaking news from Reddit

Scene rules:
- hook: grab attention with the most viral/relatable Reddit theme you found
- problem: the pain point most upvoted across those posts
- insight: the most surprising or actionable thing from the discussions + real market data
- snaphomz_angle: how Snaphomz addresses exactly what those Reddit users need
- cta: "{tmpl['cta_ex']}" style

Return ONLY valid JSON, no markdown:
{{
  "scenes": [
    {{"key": "hook",           "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}},
    {{"key": "problem",        "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}},
    {{"key": "insight",        "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}},
    {{"key": "snaphomz_angle", "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}},
    {{"key": "cta",            "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}}
  ],
  "title": "punchy 5-6 word title referencing the Reddit theme",
  "caption": "social caption under 150 chars with hashtags including #RealEstate #Reddit"
}}"""
    else:
        # Signal-first prompt: selected signal IS the theme — market data is supporting context only
        supporting = f"Supporting market context (use only if relevant to the signal): {context}"
        main_signal = signal_ctx if signal_ctx else context

        prompt = f"""You are a premium real estate content strategist for Snaphomz (snaphomz.com).

THIS IS THE MAIN THEME — your entire script must be about this signal:
Angle for this version: {variation_angle}
(Use this angle to make this script DIFFERENT from other versions of the same signal)
"{main_signal}"

{supporting}

Write a STRICT 30-second video script (5 scenes × 10 words spoken MAX = ~50 words total TTS audio). Final video must be under 40 seconds.
EVERY scene connects back to the signal above — do NOT drift to generic market talk.
The signal is what the viewer selected — it must be the core of every scene.

5 scenes. Rules per scene:
- headline: 5-7 BOLD words directly about the signal theme — stops the scroll
- body: 1-2 sentences expanding on that specific signal with any relevant data
- image_query: 4-5 word visual that matches the signal topic (e.g. if signal is about bidding wars → "multiple offer home bidding war", if inventory → "empty housing market street", NOT generic "mortgage rate chart")
- spoken: EXACTLY 1 sentence, MAX 12 words — punchy, feels like breaking news, no filler

Scene rules:
- hook: grab attention with the most surprising/urgent part of the signal
- problem: the exact pain point this signal reveals for buyers/sellers/agents
- insight: the specific details from the signal + any supporting number from market context
- snaphomz_angle: how Snaphomz helps with THIS specific problem — one mention, not salesy
- cta: "{tmpl['cta_ex']}" style — soft close

Return ONLY valid JSON, no markdown:
{{
  "scenes": [
    {{"key": "hook",           "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}},
    {{"key": "problem",        "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}},
    {{"key": "insight",        "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}},
    {{"key": "snaphomz_angle", "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}},
    {{"key": "cta",            "headline": "bold 5-7 words", "body": "1-2 sentence detail", "image_query": "specific visual 4-5 words", "spoken": "voiceover text"}}
  ],
  "title": "punchy 5-6 word title that captures the signal theme",
  "caption": "social caption under 150 chars with hashtags relevant to the signal topic"
}}"""

    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=800,
        temperature=0.7,
    )

    raw = resp.choices[0].message.content.strip()
    # Strip markdown code blocks if present
    raw = re.sub(r"^```json\s*", "", raw)
    raw = re.sub(r"^```\s*",     "", raw)
    raw = re.sub(r"\s*```$",     "", raw)

    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = {}

    # Normalize: if Groq returned old flat format, convert it
    if "scenes" not in parsed and "hook" in parsed:
        parsed["scenes"] = [
            {"key": "hook",           "headline": parsed.get("hook",           tmpl["hook_ex"]),
             "body": "",              "image_query": tmpl["bg"], "spoken": parsed.get("hook", "")},
            {"key": "problem",        "headline": parsed.get("problem",        "Most buyers miss this."),
             "body": "",              "image_query": "frustrated home buyer paperwork", "spoken": parsed.get("problem", "")},
            {"key": "insight",        "headline": parsed.get("insight",        f"Rate at {rate['rate']}%"),
             "body": f"{market['city']} median ${market['median_price']:,}. {market['days_on_market']} avg days on market.",
             "image_query": "real estate market data chart", "spoken": parsed.get("insight", "")},
            {"key": "snaphomz_angle", "headline": parsed.get("snaphomz_angle", "Snaphomz makes it simple."),
             "body": "",              "image_query": "real estate app phone search", "spoken": parsed.get("snaphomz_angle", "")},
            {"key": "cta",            "headline": parsed.get("cta",            tmpl["cta_ex"]),
             "body": "",              "image_query": "happy family new home keys", "spoken": parsed.get("cta", "")},
        ]

    # Fallback if scenes still missing
    if "scenes" not in parsed or len(parsed.get("scenes", [])) < 5:
        parsed["scenes"] = [
            {"key": "hook",           "headline": tmpl["hook_ex"],
             "body": f"Rates at {rate['rate']}%. {market['city']} market is moving.",
             "image_query": tmpl["bg"], "spoken": tmpl["hook_ex"]},
            {"key": "problem",        "headline": "Most buyers miss this.",
             "body": f"Price alone doesn't tell the full story in {market['city']}.",
             "image_query": "frustrated couple house hunting", "spoken": f"Most buyers miss what really drives {market['city']} prices."},
            {"key": "insight",        "headline": f"Rate: {rate['rate']}% right now.",
             "body": f"{market['city']} median ${market['median_price']:,}. Homes sell in {market['days_on_market']} days.",
             "image_query": "mortgage rate interest chart house", "spoken": f"Rate at {rate['rate']}%. {market['city']} median ${market['median_price']:,}."},
            {"key": "snaphomz_angle", "headline": "Snaphomz shows the full picture.",
             "body": "Search by payment, school rating, and neighborhood — not just price.",
             "image_query": "real estate search app mobile", "spoken": "Snaphomz helps you understand the home before the offer."},
            {"key": "cta",            "headline": tmpl["cta_ex"],
             "body": "Follow for weekly market insights.",
             "image_query": "follow social media real estate tips", "spoken": tmpl["cta_ex"]},
        ]

    # Build full spoken script for TTS — cap each line at 12 words to keep video under 40s
    def _cap(text: str, max_words: int = 12) -> str:
        words = text.split()
        return " ".join(words[:max_words])

    spoken_parts = [_cap(s.get("spoken", s.get("headline", ""))) for s in parsed["scenes"]]
    parsed["script"] = " ".join(spoken_parts + ["Not financial advice."])
    parsed.setdefault("title",   f"Snaphomz {content_type.replace('_', ' ').title()}")
    parsed.setdefault("caption", f"Smart real estate insights for {market['city']}. #realestate #snaphomz #homebuying")
    return parsed


# ─────────────────────────────────────────
# Background media fetchers
# ─────────────────────────────────────────
def fetch_pixabay_video(query: str, api_key: str, slide_index: int = 0) -> str | None:
    if not api_key or api_key == "YOUR_PIXABAY_API_KEY":
        return None
    try:
        encoded = urllib.parse.quote(query)
        url     = f"https://pixabay.com/api/videos/?key={api_key}&q={encoded}&video_type=film&per_page=10&safesearch=true"
        req     = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read())
        hits = data.get("hits", [])
        if not hits:
            return None
        hit  = hits[slide_index % len(hits)]
        vids = hit.get("videos", {})
        src  = (vids.get("medium") or vids.get("small") or vids.get("large") or {}).get("url")
        if not src:
            return None
        path = str(ASSETS_DIR / f"bg_video_{slide_index}.mp4")
        urllib.request.urlretrieve(src, path)
        return path
    except Exception as e:
        print(f"  [PIXABAY] {e}")
        return None


def fetch_bg_photo(query: str, pexels_key: str = "", slide_index: int = 0) -> str | None:
    path = str(ASSETS_DIR / f"bg_photo_{slide_index}.jpg")

    if pexels_key and pexels_key != "YOUR_PEXELS_API_KEY":
        try:
            encoded = urllib.parse.quote(query)
            url = f"https://api.pexels.com/v1/search?query={encoded}&per_page=10&orientation=portrait"
            req = urllib.request.Request(url, headers={"Authorization": pexels_key})
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())
            photos = data.get("photos", [])
            if photos:
                src = photos[0]["src"].get("large2x") or photos[0]["src"].get("original")
                urllib.request.urlretrieve(src, path)
                return path
        except Exception:
            pass

    try:
        seed = (abs(hash(query)) + slide_index * 137) % 1000
        url  = f"https://picsum.photos/seed/{seed}/1080/1920"
        req  = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as r:
            with open(path, "wb") as f:
                f.write(r.read())
        if os.path.getsize(path) > 10000:
            return path
    except Exception as e:
        print(f"  [IMG] {e}")
    return None


def fetch_bg_music() -> str | None:
    music_path = str(ASSETS_DIR / "bg_music.mp3")
    if os.path.exists(music_path):
        return music_path
    urls = [
        "https://files.freemusicarchive.org/storage-freemusicarchive-org/music/no_curator/Kai_Engel/Satin/Kai_Engel_-_04_-_Interlude.mp3",
        "https://ia600905.us.archive.org/13/items/SoundtrackforSilentFilms/06-pastoral.mp3",
    ]
    for url in urls:
        try:
            urllib.request.urlretrieve(url, music_path)
            return music_path
        except Exception:
            continue
    return None


# ─────────────────────────────────────────
# Scene renderer — premium dark frame
# ─────────────────────────────────────────
def _load_bg_frame(bg_source, t: float, slide_index: int) -> Image.Image:
    """Get a single frame from photo (Ken Burns) or video source."""
    if isinstance(bg_source, np.ndarray):
        # Pre-loaded photo array
        return Image.fromarray(bg_source)

    if isinstance(bg_source, str) and bg_source.endswith(".mp4"):
        try:
            vc = VideoFileClip(bg_source)
            ft = min(t, vc.duration - 0.01)
            frame = vc.get_frame(ft)
            vc.close()
            img = Image.fromarray(frame)
            # Crop to portrait
            iw, ih = img.size
            if iw / ih > W / H:
                new_w = int(ih * W / H)
                img   = img.crop(((iw - new_w) // 2, 0, (iw + new_w) // 2, ih))
            else:
                new_h = int(iw * H / W)
                img   = img.crop((0, (ih - new_h) // 2, iw, (ih + new_h) // 2))
            return img.resize((W, H), Image.LANCZOS)
        except Exception:
            pass

    # Dark gradient fallback
    img  = Image.new("RGB", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)
    for y in range(H):
        r = int(BG_DARK[0] + 18 * y / H)
        g = int(BG_DARK[1] + 12 * y / H)
        b = int(BG_DARK[2] + 30 * y / H)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    return img


def render_scene(headline: str, body: str, duration: float, scene_type: str,
                 bg_source, slide_num: int, total: int,
                 label: str = "", is_cta: bool = False) -> ImageSequenceClip:
    """Render one scene: full photo bg + 2-layer text card (headline + body)."""
    fps = 5  # 5fps — enough for slide-style Shorts; renders 3× faster
    n   = int(duration * fps)

    is_photo = isinstance(bg_source, np.ndarray)
    if is_photo:
        photo_big = Image.fromarray(bg_source).resize(
            (int(W * 1.10), int(H * 1.10)), Image.BILINEAR)

    f_headline = get_font(64, bold=True)
    f_body     = get_font(40, bold=False)
    f_label    = get_font(26, bold=True)
    f_brand    = get_font(28, bold=True)
    f_disc     = get_font(22, bold=False)
    PADX       = 64

    # Pre-wrap text (static — same every frame)
    hw         = textwrap.wrap(headline, width=15)
    bw         = textwrap.wrap(body,     width=22) if body else []
    h_line_h   = 78
    b_line_h   = 52
    gap        = 18   # gap between headline block and body block
    card_pad   = 30
    total_text_h = len(hw) * h_line_h + (gap + len(bw) * b_line_h if bw else 0)
    zone_top   = int(H * 0.55)
    y_base     = zone_top + max(0, (H - zone_top - total_text_h - 120) // 2)

    frames = []
    for i in range(n):
        t        = i / fps
        progress = i / n

        # Background with Ken Burns zoom
        if is_photo:
            scale   = 1.10 - 0.10 * progress
            cur_w   = int(W * scale)
            cur_h   = int(H * scale)
            resized = photo_big.resize((cur_w, cur_h), Image.BILINEAR)  # faster than LANCZOS
            ox      = (cur_w - W) // 2
            oy      = (cur_h - H) // 2
            frame   = resized.crop((ox, oy, ox + W, oy + H))
        else:
            frame   = _load_bg_frame(bg_source, t, slide_num)

        # Very light brand tint — photo fully visible, zero blur
        tint  = Image.new("RGBA", (W, H), (7, 17, 31, 55))
        frame = Image.alpha_composite(frame.convert("RGBA"), tint).convert("RGB")
        draw  = ImageDraw.Draw(frame)

        # Progress bar
        draw.rectangle([0, 0, int(W * slide_num / total), 6], fill=BRAND)

        # Label chip
        if label:
            chip_w = f_label.getlength(label) + 40
            draw.rounded_rectangle([PADX, 28, PADX + chip_w, 74], radius=20, fill=BRAND)
            draw.text((PADX + 18, 34), label, fill=WHITE, font=f_label)

        if is_cta:
            # CTA: centered card with orange background
            cta_lines = textwrap.wrap(headline, width=16)
            box_h     = len(cta_lines) * 80 + 60
            box_y     = (H - box_h) // 2
            draw.rounded_rectangle([PADX, box_y, W - PADX, box_y + box_h],
                                    radius=28, fill=BRAND)
            yp = box_y + 28
            for line in cta_lines:
                lw = f_headline.getlength(line)
                draw.text(((W - lw) // 2, yp), line, fill=WHITE, font=f_headline)
                yp += 80
            if body:
                sub = textwrap.wrap(body, width=24)
                for line in sub:
                    lw = f_body.getlength(line)
                    draw.text(((W - lw) // 2, yp + 8), line, fill=(220, 220, 220), font=f_body)
                    yp += b_line_h
        else:
            # Dark semi-transparent card behind text block
            card_bottom = y_base + total_text_h + card_pad
            ov2  = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            ov2d = ImageDraw.Draw(ov2)
            ov2d.rounded_rectangle(
                [PADX - card_pad, y_base - card_pad,
                 W - PADX + card_pad, card_bottom],
                radius=22, fill=(7, 17, 31, 185))
            frame = Image.alpha_composite(frame.convert("RGBA"), ov2).convert("RGB")
            draw  = ImageDraw.Draw(frame)

            # Orange accent bar left edge of card
            draw.rounded_rectangle(
                [PADX - card_pad, y_base - card_pad,
                 PADX - card_pad + 5, card_bottom],
                radius=4, fill=BRAND)

            yp = y_base
            # Headline lines — fade + slide up per line
            for j, line in enumerate(hw):
                fade   = min(1.0, max(0.0, (t - j * 0.15) / 0.22))
                offset = int(20 * (1 - fade))
                lw     = f_headline.getlength(line)
                draw.text((PADX, yp + offset), line, fill=WHITE, font=f_headline)
                yp += h_line_h

            # Body lines — fade in after headline, slightly muted
            if bw:
                yp += gap
                body_start_t = len(hw) * 0.15 + 0.1
                for j, line in enumerate(bw):
                    fade   = min(1.0, max(0.0, (t - body_start_t - j * 0.12) / 0.2))
                    offset = int(16 * (1 - fade))
                    draw.text((PADX, yp + offset), line, fill=(210, 215, 225), font=f_body)
                    yp += b_line_h

        # Snaphomz brand footer
        draw.text((PADX, H - 60), "Snaphomz", fill=BRAND, font=f_brand)
        draw.text((PADX, H - 32), "snaphomz.com", fill=GRAY, font=f_disc)

        frames.append(np.array(frame))

    return ImageSequenceClip(frames, fps=fps)


# ─────────────────────────────────────────
# Thumbnail — 1280×720 branded cover image
# ─────────────────────────────────────────
def render_thumbnail(title: str, headline: str, bg_source) -> str:
    """Generate 1280×720 YouTube thumbnail. Returns saved path."""
    TW, TH = 1280, 720
    out    = str(OUTPUT_DIR / "thumbnail.jpg")

    # Background
    if isinstance(bg_source, np.ndarray):
        img = Image.fromarray(bg_source).resize((TW, TH), Image.BILINEAR)
    else:
        img = Image.new("RGB", (TW, TH), BG_DARK)

    # Dark gradient overlay (bottom-heavy)
    overlay = Image.new("RGBA", (TW, TH), (0, 0, 0, 0))
    for y in range(TH):
        alpha = int(120 + 100 * (y / TH))
        ImageDraw.Draw(overlay).line([(0, y), (TW, y)], fill=(7, 17, 31, alpha))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(img)

    # Orange accent bar top
    draw.rectangle([0, 0, TW, 8], fill=BRAND)

    # "SNAPHOMZ" brand chip top-left
    f_chip  = get_font(28, bold=True)
    chip_lbl = "SNAPHOMZ"
    chip_w   = int(f_chip.getlength(chip_lbl)) + 32
    draw.rounded_rectangle([40, 28, 40 + chip_w, 76], radius=16, fill=BRAND)
    draw.text((56, 34), chip_lbl, fill=WHITE, font=f_chip)

    # Title text (large, centered)
    f_title = get_font(72, bold=True)
    f_sub   = get_font(38, bold=False)
    import textwrap as tw_mod
    title_lines = tw_mod.wrap(title[:60], width=22)
    total_h = len(title_lines) * 86
    y_start = (TH - total_h) // 2 + 40
    for line in title_lines:
        lw = int(f_title.getlength(line))
        # Shadow
        draw.text(((TW - lw) // 2 + 3, y_start + 3), line, fill=(0, 0, 0), font=f_title)
        draw.text(((TW - lw) // 2, y_start), line, fill=WHITE, font=f_title)
        y_start += 86

    # Headline subtitle
    if headline:
        sub_lines = tw_mod.wrap(headline[:80], width=40)
        for line in sub_lines[:2]:
            lw = int(f_sub.getlength(line))
            draw.text(((TW - lw) // 2, y_start + 12), line, fill=(210, 210, 210), font=f_sub)
            y_start += 48

    # Bottom bar
    draw.rectangle([0, TH - 10, TW, TH], fill=BRAND)

    img.save(out, quality=95)
    return out


# ─────────────────────────────────────────
# Disclaimer end card
# ─────────────────────────────────────────
def render_disclaimer(duration: float = 2.0) -> ImageSequenceClip:
    fps    = 5
    n      = int(duration * fps)
    frames = []
    font   = get_font(26, bold=False)
    for _ in range(n):
        img  = Image.new("RGB", (W, H), BG_DARK)
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 0, W, H], fill=BG_DARK)
        draw.line([(64, H // 2 - 2), (W - 64, H // 2 - 2)], fill=BRAND, width=2)
        text1 = "For informational purposes only."
        text2 = "Not financial or legal advice."
        for i, txt in enumerate([text1, text2, "snaphomz.com"]):
            lw = font.getlength(txt)
            x  = (W - lw) // 2
            y  = H // 2 + 20 + i * 46
            c  = GRAY if i < 2 else BRAND
            draw.text((x, y), txt, fill=c, font=font)
        draw.text((64, H - 60), "Snaphomz", fill=BRAND, font=get_font(28, bold=True))
        draw.text((64, H - 32), "snaphomz.com", fill=GRAY, font=get_font(22))
        frames.append(np.array(img))
    return ImageSequenceClip(frames, fps=fps)


# ─────────────────────────────────────────
# Main build function
# ─────────────────────────────────────────
def build_video(script_data: dict, content_type: str,
                zip_code: str = "10001",
                pexels_key: str = "",
                pixabay_key: str = "") -> tuple:

    script  = script_data["script"]
    title   = script_data["title"]
    tmpl    = TEMPLATES.get(content_type, TEMPLATES["market_pulse"])
    label   = tmpl["label"]
    scenes  = script_data.get("scenes", [])

    # Voiceover
    print("  [VIDEO] Generating neural voiceover (Jenny)...")
    audio_path = str(OUTPUT_DIR / "voiceover.mp3")
    try:
        _generate_edge_tts(script, audio_path)
    except Exception as e:
        raise RuntimeError(f"edge-tts failed: {e}") from e

    if not os.path.exists(audio_path) or os.path.getsize(audio_path) < 1000:
        raise RuntimeError(f"edge-tts produced empty audio file ({os.path.getsize(audio_path) if os.path.exists(audio_path) else 0} bytes). Check network / edge-tts install.")

    audio_clip  = AudioFileClip(audio_path)
    voice_dur   = audio_clip.duration

    # Equal duration per scene — each image gets same screen time
    scene_dur   = voice_dur / len(scenes) if scenes else voice_dur / 5
    durations   = [scene_dur] * 5
    scene_types = ["hook", "problem", "insight", "snaphomz", "cta"]

    # Image queries come from Groq — specific to each scene's content
    scene_queries = [s.get("image_query", tmpl["bg"]) for s in scenes]

    print("  [VIDEO] Fetching backgrounds (parallel)...")
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _fetch_one(args):
        i, q = args
        if pixabay_key and pixabay_key != "YOUR_PIXABAY_API_KEY":
            vp = fetch_pixabay_video(q, pixabay_key, slide_index=i)
            if vp:
                return i, vp
        pp = fetch_bg_photo(q, pexels_key, slide_index=i)
        if pp:
            try:
                img = Image.open(pp).convert("RGB")
                pw, ph = img.size
                if pw / ph > W / H:
                    new_w = int(ph * W / H)
                    img   = img.crop(((pw - new_w) // 2, 0, (pw + new_w) // 2, ph))
                else:
                    new_h = int(pw * H / W)
                    img   = img.crop((0, (ph - new_h) // 2, pw, (ph + new_h) // 2))
                img = img.resize((W, H), Image.LANCZOS)
                return i, np.array(img)
            except Exception as e:
                print(f"  [IMG] load error idx {i}: {e}")
        return i, None

    raw_sources = [None] * len(scene_queries)
    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = {ex.submit(_fetch_one, (i, q)): i for i, q in enumerate(scene_queries)}
        for fut in as_completed(futures):
            idx, src = fut.result()
            raw_sources[idx] = src

    bg_sources = raw_sources
    loaded = sum(1 for b in bg_sources if b is not None)
    print(f"  [VIDEO] Backgrounds ready: {loaded}/{len(scene_queries)}")

    # Background music
    print("  [VIDEO] Loading background music...")
    music_path = fetch_bg_music()

    # Build 5 scenes
    print("  [VIDEO] Rendering 5 scenes...")
    clips      = []
    slide_imgs = []

    for i, (scene, dur, stype) in enumerate(zip(scenes, durations, scene_types)):
        is_cta   = (stype == "cta")
        headline = scene.get("headline", "")
        body     = scene.get("body", "")
        clip     = render_scene(
            headline   = headline,
            body       = body,
            duration   = dur,
            scene_type = stype,
            bg_source  = bg_sources[i],
            slide_num  = i + 1,
            total      = 5,
            label      = label if i == 0 else "",
            is_cta     = is_cta,
        )
        # Save first frame for X posting
        frame      = clip.get_frame(0)
        slide_path = str(OUTPUT_DIR / f"slide_{i}.jpg")
        Image.fromarray(frame).save(slide_path, quality=88)
        slide_imgs.append(slide_path)
        clips.append(clip)

    # Disclaimer end card
    clips.append(render_disclaimer(2.0))

    # Thumbnail from hook scene background
    thumbnail_path = render_thumbnail(title, scenes[0].get("headline", "") if scenes else "", bg_sources[0])
    print(f"  [VIDEO] Thumbnail: {thumbnail_path}")

    print("  [VIDEO] Assembling...")
    video = concatenate_videoclips(clips, method="compose")

    # Mix voice + music
    if music_path:
        from moviepy import CompositeAudioClip
        try:
            music    = AudioFileClip(music_path).subclipped(0, audio_clip.duration + 2.0)
            music    = music.with_volume_scaled(0.12)
            combined = CompositeAudioClip([audio_clip, music])
            video    = video.with_audio(combined)
        except Exception:
            video = video.with_audio(audio_clip)
    else:
        video = video.with_audio(audio_clip)

    safe_title = "".join(c if c.isalnum() or c in "_-" else "_" for c in title)[:40].strip("_")
    out_path   = str(OUTPUT_DIR / f"{safe_title}.mp4")

    try:
        video.write_videofile(out_path, fps=5, codec="libx264",
                              audio_codec="aac", logger="bar")
    except Exception as e:
        audio_clip.close()
        video.close()
        raise RuntimeError(f"ffmpeg/moviepy write failed: {e}") from e

    audio_clip.close()
    video.close()

    # Final size guard
    final_size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
    if final_size < 10_000:
        raise RuntimeError(f"Output file is {final_size} bytes — render failed silently.")

    print(f"  [VIDEO] Done: {out_path} ({final_size // 1024} KB)")
    return out_path, slide_imgs, thumbnail_path
