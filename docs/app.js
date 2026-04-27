document.addEventListener('DOMContentLoaded', () => {

const REPO = 'vladevakz/crypto-news-final';

// Элементы
const ghTokenInput = document.getElementById('gh-token-input');
const tgBotTokenInput = document.getElementById('tg-bot-token-input');
const tgChatIdInput = document.getElementById('tg-chat-id-input');
const groqKeyInput = document.getElementById('groq-key-input');
const settingsStatus = document.getElementById('settings-status');
const dispatchStatus = document.getElementById('dispatch-status');
const newsRuns = document.getElementById('news-runs');
const replyRuns = document.getElementById('reply-runs');
const postedJson = document.getElementById('posted-json');
const offsetTxt = document.getElementById('offset-txt');
const healthStatus = document.getElementById('health-status');
const logsOutput = document.getElementById('logs-output');
const resetStatus = document.getElementById('reset-status');
const testMsgStatus = document.getElementById('test-msg-status');
const groqStatsOutput = document.getElementById('groq-stats-output');
const newsCronInput = document.getElementById('news-cron');
const replyCronInput = document.getElementById('reply-cron');

// Загрузка сохранённых значений
let GH_TOKEN = localStorage.getItem('gh_token') || '';
let TG_BOT_TOKEN = localStorage.getItem('tg_bot_token') || '';
let TG_CHAT_ID = localStorage.getItem('tg_chat_id') || '';
let GROQ_KEY = localStorage.getItem('groq_key') || '';

// Заполняем поля
if (ghTokenInput) ghTokenInput.value = GH_TOKEN;
if (tgBotTokenInput) tgBotTokenInput.value = TG_BOT_TOKEN;
if (tgChatIdInput) tgChatIdInput.value = TG_CHAT_ID;
if (groqKeyInput) groqKeyInput.value = GROQ_KEY;

// Показываем, что настройки загружены
showStatus('settings-status', '✅ Настройки загружены', 'success');

function showStatus(elementId, message, type) {
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = `<div class="status ${type}">${message}</div>`;
}

// Сохранение настроек
window.saveSettings = function() {
    GH_TOKEN = ghTokenInput.value.trim();
    TG_BOT_TOKEN = tgBotTokenInput.value.trim();
    TG_CHAT_ID = tgChatIdInput.value.trim();
    GROQ_KEY = groqKeyInput.value.trim();

    if (GH_TOKEN) localStorage.setItem('gh_token', GH_TOKEN);
    if (TG_BOT_TOKEN) localStorage.setItem('tg_bot_token', TG_BOT_TOKEN);
    if (TG_CHAT_ID) localStorage.setItem('tg_chat_id', TG_CHAT_ID);
    if (GROQ_KEY) localStorage.setItem('groq_key', GROQ_KEY);

    showStatus('settings-status', '💾 Настройки сохранены', 'success');
    // Автоматически перезагружаем историю, если токен был изменён
    if (GH_TOKEN) {
        loadRuns('post-news.yml', 'news-runs');
        loadRuns('reply-messages.yml', 'reply-runs');
        loadFile('posted.json', 'posted-json');
        loadFile('update_offset.txt', 'offset-txt');
    }
};

// GitHub API хелпер
function githubHeaders() {
    return {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github+json'
    };
}

// Запуск workflow
window.dispatchWorkflow = async function(workflowFile, btnId) {
    if (!GH_TOKEN) return alert('Введите GitHub Token и нажмите «Сохранить»');
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = true;
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`, {
            method: 'POST',
            headers: githubHeaders(),
            body: JSON.stringify({ ref: 'main' })
        });
        if (res.ok) {
            showStatus('dispatch-status', '✅ Workflow запущен!', 'success');
        } else {
            const err = await res.json();
            showStatus('dispatch-status', `❌ Ошибка: ${err.message}`, 'error');
        }
    } catch(e) {
        showStatus('dispatch-status', `❌ Сетевая ошибка: ${e.message}`, 'error');
    }
    btn.disabled = false;
    setTimeout(() => {
        const el = document.getElementById('dispatch-status');
        if (el) el.innerHTML = '';
    }, 5000);
};

// История запусков
async function loadRuns(workflowFile, elementId) {
    if (!GH_TOKEN) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/runs?per_page=5`, { headers: githubHeaders() });
        const data = await res.json();
        if (data.workflow_runs) {
            let html = '';
            data.workflow_runs.forEach(run => {
                const date = new Date(run.created_at).toLocaleString('ru-RU');
                const conclusion = run.conclusion || 'pending';
                html += `<div class="log-item">
                    <span>${date}</span>
                    <span class="conclusion ${conclusion}">${conclusion}</span>
                </div>`;
            });
            el.innerHTML = html || 'Нет запусков';
        }
    } catch(e) {
        el.innerHTML = 'Ошибка загрузки';
    }
}

// Загрузка файлов
async function loadFile(path, elementId) {
    if (!GH_TOKEN) return;
    const el = document.getElementById(elementId);
    if (!el) return;
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
        const data = await res.json();
        if (data.content) {
            const content = atob(data.content.replace(/\n/g, ''));
            el.textContent = content;
        } else {
            el.textContent = 'Пусто или ошибка';
        }
    } catch(e) {
        el.textContent = 'Ошибка загрузки';
    }
}

// Проверка системы
window.checkHealth = async function() {
    if (!GH_TOKEN) return alert('Введите GitHub Token');
    const statusDiv = document.getElementById('health-status');
    if (!statusDiv) return;
    statusDiv.innerHTML = '<div class="status loading">⏳ Проверка...</div>';
    const results = [];

    try {
        const userRes = await fetch('https://api.github.com/user', { headers: githubHeaders() });
        if (userRes.ok) results.push('✅ GitHub Token валиден');
        else results.push('❌ Ошибка GitHub Token: ' + (await userRes.json()).message);
    } catch(e) { results.push('❌ Сеть / GitHub недоступен'); }

    try {
        const wfRes = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, { headers: githubHeaders() });
        const wfData = await wfRes.json();
        if (wfData.workflows) {
            const names = wfData.workflows.map(w => w.name);
            results.push(names.includes('Post News') ? '✅ Workflow "Post News" найден' : '❌ "Post News" отсутствует');
            results.push(names.includes('Reply to Messages') ? '✅ Workflow "Reply to Messages" найден' : '❌ "Reply to Messages" отсутствует');
        } else results.push('❌ Не удалось получить список workflows');
    } catch(e) { results.push('❌ Ошибка получения workflows'); }

    if (GROQ_KEY) {
        try {
            const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
            });
            results.push(groqRes.ok ? '✅ Groq API доступен' : '❌ Groq API ошибка');
        } catch(e) { results.push('❌ Groq API сеть недоступна'); }
    } else results.push('⚠️ Groq Key не введён');

    for (const f of ['posted.json', 'update_offset.txt']) {
        try {
            const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: githubHeaders() });
            results.push(res.ok ? `✅ ${f} доступен` : `❌ ${f} не найден`);
        } catch(e) { results.push(`❌ Ошибка доступа к ${f}`); }
    }

    const allOk = results.every(r => r.startsWith('✅') || r.startsWith('⚠️'));
    statusDiv.innerHTML = results.map(r => `<div>${r}</div>`).join('') +
        `<div style="margin-top:8px;font-weight:bold;">${allOk ? '✅ Все системы работают' : '❌ Обнаружены проблемы'}</div>`;
};

// Обновление cron
window.updateCron = async function(workflowFile, inputId) {
    if (!GH_TOKEN) return alert('Введите GitHub Token');
    const inputEl = document.getElementById(inputId);
    if (!inputEl) return;
    const newCron = inputEl.value.trim();
    try {
        const path = `.github/workflows/${workflowFile}`;
        const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
        const data = await getRes.json();
        if (!data.content) return alert('Файл не найден');
        let content = atob(data.content.replace(/\n/g, ''));
        content = content.replace(/cron:\s*'[^']+'/, `cron: '${newCron}'`);
        const encoded = btoa(unescape(encodeURIComponent(content)));
        const putRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
            method: 'PUT',
            headers: githubHeaders(),
            body: JSON.stringify({
                message: `Update cron for ${workflowFile}`,
                content: encoded,
                sha: data.sha
            })
        });
        if (putRes.ok) {
            showStatus('dispatch-status', `✅ Расписание ${workflowFile} обновлено`, 'success');
        } else {
            const err = await putRes.json();
            showStatus('dispatch-status', `❌ Ошибка: ${err.message}`, 'error');
        }
    } catch(e) {
        showStatus('dispatch-status', `❌ Сетевая ошибка: ${e.message}`, 'error');
    }
};

// Логи последнего запуска
window.viewLatestLogs = async function() {
    if (!GH_TOKEN) return alert('Введите GitHub Token');
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/reply-messages.yml/runs?per_page=1`, {
            headers: githubHeaders()
        });
        const data = await res.json();
        if (data.workflow_runs && data.workflow_runs.length > 0) {
            const run = data.workflow_runs[0];
            const htmlUrl = run.html_url;
            const conclusion = run.conclusion || 'pending';
            logsOutput.innerHTML = `
                <p>Последний запуск: ${conclusion}</p>
                <a href="${htmlUrl}" target="_blank">Открыть в GitHub</a>
            `;
        } else {
            logsOutput.innerHTML = 'Нет запусков';
        }
    } catch(e) {
        logsOutput.innerHTML = 'Ошибка';
    }
};

// Сброс истории
window.resetHistory = async function() {
    if (!GH_TOKEN) return alert('Введите GitHub Token');
    const files = {
        'posted.json': '{}',
        'update_offset.txt': '0'
    };
    for (const [path, content] of Object.entries(files)) {
        try {
            const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
            const data = await getRes.json();
            if (!data.sha) continue;
            const encoded = btoa(unescape(encodeURIComponent(content)));
            await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
                method: 'PUT',
                headers: githubHeaders(),
                body: JSON.stringify({
                    message: `Reset ${path}`,
                    content: encoded,
                    sha: data.sha
                })
            });
        } catch(e) { console.error(e); }
    }
    showStatus('reset-status', '✅ История сброшена', 'success');
    loadFile('posted.json', 'posted-json');
    loadFile('update_offset.txt', 'offset-txt');
};

// Тестовое сообщение
window.testMessage = async function() {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) return alert('Введите Telegram Bot Token и Chat ID в настройках');
    try {
        const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TG_CHAT_ID,
                text: '🧪 Тестовое сообщение из админки. Всё работает!'
            })
        });
        const data = await res.json();
        if (data.ok) {
            showStatus('test-msg-status', '✅ Сообщение отправлено', 'success');
        } else {
            showStatus('test-msg-status', `❌ Ошибка: ${data.description}`, 'error');
        }
    } catch(e) {
        showStatus('test-msg-status', '❌ Ошибка сети', 'error');
    }
};

// Статистика Groq
window.groqStats = async function() {
    if (!GROQ_KEY) return alert('Введите Groq API Key');
    try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
        });
        const data = await res.json();
        if (data.data) {
            const models = data.data.map(m => m.id).join(', ');
            groqStatsOutput.textContent = `Доступные модели: ${models}`;
        } else {
            groqStatsOutput.textContent = 'Ошибка получения моделей';
        }
    } catch(e) {
        groqStatsOutput.textContent = 'Ошибка сети';
    }
};

// Первоначальная загрузка истории, если токен уже есть
if (GH_TOKEN) {
    loadRuns('post-news.yml', 'news-runs');
    loadRuns('reply-messages.yml', 'reply-runs');
    loadFile('posted.json', 'posted-json');
    loadFile('update_offset.txt', 'offset-txt');
}

}); // конец DOMContentLoaded
