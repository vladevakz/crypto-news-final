const REPO = 'vladevakz/crypto-news-final';

// Загрузка сохранённых настроек
let GH_TOKEN = localStorage.getItem('gh_token') || '';
let TG_BOT_TOKEN = localStorage.getItem('tg_bot_token') || '';
let TG_CHAT_ID = localStorage.getItem('tg_chat_id') || '';
let GROQ_KEY = localStorage.getItem('groq_key') || '';

// Заполняем поля при загрузке
document.getElementById('gh-token-input').value = GH_TOKEN;
document.getElementById('tg-bot-token-input').value = TG_BOT_TOKEN;
document.getElementById('tg-chat-id-input').value = TG_CHAT_ID;
document.getElementById('groq-key-input').value = GROQ_KEY;

function saveSettings() {
    GH_TOKEN = document.getElementById('gh-token-input').value.trim();
    TG_BOT_TOKEN = document.getElementById('tg-bot-token-input').value.trim();
    TG_CHAT_ID = document.getElementById('tg-chat-id-input').value.trim();
    GROQ_KEY = document.getElementById('groq-key-input').value.trim();

    if (GH_TOKEN) localStorage.setItem('gh_token', GH_TOKEN);
    if (TG_BOT_TOKEN) localStorage.setItem('tg_bot_token', TG_BOT_TOKEN);
    if (TG_CHAT_ID) localStorage.setItem('tg_chat_id', TG_CHAT_ID);
    if (GROQ_KEY) localStorage.setItem('groq_key', GROQ_KEY);

    showStatus('settings-status', '⚙️ Настройки сохранены', 'success');
}

// Общие заголовки для GitHub API
function githubHeaders() {
    return {
        'Authorization': `token ${GH_TOKEN}`,
        'Accept': 'application/vnd.github+json'
    };
}

function showStatus(elementId, message, type) {
    document.getElementById(elementId).innerHTML = `<div class="status ${type}">${message}</div>`;
}

// Запуск workflow
async function dispatchWorkflow(workflowFile, btnId) {
    if (!GH_TOKEN) return alert('Введите GitHub Token');
    const btn = document.getElementById(btnId);
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
    setTimeout(() => document.getElementById('dispatch-status').innerHTML = '', 5000);
}

// История запусков
async function loadRuns(workflowFile, elementId) {
    if (!GH_TOKEN) return;
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
            document.getElementById(elementId).innerHTML = html || 'Нет запусков';
        }
    } catch(e) {
        document.getElementById(elementId).innerHTML = 'Ошибка загрузки';
    }
}

// Загрузка файлов
async function loadFile(path, elementId) {
    if (!GH_TOKEN) return;
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
        const data = await res.json();
        if (data.content) {
            const content = atob(data.content.replace(/\n/g, ''));
            document.getElementById(elementId).textContent = content;
        }
    } catch(e) {
        document.getElementById(elementId).textContent = 'Ошибка загрузки';
    }
}

// --- Проверка системы ---
async function checkHealth() {
    const statusDiv = document.getElementById('health-status');
    statusDiv.innerHTML = '<div class="status loading">⏳ Проверка...</div>';
    const results = [];

    // GitHub Token
    try {
        const userRes = await fetch('https://api.github.com/user', { headers: githubHeaders() });
        if (userRes.ok) results.push('✅ GitHub Token валиден');
        else results.push('❌ Ошибка GitHub Token: ' + (await userRes.json()).message);
    } catch(e) {
        results.push('❌ Сеть / GitHub недоступен');
    }

    // Проверка Workflows
    try {
        const wfRes = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, { headers: githubHeaders() });
        const wfData = await wfRes.json();
        if (wfData.workflows) {
            const names = wfData.workflows.map(w => w.name);
            results.push(names.includes('Post News') ? '✅ Workflow "Post News" найден' : '❌ "Post News" отсутствует');
            results.push(names.includes('Reply to Messages') ? '✅ Workflow "Reply to Messages" найден' : '❌ "Reply to Messages" отсутствует');
        } else results.push('❌ Не удалось получить список workflows');
    } catch(e) { results.push('❌ Ошибка получения workflows'); }

    // Groq
    if (GROQ_KEY) {
        try {
            const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
            });
            results.push(groqRes.ok ? '✅ Groq API доступен' : '❌ Groq API ошибка');
        } catch(e) { results.push('❌ Groq API сеть недоступна'); }
    } else results.push('⚠️ Groq Key не введён');

    // Файлы
    for (const f of ['posted.json', 'update_offset.txt']) {
        try {
            const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: githubHeaders() });
            results.push(res.ok ? `✅ ${f} доступен` : `❌ ${f} не найден`);
        } catch(e) { results.push(`❌ Ошибка доступа к ${f}`); }
    }

    const allOk = results.every(r => r.startsWith('✅') || r.startsWith('⚠️'));
    statusDiv.innerHTML = results.map(r => `<div>${r}</div>`).join('') +
        `<div style="margin-top:8px;font-weight:bold;">${allOk ? '✅ Все системы работают' : '❌ Обнаружены проблемы'}</div>`;
}

// --- Обновление расписания ---
async function updateCron(workflowFile, inputId) {
    if (!GH_TOKEN) return alert('Введите GitHub Token');
    const newCron = document.getElementById(inputId).value.trim();
    try {
        // Получить текущее содержимое
        const path = `.github/workflows/${workflowFile}`;
        const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
        const data = await getRes.json();
        if (!data.content) return alert('Файл не найден');
        let content = atob(data.content.replace(/\n/g, ''));
        // Замена строки cron
        content = content.replace(/cron:\s*'[^']+'/, `cron: '${newCron}'`);
        // Кодируем обратно
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
}

// --- Логи последнего запуска ---
async function viewLatestLogs() {
    if (!GH_TOKEN) return alert('Введите GitHub Token');
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/reply-messages.yml/runs?per_page=1`, {
            headers: githubHeaders()
        });
        const data = await res.json();
        if (data.workflow_runs && data.workflow_runs.length > 0) {
            const run = data.workflow_runs[0];
            const logsUrl = run.logs_url; // архив zip, но не отобразить
            const htmlUrl = run.html_url;
            document.getElementById('logs-output').innerHTML = `
                <p>Последний запуск: ${run.conclusion || 'pending'}</p>
                <a href="${htmlUrl}" target="_blank">Открыть в GitHub</a>
            `;
        } else {
            document.getElementById('logs-output').innerHTML = 'Нет запусков';
        }
    } catch(e) {
        document.getElementById('logs-output').innerHTML = 'Ошибка';
    }
}

// --- Сброс истории ---
async function resetHistory() {
    if (!GH_TOKEN) return alert('Введите GitHub Token');
    const files = {
        'posted.json': '{}',
        'update_offset.txt': '0'
    };
    for (const [path, content] of Object.entries(files)) {
        try {
            const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
            const data = await getRes.json();
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
        } catch(e) {}
    }
    showStatus('reset-status', '✅ История сброшена', 'success');
    loadFile('posted.json', 'posted-json');
    loadFile('update_offset.txt', 'offset-txt');
}

// --- Тестовое сообщение ---
async function testMessage() {
    if (!TG_BOT_TOKEN || !TG_CHAT_ID) return alert('Введите токен бота и Chat ID');
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
}

// --- Статистика Groq ---
async function groqStats() {
    if (!GROQ_KEY) return alert('Введите Groq API Key');
    try {
        const res = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${GROQ_KEY}` }
        });
        const data = await res.json();
        if (data.data) {
            const models = data.data.map(m => m.id).join(', ');
            document.getElementById('groq-stats-output').textContent = `Доступные модели: ${models}`;
        } else {
            document.getElementById('groq-stats-output').textContent = 'Ошибка получения моделей';
        }
    } catch(e) {
        document.getElementById('groq-stats-output').textContent = 'Ошибка сети';
    }
}

// Инициализация
if (GH_TOKEN) {
    loadRuns('post-news.yml', 'news-runs');
    loadRuns('reply-messages.yml', 'reply-runs');
    loadFile('posted.json', 'posted-json');
    loadFile('update_offset.txt', 'offset-txt');
}
