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

# Импорт для Gemini (Ваш текущий вариант)
import google.generativeai as genai

# Импорты для Hugging Face и Cohere (если захотите попробовать)
# from huggingface_hub import InferenceClient
# import cohere

# --- Переменные окружения из секретов ---
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
FONT_PATH = 'Roboto-Bold.ttf'

# Инициализация Gemini
genai.configure(api_key=GEMINI_KEY)

# Инициализация Cohere (если будете использовать)
# co = cohere.Client(os.environ.get('COHERE_API_KEY'))

# Инициализация Hugging Face (если будете использовать)
# hf_client = InferenceClient(token=os.environ.get('HF_API_KEY'))

# --- Вспомогательные функции (история, картинки) без изменений ---
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
        try:
            font = ImageFont.truetype(FONT_PATH, 48)
        except IOError:
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

# --- Главная логика с ИИ ---
async def main():
    # 1. Парсинг и фильтрация
    history = load_history()
    feed = feedparser.parse(RSS_FEED)
    entries = feed.entries[:MAX_NEWS*2]
    fresh_entries = filter_fresh_entries(entries, history)[:MAX_NEWS]
    if not fresh_entries:
        print("No new entries today.")
        return

    # 2. Готовим «живой» пост через Gemini
    headlines = "\n".join([f"- {e.title}" for e in fresh_entries])
    prompt = (
        "Ты — главный редактор популярного крипто-канала. Креативно переработай эти заголовки в готовый пост на русском языке.\n\n"
        "Требования:\n"
        "- Дай броский заголовок для всего поста.\n"
        "- Кратко (1-2 предложения) поясни каждую новость.\n"
        "- Используй эмодзи и живое, хулиганское, но профессиональное оформление.\n"
        "- Разбей текст на абзацы для лёгкого чтения.\n\n"
        f"Вот заголовки:\n{headlines}"
    )

    print("Generating post with Gemini...")
    # Вместо 'gemini-1.5-flash' используем надёжную модель
    model = genai.GenerativeModel('gemini-pro')
    response = model.generate_content(prompt)
    post_text = response.text
    print("AI post generated.")

    # --- Альтернатива: Заменить блок выше на вызов Cohere или Hugging Face ---
    # # Cohere:
    # response = co.generate(
    #     model='command-r',
    #     prompt=prompt,
    #     max_tokens=800,
    #     temperature=0.9
    # )
    # post_text = response.generations[0].text
    #
    # # Hugging Face:
    # response = hf_client.text_generation(
    #     prompt,
    #     model="mistralai/Mixtral-8x7B-Instruct-v0.1", # Пример модели
    #     max_new_tokens=800,
    #     temperature=0.9
    # )
    # post_text = response

    # --- Отправка ---
    bot = Bot(token=TELEGRAM_TOKEN)
    banner = None
    background = get_background_image()
    if background:
        first_title = fresh_entries[0].title
        try:
            first_title = TRANSLATOR.translate(first_title)
        except:
            pass
        banner = create_news_banner(first_title, background)

    if banner:
        await bot.send_photo(chat_id=CHAT_ID, photo=banner, caption=post_text, parse_mode='HTML')
    else:
        await bot.send_message(chat_id=CHAT_ID, text=post_text)
    print("Post sent!")

    save_history(history)

if __name__ == '__main__':
    asyncio.run(main())
