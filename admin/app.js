const REPO = 'vladevakz/crypto-news-final';
const TOKEN = prompt('Введите GitHub Personal Access Token (с правами repo и workflow):');
localStorage.setItem('gh_token', TOKEN);

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

// Инициализация
loadRuns('post-news.yml', 'news-runs');
loadRuns('reply-messages.yml', 'reply-runs');
loadFile('posted.json', 'posted-json');
loadFile('update_offset.txt', 'offset-txt');
