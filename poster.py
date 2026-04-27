import os
import io
import json
import feedparser
import requests
from datetime import date
from deep_translator import GoogleTranslator
from PIL import Image, ImageDraw, ImageFont, ImageOps
from telegram import Bot
import asyncio
import cohere

# --- Переменные окружения ---
TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
UNSPLASH_KEY = os.environ.get('UNSPLASH_ACCESS_KEY', None)
COHERE_KEY = os.environ.get('COHERE_API_KEY', None)
RSS_FEED = os.environ.get('RSS_FEED', 'https://decrypt.co/feed')

# --- Настройки ---
MAX_NEWS = 5
TRANSLATOR = GoogleTranslator(source='auto', target='ru')
feedparser.USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
HISTORY_FILE = 'posted.json'
FONT_PATH = 'Roboto-Bold.ttf'      # если загружен, иначе DejaVu Sans Bold

# Инициализация Cohere с проверкой
if COHERE_KEY:
    print("Cohere: ключ найден, создаю клиента.")
    co = cohere.Client(COHERE_KEY)
else:
    print("Cohere: ключ НЕ найден, ИИ не будет использоваться.")
    co = None

# --- Функции истории ---
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

# --- Картинки с крупным шрифтом и обводкой ---
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

def create_news_banner(title, background_bytes):
    try:
        image = Image.open(io.BytesIO(background_bytes)).resize((1280, 720), Image.LANCZOS)
        draw = ImageDraw.Draw(image)

        # Крупный жирный шрифт (60pt)
        if os.path.exists(FONT_PATH):
            font = ImageFont.truetype(FONT_PATH, 60)
        else:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 60)

        # Полупрозрачная плашка
        overlay = Image.new('RGBA', (1280, 220), (0, 0, 0, 160))
        image.paste(overlay, (0, 500), overlay)

        # Переносим текст
        max_width = 1200
        words = title.split()
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

        # Рисуем белый текст с чёрной обводкой для контраста
        y = 520
        stroke_width = 3
        for line in lines:
            # Обводка (чёрная)
            draw.text((40, y), line, font=font, fill="black",
                      stroke_width=stroke_width, stroke_fill="black")
            # Основной белый текст поверх
            draw.text((40, y), line, font=font, fill="white")
            y += 70

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
    feed = feedparser.parse(RSS_FEED)
    entries = feed.entries[:MAX_NEWS*2]
    fresh_entries = filter_fresh_entries(entries, history)[:MAX_NEWS]
    if not fresh_entries:
        print("Нет новых новостей за сегодня.")
        return

    # Переводим заголовки
    translated_titles = []
    for e in fresh_entries:
        try:
            translated_titles.append(TRANSLATOR.translate(e.title))
        except:
            translated_titles.append(e.title)

    banner_title = translated_titles[0]  # на баннер
    body_titles = translated_titles[1:] if len(translated_titles) > 1 else []
    headlines_for_ai = "\n".join([f"- {t}" for t in translated_titles])

    # --- Попытка Cohere ---
    ai_text = None
    if co:
        prompt = (
            "Ты — популярный крипто-блогер с отличным чувством юмора. У тебя есть пять заголовков новостей:\n"
            f"{headlines_for_ai}\n\n"
            "Важно: на баннере уже будет крупно написан заголовок первой новости, поэтому НЕ включай его в текст поста. "
            "Напиши живой пост для Telegram на русском языке. Следуй правилам:\n"
            "1. Придумай яркий общий заголовок (с эмодзи) и короткий лид-абзац — это будет начало поста.\n"
            "2. Затем для каждой новости (начиная со второй, первую пропускаем) дай один-два сочных предложения с личным мнением.\n"
            "3. Разбивай текст на абзацы, используй эмодзи умеренно.\n"
            "4. В конце — короткий живой комментарий или вопрос читателям.\n"
            "Формат: сначала общий заголовок и лид, потом каждая новость с новой строки, без нумерации.\n"
        )
        try:
            print("Отправляю запрос в Cohere...")
            response = co.generate(
                model='command-r',
                prompt=prompt,
                max_tokens=800,
                temperature=0.9
            )
            ai_text = response.generations[0].text.strip()
            print("Cohere сгенерировал пост.")
        except Exception as e:
            print(f"Ошибка Cohere: {type(e).__name__}: {e}")

    # --- Fallback без лишнего вступления ---
    if not ai_text:
        print("Используем fallback без ИИ.")
        if body_titles:
            emojis = ["🥈", "🥉", "4️⃣", "5️⃣", "6️⃣"]
            post_lines = []
            for i, t in enumerate(body_titles):
                emoji = emojis[i] if i < len(emojis) else "🔹"
                post_lines.append(f"{emoji} {t}")
            ai_text = "\n\n".join(post_lines) if post_lines else "🔥 Сегодня одна важная новость (см. на баннере)."
        else:
            ai_text = "🔥 Сегодня одна важная новость (см. на баннере)."

    # --- Баннер ---
    background = get_background_image()
    banner = None
    if background:
        banner = create_news_banner(banner_title, background)

    # --- Отправка ---
    bot = Bot(token=TELEGRAM_TOKEN)
    if banner:
        await bot.send_photo(chat_id=CHAT_ID, photo=banner, caption=ai_text, parse_mode='HTML')
    else:
        await bot.send_message(chat_id=CHAT_ID, text=ai_text)
    print("Пост отправлен!")

    save_history(history)

if __name__ == '__main__':
    asyncio.run(main())
