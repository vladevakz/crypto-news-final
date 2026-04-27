document.addEventListener('DOMContentLoaded', () => {
const REPO = 'vladevakz/crypto-news-final';

const $ = id => document.getElementById(id);

let GH_TOKEN = localStorage.getItem('gh_token') || '';
let TG_BOT_TOKEN = localStorage.getItem('tg_bot_token') || '';
let TG_CHAT_ID = localStorage.getItem('tg_chat_id') || '';
let GROQ_KEY = localStorage.getItem('groq_key') || '';

if ($('gh-token-input')) $('gh-token-input').value = GH_TOKEN;
if ($('tg-bot-token-input')) $('tg-bot-token-input').value = TG_BOT_TOKEN;
if ($('tg-chat-id-input')) $('tg-chat-id-input').value = TG_CHAT_ID;
if ($('groq-key-input')) $('groq-key-input').value = GROQ_KEY;
if ($('settings-status')) showStatus('settings-status', '✅ Настройки загружены', 'success');

// --- Переключение вкладок ---
window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    const target = $(`tab-${tabName}`);
    if (target) target.classList.add('active');
    // Найти кнопку, которая вызвала событие, и подсветить её
    const btn = document.querySelector(`.tab-btn[onclick*="${tabName}"]`);
    if (btn) btn.classList.add('active');
    else event.target.classList.add('active');
};

// --- Вспомогательные функции ---
function showStatus(elementId, message, type) {
    const el = $(elementId); if (!el) return;
    el.innerHTML = `<div class="status ${type}">${message}</div>`;
}
function githubHeaders() {
    return { 'Authorization': `token ${GH_TOKEN}`, 'Accept': 'application/vnd.github+json' };
}

// Проверка токена GitHub
function requireToken() {
    if (!GH_TOKEN) {
        alert('Сначала сохраните GitHub Token на вкладке "Настройки"');
        return false;
    }
    return true;
}

// --- Сохранение токенов ---
window.saveSettings = function() {
    GH_TOKEN = $('gh-token-input').value.trim();
    TG_BOT_TOKEN = $('tg-bot-token-input').value.trim();
    TG_CHAT_ID = $('tg-chat-id-input').value.trim();
    GROQ_KEY = $('groq-key-input').value.trim();
    ['gh_token','tg_bot_token','tg_chat_id','groq_key'].forEach((k,i) => {
        const v = [GH_TOKEN,TG_BOT_TOKEN,TG_CHAT_ID,GROQ_KEY][i];
        if (v) localStorage.setItem(k, v);
    });
    showStatus('settings-status', '💾 Настройки сохранены', 'success');
    if (GH_TOKEN) initData();
};

// --- Запуск workflow ---
window.dispatchWorkflow = async function(workflowFile, btnId) {
    if (!requireToken()) return;
    const btn = $(btnId); if (!btn) return;
    btn.disabled = true;
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`, {
            method: 'POST', headers: githubHeaders(), body: JSON.stringify({ ref: 'main' })
        });
        const msg = res.ok ? '✅ Workflow запущен!' : `❌ Ошибка: ${(await res.json()).message}`;
        showStatus('dispatch-status', msg, res.ok?'success':'error');
    } catch(e) { showStatus('dispatch-status', '❌ Сетевая ошибка', 'error'); }
    btn.disabled = false;
};

// --- Проверка системы ---
window.checkHealth = async function() {
    if (!requireToken()) return;
    const results = [];
    try {
        const r = await fetch('https://api.github.com/user', { headers: githubHeaders() });
        results.push(r.ok ? '✅ GitHub Token валиден' : '❌ Ошибка токена');
    } catch(e) { results.push('❌ GitHub недоступен'); }

    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.workflows) {
            const names = d.workflows.map(w=>w.name);
            results.push(names.includes('Post News') ? '✅ "Post News" есть' : '❌ "Post News" нет');
            results.push(names.includes('Reply to Messages') ? '✅ "Reply to Messages" есть' : '❌ "Reply to Messages" нет');
        }
    } catch(e) { results.push('❌ Ошибка получения workflows'); }

    if (GROQ_KEY) {
        try {
            const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${GROQ_KEY}` } });
            results.push(r.ok ? '✅ Groq API доступен' : '❌ Ошибка Groq');
        } catch(e) { results.push('❌ Groq сеть'); }
    } else results.push('⚠️ Groq Key не введён');

    for (const f of ['posted.json','update_offset.txt','feeds.json','prompt.json']) {
        try {
            const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: githubHeaders() });
            results.push(r.ok ? `✅ ${f}` : `❌ ${f} не найден`);
        } catch(e) { results.push(`❌ ${f} ошибка`); }
    }

    const allOk = results.every(r => r.startsWith('✅') || r.startsWith('⚠️'));
    if ($('health-status')) $('health-status').innerHTML = results.join('<br>') + `<br><b>${allOk?'✅ Всё работает':'❌ Есть проблемы'}</b>`;
};

// --- Статистика новостей ---
async function loadNewsStats() {
    if (!GH_TOKEN) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/posted.json`, { headers: githubHeaders() });
        const d = await r.json();
        if (!d.content) return;
        const posted = JSON.parse(atob(d.content.replace(/\n/g,'')));
        const today = new Date().toISOString().slice(0,10);
        let todayCount = 0, weekCount = 0;
        const weekAgo = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
        Object.entries(posted).forEach(([date, titles]) => {
            if (date === today) todayCount = titles.length;
            if (date >= weekAgo) weekCount += titles.length;
        });
        if ($('news-stats')) $('news-stats').innerHTML = `Сегодня: ${todayCount} новостей<br>За неделю: ${weekCount} новостей`;
    } catch(e) { if ($('news-stats')) $('news-stats').textContent = 'Ошибка'; }
}

// История запусков
async function loadRuns(workflowFile, elId) {
    if (!GH_TOKEN) return;
    const el = $(elId); if (!el) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/runs?per_page=5`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.workflow_runs) {
            el.innerHTML = d.workflow_runs.map(r => {
                const dt = new Date(r.created_at).toLocaleString('ru-RU');
                const cls = r.conclusion || 'pending';
                return `<div class="log-item"><span>${dt}</span><span class="conclusion ${cls}">${cls}</span></div>`;
            }).join('');
        }
    } catch(e) { el.innerHTML = 'Ошибка'; }
}

// Загрузка файлов
async function loadFile(path, elId) {
    if (!GH_TOKEN) return;
    const el = $(elId); if (!el) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.content) el.textContent = atob(d.content.replace(/\n/g,''));
    } catch(e) { el.textContent = 'Ошибка'; }
}

// --- RSS-источники ---
async function loadFeedsUI() {
    if (!GH_TOKEN) return;
    try {
        let feeds = [];
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/feeds.json`, { headers: githubHeaders() });
        if (r.ok) {
            const d = await r.json();
            feeds = JSON.parse(atob(d.content.replace(/\n/g,'')));
        } else {
            feeds = [
                'https://decrypt.co/feed',
                'https://www.coindesk.com/arc/outboundfeeds/rss/',
                'https://cointelegraph.com/rss',
                'https://www.cnbc.com/id/10001147/device/rss/rss.html'
            ];
        }
        const div = $('feeds-list');
        div.innerHTML = feeds.map((f,i) => `<div class="feed-item"><input value="${f}" data-index="${i}"><button onclick="deleteFeed(${i})">❌</button></div>`).join('');
        window._feedsData = feeds;
    } catch(e) { $('feeds-list').innerHTML = 'Ошибка'; }
}
window.addFeed = function() {
    const input = $('new-feed-input');
    if (!input.value) return;
    if (!window._feedsData) window._feedsData = [];
    window._feedsData.push(input.value);
    input.value = '';
    loadFeedsUI();
};
window.deleteFeed = function(index) {
    window._feedsData.splice(index,1);
    loadFeedsUI();
};
window.saveFeeds = async function() {
    if (!requireToken() || !window._feedsData) return;
    const content = JSON.stringify(window._feedsData, null, 2);
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/feeds.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/feeds.json`, {
            method: 'PUT', headers: githubHeaders(),
            body: JSON.stringify({ message: 'Update feeds', content: btoa(unescape(encodeURIComponent(content))), sha })
        });
        alert('Feeds сохранены');
    } catch(e) { alert('Ошибка сохранения'); }
};

// --- Промпт ---
async function loadPromptUI() {
    if (!GH_TOKEN) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/prompt.json`, { headers: githubHeaders() });
        if (r.ok) {
            const d = await r.json();
            const prompt = JSON.parse(atob(d.content.replace(/\n/g,'')));
            $('system-prompt-input').value = prompt.system_prompt || '';
        }
    } catch(e) {}
}
window.savePrompt = async function() {
    if (!requireToken()) return;
    const content = JSON.stringify({ system_prompt: $('system-prompt-input').value });
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/prompt.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/prompt.json`, {
            method: 'PUT', headers: githubHeaders(),
            body: JSON.stringify({ message: 'Update prompt', content: btoa(unescape(encodeURIComponent(content))), sha })
        });
        showStatus('prompt-status','✅ Промпт сохранён','success');
    } catch(e) { showStatus('prompt-status','❌ Ошибка','error'); }
};

// --- Блокированные слова ---
async function loadBlockedUI() {
    if (!GH_TOKEN) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/blocked.json`, { headers: githubHeaders() });
        if (r.ok) {
            const d = await r.json();
            const blocked = JSON.parse(atob(d.content.replace(/\n/g,'')));
            $('blocked-input').value = blocked.join(', ');
        }
    } catch(e) {}
}
window.saveBlocked = async function() {
    if (!requireToken()) return;
    const words = $('blocked-input').value.split(',').map(s=>s.trim()).filter(Boolean);
    const content = JSON.stringify(words);
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/blocked.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/blocked.json`, {
            method: 'PUT', headers: githubHeaders(),
            body: JSON.stringify({ message: 'Update blocked words', content: btoa(unescape(encodeURIComponent(content))), sha })
        });
        showStatus('blocked-status','✅ Список сохранён','success');
    } catch(e) { showStatus('blocked-status','❌ Ошибка','error'); }
};

// --- Unsplash query ---
async function loadUnsplashUI() {
    if (!GH_TOKEN) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/unsplash.json`, { headers: githubHeaders() });
        if (r.ok) {
            const d = await r.json();
            const q = JSON.parse(atob(d.content.replace(/\n/g,''))).query;
            $('unsplash-query-input').value = q;
        }
    } catch(e) {}
}
window.saveUnsplashQuery = async function() {
    if (!requireToken()) return;
    const content = JSON.stringify({ query: $('unsplash-query-input').value });
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/unsplash.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/unsplash.json`, {
            method: 'PUT', headers: githubHeaders(),
            body: JSON.stringify({ message: 'Update unsplash query', content: btoa(unescape(encodeURIComponent(content))), sha })
        });
        showStatus('unsplash-status','✅ Запрос сохранён','success');
    } catch(e) { showStatus('unsplash-status','❌ Ошибка','error'); }
};

// --- Отправка кастомного сообщения ---
window.sendCustomMessage = async function() {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) return alert('Введите токены Telegram');
    const text = $('custom-msg-text').value;
    try {
        const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: TG_CHAT_ID, text })
        });
        const d = await r.json();
        showStatus('custom-msg-status', d.ok ? '✅ Отправлено' : `❌ ${d.description}`, d.ok?'success':'error');
    } catch(e) { showStatus('custom-msg-status','❌ Ошибка сети','error'); }
};

// --- Логи последнего запуска ---
window.viewLatestLogs = async function() {
    if (!requireToken()) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/reply-messages.yml/runs?per_page=1`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.workflow_runs?.[0]) {
            $('logs-output').innerHTML = `<a href="${d.workflow_runs[0].html_url}" target="_blank">Открыть в GitHub</a>`;
        } else $('logs-output').textContent = 'Нет запусков';
    } catch(e) { $('logs-output').textContent = 'Ошибка'; }
};

// --- Последние сообщения ---
window.loadRecentMessages = async function() {
    if (!TG_BOT_TOKEN) return alert('Нужен токен бота');
    try {
        const offset = localStorage.getItem('last_msg_offset') || 0;
        const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getUpdates?offset=${offset}&limit=5`);
        const d = await r.json();
        if (d.ok && d.result.length) {
            let html = '';
            d.result.forEach(u => {
                const msg = u.message || u.edited_message;
                if (msg && msg.text) {
                    html += `<div class="log-item"><span>${msg.from?.first_name||'?'}: ${msg.text.slice(0,40)}</span></div>`;
                }
            });
            $('recent-messages').innerHTML = html || 'Нет текстовых';
            const maxId = Math.max(...d.result.map(u=>u.update_id));
            localStorage.setItem('last_msg_offset', maxId+1);
        } else $('recent-messages').textContent = 'Нет новых сообщений';
    } catch(e) { $('recent-messages').textContent = 'Ошибка'; }
};

// --- Сброс истории ---
window.resetHistory = async function() {
    if (!requireToken()) return;
    for (const [path, content] of [['posted.json','{}'],['update_offset.txt','0']]) {
        try {
            const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
            const d = await r.json();
            await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
                method: 'PUT', headers: githubHeaders(),
                body: JSON.stringify({ message: `Reset ${path}`, content: btoa(unescape(encodeURIComponent(content))), sha: d.sha })
            });
        } catch(e) {}
    }
    showStatus('reset-status','✅ История сброшена','success');
    initData();
};

// --- Резервное копирование ---
window.downloadBackup = async function() {
    const files = ['posted.json','update_offset.txt'];
    let zip = '';
    for (const f of files) {
        try {
            const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: githubHeaders() });
            const d = await r.json();
            if (d.content) zip += `=== ${f} ===\n` + atob(d.content.replace(/\n/g,'')) + '\n\n';
        } catch(e) {}
    }
    const blob = new Blob([zip], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bot-backup.txt';
    a.click();
};
window.uploadBackup = function() {
    $('backup-file-input').click();
};
$('backup-file-input').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const parts = text.split(/=== (.+?) ===\n/);
    for (let i=1; i<parts.length; i+=2) {
        const filename = parts[i];
        const content = parts[i+1].trim();
        try {
            const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${filename}`, { headers: githubHeaders() });
            const d = await r.json();
            await fetch(`https://api.github.com/repos/${REPO}/contents/${filename}`, {
                method: 'PUT', headers: githubHeaders(),
                body: JSON.stringify({ message: `Restore ${filename}`, content: btoa(unescape(encodeURIComponent(content))), sha: d.sha })
            });
        } catch(e) {}
    }
    showStatus('backup-status','✅ Восстановлено','success');
    initData();
});

// --- Обновление cron ---
window.updateCron = async function(wf, inputId) {
    if (!requireToken()) return;
    const newCron = $(inputId).value;
    try {
        const path = `.github/workflows/${wf}`;
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
        const d = await r.json();
        let content = atob(d.content.replace(/\n/g,''));
        content = content.replace(/cron:\s*'[^']+'/, `cron: '${newCron}'`);
        await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
            method: 'PUT', headers: githubHeaders(),
            body: JSON.stringify({ message: `Update cron ${wf}`, content: btoa(unescape(encodeURIComponent(content))), sha: d.sha })
        });
        showStatus('cron-status', `✅ ${wf} обновлён`, 'success');
    } catch(e) { showStatus('cron-status','❌ Ошибка','error'); }
};

// --- AI Models ---
async function loadModelsUI() {
    if (!GH_TOKEN) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/models.json`, { headers: githubHeaders() });
        if (r.ok) {
            const d = await r.json();
            const m = JSON.parse(atob(d.content.replace(/\n/g,'')));
            $('chat-model-select').value = m.chat || 'llama-3.3-70b-versatile';
            $('tts-model-select').value = m.tts || 'canopylabs/orpheus-v1-english';
            $('tts-voice-select').value = m.voice || 'hannah';
        }
    } catch(e) {}
}
window.saveAIModels = async function() {
    if (!requireToken()) return;
    const data = {
        chat: $('chat-model-select').value,
        tts: $('tts-model-select').value,
        voice: $('tts-voice-select').value
    };
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/models.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/models.json`, {
            method: 'PUT', headers: githubHeaders(),
            body: JSON.stringify({ message: 'Update AI models', content: btoa(unescape(encodeURIComponent(JSON.stringify(data)))), sha })
        });
        showStatus('models-status','✅ Модели сохранены','success');
    } catch(e) { showStatus('models-status','❌ Ошибка','error'); }
};

// --- MAX_NEWS ---
async function loadMaxNewsUI() {
    if (!GH_TOKEN) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/config.json`, { headers: githubHeaders() });
        if (r.ok) {
            const d = await r.json();
            const cfg = JSON.parse(atob(d.content.replace(/\n/g,'')));
            $('max-news-input').value = cfg.MAX_NEWS || 5;
        }
    } catch(e) {}
}
window.saveMaxNews = async function() {
    if (!requireToken()) return;
    const max = parseInt($('max-news-input').value);
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/config.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        let cfg = {};
        if (sha) cfg = JSON.parse(atob(d.content.replace(/\n/g,'')));
        cfg.MAX_NEWS = max;
        await fetch(`https://api.github.com/repos/${REPO}/contents/config.json`, {
            method: 'PUT', headers: githubHeaders(),
            body: JSON.stringify({ message: 'Update MAX_NEWS', content: btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))), sha })
        });
        showStatus('maxnews-status','✅ MAX_NEWS сохранено','success');
    } catch(e) { showStatus('maxnews-status','❌ Ошибка','error'); }
};

// --- GitHub limits ---
window.checkGitHubLimits = async function() {
    if (!requireToken()) return;
    try {
        const r = await fetch('https://api.github.com/rate_limit', { headers: githubHeaders() });
        const d = await r.json();
        const core = d.resources?.core;
        if (core) {
            const resetDate = new Date(core.reset * 1000).toLocaleTimeString('ru-RU');
            $('limits-output').innerHTML = `
                Осталось: ${core.remaining} / ${core.limit} запросов<br>
                Сброс в: ${resetDate}
            `;
        } else {
            $('limits-output').textContent = 'Не удалось получить лимиты';
        }
    } catch(e) { $('limits-output').textContent = 'Ошибка'; }
};

// --- Error notifications ---
async function loadErrorNotifyUI() {
    if (!GH_TOKEN) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/notify.json`, { headers: githubHeaders() });
        if (r.ok) {
            const d = await r.json();
            const n = JSON.parse(atob(d.content.replace(/\n/g,'')));
            $('error-notify-checkbox').checked = n.enabled || false;
        }
    } catch(e) {}
}
window.saveErrorNotify = async function() {
    if (!requireToken()) return;
    const enabled = $('error-notify-checkbox').checked;
    try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/notify.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/notify.json`, {
            method: 'PUT', headers: githubHeaders(),
            body: JSON.stringify({ message: 'Update error notify', content: btoa(unescape(encodeURIComponent(JSON.stringify({enabled})))), sha })
        });
        showStatus('notify-status','✅ Настройка уведомлений сохранена','success');
    } catch(e) { showStatus('notify-status','❌ Ошибка','error'); }
};

// --- Инициализация данных ---
function initData() {
    loadRuns('post-news.yml','news-runs');
    loadRuns('reply-messages.yml','reply-runs');
    loadFile('posted.json','posted-json');
    loadFile('update_offset.txt','offset-txt');
    loadFile('feeds.json','feeds-json');
    loadFile('prompt.json','prompt-json');
    loadNewsStats();
    loadFeedsUI();
    loadPromptUI();
    loadBlockedUI();
    loadUnsplashUI();
    loadModelsUI();
    loadMaxNewsUI();
    loadErrorNotifyUI();
}
if (GH_TOKEN) initData();
});
