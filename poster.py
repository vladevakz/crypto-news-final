import os
import io
import json
import feedparser
import requests
from datetime import date
from deep_translator import GoogleTranslator
from PIL import Image, ImageDraw, ImageFont
from telegram import Bot
import asyncio
import google.generativeai as genai

# --- Переменные окружения ---
TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
GEMINI_KEY = os.environ.get('GEMINI_API_KEY', None)
UNSPLASH_KEY = os.environ.get('UNSPLASH_ACCESS_KEY', None)
RSS_FEED = os.environ.get('RSS_FEED', 'https://decrypt.co/feed')

# --- Настройки ---
MAX_NEWS = 5
TRANSLATOR = GoogleTranslator(source='auto', target='ru')
feedparser.USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
HISTORY_FILE = 'posted.json'
FONT_PATH = 'Roboto-Bold.ttf'  # если загрузите жирный шрифт в корень; иначе будет DejaVu Sans Bold

# Инициализация Gemini
genai.configure(api_key=GEMINI_KEY)

# --- Функции истории (без изменений) ---
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

# --- Функции картинок (с fallback-шрифтом) ---
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

        # Пробуем использовать загруженный Roboto-Bold.ttf
        if os.path.exists(FONT_PATH):
            font = ImageFont.truetype(FONT_PATH, 48)
        else:
            # если нет – дефолтный жирный DejaVu Sans на GitHub Actions
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)

        overlay = Image.new('RGBA', (1280, 200), (0, 0, 0, 160))
        image.paste(overlay, (0, 520), overlay)

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

        y = 540
        for line in lines:
            draw.text((40, y), line, font=font, fill="white")
            y += 55

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

    # Собираем заголовки для ИИ
    headlines = "\n".join([f"- {e.title}" for e in fresh_entries])

    # Улучшенный промпт – теперь Gemini будет стараться делать пост «с перчинкой»
    prompt = (
        "Ты — популярный крипто-блогер с отличным чувством юмора. У тебя есть пять свежих заголовков:\n"
        f"{headlines}\n\n"
        "Сделай из этого яркий пост для Telegram на русском языке. Строго следуй правилам:\n"
        "1. Придумай цепляющий заголовок для всего поста (обязательно с эмодзи), который заинтригует.\n"
        "2. Для каждой новости дай одну короткую, но сочную фразу с личным мнением (ироничным, дерзким, но профессиональным).\n"
        "3. Разбавляй эмодзи, не перегружай.\n"
        "4. Разбей текст на абзацы, чтобы читалось легко.\n"
        "5. Никаких списков вида «1. 2. 3.» – просто живой текст.\n\n"
        "Формат вывода:\n"
        "🔥 ТВОЙ ЗАГОЛОВОК\n\n"
        "Короткий лид-абзац.\n\n"
        "• Пояснение первой новости\n\n"
        "• Пояснение второй новости\n\n"
        "... и так далее\n\n"
        "Живой комментарий в конце.\n"
    )

    # Пытаемся получить креативный пост от Gemini
    ai_text = None
    try:
    # Пробуем актуальную бесплатную модель
    model = genai.GenerativeModel('gemini-1.0-pro')
    response = model.generate_content(prompt)
    ai_text = response.text
    print("ИИ сгенерировал креативный пост.")
except Exception as e:
    print(f"Ошибка Gemini: {type(e).__name__}: {e}")
    # Попробуем ещё одну модель, если первая не сработала
    try:
        model = genai.GenerativeModel('gemini-1.5-flash-latest')
        response = model.generate_content(prompt)
        ai_text = response.text
        print("ИИ сгенерировал креативный пост (через gemini-1.5-flash-latest).")
    except Exception as e2:
        print(f"Ошибка Gemini (вторая попытка): {type(e2).__name__}: {e2}")

    # Если Gemini не смог или отказался – делаем обычный перевод с форматированием
    if not ai_text:
        print("Используем fallback-перевод.")
        post_lines = [""]  # <-- Вот так правильно, с закрытой скобкой
        for i, entry in enumerate(fresh_entries, 1):
            try:
                trans_title = TRANSLATOR.translate(entry.title)
            except:
                trans_title = entry.title
            post_lines.append(f"{i}. {trans_title}")
        ai_text = "\n".join(post_lines)

    # Баннер
    banner = None
    background = get_background_image()
    if background:
        first_title = fresh_entries[0].title
        try:
            first_title = TRANSLATOR.translate(first_title)
        except:
            pass
        banner = create_news_banner(first_title, background)

    # Отправка
    bot = Bot(token=TELEGRAM_TOKEN)
    if banner:
        await bot.send_photo(chat_id=CHAT_ID, photo=banner, caption=ai_text, parse_mode='HTML')
    else:
        await bot.send_message(chat_id=CHAT_ID, text=ai_text)
    print("Пост отправлен!")

    save_history(history)

if __name__ == '__main__':
    asyncio.run(main())
