(function() {
  const REPO = 'vladevakz/crypto-news-final';
  function $(id) { return document.getElementById(id); }

  // Универсальные функции для работы с UTF-8 и Base64
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }
  function base64ToUtf8(base64) {
    const binary = atob(base64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  window.addEventListener('DOMContentLoaded', function() {
    // Загружаем сохранённые ключи
    function loadKeys() {
      $('gh-token-input').value = localStorage.getItem('gh_token') || '';
      $('tg-bot-token-input').value = localStorage.getItem('tg_bot_token') || '';
      $('tg-chat-id-input').value = localStorage.getItem('tg_chat_id') || '';
      $('groq-key-input').value = localStorage.getItem('groq_key') || '';
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
        if (tab === 'data') loadDataView();
      });
    });

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

    $('post-news-btn').addEventListener('click', function() { dispatchWorkflow('post-news.yml', this); });
    $('reply-btn').addEventListener('click', function() { dispatchWorkflow('reply-messages.yml', this); });

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
      if (!localStorage.getItem('gh_token')) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/posted.json`, { headers: githubHeaders() });
        const d = await r.json();
        if (!d.content) return;
        const json = base64ToUtf8(d.content);
        const posted = JSON.parse(json);
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
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/feeds.json`, { headers: githubHeaders() });
        if (r.ok) {
          const d = await r.json();
          const feeds = JSON.parse(base64ToUtf8(d.content));
          $('feeds-list').innerHTML = feeds.map((f,i) => `<div class="feed-item"><input value="${f}" data-index="${i}"><button class="delete-feed-btn">❌</button></div>`).join('');
          window._feedsData = feeds;
        } else {
          window._feedsData = [];
        }
      } catch (e) { $('feeds-list').innerHTML = 'Ошибка'; }
    }
    $('add-feed-btn').addEventListener('click', function() {
      const input = $('new-feed-input');
      if (!input.value) return;
      if (!window._feedsData) window._feedsData = [];
      window._feedsData.push(input.value);
      input.value = '';
      loadFeedsUI();
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
          body: JSON.stringify({ message: 'Update feeds', content: utf8ToBase64(content), sha })
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
          const prompt = JSON.parse(base64ToUtf8(d.content));
          $('system-prompt-input').value = prompt.system_prompt || '';
        }
      } catch (e) { $('system-prompt-input').value = 'Ошибка загрузки'; }
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
          body: JSON.stringify({ message: 'Update prompt', content: utf8ToBase64(content), sha })
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
          const blocked = JSON.parse(base64ToUtf8(d.content));
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
          body: JSON.stringify({ message: 'Update blocked', content: utf8ToBase64(content), sha })
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
          const q = JSON.parse(base64ToUtf8(d.content)).query;
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
          body: JSON.stringify({ message: 'Update unsplash', content: utf8ToBase64(content), sha })
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
        let content = base64ToUtf8(d.content);
        content = content.replace(/cron:\s*'[^']+'/, `cron: '${newCron}'`);
        await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: `Update cron ${wf}`, content: utf8ToBase64(content), sha: d.sha })
        });
        showStatus('cron-status', `✅ ${wf} обновлён`, 'success');
      } catch (e) { showStatus('cron-status', '❌ Ошибка', 'error'); }
    }

    // Отправка кастомного сообщения
    $('send-custom-msg-btn').addEventListener('click', async function() {
      const tgt = localStorage.getItem('tg_bot_token');
      const tgc = localStorage.getItem('tg_chat_id');
      if (!tgt || !tgc) return alert('Введите токены Telegram');
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

    // Логи
    $('view-logs-btn').addEventListener('click', async function() {
      const token = localStorage.getItem('gh_token');
      if (!token) return alert('Введите GitHub Token');
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/reply-messages.yml/runs?per_page=1`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.workflow_runs?.[0]) {
          $('logs-output').innerHTML = `<a href="${d.workflow_runs[0].html_url}" target="_blank">Открыть в GitHub</a>`;
        } else $('logs-output').textContent = 'Нет запусков';
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
        } else $('recent-messages').textContent = 'Нет новых сообщений';
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
            body: JSON.stringify({ message: `Reset ${path}`, content: utf8ToBase64(content), sha: d.sha })
          });
        } catch (e) {}
      }
      showStatus('reset-status', '✅ История сброшена', 'success');
    });

    // Бэкап
    $('download-backup-btn').addEventListener('click', async function() {
      const files = ['posted.json','update_offset.txt'];
      let data = '';
      for (const f of files) {
        try {
          const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: githubHeaders() });
          const d = await r.json();
          if (d.content) data += `=== ${f} ===\n` + base64ToUtf8(d.content) + '\n\n';
        } catch (e) {}
      }
      const blob = new Blob([data], {type:'text/plain'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'bot-backup.txt';
      a.click();
    });
    $('upload-backup-btn').addEventListener('click', () => $('backup-file-input').click());
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
            body: JSON.stringify({ message: `Restore ${filename}`, content: utf8ToBase64(content), sha: d.sha })
          });
        } catch (e) {}
      }
      showStatus('backup-status', '✅ Восстановлено', 'success');
    });

    // Ближайшие запуски
    $('calc-next-runs-btn')?.addEventListener('click', function() {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();

      // Новости каждые 3 часа
      let nextNewsHour = Math.ceil(hours / 3) * 3;
      let nextNews = new Date(now);
      nextNews.setHours(nextNewsHour, 0, 0, 0);
      if (nextNews <= now) nextNews.setHours(nextNews.getHours() + 3);
      const diffNewsMs = nextNews - now;
      const newsMin = Math.floor(diffNewsMs / 60000);
      const newsSec = Math.floor((diffNewsMs % 60000) / 1000);

      // Ответы каждые 20 минут
      let nextReplyMinute = Math.ceil(minutes / 20) * 20;
      let nextReply = new Date(now);
      nextReply.setMinutes(nextReplyMinute, 0, 0);
      if (nextReply <= now) nextReply.setMinutes(nextReply.getMinutes() + 20);
      const diffReplyMs = nextReply - now;
      const replyMin = Math.floor(diffReplyMs / 60000);
      const replySec = Math.floor((diffReplyMs % 60000) / 1000);

      $('next-runs-output').innerHTML = `
        <b>📰 Новости:</b> через ${newsMin} мин ${newsSec} сек<br>
        <b>💬 Ответы:</b> через ${replyMin} мин ${replySec} сек
      `;
    });

    // Тестовый чат с AI
    $('test-ai-chat-btn').addEventListener('click', async function() {
      const groqKey = localStorage.getItem('groq_key');
      if (!groqKey) return alert('Введите Groq API Key в настройках');
      const input = $('test-chat-input').value.trim();
      if (!input) return;
      $('test-chat-output').innerHTML = '<span class="status loading">⏳ Думаю...</span>';
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqKey}`
          },
          body: JSON.stringify({
            model: $('chat-model-select') ? $('chat-model-select').value : 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'Ты — популярный крипто-блогер. Отвечай живо, с юмором, эмодзи.' },
              { role: 'user', content: input }
            ],
            temperature: 0.9,
            max_tokens: 300
          })
        });
        const data = await response.json();
        if (data.choices && data.choices[0]) {
          $('test-chat-output').textContent = data.choices[0].message.content;
        } else {
          $('test-chat-output').textContent = '❌ Ошибка: ' + (data.error?.message || 'неизвестно');
        }
      } catch (e) {
        $('test-chat-output').textContent = '❌ Сетевая ошибка: ' + e.message;
      }
    });

    // AI Models
    async function loadModelsUI() {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/models.json`, { headers: githubHeaders() });
        if (r.ok) {
          const d = await r.json();
          const m = JSON.parse(base64ToUtf8(d.content));
          $('chat-model-select').value = m.chat || 'llama-3.3-70b-versatile';
          if ($('tts-voice-select')) $('tts-voice-select').value = m.voice || 'hannah';
        }
      } catch (e) {}
    }
    $('save-models-btn').addEventListener('click', async function() {
      const data = {
        chat: $('chat-model-select').value,
        voice: $('tts-voice-select')?.value || 'hannah'
      };
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/models.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/models.json`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: 'Update AI models', content: utf8ToBase64(JSON.stringify(data)), sha })
        });
        showStatus('models-status', '✅ Модели сохранены', 'success');
      } catch (e) { showStatus('models-status', '❌ Ошибка', 'error'); }
    });
    loadModelsUI();

    // MAX_NEWS
    async function loadMaxNewsUI() {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/config.json`, { headers: githubHeaders() });
        if (r.ok) {
          const d = await r.json();
          const cfg = JSON.parse(base64ToUtf8(d.content));
          $('max-news-input').value = cfg.MAX_NEWS || 5;
        }
      } catch (e) {}
    }
    $('save-max-news-btn').addEventListener('click', async function() {
      const max = parseInt($('max-news-input').value);
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/config.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        let cfg = {};
        if (sha) cfg = JSON.parse(base64ToUtf8(d.content));
        cfg.MAX_NEWS = max;
        await fetch(`https://api.github.com/repos/${REPO}/contents/config.json`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: 'Update MAX_NEWS', content: utf8ToBase64(JSON.stringify(cfg)), sha })
        });
        showStatus('maxnews-status', '✅ MAX_NEWS сохранено', 'success');
      } catch (e) { showStatus('maxnews-status', '❌ Ошибка', 'error'); }
    });
    loadMaxNewsUI();

    // Уведомления
    async function loadNotifyUI() {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/notify.json`, { headers: githubHeaders() });
        if (r.ok) {
          const d = await r.json();
          const n = JSON.parse(base64ToUtf8(d.content));
          $('error-notify-checkbox').checked = n.enabled || false;
        }
      } catch (e) {}
    }
    $('save-notify-btn').addEventListener('click', async function() {
      const enabled = $('error-notify-checkbox').checked;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/notify.json`, { headers: githubHeaders() });
        const d = await r.json();
        const sha = d.sha || null;
        await fetch(`https://api.github.com/repos/${REPO}/contents/notify.json`, {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({ message: 'Update notify', content: utf8ToBase64(JSON.stringify({enabled})), sha })
        });
        showStatus('notify-status', '✅ Настройка сохранена', 'success');
      } catch (e) { showStatus('notify-status', '❌ Ошибка', 'error'); }
    });
    loadNotifyUI();

    // Данные (вкладка)
    async function loadDataView() {
      if (!localStorage.getItem('gh_token')) return;
      const files = ['posted.json', 'update_offset.txt', 'feeds.json', 'prompt.json'];
      for (const f of files) {
        const elId = f === 'posted.json' ? 'posted-json' : (f === 'update_offset.txt' ? 'offset-txt' : (f === 'feeds.json' ? 'feeds-json' : 'prompt-json'));
        try {
          const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, { headers: githubHeaders() });
          const d = await r.json();
          if (d.content) {
            const el = $(elId);
            if (el) el.textContent = base64ToUtf8(d.content);
          }
        } catch (e) {}
      }
    }
    loadDataView();

    if (localStorage.getItem('gh_token')) initData();
  });
})();
