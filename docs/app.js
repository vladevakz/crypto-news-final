(function() {
  const REPO = 'vladevakz/crypto-news-final';
  function $(id) { return document.getElementById(id); }

  // Инициализация только после полной загрузки DOM
  window.addEventListener('DOMContentLoaded', function() {
    // === ЗАГРУЗКА СОХРАНЁННЫХ КЛЮЧЕЙ ===
    function loadKeys() {
      $('gh-token-input').value = localStorage.getItem('gh_token') || '';
      $('tg-bot-token-input').value = localStorage.getItem('tg_bot_token') || '';
      $('tg-chat-id-input').value = localStorage.getItem('tg_chat_id') || '';
      $('groq-key-input').value = localStorage.getItem('groq_key') || '';
    }
    loadKeys(); // сразу заполняем поля

    // === ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ===
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

    // === ПОКАЗ СООБЩЕНИЙ ===
    function showStatus(elementId, message, type) {
      const el = $(elementId);
      if (!el) return;
      el.innerHTML = `<div class="status ${type}">${message}</div>`;
    }

    // === СОХРАНЕНИЕ КЛЮЧЕЙ ===
    $('save-settings-btn').addEventListener('click', function() {
      try {
        const gh = $('gh-token-input').value.trim();
        const tgt = $('tg-bot-token-input').value.trim();
        const tgc = $('tg-chat-id-input').value.trim();
        const groq = $('groq-key-input').value.trim();

        if (gh) localStorage.setItem('gh_token', gh);
        if (tgt) localStorage.setItem('tg_bot_token', tgt);
        if (tgc) localStorage.setItem('tg_chat_id', tgc);
        if (groq) localStorage.setItem('groq_key', groq);

        showStatus('settings-status', '💾 Ключи сохранены!', 'success');
        // При успешном сохранении ключей можно обновить данные на главной
        if (gh) initData();
      } catch (e) {
        alert('Ошибка сохранения: ' + e.message);
      }
    });

    // === БЫСТРЫЕ ДЕЙСТВИЯ ===
    async function dispatchWorkflow(workflowFile, btn) {
      const token = localStorage.getItem('gh_token');
      if (!token) return alert('Сначала сохраните GitHub Token на вкладке Настройки');
      btn.disabled = true;
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/dispatches`, {
          method: 'POST',
          headers: {
            'Authorization': 'token ' + token,
            'Accept': 'application/vnd.github+json'
          },
          body: JSON.stringify({ ref: 'main' })
        });
        if (res.ok) {
          showStatus('dispatch-status', '✅ Workflow запущен!', 'success');
        } else {
          const err = await res.json();
          showStatus('dispatch-status', '❌ Ошибка: ' + err.message, 'error');
        }
      } catch (e) {
        showStatus('dispatch-status', '❌ Сетевая ошибка', 'error');
      }
      btn.disabled = false;
    }

    $('post-news-btn').addEventListener('click', function() {
      dispatchWorkflow('post-news.yml', this);
    });
    $('reply-btn').addEventListener('click', function() {
      dispatchWorkflow('reply-messages.yml', this);
    });

    // === ПРОВЕРКА СИСТЕМЫ ===
    $('health-btn').addEventListener('click', async function() {
      const token = localStorage.getItem('gh_token');
      if (!token) return alert('Введите GitHub Token в настройках');
      const results = [];
      try {
        const r = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': 'token ' + token }
        });
        results.push(r.ok ? '✅ GitHub Token валиден' : '❌ Ошибка токена');
      } catch (e) { results.push('❌ GitHub недоступен'); }

      // Workflows
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows`, {
          headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' }
        });
        const d = await r.json();
        if (d.workflows) {
          const names = d.workflows.map(w => w.name);
          results.push(names.includes('Post News') ? '✅ "Post News" есть' : '❌ "Post News" нет');
          results.push(names.includes('Reply to Messages') ? '✅ "Reply to Messages" есть' : '❌ "Reply to Messages" нет');
        } else results.push('❌ Workflows не получены');
      } catch (e) { results.push('❌ Ошибка получения workflows'); }

      // Groq
      const groqKey = localStorage.getItem('groq_key');
      if (groqKey) {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/models', {
            headers: { 'Authorization': 'Bearer ' + groqKey }
          });
          results.push(r.ok ? '✅ Groq API доступен' : '❌ Ошибка Groq');
        } catch (e) { results.push('❌ Groq сеть недоступна'); }
      } else results.push('⚠️ Groq ключ не введён');

      // Файлы
      for (const f of ['posted.json', 'update_offset.txt']) {
        try {
          const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${f}`, {
            headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' }
          });
          results.push(r.ok ? `✅ ${f}` : `❌ ${f} не найден`);
        } catch (e) { results.push(`❌ Ошибка ${f}`); }
      }

      const allOk = results.every(r => r.startsWith('✅') || r.startsWith('⚠️'));
      $('health-status').innerHTML = results.join('<br>') + `<br><b>${allOk ? '✅ Всё работает' : '❌ Есть проблемы'}</b>`;
    });

    // === СТАТИСТИКА НОВОСТЕЙ ===
    async function loadNewsStats() {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/contents/posted.json`, {
          headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' }
        });
        const d = await r.json();
        if (!d.content) return;
        const posted = JSON.parse(atob(d.content.replace(/\n/g, '')));
        const today = new Date().toISOString().slice(0, 10);
        let todayCount = 0, weekCount = 0;
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
        Object.entries(posted).forEach(([date, titles]) => {
          if (date === today) todayCount = titles.length;
          if (date >= weekAgo) weekCount += titles.length;
        });
        $('news-stats').innerHTML = `Сегодня: ${todayCount} новостей<br>За неделю: ${weekCount} новостей`;
      } catch (e) { $('news-stats').textContent = 'Ошибка'; }
    }

    // История запусков (упрощённо)
    async function loadRuns(workflowFile, elId) {
      const token = localStorage.getItem('gh_token');
      if (!token) return;
      const el = $(elId);
      if (!el) return;
      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${workflowFile}/runs?per_page=5`, {
          headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' }
        });
        const d = await r.json();
        if (d.workflow_runs) {
          el.innerHTML = d.workflow_runs.map(r => {
            const dt = new Date(r.created_at).toLocaleString('ru-RU');
            const cls = r.conclusion || 'pending';
            return `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #333;padding:4px 0;">
              <span>${dt}</span><span class="status ${cls === 'success' ? 'success' : cls === 'failure' ? 'error' : 'info'}">${cls}</span>
            </div>`;
          }).join('');
        }
      } catch (e) { el.innerHTML = 'Ошибка'; }
    }

    // Инициализация данных при наличии GitHub токена
    function initData() {
      loadNewsStats();
      loadRuns('post-news.yml', 'news-runs');
      loadRuns('reply-messages.yml', 'reply-runs');
    }

    // Вызываем сразу, если токен уже есть
    if (localStorage.getItem('gh_token')) {
      initData();
    }

    // === ЗАГРУЗКА RSS (заглушка, можно расширить) ===
    async function loadFeedsUI() {
      // загрузите feeds.json с GitHub аналогично другим функциям при необходимости
      $('feeds-list').innerText = 'Функция в разработке';
    }
    // Привязка кнопок RSS и других настроек может быть добавлена аналогично
    // Но для базового функционала достаточно основной вкладки и сохранения ключей.

    // Обработчик для фидов – пока просто показываем, что функция в разработке
    $('add-feed-btn').addEventListener('click', function() {
      alert('Добавление фидов будет доступно позже');
    });
    $('save-feeds-btn').addEventListener('click', function() {
      alert('Сохранение фидов будет доступно позже');
    });

    // Заглушки для остальных кнопок настроек
    $('save-prompt-btn').addEventListener('click', function() {
      alert('Сохранение промпта будет доступно позже');
    });
    $('save-blocked-btn').addEventListener('click', function() {
      alert('Сохранение запрещённых тем будет доступно позже');
    });
    $('save-unsplash-btn').addEventListener('click', function() {
      alert('Сохранение запроса Unsplash будет доступно позже');
    });

    console.log('Admin panel loaded successfully');
  });
})();
