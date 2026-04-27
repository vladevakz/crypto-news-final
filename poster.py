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

# --- Переменные окружения из секретов ---
TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
UNSPLASH_KEY = os.environ.get('UNSPLASH_ACCESS_KEY', None)
RSS_FEED = os.environ.get('RSS_FEED', 'https://decrypt.co/feed')

# --- Настройки ---
MAX_NEWS = 5
TRANSLATOR = GoogleTranslator(source='auto', target='ru')
feedparser.USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
HISTORY_FILE = 'posted.json'                     # файл с историей
FONT_PATH = 'Roboto-Bold.ttf'                    # наш загруженный шрифт

def load_history():
    """Загружает словарь {дата: [список заголовков]} из posted.json."""
    try:
        with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_history(history):
    """Сохраняет историю обратно в файл."""
    with open(HISTORY_FILE, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False, indent=2)

def filter_fresh_entries(entries, history):
    """Возвращает только те новости, заголовки которых ещё не публиковались сегодня."""
    today = str(date.today())
    sent_titles = set(history.get(today, []))
    fresh = []
    for e in entries:
        if e.title not in sent_titles:
            fresh.append(e)
            sent_titles.add(e.title)
    # Обновляем историю для текущего дня
    history[today] = list(sent_titles)
    return fresh

def get_background_image(query="crypto blockchain technology"):
    if not UNSPLASH_KEY:
        print("Unsplash: ключ не задан, баннер не создаётся.")
        return None
    url = "https://api.unsplash.com/photos/random"
    params = {"query": query, "orientation": "landscape", "content_filter": "high"}
    headers = {"Authorization": f"Client-ID {UNSPLASH_KEY}"}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        data = resp.json()
        img_url = data["urls"]["regular"]
        print(f"Unsplash: найдено изображение по запросу '{query}'")
        return requests.get(img_url).content
    except Exception as e:
        print(f"Ошибка Unsplash: {e}")
        return None

def create_news_banner(news_title, background_bytes):
    """Создаёт изображение-баннер с жирным шрифтом."""
    try:
        image = Image.open(io.BytesIO(background_bytes)).resize((1280, 720), Image.LANCZOS)
        draw = ImageDraw.Draw(image)

        # Используем загруженный жирный шрифт, размер 48
        try:
            font = ImageFont.truetype(FONT_PATH, 48)
        except IOError:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)

        # Полупрозрачная плашка для читаемости
        overlay = Image.new('RGBA', (1280, 200), (0, 0, 0, 160))
        image.paste(overlay, (0, 520), overlay)

        # Перенос строк
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
        print(f"Ошибка Pillow: {e}")
        return None

async def main():
    # 1. Загружаем историю и парсим RSS
    history = load_history()
    feed = feedparser.parse(RSS_FEED)
    print(f"Источник: {RSS_FEED}, статус: {feed.status}, найдено: {len(feed.entries)}")

    # 2. Фильтруем только свежие за день
    entries = feed.entries[:MAX_NEWS*2]   # берём с запасом
    fresh_entries = filter_fresh_entries(entries, history)[:MAX_NEWS]
    if not fresh_entries:
        print("Нет новых новостей за сегодня.")
        return

    # 3. Переводим заголовки
    post_lines = [""]
    for i, entry in enumerate(fresh_entries, 1):
        try:
            trans_title = TRANSLATOR.translate(entry.title)
        except Exception as e:
            print(f"Ошибка перевода: {e}")
            trans_title = entry.title
        post_lines.append(f"{i}. {trans_title}")

    post_text = "\n".join(post_lines)
    print("Перевод завершён.")

    # 4. Баннер с картинкой
    background = get_background_image()
    banner = None
    if background:
        first_title = fresh_entries[0].title
        try:
            first_title = TRANSLATOR.translate(first_title)
        except:
            pass
        banner = create_news_banner(first_title, background)

    # 5. Отправка в Telegram
    bot = Bot(token=TELEGRAM_TOKEN)
    if banner:
        await bot.send_photo(chat_id=CHAT_ID, photo=banner, caption=post_text, parse_mode='HTML')
        print("Пост с баннером отправлен!")
    else:
        await bot.send_message(chat_id=CHAT_ID, text=post_text)
        print("Баннер не создан, отправлен только текст.")

    # 6. Сохраняем обновлённую историю
    save_history(history)
    print("История сохранена в posted.json")

if __name__ == '__main__':
    asyncio.run(main())
