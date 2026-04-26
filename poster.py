import os
import io
import feedparser
import requests
from deep_translator import GoogleTranslator
from PIL import Image, ImageDraw, ImageFont
from telegram import Bot
import asyncio

# --- Переменные окружения из секретов GitHub ---
TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
UNSPLASH_KEY = os.environ.get('UNSPLASH_ACCESS_KEY', None)  # Не падаем, если нет ключа
RSS_FEED = os.environ.get('RSS_FEED', 'https://decrypt.co/feed')

# --- Настройки ---
MAX_NEWS = 5
TRANSLATOR = GoogleTranslator(source='auto', target='ru')
feedparser.USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'

def get_background_image(query="crypto blockchain technology"):
    """Ищет тематическую картинку через Unsplash API. Нужен ключ."""
    if not UNSPLASH_KEY:
        print("Unsplash: ключ не задан, пропускаем.")
        return None
    url = "https://api.unsplash.com/photos/random"
    params = {
        "query": query,
        "orientation": "landscape",
        "content_filter": "high"
    }
    headers = {"Authorization": f"Client-ID {UNSPLASH_KEY}"}
    
    try:
        response = requests.get(url, params=params, headers=headers, timeout=10)
        data = response.json()
        image_url = data["urls"]["regular"]
        print(f"Unsplash: найдено изображение по запросу '{query}'")
        return requests.get(image_url).content
    except Exception as e:
        print(f"Ошибка Unsplash: {e}")
        return None

def create_news_banner(news_title, background_bytes):
    """Создаёт изображение-баннер с заголовком новости."""
    try:
        image = Image.open(io.BytesIO(background_bytes))
        image = image.resize((1280, 720), Image.LANCZOS)
        draw = ImageDraw.Draw(image)
        
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
        except IOError:
            font = ImageFont.load_default()
        
        overlay = Image.new('RGBA', (1280, 200), (0, 0, 0, 128))
        image.paste(overlay, (0, 520), overlay)
        
        if font.getlength(news_title) > 1200:
            words = news_title.split()
            lines = []
            current_line = ""
            for word in words:
                test_line = f"{current_line} {word}".strip()
                if font.getlength(test_line) < 1200:
                    current_line = test_line
                else:
                    lines.append(current_line)
                    current_line = word
            lines.append(current_line)
            
            y_offset = 540
            for line in lines:
                draw.text((40, y_offset), line, font=font, fill="white")
                y_offset += 45
        else:
            draw.text((40, 560), news_title, font=font, fill="white")
        
        img_byte_arr = io.BytesIO()
        image.save(img_byte_arr, format='JPEG')
        img_byte_arr.seek(0)
        return img_byte_arr
    except Exception as e:
        print(f"Ошибка Pillow: {e}")
        return None

async def main():
    # --- 1. Парсим новости ---
    feed = feedparser.parse(RSS_FEED)
    print(f"Источник: {RSS_FEED}, статус: {feed.status}, найдено: {len(feed.entries)}")
    
    entries = feed.entries[:MAX_NEWS]
    if not entries:
        print("Нет новостей.")
        return

    # --- 2. Переводим и готовим пост ---
    post_lines = [""]
    for i, entry in enumerate(entries, 1):
        try:
            translated_title = TRANSLATOR.translate(entry.title)
            post_lines.append(f"{i}. {translated_title}")
        except Exception as e:
            print(f"Ошибка перевода: {e}")
            post_lines.append(f"{i}. {entry.title}")
    
    post_text = "\n".join(post_lines)
    print("Перевод завершён.")

    # --- 3. Получаем картинку для фона ---
    background = get_background_image()
    banner_image = None
    if background:
        first_title = entries[0].title
        try:
            first_title = TRANSLATOR.translate(first_title)
        except:
            pass
        banner_image = create_news_banner(first_title, background)

    # --- 4. Отправляем в Telegram ---
    bot = Bot(token=TELEGRAM_TOKEN)
    
    if banner_image:
        await bot.send_photo(
            chat_id=CHAT_ID,
            photo=banner_image,
            caption=post_text,
            parse_mode='HTML'
        )
        print("Пост с баннером отправлен!")
    else:
        await bot.send_message(chat_id=CHAT_ID, text=post_text)
        print("Баннер не создан (нет ключа или ошибка), отправлен только текст.")

if __name__ == '__main__':
    asyncio.run(main())
