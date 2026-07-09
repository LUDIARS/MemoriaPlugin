// furusato-nozei プラグイン UI。 vanilla JS (Memoria 本体 app.ts と同じ流儀)。
(() => {
  const BASE = window.__BASE || '';
  const $ = (id) => document.getElementById(id);
  const yen = (n) => `${Math.round(n || 0).toLocaleString('ja-JP')}円`;
  const thisYear = new Date().getFullYear();

  async function api(path, opts) {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // ---- tabs ---------------------------------------------------------------

  function initTabs() {
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $(`panel-${btn.dataset.tab}`).classList.add('active');
      });
    });
  }

  function fillYearSelect(select, years, selected) {
    const set = new Set(years);
    set.add(selected);
    set.add(thisYear);
    const sorted = [...set].sort((a, b) => b - a);
    select.innerHTML = sorted.map((y) => `<option value="${y}"${y === selected ? ' selected' : ''}>${y}</option>`).join('');
  }

  // ---- summary --------------------------------------------------------------

  let summaryYear = thisYear;

  async function loadSummary() {
    const data = await api(`/api/summary?year=${summaryYear}`);
    fillYearSelect($('summaryYear'), data.years, summaryYear);
    fillYearSelect($('giftsYearFilter'), data.years, summaryYear);
    $('statLimit').textContent = yen(data.limitYen);
    $('statDonated').textContent = yen(data.totalDonatedYen);
    $('statRemaining').textContent = yen(data.remainingYen);
  }

  // ---- settings / simulate ---------------------------------------------------

  async function loadSettings() {
    const { settings, limit } = await api('/api/settings');
    $('income').value = settings.annual_income_yen || '';
    $('marital').value = settings.marital_status;
    $('depGeneral').value = settings.dependents_general;
    $('depSpecific').value = settings.dependents_specific;
    $('siRate').value = settings.social_insurance_rate;
    $('otherDed').value = settings.other_deductions_yen;
    $('limitNote').textContent = limit.note;
  }

  async function saveSettings() {
    const status = $('settingsStatus');
    status.textContent = '保存中...'; status.className = 'status muted';
    try {
      const body = {
        annual_income_yen: Number($('income').value || 0),
        marital_status: $('marital').value,
        dependents_general: Number($('depGeneral').value || 0),
        dependents_specific: Number($('depSpecific').value || 0),
        social_insurance_rate: Number($('siRate').value || 0.15),
        other_deductions_yen: Number($('otherDed').value || 0),
      };
      const { limit } = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
      status.textContent = `控除上限 (概算): ${yen(limit.limitYen)}`; status.className = 'status ok';
      $('limitNote').textContent = limit.note;
      await loadSummary();
    } catch (e) {
      status.textContent = `エラー: ${e.message}`; status.className = 'status ng';
    }
  }

  // ---- gifts -----------------------------------------------------------------

  function giftRow(g) {
    const arrived = g.arrived_at
      ? `<span class="pill arrived">到着済 ${g.arrived_at}</span>`
      : (g.expected_ship_start ? `<span class="pill waiting">未到着</span>` : '<span class="muted">-</span>');
    const ship = [g.expected_ship_start, g.expected_ship_end].filter(Boolean).join(' 〜 ') || '-';
    return `<tr data-id="${g.id}">
      <td>${g.year}</td>
      <td>${escapeHtml(g.municipality)}<br><span class="muted">${escapeHtml(g.product_name)}</span></td>
      <td>${yen(g.amount_yen)}</td>
      <td>${ship}</td>
      <td>${arrived}</td>
      <td class="actions">
        ${g.arrived_at ? '' : '<button class="ghost mark-arrived">到着</button>'}
        <button class="ghost delete-gift">削除</button>
      </td>
    </tr>`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function loadGifts() {
    const yearSel = $('giftsYearFilter').value;
    const q = yearSel ? `?year=${yearSel}` : '';
    const { gifts } = await api(`/api/gifts${q}`);
    $('giftsBody').innerHTML = gifts.map(giftRow).join('') || '<tr><td colspan="6" class="muted">記録なし</td></tr>';
  }

  async function addGift() {
    const status = $('giftStatus');
    const body = {
      year: Number($('giftYear').value || thisYear),
      municipality: $('giftMunicipality').value.trim(),
      product_name: $('giftProduct').value.trim(),
      category: $('giftCategory').value.trim() || null,
      amount_yen: Number($('giftAmount').value || 0),
      donated_at: $('giftDonatedAt').value || null,
      expected_ship_start: $('giftShipStart').value || null,
      expected_ship_end: $('giftShipEnd').value || null,
    };
    if (!body.municipality || !body.product_name || !body.amount_yen) {
      status.textContent = '自治体・返礼品名・寄付額は必須です'; status.className = 'status ng';
      return;
    }
    status.textContent = '追加中...'; status.className = 'status muted';
    try {
      await api('/api/gifts', { method: 'POST', body: JSON.stringify(body) });
      status.textContent = '追加しました'; status.className = 'status ok';
      ['giftMunicipality', 'giftProduct', 'giftCategory', 'giftAmount', 'giftShipStart', 'giftShipEnd'].forEach((id) => { $(id).value = ''; });
      await Promise.all([loadGifts(), loadSummary()]);
    } catch (e) {
      status.textContent = `エラー: ${e.message}`; status.className = 'status ng';
    }
  }

  function initGiftsTableEvents() {
    $('giftsBody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.classList.contains('mark-arrived')) {
        await api(`/api/gifts/${id}`, { method: 'PATCH', body: JSON.stringify({ arrived_at: new Date().toLocaleDateString('en-CA') }) });
        await loadGifts();
      } else if (e.target.classList.contains('delete-gift')) {
        await api(`/api/gifts/${id}`, { method: 'DELETE' });
        await Promise.all([loadGifts(), loadSummary()]);
      }
    });
  }

  // ---- bookmarks ---------------------------------------------------------------

  function bookmarkRow(b) {
    const statusPill = b.status === 'watching'
      ? '<span class="pill watching">ウォッチ中</span>'
      : (b.status === 'donated' ? '<span class="pill arrived">寄付済</span>' : '<span class="muted">見送り</span>');
    const link = b.url ? `<a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">開く</a>` : '';
    return `<tr data-id="${b.id}">
      <td>${escapeHtml(b.municipality || '自治体不明')}<br><span class="muted">${escapeHtml(b.product_name)}</span> ${link}</td>
      <td>${b.amount_yen ? yen(b.amount_yen) : '-'}</td>
      <td>${statusPill}</td>
      <td class="actions">
        ${b.status === 'watching' ? '<button class="ghost convert-gift">寄付済に変換</button><button class="ghost dismiss-bm">見送り</button>' : ''}
        <button class="ghost delete-bm">削除</button>
      </td>
    </tr>`;
  }

  async function loadBookmarks() {
    const { bookmarks } = await api('/api/bookmarks');
    $('bookmarksBody').innerHTML = bookmarks.map(bookmarkRow).join('') || '<tr><td colspan="4" class="muted">まだありません</td></tr>';
  }

  function initBookmarksTableEvents() {
    $('bookmarksBody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.dataset.id;
      if (e.target.classList.contains('dismiss-bm')) {
        await api(`/api/bookmarks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) });
        await loadBookmarks();
      } else if (e.target.classList.contains('delete-bm')) {
        await api(`/api/bookmarks/${id}`, { method: 'DELETE' });
        await loadBookmarks();
      } else if (e.target.classList.contains('convert-gift')) {
        const amount = window.prompt('寄付額 (円) を入力してください');
        if (!amount || Number.isNaN(Number(amount))) return;
        await api(`/api/bookmarks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'donated', amount_yen: Number(amount), year: thisYear }),
        });
        await Promise.all([loadBookmarks(), loadGifts(), loadSummary()]);
      }
    });
  }

  // ---- suggest ---------------------------------------------------------------

  async function loadLatestSuggestion() {
    const { suggestion } = await api(`/api/suggestions/latest?year=${summaryYear}`);
    $('suggestionBody').textContent = suggestion ? suggestion.body_md : 'まだ提案はありません。';
    $('suggestionBody').classList.toggle('muted', !suggestion);
  }

  async function runSuggest() {
    const btn = $('suggestBtn');
    const status = $('suggestStatus');
    btn.disabled = true;
    status.textContent = 'サジェスト中... (数十秒かかることがあります)'; status.className = 'status muted';
    try {
      const { ok, suggestion, error } = await api('/api/suggest', { method: 'POST', body: JSON.stringify({ year: summaryYear }) });
      if (!ok) throw new Error(error || '不明なエラー');
      $('suggestionBody').textContent = suggestion.body_md;
      $('suggestionBody').classList.remove('muted');
      status.textContent = '完了'; status.className = 'status ok';
    } catch (e) {
      status.textContent = `エラー: ${e.message}`; status.className = 'status ng';
    } finally {
      btn.disabled = false;
    }
  }

  // ---- init --------------------------------------------------------------------

  async function init() {
    initTabs();
    initGiftsTableEvents();
    initBookmarksTableEvents();

    $('summaryYear').addEventListener('change', async (e) => {
      summaryYear = Number(e.target.value);
      await Promise.all([loadSummary(), loadLatestSuggestion()]);
    });
    $('giftsYearFilter').addEventListener('change', loadGifts);
    $('saveSettings').addEventListener('click', saveSettings);
    $('addGift').addEventListener('click', addGift);
    $('suggestBtn').addEventListener('click', runSuggest);

    await Promise.all([loadSettings(), loadSummary(), loadGifts(), loadBookmarks(), loadLatestSuggestion()]);
  }

  init().catch((e) => console.error('[furusato-nozei] init failed', e));
})();
