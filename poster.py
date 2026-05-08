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
# Локальный словарь монет (как раньше)
SYMBOL_TO_ID = { ... }   # оставлен без изменений, слишком длинный для копирования – он уже есть у вас

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

# --- Веб-поиск для мнения ---
def search_web(query, max_results=5):
    """Быстрый поиск через DuckDuckGo, возвращает список (title, snippet, url)."""
    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    'title': r['title'],
                    'snippet': r['body'],
                    'url': r['href']
                })
        time.sleep(1)  # небольшая задержка для вежливости
    except Exception as e:
        print(f"Ошибка DuckDuckGo: {e}")
    return results

def form_opinion(question, search_results):
    """Формирует развёрнутое 'мнение' на основе поисковых данных."""
    if not search_results:
        return "К сожалению, мне не удалось найти свежую информацию по этому вопросу. Попробуйте позже."

    context = "\n".join([f"Источник: {r['title']}\n{r['snippet'][:500]}" for r in search_results[:5]])
    prompt = (
        "Ты — крипто-аналитик с собственным мнением. На основе приведённых ниже источников "
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

# ... (остальные функции: новости, баннер, голос, графики – без изменений)
# Для краткости я приведу только изменённую часть reply_to_messages

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
            # ... (весь блок построения графика как раньше)
            continue
        # Анализ / мнение
        if contains_any(user_text, ANALYSIS_KEYWORDS):
            # Извлекаем тему (убираем ключевые фразы и имя)
            question = user_text.lower()
            for phrase in ANALYSIS_KEYWORDS + ['яша', 'яш']:
                question = question.replace(phrase, '')
            question = question.strip(' .,!?;:')
            if not question:
                question = "общая ситуация на крипторынке"
            # Уведомляем о начале анализа (опционально)
            # await bot.send_message(chat_id=msg.chat_id, text="Собираю информацию и формирую мнение...", reply_to_message_id=msg.message_id)
            results = search_web(question + " криптовалюта", max_results=5)
            opinion = form_opinion(question, results)
            # Отправка ответа
            if is_voice:
                voice_data = generate_voice(opinion[:300])  # голосовое – короткая версия
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

# ... (остальное без изменений)
