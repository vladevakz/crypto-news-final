const REPO = 'vladevakz/crypto-news-final';
let TOKEN = localStorage.getItem('gh_token');
let GROQ_KEY = localStorage.getItem('groq_key');

if (!TOKEN) {
    TOKEN = prompt('Введите GitHub Personal Access Token (с правами repo и workflow):');
    localStorage.setItem('gh_token', TOKEN);
}
if (!GROQ_KEY) {
    GROQ_KEY = prompt('Введите Groq API Key (для проверки Groq, можно ввести позже):');
    if (GROQ_KEY) localStorage.setItem('groq_key', GROQ_KEY);
}

const headers = {
    'Authorization': `token ${TOKEN}`,
    'Accept': 'application/vnd.github+json'
};

function showStatus(elementId, message, type) {
    document.getElementById(elementId).innerHTML = `<div class="status ${type}">${message}</div>`;
}

async function dispatchWorkflow(workflowFile, btnId) {
    const btn = document.getElementById(btnId);
    btn.disabled = true;
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`, {
            method: 'POST',
            headers,
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

async function loadRuns(workflowFile, elementId) {
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/runs?per_page=5`, { headers });
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

async function loadFile(path, elementId) {
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers });
        const data = await res.json();
        if (data.content) {
            const content = atob(data.content.replace(/\n/g, ''));
            document.getElementById(elementId).textContent = content;
        }
    } catch(e) {
        document.getElementById(elementId).textContent = 'Ошибка загрузки';
    }
}

// ================== Проверка системы ==================
async function checkHealth() {
    const statusDiv = document.getElementById('health-status');
    statusDiv.innerHTML = '<div class="status loading">⏳ Проверка...</div>';

    const results = [];
    const groqInput = document.getElementById('groq-key-input').value;
    const currentGroqKey = groqInput || GROQ_KEY;

    // 1. Проверка GitHub Token
    try {
        const userRes = await fetch('https://api.github.com/user', { headers });
        if (userRes.ok) {
            results.push('✅ GitHub Token валиден');
        } else {
            results.push('❌ Ошибка GitHub Token: ' + (await userRes.json()).message);
        }
    } catch (e) {
        results.push('❌ Сеть / GitHub недоступен');
    }

    // 2. Проверка наличия workflows
    try {
        const wfRes = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, { headers });
        const wfData = await wfRes.json();
        if (wfData.workflows) {
            const names = wfData.workflows.map(w => w.name);
            const hasPost = names.includes('Post News');
            const hasReply = names.includes('Reply to Messages');
            results.push(hasPost ? '✅ Workflow "Post News" найден' : '❌ Workflow "Post News" отсутствует');
            results.push(hasReply ? '✅ Workflow "Reply to Messages" найден' : '❌ Workflow "Reply to Messages" отсутствует');
        } else {
            results.push('❌ Не удалось получить список workflows');
        }
    } catch (e) {
        results.push('❌ Ошибка получения workflows');
    }

    // 3. Проверка Groq API (если ключ предоставлен)
    if (currentGroqKey) {
        try {
            const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
                headers: { 'Authorization': `Bearer ${currentGroqKey}` }
            });
            if (groqRes.ok) {
                results.push('✅ Groq API доступен');
            } else {
                results.push('❌ Groq API ошибка: ' + (await groqRes.json()).error?.message || 'неизвестно');
            }
        } catch (e) {
            results.push('❌ Groq API сеть / недоступен');
        }
    } else {
        results.push('⚠️ Groq Key не введён – проверка пропущена');
    }

    // 4. Проверка доступа к файлам
    try {
        const fRes = await fetch(`https://api.github.com/repos/${REPO}/contents/posted.json`, { headers });
        results.push(fRes.ok ? '✅ posted.json доступен' : '❌ posted.json не найден');
    } catch (e) {
        results.push('❌ Ошибка доступа к posted.json');
    }

    try {
        const fRes = await fetch(`https://api.github.com/repos/${REPO}/contents/update_offset.txt`, { headers });
        results.push(fRes.ok ? '✅ update_offset.txt доступен' : '❌ update_offset.txt не найден');
    } catch (e) {
        results.push('❌ Ошибка доступа к update_offset.txt');
    }

    // Вывод
    const allOk = results.every(r => r.startsWith('✅') || r.startsWith('⚠️'));
    let html = results.map(r => `<div>${r}</div>`).join('');
    html += `<div style="margin-top:8px;font-weight:bold;">${
        allOk ? '✅ Все системы работают' : '❌ Обнаружены проблемы'
    }</div>`;
    statusDiv.innerHTML = html;
}

// Инициализация
loadRuns('post-news.yml', 'news-runs');
loadRuns('reply-messages.yml', 'reply-runs');
loadFile('posted.json', 'posted-json');
loadFile('update_offset.txt', 'offset-txt');

// Заполняем поле Groq ключом из localStorage, если есть
if (GROQ_KEY) {
    document.getElementById('groq-key-input').value = GROQ_KEY;
}
