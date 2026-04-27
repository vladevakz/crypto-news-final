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
from huggingface_hub import InferenceClient

# --- Переменные окружения ---
TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
UNSPLASH_KEY = os.environ.get('UNSPLASH_ACCESS_KEY', None)
HF_TOKEN = os.environ.get('HF_TOKEN', None)
RSS_FEED = os.environ.get('RSS_FEED', 'https://decrypt.co/feed')

# --- Настройки ---
MAX_NEWS = 5
TRANSLATOR = GoogleTranslator(source='auto', target='ru')
feedparser.USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
HISTORY_FILE = 'posted.json'
FONT_PATH = 'Roboto-Bold.ttf'      # если загружен, иначе DejaVu Sans Bold

# Инициализация Hugging Face
hf_client = None
if HF_TOKEN:
    print("Hugging Face: ключ найден, создаю клиента.")
    hf_client = InferenceClient(token=HF_TOKEN)
else:
    print("Hugging Face: ключ НЕ найден, ИИ не будет использоваться.")

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

# --- Картинки (крупный шрифт 60pt) ---
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
            font = ImageFont.truetype(FONT_PATH, 60)
        else:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 60)

        overlay = Image.new('RGBA', (1280, 220), (0, 0, 0, 180))
        image.paste(overlay, (0, 500), overlay)

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

        y = 530
        for line in lines:
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

    translated_titles = []
    for e in fresh_entries:
        try:
            translated_titles.append(TRANSLATOR.translate(e.title))
        except:
            translated_titles.append(e.title)

    banner_title = translated_titles[0]
    body_titles = translated_titles[1:] if len(translated_titles) > 1 else []
    headlines_for_ai = "\n".join([f"- {t}" for t in translated_titles])

    # --- Запрос к Hugging Face (перебор моделей) ---
    ai_text = None
    if hf_client:
        prompt = (
            "Ты — популярный крипто-блогер. Напиши пост в Telegram на русском для этих новостей:\n"
            f"{headlines_for_ai}\n\n"
            "Правила:\n"
            "- Первая новость уже на баннере, не упоминай её в тексте.\n"
            "- Дай яркий общий заголовок и короткий лид.\n"
            "- Для каждой оставшейся новости дай 1-2 сочных предложения с эмодзи.\n"
            "- Разбей на абзацы, закончи живым вопросом или комментарием."
        )
        # Пробуем несколько надёжных моделей
        models_to_try = [
            "google/flan-t5-large",               # меньше 1 млрд параметров, всегда бесплатна
            "mistralai/Mistral-7B-Instruct-v0.1", # популярная, может быть под квотой
            "facebook/bart-large-cnn"             # запасная
        ]
        for model_name in models_to_try:
            try:
                print(f"Пробую модель {model_name}...")
                response = hf_client.text_generation(
                    prompt,
                    model=model_name,
                    max_new_tokens=600,
                    temperature=0.9,
                    do_sample=True,
                    top_p=0.95,
                    repetition_penalty=1.1
                )
                # Ответ может быть строкой или объектом
                text = response if isinstance(response, str) else str(response)
                if text and len(text.strip()) > 10:
                    ai_text = text.strip()
                    print(f"Модель {model_name} вернула текст.")
                    break
                else:
                    print(f"Модель {model_name} вернула пустой ответ.")
            except Exception as e:
                print(f"Ошибка с моделью {model_name}: {type(e).__name__}: {e}")
                continue

    # --- Fallback ---
    if not ai_text:
        print("Используем fallback-перевод.")
        if body_titles:
            emojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
            post_lines = []
            for i, t in enumerate(body_titles):
                emoji = emojis[i] if i < len(emojis) else "🔹"
                post_lines.append(f"{emoji} {t}")
            ai_text = "\n\n".join(post_lines) if post_lines else "🔥 Сегодня одна важная новость (см. на баннере)."
        else:
            ai_text = "🔥 Сегодня одна важная новость (см. на баннере)."

    # --- Баннер и отправка ---
    background = get_background_image()
    banner = None
    if background:
        banner = create_news_banner(banner_title, background)

    bot = Bot(token=TELEGRAM_TOKEN)
    if banner:
        await bot.send_photo(chat_id=CHAT_ID, photo=banner, caption=ai_text, parse_mode='HTML')
    else:
        await bot.send_message(chat_id=CHAT_ID, text=ai_text)
    print("Пост отправлен!")

    save_history(history)

if __name__ == '__main__':
    asyncio.run(main())
