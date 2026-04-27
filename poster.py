import os
import io
import json
import feedparser
import requests
from datetime import date, datetime
from deep_translator import GoogleTranslator
from PIL import Image, ImageDraw, ImageFont
from telegram import Bot
import asyncio
from openai import OpenAI

# --- Переменные окружения (секреты GitHub) ---
TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
UNSPLASH_KEY = os.environ.get('UNSPLASH_ACCESS_KEY', None)
GROQ_KEY = os.environ.get('GROQ_API_KEY', None)

# --- Список RSS-источников (можно редактировать) ---
RSS_FEEDS = [
    'https://decrypt.co/feed',
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
    'https://www.cnbc.com/id/10001147/device/rss/rss.html'
]

# --- Настройки ---
MAX_NEWS = 5
TRANSLATOR = GoogleTranslator(source='auto', target='ru')
feedparser.USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
HISTORY_FILE = 'posted.json'
FONT_PATH = 'Roboto-Bold.ttf'   # если загружен, иначе DejaVuSans-Bold

# Инициализация Groq
if GROQ_KEY:
    print("Groq: ключ найден, создаю клиента.")
    client = OpenAI(api_key=GROQ_KEY, base_url="https://api.groq.com/openai/v1")
else:
    print("Groq: ключ НЕ найден, ИИ не будет использоваться.")
    client = None

# --- Функции для истории (чтобы не повторяться) ---
def load_history():
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_history(history):
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

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

# --- Сбор и отбор популярных новостей ---
def fetch_all_feeds():
    all_entries = []
    seen_urls = set()

    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries:
                link = entry.get('link', '')
                if link and link not in seen_urls:
                    seen_urls.add(link)
                    all_entries.append(entry)
            print(f"Источник {url}: получено {len(feed.entries)} записей")
        except Exception as e:
            print(f"Ошибка при парсинге {url}: {e}")

    def get_pub_date(entry):
        try:
            return datetime(*entry.published_parsed[:6])
        except:
            return datetime.min

    all_entries.sort(key=get_pub_date, reverse=True)
    return all_entries[:MAX_NEWS]

# --- Картинки (баннер с динамической плашкой и отступами) ---
def get_background_image(query="crypto blockchain technology"):
    if not UNSPLASH_KEY:
        return None
    url = "https://api.unsplash.com/photos/random"
    params = {"query": query, "orientation": "landscape", "content_filter": "high"}
    headers = {"Authorization": f"Client-ID {UNSPLASH_KEY}"}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        data = resp.json()
        img_url = data["urls"]["regular"]
        return requests.get(img_url).content
    except Exception as e:
        print(f"Unsplash error: {e}")
        return None

def create_news_banner(news_title, background_bytes):
    try:
        image = Image.open(io.BytesIO(background_bytes)).resize((1280, 720), Image.LANCZOS)
        draw = ImageDraw.Draw(image)

        if os.path.exists(FONT_PATH):
            font = ImageFont.truetype(FONT_PATH, 64)
        else:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)

        max_width = 1200
        words = news_title.split()
        lines = []
        current_line = ""
        for word in words:
            test_line = f"{current_line} {word}".strip()
            if font.getlength(test_line) < max_width:
                current_line = test_line
            else:
                lines.append(current_line)
                current_line = word
        lines.append(current_line)

        # Параметры плашки
        line_height = 80
        padding_top = 30
        padding_bottom = 30
        total_text_height = line_height * len(lines)
        overlay_height = total_text_height + padding_top + padding_bottom

        # Плашка внизу, с отступом 20px от края
        overlay_y = 720 - overlay_height - 20
        if overlay_y < 0:
            overlay_y = 0

        overlay = Image.new('RGBA', (1280, overlay_height), (0, 0, 0, 180))
        image.paste(overlay, (0, overlay_y), overlay)

        # Рисуем текст внутри плашки
        y = overlay_y + padding_top
        stroke_width = 5
        for line in lines:
            draw.text((40, y), line, font=font, fill="black", stroke_width=stroke_width, stroke_fill="black")
            draw.text((40, y), line, font=font, fill="white")
            y += line_height

        buf = io.BytesIO()
        image.save(buf, format='JPEG')
        buf.seek(0)
        return buf
    except Exception as e:
        print(f"Pillow error: {e}")
        return None

# --- Главная логика ---
async def main():
    history = load_history()
    fresh_entries = fetch_all_feeds()
    if not fresh_entries:
        print("Нет новостей.")
        return

    fresh_entries = filter_fresh_entries(fresh_entries, history)[:MAX_NEWS]
    if not fresh_entries:
        print("Нет новых новостей за сегодня (все уже были).")
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

    # --- Генерация через Groq ---
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
                print(f"Пробую модель {model_name}...")
                response = client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.9,
                    max_tokens=400
                )
                raw = response.choices[0].message.content.strip()
                if raw and len(raw) > 15:
                    if len(raw) > 1000:
                        raw = raw[:997] + "..."
                    ai_text = raw
                    print(f"Groq ({model_name}) сгенерировал пост ({len(ai_text)} символов).")
                    break
            except Exception as e:
                print(f"Ошибка с моделью {model_name}: {type(e).__name__}: {e}")

    # --- Fallback ---
    if not ai_text:
        print("Используем fallback-перевод.")
        if body_titles:
            emojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
            post_lines = []
            for i, t in enumerate(body_titles):
                emoji = emojis[i] if i < len(emojis) else "🔹"
                post_lines.append(f"{emoji} {t}")
            ai_text = "\n\n".join(post_lines)
        else:
            ai_text = "🔥 Сегодня одна важная новость (см. на баннере)."

    # --- Баннер и отправка ---
    background = get_background_image()
    banner = None
    if background:
        banner = create_news_banner(banner_title, background)

    bot = Bot(token=TELEGRAM_TOKEN)
    if banner:
        await bot.send_photo(chat_id=CHAT_ID, photo=banner, caption=ai_text[:1024])
    else:
        await bot.send_message(chat_id=CHAT_ID, text=ai_text)
    print("Пост отправлен!")

    save_history(history)

if __name__ == '__main__':
    asyncio.run(main())
