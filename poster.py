import os
import io
import json
import sys
import asyncio
import tempfile
import subprocess
from datetime import date, datetime
import feedparser
import requests
from deep_translator import GoogleTranslator
from PIL import Image, ImageDraw, ImageFont
from telegram import Bot
from openai import OpenAI
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
import re
from duckduckgo_search import DDGS
import time

# --- Переменные окружения (секреты GitHub) ---
TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
UNSPLASH_KEY = os.environ.get('UNSPLASH_ACCESS_KEY', None)
GROQ_KEY = os.environ.get('GROQ_API_KEY', None)

# --- Настройки ---
RSS_FEEDS = [
    'https://decrypt.co/feed',
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://www.cnbc.com/id/10001147/device/rss/rss.html'
]
MAX_NEWS = 5
TRANSLATOR = GoogleTranslator(source='auto', target='ru')
feedparser.USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'

HISTORY_FILE = 'posted.json'
OFFSET_FILE = 'update_offset.txt'
MUTE_FILE = 'mute.json'
FONT_PATH = 'Roboto-Bold.ttf'

client = OpenAI(api_key=GROQ_KEY, base_url="https://api.groq.com/openai/v1") if GROQ_KEY else None

# --- Mute/unmute фразы ---
MUTE_PHRASES = [
    'не отвечай', 'перестань отвечать', 'больше не отвечай', 'не пиши', 'замолчи',
    'отстань', 'молчи', 'не нужно отвечать', 'не надо отвечать',
    'перестань писать', 'больше не пиши', 'отключи ответы'
]
UNMUTE_PHRASES = [
    'можешь отвечать', 'отвечай', 'снова отвечай', 'начни отвечать', 'разрешаю отвечать',
    'включи ответы', 'можешь снова отвечать', 'продолжай отвечать', 'возобнови ответы',
    'я снова хочу получать сообщения', 'давай отвечай'
]

CHART_KEYWORDS = ['график', 'тренд', 'цена', 'поддержка', 'сопротивление', 'куда движется', 'покажи график', 'покажи цену']
ANALYSIS_KEYWORDS = ['твоё мнение', 'что думаешь', 'сделай анализ', 'проанализируй', 'твое мнение', 'как считаешь', 'дай оценку', 'расскажи подробно']

# Расширенный локальный словарь (монета -> CoinGecko ID)
SYMBOL_TO_ID = {
    'биткоин': 'bitcoin', 'bitcoin': 'bitcoin', 'btc': 'bitcoin',
    'эфириум': 'ethereum', 'ethereum': 'ethereum', 'eth': 'ethereum',
    'солана': 'solana', 'solana': 'solana', 'sol': 'solana',
    'доге': 'dogecoin', 'doge': 'dogecoin', 'dogecoin': 'dogecoin',
    'bnb': 'binancecoin', 'бинанс': 'binancecoin',
    'xrp': 'ripple', 'рипл': 'ripple',
    'ada': 'cardano', 'кардано': 'cardano',
    'matic': 'matic-network', 'полигон': 'matic-network', 'polygon': 'matic-network',
    'avax': 'avalanche-2', 'аваланч': 'avalanche-2',
    'dot': 'polkadot', 'полкадот': 'polkadot',
    'link': 'chainlink', 'чейнлинк': 'chainlink',
    'uni': 'uniswap', 'юнисвап': 'uniswap',
    'litecoin': 'litecoin', 'ltc': 'litecoin', 'лайткоин': 'litecoin',
    'toncoin': 'the-open-network', 'тонкоин': 'the-open-network', 'ton': 'the-open-network', 'тон': 'the-open-network',
    'shiba': 'shiba-inu', 'шиба': 'shiba-inu', 'shib': 'shiba-inu',
    'pepe': 'pepe', 'пепе': 'pepe',
    'optimism': 'optimism', 'оптимизм': 'optimism', 'op': 'optimism',
    'arbitrum': 'arbitrum', 'арбитрум': 'arbitrum', 'arb': 'arbitrum',
    'aptos': 'aptos', 'аптос': 'aptos', 'apt': 'aptos',
    'atom': 'cosmos', 'космос': 'cosmos', 'cosmos': 'cosmos',
    'near': 'near', 'нир': 'near',
    'sui': 'sui', 'суи': 'sui',
    'xlm': 'stellar', 'стеллар': 'stellar', 'stellar': 'stellar',
    'algo': 'algorand', 'алгоранд': 'algorand',
    'vet': 'vechain', 'вечейн': 'vechain',
    'xtz': 'tezos', 'тезос': 'tezos',
    'fil': 'filecoin', 'файлкоин': 'filecoin',
    'aave': 'aave', 'аве': 'aave',
    'mkr': 'maker', 'мейкер': 'maker',
    'grt': 'the-graph', 'граф': 'the-graph',
    'xmr': 'monero', 'монеро': 'monero',
    'zec': 'zcash', 'зкеш': 'zcash',
    'dash': 'dash', 'даш': 'dash',
    'eos': 'eos',
    'bch': 'bitcoin-cash', 'биткоин кэш': 'bitcoin-cash',
    'etc': 'ethereum-classic', 'эфириум классик': 'ethereum-classic',
    'hbar': 'hedera-hashgraph', 'хедара': 'hedera-hashgraph',
    'qnt': 'quant-network', 'квант': 'quant-network',
    'flow': 'flow', 'флоу': 'flow',
    'egld': 'elrond-erd-2', 'элронд': 'elrond-erd-2',
    'kcs': 'kucoin-shares',
    'cake': 'pancakeswap-token',
    'snx': 'synthetix-network-token',
}

def load_mute_list():
    try:
        with open(MUTE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return set(data.get('muted', []) if isinstance(data, dict) else data)
    except (FileNotFoundError, json.JSONDecodeError):
        return set()

def save_mute_list(muted_set):
    with open(MUTE_FILE, 'w', encoding='utf-8') as f:
        json.dump({"muted": list(muted_set)}, f, ensure_ascii=False, indent=2)

def load_json(filename, default=None):
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default if default is not None else {}

def save_json(filename, data):
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_history():
    return load_json(HISTORY_FILE, {})

def save_history(history):
    save_json(HISTORY_FILE, history)

def filter_fresh_entries(entries, history):
    today = str(date.today())
    sent_titles = set(history.get(today, []))
    fresh = []
    for e in entries:
        if e.title not in sent_titles:
            fresh.append(e)
            sent_titles.add(e.title)
    history[today] = list(sent_titles)
    return fresh

def load_offset():
    try:
        with open(OFFSET_FILE, 'r') as f:
            return int(f.read().strip())
    except (FileNotFoundError, ValueError):
        return 0

def save_offset(offset):
    with open(OFFSET_FILE, 'w') as f:
        f.write(str(offset))

def contains_any(text, phrases):
    text_lower = text.lower()
    return any(phrase in text_lower for phrase in phrases)

def is_addressed_to_yasha(text):
    return 'яша' in text.lower() if text else False

# --- Работа с CoinGecko API ---
def search_coin_id(query):
    url = f'https://api.coingecko.com/api/v3/search?query={query}'
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        if 'coins' in data and data['coins']:
            return data['coins'][0]['id']
    except Exception as e:
        print(f"CoinGecko search error: {e}")
    return None

def detect_coin_id(text):
    text_lower = text.lower()
    for key, cid in SYMBOL_TO_ID.items():
        if key in text_lower:
            return cid
    patterns = [
        r'(?:график|цена|покажи|тренд|куда движется|поддержка|сопротивление)\s+(\w+)',
        r'(\w+)\s+(?:график|цена|покажи|тренд|куда движется|поддержка|сопротивление)',
    ]
    for pat in patterns:
        match = re.search(pat, text_lower)
        if match:
            candidate = match.group(1).strip('.,!?;:')
            if len(candidate) >= 2:
                for key, cid in SYMBOL_TO_ID.items():
                    if key == candidate or key in candidate or candidate in key:
                        return cid
                cid = search_coin_id(candidate)
                if cid:
                    return cid
    words = text_lower.split()
    for w in words:
        w = w.strip('.,!?;:')
        if len(w) >= 3:
            for key, cid in SYMBOL_TO_ID.items():
                if key == w or key in w or w in key:
                    return cid
            cid = search_coin_id(w)
            if cid:
                return cid
    return 'bitcoin'

def fetch_coingecko_ohlc(coin_id, days=30):
    url = f'https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc?vs_currency=usd&days={days}'
    try:
        resp = requests.get(url, timeout=15)
        data = resp.json()
        if not isinstance(data, list) or len(data) < 10:
            return None
        ohlc = []
        for point in data:
            ohlc.append({
                'time': datetime.fromtimestamp(point[0]/1000),
                'open': point[1],
                'high': point[2],
                'low': point[3],
                'close': point[4]
            })
        return ohlc[-200:]
    except Exception as e:
        print(f"CoinGecko OHLC error: {e}")
        return None

def fetch_binance_klines(symbol, interval='1h', limit=200):
    url = f'https://api.binance.com/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}'
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        if not isinstance(data, list):
            return None
        ohlc = []
        for k in data:
            ohlc.append({
                'time': datetime.fromtimestamp(k[0]/1000),
                'open': float(k[1]),
                'high': float(k[2]),
                'low': float(k[3]),
                'close': float(k[4])
            })
        return ohlc
    except Exception as e:
        print(f"Binance error: {e}")
        return None

def find_support_resistance(ohlc, window=10):
    if len(ohlc) < window*2:
        return [], []
    lows = [c['low'] for c in ohlc]
    highs = [c['high'] for c in ohlc]
    support, resistance = [], []
    for i in range(window, len(ohlc)-window):
        if all(lows[i] <= lows[i-j] for j in range(1, window+1)) and all(lows[i] <= lows[i+j] for j in range(1, window+1)):
            support.append((ohlc[i]['time'], lows[i]))
        if all(highs[i] >= highs[i-j] for j in range(1, window+1)) and all(highs[i] >= highs[i+j] for j in range(1, window+1)):
            resistance.append((ohlc[i]['time'], highs[i]))
    return support, resistance

def generate_chart(coin_id):
    reverse_map = {
        'bitcoin': 'BTCUSDT', 'ethereum': 'ETHUSDT', 'solana': 'SOLUSDT',
        'dogecoin': 'DOGEUSDT', 'binancecoin': 'BNBUSDT', 'ripple': 'XRPUSDT',
        'cardano': 'ADAUSDT', 'matic-network': 'MATICUSDT', 'avalanche-2': 'AVAXUSDT',
        'polkadot': 'DOTUSDT', 'chainlink': 'LINKUSDT', 'uniswap': 'UNIUSDT',
        'litecoin': 'LTCUSDT', 'shiba-inu': 'SHIBUSDT', 'pepe': 'PEPEUSDT',
        'optimism': 'OPUSDT', 'arbitrum': 'ARBUSDT', 'aptos': 'APTUSDT',
        'cosmos': 'ATOMUSDT', 'near': 'NEARUSDT', 'sui': 'SUIUSDT',
        'the-open-network': 'TONUSDT'
    }
    symbol = reverse_map.get(coin_id)
    ohlc = None
    source = 'CoinGecko'
    if symbol:
        ohlc = fetch_binance_klines(symbol, '1h', 200)
        if ohlc:
            source = 'Binance'
    if not ohlc:
        ohlc = fetch_coingecko_ohlc(coin_id, 30)
    if not ohlc:
        return None

    support, resistance = find_support_resistance(ohlc)

    fig, ax = plt.subplots(figsize=(10, 5))
    times = [c['time'] for c in ohlc]
    for i, c in enumerate(ohlc):
        color = '#26a69a' if c['close'] >= c['open'] else '#ef5350'
        ax.plot([times[i], times[i]], [c['low'], c['high']], color='black', linewidth=0.5)
        body = abs(c['close'] - c['open']) or 0.0001
        ax.add_patch(plt.Rectangle(
            (mdates.date2num(times[i]) - 0.02, min(c['open'], c['close'])),
            0.04, body, facecolor=color, edgecolor='black', linewidth=0.5))

    closes = np.array([c['close'] for c in ohlc])
    if len(closes) >= 20:
        ma20 = np.convolve(closes, np.ones(20)/20, mode='valid')
        ax.plot(times[19:], ma20, color='blue', linewidth=1, label='MA20')
    if len(closes) >= 50:
        ma50 = np.convolve(closes, np.ones(50)/50, mode='valid')
        ax.plot(times[49:], ma50, color='orange', linewidth=1, label='MA50')

    for t, price in support:
        ax.axhline(y=price, color='green', linestyle='--', linewidth=0.8, alpha=0.7)
    for t, price in resistance:
        ax.axhline(y=price, color='red', linestyle='--', linewidth=0.8, alpha=0.7)

    ax.xaxis.set_major_formatter(mdates.DateFormatter('%d.%m %H:%M'))
    plt.xticks(rotation=45)
    ax.legend()
    ax.set_title(f'{coin_id.upper()} (1h, источник: {source})')
    ax.grid(True, alpha=0.3)
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=100)
    plt.close(fig)
    buf.seek(0)
    return buf

# --- Веб-поиск для мнения ---
def search_web(query, max_results=5):
    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    'title': r['title'],
                    'snippet': r['body'],
                    'url': r['href']
                })
        time.sleep(1)
    except Exception as e:
        print(f"Ошибка DuckDuckGo: {e}")
    return results

def form_opinion(question, search_results):
    if not search_results:
        return "К сожалению, мне не удалось найти свежую информацию по этому вопросу."
    context = "\n".join([f"Источник: {r['title']}\n{r['snippet'][:500]}" for r in search_results[:5]])
    prompt = (
        "Ты — крипто-аналитик с собственным мнением. На основе приведённых источников "
        "сформируй развёрнутое личное мнение по вопросу, ссылаясь на данные. Пиши от первого лица, "
        "уверенно, но с оговорками если данные противоречивы. Добавь вывод в конце.\n\n"
        f"Вопрос: {question}\n\n"
        f"Данные:\n{context}\n\n"
        "Мнение:"
    )
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.8,
            max_tokens=700
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"Groq error: {e}")
        return "Произошла ошибка при формировании мнения."

# --- Новости ---
def fetch_all_feeds():
    all_entries, seen_urls = [], set()
    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                link = entry.get('link', '')
                if link and link not in seen_urls:
                    seen_urls.add(link)
                    all_entries.append(entry)
        except Exception as e:
            print(f"Ошибка парсинга {url}: {e}")
    def get_pub_date(entry):
        try:
            return datetime(*entry.published_parsed[:6])
        except:
            return datetime.min
    all_entries.sort(key=get_pub_date, reverse=True)
    return all_entries[:MAX_NEWS]

def get_background_image(query="crypto blockchain technology"):
    if not UNSPLASH_KEY:
        return None
    url = "https://api.unsplash.com/photos/random"
    params = {"query": query, "orientation": "landscape", "content_filter": "high"}
    headers = {"Authorization": f"Client-ID {UNSPLASH_KEY}"}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        data = resp.json()
        return requests.get(data["urls"]["regular"]).content
    except:
        return None

def create_news_banner(news_title, background_bytes):
    try:
        image = Image.open(io.BytesIO(background_bytes)).resize((1280, 720), Image.LANCZOS)
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype(FONT_PATH, 64) if os.path.exists(FONT_PATH) else ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)
        max_width = 1200
        words = news_title.split()
        lines, current_line = [], ""
        for word in words:
            test_line = f"{current_line} {word}".strip()
            if font.getlength(test_line) < max_width:
                current_line = test_line
            else:
                lines.append(current_line)
                current_line = word
        lines.append(current_line)
        line_height = 80
        padding_top = 30
        padding_bottom = 30
        total_text_height = line_height * len(lines)
        overlay_height = total_text_height + padding_top + padding_bottom
        overlay_y = 720 - overlay_height - 20
        if overlay_y < 0:
            overlay_y = 0
        overlay = Image.new('RGBA', (1280, overlay_height), (0, 0, 0, 180))
        image.paste(overlay, (0, overlay_y), overlay)
        y = overlay_y + padding_top
        for line in lines:
            draw.text((40, y), line, font=font, fill="black", stroke_width=5, stroke_fill="black")
            draw.text((40, y), line, font=font, fill="white")
            y += line_height
        buf = io.BytesIO()
        image.save(buf, format='JPEG')
        buf.seek(0)
        return buf
    except:
        return None

def generate_voice(text: str):
    if not client:
        return None
    try:
        response = client.audio.speech.create(
            model="canopylabs/orpheus-v1-english",
            voice="hannah",
            input=text,
            response_format="wav"
        )
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
            response.write_to_file(tmp_wav.name)
            wav_path = tmp_wav.name
        with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp_ogg:
            ogg_path = tmp_ogg.name
        subprocess.run([
            'ffmpeg', '-y', '-i', wav_path,
            '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k',
            ogg_path
        ], check=True, capture_output=True)
        with open(ogg_path, 'rb') as f:
            voice_data = io.BytesIO(f.read())
        voice_data.seek(0)
        os.unlink(wav_path)
        os.unlink(ogg_path)
        return voice_data
    except:
        return None

async def post_news():
    history = load_history()
    fresh_entries = fetch_all_feeds()
    if not fresh_entries:
        print("Нет новостей.")
        return
    fresh_entries = filter_fresh_entries(fresh_entries, history)[:MAX_NEWS]
    if not fresh_entries:
        save_history(history)
        return
    translated_titles = []
    for e in fresh_entries:
        try:
            translated_titles.append(TRANSLATOR.translate(e.title))
        except:
            translated_titles.append(e.title)
    banner_title = translated_titles[0]
    body_titles = translated_titles[1:] if len(translated_titles) > 1 else []
    headlines_for_ai = "\n".join([f"- {t}" for t in translated_titles])
    ai_text = None
    if client:
        prompt = (
            "Ты — популярный крипто-блогер. Напиши пост в Telegram на русском для этих новостей:\n"
            f"{headlines_for_ai}\n\n"
            "Правила:\n"
            "- Первая новость уже на баннере, не упоминай её в тексте.\n"
            "- Дай яркий общий заголовок и короткий лид.\n"
            "- Для каждой оставшейся новости дай 1-2 сочных предложения с эмодзи.\n"
            "- Разбей на абзацы, закончи живым вопросом или комментарием.\n"
            "- Обязательно умести всё в 800 символов или меньше!"
        )
        models_to_try = ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama-3.1-8b-instant"]
        for model_name in models_to_try:
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.9,
                    max_tokens=400
                )
                raw = response.choices[0].message.content.strip()
                if raw and len(raw) > 15:
                    ai_text = raw[:1000]
                    break
            except:
                pass
    if not ai_text:
        if body_titles:
            emojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
            ai_text = "\n\n".join([f"{emojis[i] if i < len(emojis) else '🔹'} {t}" for i, t in enumerate(body_titles)])
        else:
            ai_text = "🔥 Сегодня одна важная новость (см. на баннере)."
    background = get_background_image()
    banner = create_news_banner(banner_title, background) if background else None
    bot = Bot(token=TELEGRAM_TOKEN)
    try:
        if banner:
            await bot.send_photo(chat_id=CHAT_ID, photo=banner, caption=ai_text[:1024])
        else:
            await bot.send_message(chat_id=CHAT_ID, text=ai_text)
        print("Пост отправлен!")
    except:
        pass
    save_history(history)

async def reply_to_messages():
    if not client:
        return
    bot = Bot(token=TELEGRAM_TOKEN)
    offset = load_offset()
    mute_set = load_mute_list()
    try:
        updates = await bot.get_updates(offset=offset, timeout=10, limit=10)
    except:
        return
    if not updates:
        return
    for update in updates:
        if update.update_id > offset:
            offset = update.update_id
        msg = update.message
        if not msg or not msg.text and not msg.voice:
            continue
        user_id = msg.from_user.id if msg.from_user else None
        # MUTE/UNMUTE
        if user_id and user_id in mute_set:
            if msg.text and contains_any(msg.text, UNMUTE_PHRASES):
                mute_set.discard(user_id)
                save_mute_list(mute_set)
                await bot.send_message(chat_id=msg.chat_id, text="Я снова буду отвечать на ваши сообщения!", reply_to_message_id=msg.message_id)
            continue
        # Админы и боты
        admin_ids_str = os.environ.get('TELEGRAM_ADMIN_IDS', '')
        ADMIN_IDS = set()
        if admin_ids_str:
            try:
                ADMIN_IDS = set(int(uid.strip()) for uid in admin_ids_str.split(',') if uid.strip())
            except:
                pass
        if (user_id and user_id in ADMIN_IDS) or (msg.from_user and msg.from_user.is_bot):
            continue
        # Текст или голос
        user_text = None
        is_voice = False
        if msg.text:
            user_text = msg.text
        elif msg.voice:
            is_voice = True
            voice_file = await bot.get_file(msg.voice.file_id)
            with tempfile.NamedTemporaryFile(delete=True, suffix=".ogg") as tmp:
                await voice_file.download_to_drive(tmp.name)
                try:
                    audio_bytes = open(tmp.name, "rb").read()
                    transcription = client.audio.transcriptions.create(
                        model="whisper-large-v3",
                        file=("voice.ogg", audio_bytes, "audio/ogg"),
                        response_format="text"
                    )
                    user_text = transcription.strip()
                except:
                    await bot.send_message(chat_id=msg.chat_id, text="🎧 Не смог распознать голос.", reply_to_message_id=msg.message_id)
                    continue
        if not user_text:
            continue
        # MUTE/UNMUTE команды
        if msg.text and contains_any(msg.text, MUTE_PHRASES):
            mute_set.add(user_id)
            save_mute_list(mute_set)
            await bot.send_message(chat_id=msg.chat_id, text="Хорошо, я больше не буду отвечать на ваши сообщения. Чтобы возобновить — напишите «можешь отвечать».", reply_to_message_id=msg.message_id)
            continue
        if msg.text and contains_any(msg.text, UNMUTE_PHRASES):
            await bot.send_message(chat_id=msg.chat_id, text="Я и так могу отвечать! 😊", reply_to_message_id=msg.message_id)
            continue
        # Фильтр обращения
        addressed = is_addressed_to_yasha(user_text)
        is_reply_to_bot = msg.reply_to_message and msg.reply_to_message.from_user and msg.reply_to_message.from_user.is_bot
        if not addressed and not is_reply_to_bot:
            continue
        # График
        if contains_any(user_text, CHART_KEYWORDS):
            coin_id = detect_coin_id(user_text)
            chart_buf = generate_chart(coin_id)
            if chart_buf:
                caption = f"Вот график {coin_id.upper()} (1h) с уровнями поддержки и сопротивления."
                if is_voice:
                    voice_data = generate_voice(caption)
                    if voice_data:
                        await bot.send_voice(chat_id=msg.chat_id, voice=voice_data, reply_to_message_id=msg.message_id)
                await bot.send_photo(chat_id=msg.chat_id, photo=chart_buf, caption=caption, reply_to_message_id=msg.message_id)
            else:
                await bot.send_message(chat_id=msg.chat_id, text="Не удалось получить данные для графика. Попробуйте позже.", reply_to_message_id=msg.message_id)
            continue
        # Анализ / мнение
        if contains_any(user_text, ANALYSIS_KEYWORDS):
            question = user_text.lower()
            for phrase in ANALYSIS_KEYWORDS + ['яша', 'яш']:
                question = question.replace(phrase, '')
            question = question.strip(' .,!?;:')
            if not question:
                question = "общая ситуация на крипторынке"
            results = search_web(question + " криптовалюта", max_results=5)
            opinion = form_opinion(question, results)
            if is_voice:
                voice_data = generate_voice(opinion[:300])
                if voice_data:
                    await bot.send_voice(chat_id=msg.chat_id, voice=voice_data, reply_to_message_id=msg.message_id)
            await bot.send_message(chat_id=msg.chat_id, text=opinion, reply_to_message_id=msg.message_id)
            continue
        # Обычный ответ
        messages = [{"role": "system", "content": "Ты — дружелюбный помощник Яша. Отвечай живо, с юмором, эмодзи. Избегай политики, религии, национализма."}]
        if msg.reply_to_message and msg.reply_to_message.text:
            quoted = msg.reply_to_message.text
            if msg.reply_to_message.from_user.is_bot:
                messages.append({"role": "assistant", "content": quoted})
            else:
                messages.append({"role": "user", "content": quoted})
        messages.append({"role": "user", "content": user_text})
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                temperature=0.9,
                max_tokens=500
            )
            reply_text = response.choices[0].message.content.strip()
            if is_voice:
                voice_data = generate_voice(reply_text)
                if voice_data:
                    await bot.send_voice(chat_id=msg.chat_id, voice=voice_data, reply_to_message_id=msg.message_id)
                else:
                    await bot.send_message(chat_id=msg.chat_id, text=reply_text, reply_to_message_id=msg.message_id)
            else:
                await bot.send_message(chat_id=msg.chat_id, text=reply_text, reply_to_message_id=msg.message_id)
        except:
            await bot.send_message(chat_id=msg.chat_id, text="🤷‍♂️ Что-то пошло не так, попробуй позже.", reply_to_message_id=msg.message_id)
    save_offset(offset + 1)

async def main():
    mode = 'all'
    if '--post' in sys.argv:
        mode = 'post'
    elif '--reply' in sys.argv:
        mode = 'reply'
    if mode in ('post', 'all'):
        await post_news()
    if mode in ('reply', 'all'):
        await reply_to_messages()

if __name__ == '__main__':
    asyncio.run(main())
