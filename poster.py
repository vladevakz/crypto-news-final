import os
import feedparser
from google import genai
from google.genai import types
from telegram import Bot
import asyncio

TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']
GEMINI_KEY = os.environ['GEMINI_API_KEY']
RSS_FEED = os.environ.get('RSS_FEED', 'https://decrypt.co/feed')

client = genai.Client(api_key=GEMINI_KEY)
feedparser.USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

async def main():
    feed = feedparser.parse(RSS_FEED)
    print(f"Источник 1 ({RSS_FEED}): статус {feed.status}, найдено {len(feed.entries)} новостей")
    entries = feed.entries[:5]

    if not entries:
        backup_url = 'https://cointelegraph.com/rss'
        print(f"Первичный источник пуст. Пробуем {backup_url}")
        feed = feedparser.parse(backup_url)
        print(f"Источник 2: статус {feed.status}, найдено {len(feed.entries)} новостей")
        entries = feed.entries[:5]

    if not entries:
        print("Новостей нет нигде. Выход.")
        return

    headlines = "\n".join([f"- {e.title}" for e in entries])
    prompt = (
        "Ты — редактор крипто-новостей. Сделай из этих заголовков привлекательный "
        "пост для Telegram. Используй эмодзи, разбивай на абзацы, сохраняй смысл. "
        "Вот заголовки:\n" + headlines
    )

    try:
        response = client.models.generate_content(
            model='gemini-2.0-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction="Ты — редактор крипто-новостей."
            )
        )
        post_text = response.text
        print("ИИ успешно обработал новости.")
    except Exception as e:
        print(f"Ошибка Gemini: {e}")
        post_text = "🔥 Свежие новости криптомира:\n\n" + headlines

    bot = Bot(token=TELEGRAM_TOKEN)
    await bot.send_message(chat_id=CHAT_ID, text=post_text, parse_mode='HTML')
    print("Сообщение отправлено в канал!")

if __name__ == '__main__':
    asyncio.run(main())
