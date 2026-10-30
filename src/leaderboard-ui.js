import {
  fetchTop,
  submitScore,
  getNickname,
  setNickname,
  getAutoSubmit,
  setAutoSubmit,
  makeRunId,
  leaderboardErrorMessage,
} from './leaderboard.js';

const MAX_NAME_LENGTH = 12;

function cleanName(raw) {
  const cleaned = String(raw || '')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, MAX_NAME_LENGTH).join('');
}

export class LeaderboardUI {
  constructor(game) {
    this.game = game;
    this.isOpen = false;
    this.period = 'all';
    this.pending = null;
    this.lastGameoverSerial = null;
    this.loadSeq = 0;
    this.toastTimer = null;
    this.build();
  }

  build() {
    const root = document.createElement('div');
    root.className = 'lb-root';
    root.innerHTML = `
      <button class="lb-open" type="button" aria-haspopup="dialog">排行榜</button>
      <div class="lb-modal" aria-hidden="true">
        <div class="lb-backdrop" data-close="1"></div>
        <section class="lb-card" role="dialog" aria-modal="true" aria-labelledby="lb-title">
          <div class="lb-stripe"></div>
          <header class="lb-head">
            <div class="lb-heading">
              <h2 id="lb-title">全球排行榜</h2>
              <p class="lb-sub">所有玩家的成绩 · 总榜 / 本周</p>
            </div>
            <button class="lb-close" type="button" aria-label="关闭">×</button>
          </header>
          <div class="lb-tabs" role="tablist">
            <button type="button" class="active" data-period="all" role="tab" aria-selected="true">总榜</button>
            <button type="button" data-period="week" role="tab" aria-selected="false">本周</button>
          </div>
          <div class="lb-list" role="list"><div class="lb-empty">加载中…</div></div>
          <div class="lb-submit">
            <div class="lb-run" hidden></div>
            <div class="lb-name-row">
              <label class="lb-name-label" for="lb-name">昵称</label>
              <input id="lb-name" class="lb-name" type="text" maxlength="12"
                autocomplete="nickname" spellcheck="false" placeholder="最多 12 个字">
              <button class="lb-save-name" type="button">保存</button>
            </div>
            <label class="lb-auto">
              <input class="lb-auto-input" type="checkbox" checked>
              结算时自动上传成绩
            </label>
            <button class="lb-submit-btn" type="button" disabled>提交本局成绩</button>
            <p class="lb-status" role="status"></p>
          </div>
          <p class="lb-foot">保存昵称、成绩和匿名设备标识；IP 仅以加盐哈希用于限频，不收集账号或邮箱。成绩由客户端提交，排行榜以娱乐为主。</p>
        </section>
      </div>
      <div class="lb-toast" role="status"></div>
    `;
    document.body.appendChild(root);

    this.root = root;
    this.button = root.querySelector('.lb-open');
    this.modal = root.querySelector('.lb-modal');
    this.card = root.querySelector('.lb-card');
    this.closeBtn = root.querySelector('.lb-close');
    this.tabs = Array.from(root.querySelectorAll('.lb-tabs button'));
    this.listEl = root.querySelector('.lb-list');
    this.runEl = root.querySelector('.lb-run');
    this.nameInput = root.querySelector('.lb-name');
    this.saveNameBtn = root.querySelector('.lb-save-name');
    this.autoInput = root.querySelector('.lb-auto-input');
    this.submitBtn = root.querySelector('.lb-submit-btn');
    this.statusEl = root.querySelector('.lb-status');
    this.toastEl = root.querySelector('.lb-toast');

    this.button.addEventListener('click', () => this.open());
    this.closeBtn.addEventListener('click', () => this.close());
    this.modal
      .querySelector('.lb-backdrop')
      .addEventListener('click', () => this.close());
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => {
        this.setPeriod(tab.dataset.period);
      });
    }
    this.saveNameBtn.addEventListener('click', () => {
      this.saveName(true);
    });
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.saveName(true);
      }
    });
    this.autoInput.addEventListener('change', () => {
      setAutoSubmit(this.autoInput.checked);
    });
    this.submitBtn.addEventListener('click', () => {
      this.submitPending(false);
    });
    window.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        this.close();
      }
    });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.modal.classList.add('open');
    this.modal.setAttribute('aria-hidden', 'false');
    this.button.classList.remove('visible');
    this.nameInput.value = getNickname();
    this.autoInput.checked = getAutoSubmit();
    this.syncPendingView();
    if (this.pending && this.pending.error) {
      this.setStatus(leaderboardErrorMessage(this.pending.error), 'error');
    } else if (this.pending && this.pending.submitted) {
      this.setStatus(
        this.pending.rank
          ? `已上榜 · 全球第 ${this.pending.rank} 名`
          : '本局成绩已上传',
        'ok'
      );
    } else {
      this.setStatus('');
    }
    this.loadTop();
    requestAnimationFrame(() => {
      this.closeBtn.focus({ preventScroll: true });
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.modal.classList.remove('open');
    this.modal.setAttribute('aria-hidden', 'true');
    this.update(this.game, false);
  }

  update(game, debugOpen = false) {
    this.game = game;
    const canShow =
      (game.mode === 'title' || game.mode === 'gameover') &&
      !debugOpen &&
      !this.isOpen;
    const pendingActive = !!(this.pending && !this.pending.submitted);
    this.button.classList.toggle('visible', canShow);
    this.button.classList.toggle('pending', canShow && pendingActive);
    const label = pendingActive ? '上榜 ★' : '排行榜';
    if (this.button.textContent !== label) {
      this.button.textContent = label;
    }

    if (
      game.mode === 'gameover' &&
      game.runSerial !== this.lastGameoverSerial
    ) {
      this.lastGameoverSerial = game.runSerial;
      this.onGameOver(game);
    }
  }

  onGameOver(game) {
    const score = Math.floor(game.finalScore || 0);
    if (score <= 0) {
      this.pending = null;
      this.syncPendingView();
      return;
    }
    this.pending = {
      score,
      duration: Math.max(0, Number(game.runRealTime) || 0),
      hijacks: Math.max(0, Math.floor(game.hijackCount) || 0),
      runId: makeRunId(game.runSerial),
      submitted: false,
      submitting: false,
      rank: null,
      error: null,
    };
    this.syncPendingView();
    if (getNickname() && getAutoSubmit()) {
      this.submitPending(true);
    }
  }

  setPeriod(period) {
    this.period = period === 'week' ? 'week' : 'all';
    for (const tab of this.tabs) {
      const active = tab.dataset.period === this.period;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    this.loadTop();
  }

  saveName(showStatus) {
    const name = cleanName(this.nameInput.value);
    if (!name) {
      if (showStatus) this.setStatus('先输入一个昵称', 'error');
      return '';
    }
    this.nameInput.value = name;
    setNickname(name);
    setAutoSubmit(this.autoInput.checked);
    if (showStatus) this.setStatus('昵称已保存', 'ok');
    this.syncPendingView();
    return name;
  }

  async submitPending(auto) {
    const pending = this.pending;
    if (!pending || pending.submitted || pending.submitting) return;

    let name;
    if (auto) {
      name = getNickname();
      if (!name || !getAutoSubmit()) return;
    } else {
      name = this.saveName(false);
      if (!name) {
        this.setStatus('先输入一个昵称', 'error');
        return;
      }
    }

    pending.submitting = true;
    pending.error = null;
    if (this.isOpen) this.setStatus('上传中…', 'info');
    this.syncPendingView();

    try {
      const result = await submitScore({
        name,
        score: pending.score,
        duration: pending.duration,
        hijacks: pending.hijacks,
        runId: pending.runId,
      });
      pending.submitted = true;
      pending.submitting = false;
      pending.rank = Number(result.rank) || null;
      pending.duplicate = !!result.duplicate;
      if (this.isOpen) {
        this.setStatus(
          pending.rank
            ? `已上榜 · 全球第 ${pending.rank} 名`
            : '本局成绩已上传',
          'ok'
        );
      } else if (auto) {
        this.toast(
          pending.rank
            ? `已上传 · 全球第 ${pending.rank} 名`
            : '本局成绩已上传'
        );
      }
      this.syncPendingView();
      if (this.isOpen) this.loadTop();
      this.update(this.game, false);
    } catch (error) {
      pending.submitting = false;
      pending.error = error;
      if (this.isOpen) {
        this.setStatus(leaderboardErrorMessage(error), 'error');
      } else {
        console.warn('leaderboard auto submit failed', error);
      }
      this.syncPendingView();
      this.update(this.game, false);
    }
  }

  syncPendingView() {
    const pending = this.pending;
    if (!pending) {
      this.runEl.hidden = true;
      this.runEl.textContent = '';
      this.submitBtn.hidden = true;
      this.submitBtn.disabled = true;
      this.submitBtn.textContent = '提交本局成绩';
      return;
    }
    this.runEl.hidden = false;
    this.submitBtn.hidden = false;
    this.runEl.textContent =
      `本局 ${pending.score.toLocaleString('zh-CN')} 分 · 存活 ` +
      `${pending.duration.toFixed(1)} 秒` +
      (pending.rank ? ` · 全球第 ${pending.rank} 名` : '');
    this.submitBtn.disabled = pending.submitted || pending.submitting;
    this.submitBtn.textContent = pending.submitted
      ? '本局成绩已上传'
      : pending.submitting
        ? '上传中…'
        : '提交本局成绩';
  }

  async loadTop() {
    const seq = ++this.loadSeq;
    this.listEl.innerHTML = '<div class="lb-empty">加载中…</div>';
    try {
      const entries = await fetchTop(this.period, 10);
      if (seq !== this.loadSeq) return;
      this.renderEntries(entries);
    } catch (error) {
      if (seq !== this.loadSeq) return;
      this.listEl.innerHTML = '';
      const box = document.createElement('div');
      box.className = 'lb-empty lb-error';
      box.textContent = leaderboardErrorMessage(error);
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'lb-retry';
      retry.textContent = '重试';
      retry.addEventListener('click', () => this.loadTop());
      box.appendChild(document.createElement('br'));
      box.appendChild(retry);
      this.listEl.appendChild(box);
    }
  }

  renderEntries(entries) {
    this.listEl.innerHTML = '';
    if (!entries.length) {
      this.listEl.innerHTML =
        '<div class="lb-empty">还没有成绩，来抢第一！</div>';
      return;
    }
    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'lb-row';
      row.setAttribute('role', 'listitem');
      row.title = `存活 ${Number(entry.duration || 0).toFixed(1)} 秒 · 抢车 ${Number(
        entry.hijacks || 0
      )} 辆`;

      const rank = document.createElement('span');
      rank.className = `lb-rank${index < 3 ? ` top${index + 1}` : ''}`;
      rank.textContent = String(index + 1);

      const name = document.createElement('span');
      name.className = 'lb-name-cell';
      name.textContent = entry.name || '匿名车手';

      const score = document.createElement('span');
      score.className = 'lb-score';
      score.textContent = Number(entry.score || 0).toLocaleString('zh-CN');

      row.appendChild(rank);
      row.appendChild(name);
      row.appendChild(score);
      this.listEl.appendChild(row);
    });
  }

  setStatus(text, tone = '') {
    this.statusEl.textContent = text;
    this.statusEl.dataset.tone = tone;
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 3200);
  }
}
