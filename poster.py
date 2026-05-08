import os
import io
import json
import sys
import asyncio
import tempfile
import subprocess
import feedparser
import requests
from datetime import date, datetime
from deep_translator import GoogleTranslator
from PIL import Image, ImageDraw, ImageFont
from telegram import Bot
from openai import OpenAI

# --- Переменные окружения (секреты GitHub) ---
TELEGRAM_TOKEN = os.environ['TELEGRAM_BOT_TOKEN']
CHAT_ID = os.environ['TELEGRAM_CHAT_ID']          # канал/чат для новостей
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
USER_PREFS_FILE = 'user_prefs.json'
FONT_PATH = 'Roboto-Bold.ttf'

# Инициализация Groq
client = OpenAI(api_key=GROQ_KEY, base_url="https://api.groq.com/openai/v1") if GROQ_KEY else None

# --- Фразы для mute / unmute (естественный язык) ---
MUTE_PHRASES = [
    'не отвечай', 'перестань отвечать', 'больше не отвечай', 'не пиши', 'замолчи',
    'отстань', 'молчи', 'не нужно отвечать', 'не отвечайте мне', 'не надо отвечать',
    'перестань писать', 'больше не пиши', 'не хочу получать сообщения', 'отключи ответы'
]
UNMUTE_PHRASES = [
    'можешь отвечать', 'отвечай', 'снова отвечай', 'начни отвечать', 'разрешаю отвечать',
    'включи ответы', 'можешь снова отвечать', 'продолжай отвечать', 'возобнови ответы',
    'я снова хочу получать сообщения', 'давай отвечай'
]

# -------------------- Утилиты для mute --------------------
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

# --- Утилиты для user_prefs (restricted/unrestricted) – оставлены на будущее ---
def load_user_prefs():
    try:
        with open(USER_PREFS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def save_user_prefs(prefs):
    with open(USER_PREFS_FILE, 'w', encoding='utf-8') as f:
        json.dump(prefs, f, ensure_ascii=False, indent=2)

# -------------------- Утилиты истории (без изменений) --------------------
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
    """Проверяет, содержит ли сообщение обращение к Яше (регистронезависимо)."""
    if not text:
        return False
    return 'яша' in text.lower()

# -------------------- Сбор новостей (без изменений) --------------------
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

# -------------------- Картинки (без изменений) --------------------
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
        font = None
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

# -------------------- Синтез речи (Groq Orpheus) --------------------
def generate_voice(text: str) -> io.BytesIO | None:
    if not client:
        print("Groq клиент не инициализирован, синтез речи невозможен.")
        return None

    try:
        print(f"Синтезирую голос для текста: {text[:70]}...")
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

        print(f"Голосовое сообщение сгенерировано ({voice_data.getbuffer().nbytes} байт)")
        return voice_data

    except Exception as e:
        print(f"Ошибка при синтезе речи: {e}")
        return None

# -------------------- Публикация новостей --------------------
async def post_news():
    history = load_history()
    fresh_entries = fetch_all_feeds()
    if not fresh_entries:
        print("Нет новостей.")
        return False

    fresh_entries = filter_fresh_entries(fresh_entries, history)[:MAX_NEWS]
    if not fresh_entries:
        print("Нет новых новостей за сегодня (все уже были).")
        save_history(history)
        return True

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
                    if len(raw) > 1000:
                        raw = raw[:997] + "..."
                    ai_text = raw
                    print(f"Groq ({model_name}) сгенерировал пост ({len(ai_text)} символов).")
                    break
            except Exception as e:
                print(f"Ошибка с моделью {model_name}: {type(e).__name__}: {e}")

    if not ai_text:
        print("Используем fallback-перевод.")
        if body_titles:
            emojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"]
            post_lines = [f"{emojis[i] if i < len(emojis) else '🔹'} {t}" for i, t in enumerate(body_titles)]
            ai_text = "\n\n".join(post_lines)
        else:
            ai_text = "🔥 Сегодня одна важная новость (см. на баннере)."

    background = get_background_image()
    banner = None
    if background:
        banner = create_news_banner(banner_title, background)

    bot = Bot(token=TELEGRAM_TOKEN)
    try:
        if banner:
            await bot.send_photo(chat_id=CHAT_ID, photo=banner, caption=ai_text[:1024])
        else:
            await bot.send_message(chat_id=CHAT_ID, text=ai_text)
        print("Пост отправлен!")
    except Exception as e:
        print(f"Ошибка отправки поста: {e}")
        return False

    save_history(history)
    return True

# -------------------- Ответы на сообщения (ТОЛЬКО при обращении "Яша" или в ответ на бота) --------------------
async def reply_to_messages():
    if not client:
        print("Нет Groq ключа, ответы отключены.")
        return

    bot = Bot(token=TELEGRAM_TOKEN)
    offset = load_offset()
    mute_set = load_mute_list()

    print(f"Проверяю сообщения, начиная с offset={offset}")

    try:
        updates = await bot.get_updates(offset=offset, timeout=10, limit=10)
    except Exception as e:
        print(f"Ошибка получения обновлений: {e}")
        return

    if not updates:
        print("Нет новых сообщений.")
        return

    for update in updates:
        if update.update_id > offset:
            offset = update.update_id
        msg = update.message
        if not msg or not msg.text and not msg.voice:
            continue

        user_id = msg.from_user.id if msg.from_user else None

        # --- MUTE/UNMUTE (всегда работает) ---
        if user_id and user_id in mute_set:
            if msg.text and contains_any(msg.text, UNMUTE_PHRASES):
                mute_set.discard(user_id)
                save_mute_list(mute_set)
                await bot.send_message(
                    chat_id=msg.chat_id,
                    text="Я снова буду отвечать на ваши сообщения!",
                    reply_to_message_id=msg.message_id
                )
                print(f"Пользователь {user_id} размучен.")
            else:
                print(f"Пропущено сообщение от пользователя {user_id} (в муте).")
            continue

        # --- Админы и боты игнорируются ---
        admin_ids_str = os.environ.get('TELEGRAM_ADMIN_IDS', '')
        ADMIN_IDS = set()
        if admin_ids_str:
            try:
                ADMIN_IDS = set(int(uid.strip()) for uid in admin_ids_str.split(',') if uid.strip())
            except ValueError:
                pass
        if (user_id and user_id in ADMIN_IDS) or (msg.from_user and msg.from_user.is_bot):
            print(f"Пропущено сообщение от админа/бота (ID {user_id})")
            continue

        # Получаем текст сообщения (распознаём голос)
        user_text = None
        is_voice_message = False
        if msg.text:
            user_text = msg.text
        elif msg.voice:
            is_voice_message = True
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
                    print(f"Распознан голосовой текст: {user_text}")
                except Exception as e:
                    print(f"Ошибка распознавания голоса: {e}")
                    await bot.send_message(
                        chat_id=msg.chat_id,
                        text="🎧 Не смог распознать голос.",
                        reply_to_message_id=msg.message_id
                    )
                    continue

        if not user_text:
            continue

        # --- Запросы на MUTE/UNMUTE (текстовые) ---
        if msg.text and contains_any(msg.text, MUTE_PHRASES):
            mute_set.add(user_id)
            save_mute_list(mute_set)
            await bot.send_message(
                chat_id=msg.chat_id,
                text="Хорошо, я больше не буду отвечать на ваши сообщения. Если захотите возобновить — напишите «можешь отвечать».",
                reply_to_message_id=msg.message_id
            )
            print(f"Пользователь {user_id} замучен.")
            continue

        if msg.text and contains_any(msg.text, UNMUTE_PHRASES):
            await bot.send_message(
                chat_id=msg.chat_id,
                text="Я и так могу отвечать! Не переживайте 😊",
                reply_to_message_id=msg.message_id
            )
            continue

        # ========== ГЛАВНЫЙ ФИЛЬТР ==========
        # Определяем, нужно ли отвечать:
        # 1. Сообщение адресовано Яше (есть "яша" в тексте)
        # 2. Сообщение является ответом на сообщение бота (цитирует бота)
        addressed = is_addressed_to_yasha(user_text)
        is_reply_to_bot = msg.reply_to_message and msg.reply_to_message.from_user and msg.reply_to_message.from_user.is_bot

        if not addressed and not is_reply_to_bot:
            print(f"Игнорируем (не обращено к Яше и не ответ боту): {user_text[:60]}")
            continue
        # =====================================

        # --- Формирование контекста с учётом цитируемого сообщения ---
        messages = []
        system_prompt = (
            "Ты — дружелюбный помощник, которого зовут Яша. Ты общаешься со своей аудиторией в Telegram. "
            "Отвечай живо, с юмором, эмодзи, как человек, на любые темы. "
            "Если собеседник затрагивает политику, религию, национализм или любые острые социальные темы, "
            "ты должен мягко и с юмором уйти от ответа: пошути, переведи разговор на что-то нейтральное, "
            "задай встречный вопрос о любимых фильмах, книгах, увлечениях. "
            "Ни в коем случае не высказывай собственного мнения по политике или вере."
        )
        messages.append({"role": "system", "content": system_prompt})

        # Проверяем наличие цитируемого сообщения
        if msg.reply_to_message and msg.reply_to_message.text:
            quoted_text = msg.reply_to_message.text
            quoted_from_bot = msg.reply_to_message.from_user.is_bot if msg.reply_to_message.from_user else False
            if quoted_from_bot:
                # Цитируется ответ бота — добавляем как сообщение ассистента
                messages.append({"role": "assistant", "content": quoted_text})
            else:
                # Цитируется сообщение пользователя — добавляем как ещё один user-контекст
                messages.append({"role": "user", "content": quoted_text})
        
        # Добавляем текущее сообщение пользователя
        messages.append({"role": "user", "content": user_text})

        # --- Генерация AI-ответа ---
        try:
            response = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=messages,
                temperature=0.9,
                max_tokens=500
            )
            reply_text = response.choices[0].message.content.strip()

            if is_voice_message:
                voice_data = generate_voice(reply_text)
                if voice_data:
                    await bot.send_voice(
                        chat_id=msg.chat_id,
                        voice=voice_data,
                        reply_to_message_id=msg.message_id
                    )
                else:
                    await bot.send_message(
                        chat_id=msg.chat_id,
                        text=reply_text,
                        reply_to_message_id=msg.message_id
                    )
            else:
                await bot.send_message(
                    chat_id=msg.chat_id,
                    text=reply_text,
                    reply_to_message_id=msg.message_id
                )
            print(f"Ответ отправлен на сообщение {msg.message_id}")
        except Exception as e:
            print(f"Ошибка генерации ответа: {e}")
            await bot.send_message(
                chat_id=msg.chat_id,
                text="🤷‍♂️ Что-то пошло не так, попробуй позже.",
                reply_to_message_id=msg.message_id
            )

    offset += 1
    save_offset(offset)
    print(f"Offset обновлён: {offset}")

# -------------------- Точка входа --------------------
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
