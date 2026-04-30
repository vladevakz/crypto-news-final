(function() {
  const REPO = 'vladevakz/crypto-news-final';
  function $(id) { return document.getElementById(id); }
  window.addEventListener('DOMContentLoaded', function() {
    // Загрузка сохранённых ключей
    function loadKeys() {
      $('gh-token-input').value = localStorage.getItem('gh_token') || '';
      $('tg-bot-token-input').value = localStorage.getItem('tg_bot_token') || '';
      $('tg-chat-id-input').value = localStorage.getItem('tg_chat_id') || '';
      $('groq-key-input').value = localStorage.getItem('groq_key') || '';
    }
    loadKeys();
    // Вкладки
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
    function showStatus(elId, msg, type) {
      const el = $(elId);
      if (!el) return;
      el.innerHTML = `<div class="status ${type}">${msg}</div>`;
    }
    function githubHeaders() {
      return {
        'Authorization': 'token ' + localStorage.getItem('gh_token'),
        'Accept': 'application/vnd.github+json'
      };
    }
    function utf8ToBase64(str) {
      const bytes = new TextEncoder().encode(str);
      let binary = '';
      bytes.forEach(b => binary += String.fromCharCode(b));
      return btoa(binary);
    }
    // Отправка workflow
    async function dispatchWorkflow(workflowFile, btn) {
      if (!localStorage.getItem('gh_token')) return alert('Введите GitHub Token в настройках');
      btn.disabled = true;
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`, {
          method: 'POST', headers: githubHeaders(), body: JSON.stringify({ ref: 'main' })
        });
        if (res.ok) showStatus('dispatch-status', '✅ Workflow запущен!', 'success');
        else {
          const err = await res.json();
          showStatus('dispatch-status', `❌ ${err.message}`, 'error');
        }
      } catch(e) { showStatus('dispatch-status', '❌ Сетевая ошибка', 'error'); }
      btn.disabled = false;
    }
    $('post-news-btn').addEventListener('click', function() { dispatchWorkflow('post-news.yml', this); });
    $('reply-btn').addEventListener('click', function() { dispatchWorkflow('reply-messages.yml', this); });
    // Сохранение ключей
    $('save-settings-btn').addEventListener('click', function() {
      const gh = $('gh-token-input').value.trim();
      const tgt = $('tg-bot-token-input').value.trim();
      const tgc = $('tg-chat-id-input').value.trim();
      const groq = $('groq-key-input').value.trim();
      if (gh) localStorage.setItem('gh_token', gh);
      if (tgt) localStorage.setItem('tg_bot_token', tgt);
      if (tgc) localStorage.setItem('tg_chat_id', tgc);
      if (groq) localStorage.setItem('groq_key', groq);
      showStatus('settings-status', '💾 Ключи сохранены!', 'success');
    });
    // Проверка системы
    $('health-btn').addEventListener('click', async function() {
      if (!localStorage.getItem('gh_token')) return alert('Введите GitHub Token');
      const results = [];
      try {
        const r = await fetch('https://api.github.com/user', { headers: githubHeaders() });
        results.push(r.ok ? '✅ GitHub OK' : '❌ Токен невалиден');
      } catch(e) { results.push('❌ GitHub недоступен'); }
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, { headers: githubHeaders() });
        const d = await r.json();
        if (d.workflows) {
          const names = d.workflows.map(w => w.name);
          results.push(names.includes('Post News') ? '✅ Post News' : '❌ Post News отсутствует');
          results.push(names.includes('Reply to Messages') ? '✅ Reply to Messages' : '❌ Reply to Messages отсутствует');
        }
      } catch(e) { results.push('❌ Workflows ошибка'); }
      const groqKey = localStorage.getItem('groq_key');
      if (groqKey) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { 'Authorization': 'Bearer ' + groqKey } });
          results.push(r.ok ? '✅ Groq API' : '❌ Ошибка Groq');
        } catch(e) { results.push('❌ Groq сеть'); }
      } else results.push('⚠️ Groq ключ не введён');
      $('health-status').innerHTML = results.join('<br>');
    });
    // Тестовый чат с AI
    $('test-ai-chat-btn').addEventListener('click', async function() {
      const groqKey = localStorage.getItem('groq_key');
      if (!groqKey) return alert('Введите Groq API Key');
      const input = $('test-chat-input').value.trim();
      if (!input) return;
      $('test-chat-output').innerHTML = '<span class="status loading">⏳ Думаю...</span>';
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'Ты — популярный крипто-блогер. Отвечай живо, с юмором.' },
              { role: 'user', content: input }
            ],
            temperature: 0.9, max_tokens: 300
          })
        });
        const data = await response.json();
        if (data.choices?.[0]) {
          $('test-chat-output').textContent = data.choices[0].message.content;
        } else {
          $('test-chat-output').textContent = '❌ Ошибка: ' + (data.error?.message || 'неизвестно');
        }
      } catch(e) { $('test-chat-output').textContent = '❌ Сетевая ошибка'; }
    });
    // Функции для остальных кнопок (заглушки / аналогичная реализация)
    // ... (остальной функционал можно вернуть по запросу)
    // Пока оставляем минимальный рабочий вариант, чтобы не перегружать.
  });
})();
