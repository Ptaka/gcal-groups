// READMEキャプチャ用マスキングスクリプト(自動マッピング方式)
// javascript_tool でページに注入して使う。実名の対応表は一切ハードコードしない。
// 解除: window.__mask.stop() / 追加マスク: window.__mask.add('実名','ダミー名')
window.__mask = (() => {
  if (window.__mask && window.__mask.stop) window.__mask.stop();

  // ダミー名プール(すべて架空)
  const PERSON_POOL = ['山田 太郎','佐藤 花子','鈴木 一郎','田中 美咲','高橋 健','伊藤 彩','渡辺 大輔','中村 玲奈','小林 誠','加藤 由紀'];
  const ROOM_POOL   = ['会議室A','会議室B','会議室C','会議室D','会議室E'];
  const GROUP_POOL  = ['営業','開発','クライアントA','個人','広報','経理'];
  // 置換不要の一般名
  const GENERIC = new Set(['ToDo リスト','誕生日','リマインダー','Tasks','Birthdays','Reminders']);

  const MAP = new Map();
  let pi = 0, ri = 0, gi = 0;

  function assign(name, kind) {
    if (!name || GENERIC.has(name) || MAP.has(name)) return;
    let dummy;
    if (kind === 'group') dummy = GROUP_POOL[gi++] || ('グループ' + gi);
    else if (/会議室|スペース|ルーム|\(\d+\)/.test(name)) dummy = ROOM_POOL[ri++] || ('会議室' + ri);
    else dummy = PERSON_POOL[pi++] || ('社員' + pi);
    MAP.set(name, dummy);
    // ローマ字氏名は単語単位でも置換(予約ページ「〈名〉 と 30 分間の予定」のような部分一致に対応)
    const tokens = name.match(/[A-Za-z]{4,}/g) || [];
    const dTokens = dummy.split(/\s+/);
    tokens.forEach((t, i) => { if (!MAP.has(t)) MAP.set(t, dTokens[i % dTokens.length]); });
  }

  // 1) カレンダー名: サイドバーのチェックボックス aria-label(拡張と同じ識別方法)
  for (const b of document.querySelectorAll('input[type="checkbox"][aria-label]')) assign(b.getAttribute('aria-label'), 'cal');
  // 2) 拡張がキャッシュしている候補名(パネルを一度開いて .gcg-editor-line 等が現れた時にも再収集される)
  for (const e of document.querySelectorAll('#gcg-panel .gcg-editor-name, #gcg-panel .gcg-editor-line label')) assign(e.textContent.trim(), 'cal');
  // 3) グループ名: チップのテキスト
  for (const c of document.querySelectorAll('.gcg-chip')) assign(c.textContent.replace(/^[✓\s]+/, '').trim(), 'group');

  const keys = () => [...MAP.keys()].sort((a, b) => b.length - a.length);
  function rep(t) { for (const k of keys()) if (t.includes(k)) t = t.split(k).join(MAP.get(k)); return t; }

  function replaceIn(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const t = rep(w.currentNode.textContent);
      if (t !== w.currentNode.textContent) w.currentNode.textContent = t;
    }
  }
  function maskAttrs() {
    for (const e of document.querySelectorAll('[title]')) {
      const t = rep(e.getAttribute('title'));
      if (t !== e.getAttribute('title')) e.setAttribute('title', t);
    }
  }

  // 予定・アバター・組織ロゴのぼかし(gb_* はGoogle側の難読化クラス。効いているか目視確認すること)
  const style = document.createElement('style');
  style.id = '__mask_style';
  style.textContent = `
    [data-eventchip]{filter:blur(6px)!important;}
    img.gb_eb, img.gb_W{filter:blur(8px)!important;}
  `;
  document.head.appendChild(style);

  replaceIn(document.body); maskAttrs();
  document.title = 'Google カレンダー';

  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') replaceIn(m.target.parentElement || document.body);
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) replaceIn(n);
        else if (n.nodeType === 3 && n.parentElement) replaceIn(n.parentElement);
      }
    }
    maskAttrs();
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });

  return {
    map: MAP,
    add(real, dummy) { MAP.set(real, dummy); replaceIn(document.body); maskAttrs(); },
    stop() { mo.disconnect(); style.remove(); }
  };
})();
'masked: ' + window.__mask.map.size + ' names';
