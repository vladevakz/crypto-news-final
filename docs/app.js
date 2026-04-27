(function() {
  const REPO = 'vladevakz/crypto-news-final';
  function $(id) { return document.getElementById(id); }

  window.addEventListener('DOMContentLoaded', function() {
    // Загружаем сохранённые ключи
    function loadKeys() {
      $('gh-token-input').value = localStorage.getItem('gh_token') || '';
      $('tg-bot-token-input').value = localStorage.getItem('tg_bot_token') || '';
      $('tg-chat-id-input').value = localStorage.getItem('tg_chat_id') || '';
      $('groq-key-input').value = localStorage.getItem('groq_key') || '';
      // На всякий случай восстанавливаем чекбокс уведомлений (сохраняется в notify.json)
    }
    loadKeys();

    // Переключение вкладок
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const tab = this.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        this.classList.add('active');
        const pane = $('tab-' + tab);
        if (pane) pane.classList.add('active');
      });
    });

    // Вспомогательные функции
    function showStatus(elId, message, type) {
      const el = $(elId);
      if (!el) return;
      el.innerHTML = `<div class="status ${type}">${message}</div>`;
    }

    function githubHeaders() {
      const token = localStorage.getItem('gh_token');
      return {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      };
    }

    async function dispatchWorkflow(workflowFile, btn) {
      const token = localStorage.getItem('gh_token');
      if (!token) return alert('Сначала сохраните GitHub Token на вкладке Настройки');
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
      } catch (e) {
        showStatus('dispatch-status', '❌ Сетевая ошибка', 'error');
      }
      btn.disabled = false;
    }

    // === Привязка кнопок ===
    $('post-news-btn').addEventListener('click', function() {
      dispatchWorkflow('post-news.yml', this);
    });
    $('reply-btn').addEventListener('click', function() {
      dispatchWorkflow('reply-messages.yml', this);
    });

    // Проверка системы
    $('health-btn').addEventListener('click', async function() {
      const token = localStorage.getItem('gh_token');
      if (!token) return alert('Введите GitHub Token в настройках');
      const results = [];
      try {
        const r = await fetch('https://api.github.com/user', { headers: githubHeaders() });
        results.push(r.ok ? '✅ GitHub Token валиден' : '❌ Ошибка токена');
      } catch (e) { results.push('❌ GitHub недоступен'); }

      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.workflows) {
          const names = d.workflows.map(w => w.name);
          results.push(names.includes('Post News') ? '✅ "Post News" есть' : '❌ "Post News" нет');
          results.push(names.includes('Reply to Messages') ? '✅ "Reply to Messages" есть' : '❌ "Reply to Messages" нет');
        }
      } catch (e) { results.push('❌ Ошибка получения workflows'); }

      const groqKey = localStorage.getItem('groq_key');
      if (groqKey) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': `Bearer ${groqKey}` }
          });
          results.push(r.ok ? '✅ Groq API доступен' : '❌ Ошибка Groq');
        } catch (e) { results.push('❌ Groq сеть недоступна'); }
      } else results.push('⚠️ Groq ключ не введён');

      for (const f of ['posted.json','update_offset.txt']) {
        try {
          const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: githubHeaders() });
          results.push(r.ok ? `✅ ${f}` : `❌ ${f} не найден`);
        } catch (e) { results.push(`❌ Ошибка ${f}`); }
      }
      $('health-status').innerHTML = results.join('<br>') + `<br><b>${results.every(r => r.startsWith('✅') || r.startsWith('⚠️')) ? '✅ Всё работает' : '❌ Есть проблемы'}</b>`;
    });

    // Сохранение токенов
    $('save-settings-btn').addEventListener('click', function() {
      const gh = $('gh-token-input').value.trim();
      const tgt = $('tg-bot-token-input').value.trim();
      const tgc = $('tg-chat-id-input').value.trim();
      const groq = $('groq-key-input').value.trim();
      try {
        if (gh) localStorage.setItem('gh_token', gh);
        if (tgt) localStorage.setItem('tg_bot_token', tgt);
        if (tgc) localStorage.setItem('tg_chat_id', tgc);
        if (groq) localStorage.setItem('groq_key', groq);
        showStatus('settings-status', '💾 Ключи сохранены!', 'success');
        initData();
      } catch (e) {
        alert('Ошибка сохранения: ' + e.message);
      }
    });

    // Статистика новостей
    async function loadNewsStats() {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
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
        $('news-stats').innerHTML = `Сегодня: ${todayCount} новостей<br>За неделю: ${weekCount} новостей`;
      } catch (e) { $('news-stats').textContent = 'Ошибка'; }
    }

    async function loadRuns(workflowFile, elId) {
      const el = $(elId);
      if (!el) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/runs?per_page=5`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.workflow_runs) {
          el.innerHTML = d.workflow_runs.map(r => {
            const dt = new Date(r.created_at).toLocaleString('ru-RU');
            const cls = r.conclusion || 'pending';
            let clsName = 'info';
            if (cls === 'success') clsName = 'success';
            else if (cls === 'failure') clsName = 'error';
            return `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #333;padding:4px 0;">
              <span>${dt}</span><span class="status ${clsName}">${cls}</span>
            </div>`;
          }).join('');
        }
      } catch (e) { el.innerHTML = 'Ошибка'; }
    }

    function initData() {
      loadNewsStats();
      loadRuns('post-news.yml', 'news-runs');
      loadRuns('reply-messages.yml', 'reply-runs');
    }
    if (localStorage.getItem('gh_token')) initData();

    // RSS-источники
    async function loadFeedsUI() {
      // Реализация загрузки из feeds.json (упрощённо)
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/feeds.json`, { headers: githubHeaders() });
        if (r.ok) {
          const d = await r.json();
          const feeds = JSON.parse(atob(d.content.replace(/\n/g,'')));
          $('feeds-list').innerHTML = feeds.map((f,i) => `<div class="feed-item"><input value="${f}" data-index="${i}"><button class="delete-feed-btn">❌</button></div>`).join('');
          window._feedsData = feeds;
        } else {
          // Создадим файл при первом сохранении
        }
      } catch (e) { $('feeds-list').innerHTML = 'Ошибка'; }
    }
    $('add-feed-btn').addEventListener('click', function() {
      const input = $('new-feed-input');
      if (!input.value) return;
      if (!window._feedsData) window._feedsData = [];
      window._feedsData.push(input.value);
      input.value = '';
      loadFeedsUI(); // перерисовка
    });
    $('save-feeds-btn').addEventListener('click', async function() {
      if (!window._feedsData) return;
      const content = JSON.stringify(window._feedsData, null, 2);
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/feeds.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/feeds.json`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: 'Update feeds', content: btoa(unescape(encodeURIComponent(content))), sha })
        });
        alert('Feeds сохранены');
      } catch (e) { alert('Ошибка сохранения'); }
    });
    loadFeedsUI();

    // Промпт
    async function loadPromptUI() {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/prompt.json`, { headers: githubHeaders() });
        if (r.ok) {
          const d = await r.json();
          const prompt = JSON.parse(atob(d.content.replace(/\n/g,'')));
          $('system-prompt-input').value = prompt.system_prompt || '';
        }
      } catch (e) {}
    }
    $('save-prompt-btn').addEventListener('click', async function() {
      const content = JSON.stringify({ system_prompt: $('system-prompt-input').value });
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/prompt.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/prompt.json`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: 'Update prompt', content: btoa(unescape(encodeURIComponent(content))), sha })
        });
        showStatus('prompt-status', '✅ Промпт сохранён', 'success');
      } catch (e) { showStatus('prompt-status', '❌ Ошибка', 'error'); }
    });
    loadPromptUI();

    // Запрещённые темы
    async function loadBlockedUI() {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/blocked.json`, { headers: githubHeaders() });
        if (r.ok) {
          const d = await r.json();
          const blocked = JSON.parse(atob(d.content.replace(/\n/g,'')));
          $('blocked-input').value = blocked.join(', ');
        }
      } catch (e) {}
    }
    $('save-blocked-btn').addEventListener('click', async function() {
      const words = $('blocked-input').value.split(',').map(s=>s.trim()).filter(Boolean);
      const content = JSON.stringify(words);
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/blocked.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/blocked.json`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: 'Update blocked', content: btoa(unescape(encodeURIComponent(content))), sha })
        });
        showStatus('blocked-status', '✅ Сохранено', 'success');
      } catch (e) { showStatus('blocked-status', '❌ Ошибка', 'error'); }
    });
    loadBlockedUI();

    // Unsplash
    async function loadUnsplashUI() {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/unsplash.json`, { headers: githubHeaders() });
        if (r.ok) {
          const d = await r.json();
          const q = JSON.parse(atob(d.content.replace(/\n/g,''))).query;
          $('unsplash-query-input').value = q;
        }
      } catch (e) {}
    }
    $('save-unsplash-btn').addEventListener('click', async function() {
      const content = JSON.stringify({ query: $('unsplash-query-input').value });
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/unsplash.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/unsplash.json`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: 'Update unsplash', content: btoa(unescape(encodeURIComponent(content))), sha })
        });
        showStatus('unsplash-status', '✅ Сохранено', 'success');
      } catch (e) { showStatus('unsplash-status', '❌ Ошибка', 'error'); }
    });
    loadUnsplashUI();

    // Обновление cron
    $('update-news-cron-btn').addEventListener('click', async function() {
      await updateCron('post-news.yml', 'news-cron');
    });
    $('update-reply-cron-btn').addEventListener('click', async function() {
      await updateCron('reply-messages.yml', 'reply-cron');
    });
    async function updateCron(wf, inputId) {
      const token = localStorage.getItem('gh_token');
      if (!token) return alert('Введите GitHub Token');
      const newCron = $(inputId).value;
      const path = `.github/workflows/${wf}`;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
        const d = await r.json();
        let content = atob(d.content.replace(/\n/g,''));
        content = content.replace(/cron:\s*'[^']+'/, `cron: '${newCron}'`);
        await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: `Update cron ${wf}`, content: btoa(unescape(encodeURIComponent(content))), sha: d.sha })
        });
        showStatus('cron-status', `✅ ${wf} обновлён`, 'success');
      } catch (e) { showStatus('cron-status', '❌ Ошибка', 'error'); }
    }

    // Отправка кастомного сообщения
    $('send-custom-msg-btn').addEventListener('click', async function() {
      const tgt = localStorage.getItem('tg_bot_token');
      const tgc = localStorage.getItem('tg_chat_id');
      if (!tgt || !tgc) return alert('Введите Telegram токены');
      const text = $('custom-msg-text').value;
      try {
        const r = await fetch(`https://api.telegram.org/bot${tgt}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: tgc, text })
        });
        const d = await r.json();
        showStatus('custom-msg-status', d.ok ? '✅ Отправлено' : `❌ ${d.description}`, d.ok?'success':'error');
      } catch (e) { showStatus('custom-msg-status', '❌ Ошибка сети', 'error'); }
    });

    // Логи последнего запуска
    $('view-logs-btn').addEventListener('click', async function() {
      const token = localStorage.getItem('gh_token');
      if (!token) return alert('Введите GitHub Token');
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/reply-messages.yml/runs?per_page=1`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.workflow_runs?.[0]) {
          $('logs-output').innerHTML = `<a href="${d.workflow_runs[0].html_url}" target="_blank">Открыть в GitHub</a>`;
        } else {
          $('logs-output').textContent = 'Нет запусков';
        }
      } catch (e) { $('logs-output').textContent = 'Ошибка'; }
    });

    // Последние входящие
    $('load-messages-btn').addEventListener('click', async function() {
      const tgt = localStorage.getItem('tg_bot_token');
      if (!tgt) return alert('Введите токен бота');
      try {
        const offset = localStorage.getItem('last_msg_offset') || 0;
        const r = await fetch(`https://api.telegram.org/bot${tgt}/getUpdates?offset=${offset}&limit=5`);
        const d = await r.json();
        if (d.ok && d.result.length) {
          let html = '';
          d.result.forEach(u => {
            const msg = u.message || u.edited_message;
            if (msg && msg.text) {
              html += `<div>${msg.from?.first_name||'?'}: ${msg.text.slice(0,40)}</div>`;
            }
          });
          $('recent-messages').innerHTML = html || 'Нет текстовых';
          const maxId = Math.max(...d.result.map(u=>u.update_id));
          localStorage.setItem('last_msg_offset', maxId+1);
        } else {
          $('recent-messages').textContent = 'Нет новых сообщений';
        }
      } catch (e) { $('recent-messages').textContent = 'Ошибка'; }
    });

    // Сброс истории
    $('reset-history-btn').addEventListener('click', async function() {
      const token = localStorage.getItem('gh_token');
      if (!token) return alert('Введите GitHub Token');
      for (const [path, content] of [['posted.json','{}'],['update_offset.txt','0']]) {
        try {
          const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, { headers: githubHeaders() });
          const d = await r.json();
          await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
            method: 'PUT',
            headers: githubHeaders(),
            body: JSON.stringify({ message: `Reset ${path}`, content: btoa(unescape(encodeURIComponent(content))), sha: d.sha })
          });
        } catch (e) {}
      }
      showStatus('reset-status', '✅ История сброшена', 'success');
    });

    // Резервное копирование
    $('download-backup-btn').addEventListener('click', async function() {
      const files = ['posted.json','update_offset.txt'];
      let data = '';
      for (const f of files) {
        try {
          const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: githubHeaders() });
          const d = await r.json();
          if (d.content) data += `=== ${f} ===\n` + atob(d.content.replace(/\n/g,'')) + '\n\n';
        } catch (e) {}
      }
      const blob = new Blob([data], {type:'text/plain'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bot-backup.txt';
      a.click();
    });
    $('upload-backup-btn').addEventListener('click', function() {
      $('backup-file-input').click();
    });
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
            method: 'PUT',
            headers: githubHeaders(),
            body: JSON.stringify({ message: `Restore ${filename}`, content: btoa(unescape(encodeURIComponent(content))), sha: d.sha })
          });
        } catch (e) {}
      }
      showStatus('backup-status', '✅ Восстановлено', 'success');
    });

    // Ближайшие запуски
    $('calc-next-runs-btn').addEventListener('click', function() {
      const now = new Date();
      const hours = now.getHou
