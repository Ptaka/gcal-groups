// Google Calendar グループ切替 v3
// カレンダーをグルーピングし、グループ単位でON/OFFする content script
//
// 方式: GCalのDOM(Wizフレームワーク管理下)には一切触れず、
// document.body直下に固定オーバーレイのチップバーを置く。
// バーはカレンダー上部に表示され、ドラッグで移動可能。

(() => {
  "use strict";

  const BAR_ID = "gcg-bar";
  const PANEL_ID = "gcg-panel";
  const STORAGE_KEY = "gcgGroups";
  const PINNED_KEY = "gcgPinned";
  const KNOWN_KEY = "gcgKnownCalendars";
  const POS_KEY = "gcgBarPos";
  const EXCLUSIVE_KEY = "gcgExclusive";
  const ACTIVE_KEY = "gcgActiveGroups";
  const SCAN_META_KEY = "gcgScanMeta";

  /** @type {{id:string, name:string, calendars:string[]}[]} */
  let groups = [];
  let editingGroupId = null; // 編集エリアを開いているグループ
  let editorFilter = ""; // エディタの絞り込みテキスト(再描画をまたいで保持)
  let panelOpen = false;
  /** 一度でも検出したカレンダー名のキャッシュ @type {Set<string>} */
  let knownCalendars = new Set();
  /** バーの位置 {x, y} | null(nullなら上部中央) */
  let barPos = null;
  /** 排他モード: ONにしたグループ以外のグループ所属カレンダーをOFFにする */
  let exclusiveMode = false;
  /** ユーザーが明示的に選択(ON)しているグループID @type {Set<string>} */
  let activeGroupIds = new Set();
  /** ピン留め(グループ操作でOFFにしない)カレンダー名 @type {Set<string>} */
  let pinnedCalendars = new Set();
  /** 最終スキャン情報 {at: epoch_ms, count: number} | null */
  let scanMeta = null;
  /** 最後の全件検出で見つかった名前(存在判定の基準) @type {Set<string>} */
  let lastScanNames = new Set();
  /** エディタの初回Tipsを表示済みか */
  let editorTipShown = false;
  /** ピン留めのTipsを表示済みか */
  let pinTipShown = false;
  /** 初回のバー紹介コーチマークを表示済みか */
  let onboarded = false;
  /** ドラッグ案内コーチマークを表示済みか */
  let dragTipShown = false;

  // ---------- storage ----------

  function loadGroups() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEY, PINNED_KEY], (res) => {
        groups = Array.isArray(res[STORAGE_KEY]) ? res[STORAGE_KEY] : [];
        pinnedCalendars = new Set(
          Array.isArray(res[PINNED_KEY]) ? res[PINNED_KEY] : []
        );
        resolve();
      });
    });
  }

  function saveGroups(onDone) {
    chrome.storage.sync.set({ [STORAGE_KEY]: groups }, () => {
      if (onDone) onDone(chrome.runtime.lastError || null);
    });
  }

  let idSeq = 0;
  function newGroupId() {
    return "g" + Date.now().toString(36) + (idSeq++).toString(36);
  }

  // ---------- export / import ----------
  // グループ定義をJSONファイルとして書き出す(チーム共有・バックアップ用)。
  // idはローカル固有のため出力せず、名前を識別子として交換する。
  function exportGroups() {
    const data = {
      app: "gcal-groups",
      version: 1,
      exportedAt: new Date().toISOString(),
      groups: groups.map((g) => ({
        name: g.name,
        calendars: [...g.calendars],
      })),
      pinned: [...pinnedCalendars],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gcal-groups-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("グループをエクスポートしました。");
  }

  // 追加マージ方式: 既存グループはそのまま、同名グループはメンバーを上書き
  function mergeImport(data) {
    if (!data || !Array.isArray(data.groups)) {
      throw new Error("invalid format");
    }
    let added = 0;
    let updated = 0;
    for (const g of data.groups) {
      if (!g || typeof g.name !== "string" || !Array.isArray(g.calendars)) {
        continue;
      }
      const name = g.name.trim();
      if (!name) continue;
      const calendars = [
        ...new Set(
          g.calendars
            .filter((c) => typeof c === "string" && c.trim())
            .map((c) => c.trim())
        ),
      ];
      const existing = groups.find((x) => x.name === name);
      if (existing) {
        existing.calendars = calendars;
        updated++;
      } else {
        groups.push({ id: newGroupId(), name, calendars });
        added++;
      }
    }
    const pinned = Array.isArray(data.pinned)
      ? data.pinned.filter((p) => typeof p === "string" && p.trim()).map((p) => p.trim())
      : [];
    return { added, updated, pinned };
  }

  function importGroupsFromFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const backup = JSON.stringify(groups);
      let result;
      try {
        result = mergeImport(JSON.parse(await file.text()));
      } catch (e) {
        groups = JSON.parse(backup);
        showToast("インポートできませんでした。ファイル形式を確認してください。");
        return;
      }
      if (result.added === 0 && result.updated === 0) {
        groups = JSON.parse(backup);
        showToast("インポートできるグループがありませんでした。");
        return;
      }
      saveGroups((err) => {
        if (err) {
          // 保存失敗(同期ストレージの容量超過など)。メモリ上の状態も元に戻す
          groups = JSON.parse(backup);
          showToast("保存に失敗しました。グループ数を減らして再度お試しください。");
          return;
        }
        for (const p of result.pinned) pinnedCalendars.add(p);
        if (result.pinned.length) savePinned();
        renderGroups();
        renderChips();
        showToast(
          `インポートしました(追加 ${result.added}・上書き ${result.updated})。`
        );
      });
    });
    input.click();
  }

  function savePinned() {
    chrome.storage.sync.set({ [PINNED_KEY]: [...pinnedCalendars] });
  }

  function loadLocalState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        [KNOWN_KEY, POS_KEY, EXCLUSIVE_KEY, ACTIVE_KEY, SCAN_META_KEY, "gcgScanNames", "gcgEditorTipShown", "gcgPinTipShown", "gcgOnboarded", "gcgDragTipShown"],
        (res) => {
          const raw = Array.isArray(res[KNOWN_KEY]) ? res[KNOWN_KEY] : [];
          // 過去に混入したジャンク(登録用チェックボックス等)を自動除去
          const cleaned = raw.filter((n) => !isJunkLabel(n));
          knownCalendars = new Set(cleaned);
          if (cleaned.length !== raw.length) saveKnownCalendars();
          exclusiveMode = res[EXCLUSIVE_KEY] === true;
          activeGroupIds = new Set(
            Array.isArray(res[ACTIVE_KEY]) ? res[ACTIVE_KEY] : []
          );
          scanMeta =
            res[SCAN_META_KEY] && typeof res[SCAN_META_KEY].at === "number"
              ? res[SCAN_META_KEY]
              : null;
          editorTipShown = res.gcgEditorTipShown === true;
          pinTipShown = res.gcgPinTipShown === true;
          onboarded = res.gcgOnboarded === true;
          dragTipShown = res.gcgDragTipShown === true;
          lastScanNames = new Set(
            Array.isArray(res.gcgScanNames) ? res.gcgScanNames : []
          );
          barPos =
          res[POS_KEY] &&
          typeof res[POS_KEY].x === "number" &&
          typeof res[POS_KEY].y === "number"
            ? res[POS_KEY]
            : null;
        resolve();
      });
    });
  }

  let knownSaveTimer = null;
  function saveKnownCalendars() {
    clearTimeout(knownSaveTimer);
    knownSaveTimer = setTimeout(() => {
      chrome.storage.local.set({ [KNOWN_KEY]: [...knownCalendars] });
    }, 500);
  }

  function saveBarPos() {
    chrome.storage.local.set({ [POS_KEY]: barPos });
  }

  function saveExclusiveMode() {
    chrome.storage.local.set({ [EXCLUSIVE_KEY]: exclusiveMode });
  }

  function saveActiveGroups() {
    chrome.storage.local.set({ [ACTIVE_KEY]: [...activeGroupIds] });
  }

  // ---------- カレンダー検出 ----------

  // カレンダー行として扱わないパターン
  // (「他のカレンダーを追加」の閲覧画面などの登録用チェックボックス)
  function isJunkLabel(label) {
    return (
      /に登録する$/.test(label) ||
      /^Subscribe to /i.test(label) ||
      /^登録:/.test(label)
    );
  }

  // サイドバーのカレンダー行チェックボックスを収集する。
  // Google カレンダーは各カレンダー行に aria-label 付きの
  // input[type=checkbox] を持つ(UI変更に備えて listitem 内も走査)。
  function findCalendarCheckboxes() {
    /** @type {Map<string, HTMLInputElement>} */
    const map = new Map();

    // 設定画面(カレンダー追加・ブラウズ等)ではスキャンしない
    if (location.pathname.includes("/settings")) return map;

    const inputs = document.querySelectorAll(
      'input[type="checkbox"][aria-label], [role="listitem"] input[type="checkbox"], li input[type="checkbox"]'
    );
    for (const input of inputs) {
      if (input.closest(`#${PANEL_ID}`) || input.closest(`#${BAR_ID}`)) continue;
      // モーダルダイアログ内(カレンダー追加UI等)は対象外
      if (input.closest('[role="dialog"]')) continue;
      const label = getCalendarLabel(input);
      if (!label || isJunkLabel(label)) continue;
      if (!map.has(label)) map.set(label, input);
    }
    // 検出した名前をキャッシュに蓄積(折りたたみで消えても選択肢に残す)
    let changed = false;
    for (const name of map.keys()) {
      if (!knownCalendars.has(name)) {
        knownCalendars.add(name);
        changed = true;
      }
    }
    if (changed) saveKnownCalendars();
    return map;
  }

  function getCalendarLabel(input) {
    const aria = input.getAttribute("aria-label");
    if (aria) return aria.trim();
    // フォールバック: 行内のテキスト
    const item = input.closest('[role="listitem"], li');
    if (item) {
      const text = item.textContent.trim();
      if (text) return text.split("\n")[0].trim();
    }
    return null;
  }

  // サイドバーを自動スクロールして全カレンダーを収集する。
  // GCalはリストが長いと画面内の行しかDOMに描画しないため、
  // スクロールで順次描画させながら収穫する。終了後は元の位置に戻す。
  async function scanAllCalendars() {
    /** @type {Set<string>} */
    const collected = new Set();
    const harvest = () => {
      for (const n of findCalendarCheckboxes().keys()) collected.add(n);
    };
    harvest();

    // カレンダー行を含むスクロール可能な祖先(=サイドバーのスクローラ)を探す
    const anyInput = findCalendarCheckboxes().values().next().value;
    let scroller = null;
    for (let el = anyInput; el; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 10) {
        scroller = el;
        break;
      }
    }
    if (!scroller) return collected; // スクロール不要(全件描画済み)

    const originalTop = scroller.scrollTop;
    const step = Math.max(scroller.clientHeight * 0.7, 100);
    for (let y = 0; y <= scroller.scrollHeight; y += step) {
      scroller.scrollTop = y;
      await new Promise((r) => setTimeout(r, 160)); // 描画待ち
      harvest();
    }
    scroller.scrollTop = originalTop;
    await new Promise((r) => setTimeout(r, 160));
    harvest();
    return collected;
  }

  // ---------- グループ状態の算出 ----------

  function groupState(group, calMap) {
    let checked = 0;
    let total = 0;
    for (const name of group.calendars) {
      const input = calMap.get(name);
      if (!input) continue;
      total++;
      if (input.checked) checked++;
    }
    if (total === 0) return "empty";
    if (checked === 0) return "off";
    if (checked === total) return "on";
    return "mixed";
  }

  // 表示用の状態。「ユーザーが明示的に選択したか」を基準にする。
  // 他グループの操作でカレンダーがたまたま全部ONになっても、
  // 選択していないグループはOFF表示のまま。
  // 仮想スクロールでメンバーが全員画面外(DOM不在)でも、
  // 検出名リストに存在すれば「対象なし」とは扱わない。
  function displayState(group, calMap) {
    const derived = groupState(group, calMap);
    if (derived === "empty") {
      const anyKnown = group.calendars.some(
        (n) => calMap.has(n) || lastScanNames.has(n)
      );
      if (!anyKnown) return "empty";
      // メンバーは存在するが描画されていない: 選択状態を信じて表示
      return activeGroupIds.has(group.id) ? "on" : "off";
    }
    if (!activeGroupIds.has(group.id)) return "off";
    if (derived === "off") {
      // 選択中なのに全部OFF = サイドバーで手動解除された → 選択も解除
      activeGroupIds.delete(group.id);
      saveActiveGroups();
      return "off";
    }
    return derived; // on | mixed
  }

  let toggling = false; // 切替の多重実行防止

  async function toggleGroup(group, turnOn) {
    if (toggling) return;
    toggling = true;
    setGroupBusy(group.id, true);
    try {
      /** @type {Set<string>} */
      const toOn = new Set();
      /** @type {Set<string>} */
      const toOff = new Set();

      if (turnOn) {
        activeGroupIds.add(group.id);
        for (const n of group.calendars) toOn.add(n);
        // 排他モード: 他グループの選択を解除し、
        // それらの所属カレンダーをOFFにする
        // (選択グループにも属するもの・ピン留めは除く。
        //  どのグループにも属さないカレンダーには触らない)
        if (exclusiveMode) {
          for (const g of groups) {
            if (g.id === group.id) continue;
            activeGroupIds.delete(g.id);
            for (const n of g.calendars) {
              if (!toOn.has(n) && !pinnedCalendars.has(n)) toOff.add(n);
            }
          }
        }
      } else {
        activeGroupIds.delete(group.id);
        // 他の選択中グループがまだ必要としているカレンダーと
        // ピン留め(常に表示)のカレンダーは残す
        const needed = new Set();
        for (const g of groups) {
          if (!activeGroupIds.has(g.id)) continue;
          for (const n of g.calendars) needed.add(n);
        }
        for (const n of group.calendars) {
          if (!needed.has(n) && !pinnedCalendars.has(n)) toOff.add(n);
        }
      }
      saveActiveGroups();

      // 適用対象(OFF→ONの順)。GCalは仮想スクロールで画面外の行を
      // DOMに描画しないため、まず描画済みを適用し、残りはサイドバーを
      // スクロールして描画させながら適用する。
      /** @type {Map<string, boolean>} */
      const pending = new Map();
      for (const n of toOff) pending.set(n, false);
      for (const n of toOn) pending.set(n, true);

      const clickRendered = async () => {
        for (const [name, target] of [...pending]) {
          const input = findCalendarCheckboxes().get(name);
          if (input && document.contains(input)) {
            if (input.checked !== target) {
              input.click(); // click で Google 側の状態も更新される
              await new Promise((r) => setTimeout(r, 120));
            }
            pending.delete(name);
          }
        }
      };

      await clickRendered();

      if (pending.size > 0) {
        const anyInput = findCalendarCheckboxes().values().next().value;
        let scroller = null;
        for (let el = anyInput; el; el = el.parentElement) {
          if (el.scrollHeight > el.clientHeight + 10) {
            scroller = el;
            break;
          }
        }
        if (scroller) {
          const originalTop = scroller.scrollTop;
          const step = Math.max(scroller.clientHeight * 0.7, 100);
          for (
            let y = 0;
            y <= scroller.scrollHeight && pending.size > 0;
            y += step
          ) {
            scroller.scrollTop = y;
            await new Promise((r) => setTimeout(r, 160)); // 描画待ち
            await clickRendered();
          }
          scroller.scrollTop = originalTop;
        }
      }
    } finally {
      toggling = false;
      setGroupBusy(group.id, false);
    }
    // ビジー解除と同時に即時反映(表示の空白をなくす)
    refreshGroupStates();
    // GCal側の遅延反映分をもう一度拾う
    setTimeout(refreshGroupStates, 300);
  }

  // ---------- 共通 ----------

  // 簡易トースト通知(バーの近くに表示、自動で消える)
  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById("gcg-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "gcg-toast";
      isolateEvents(toast);
      document.body.append(toast);
    }
    toast.textContent = message;
    const bar = document.getElementById(BAR_ID);
    if (bar) {
      const rect = bar.getBoundingClientRect();
      toast.style.left = `${Math.max(rect.left, 8)}px`;
      toast.style.top = `${rect.bottom + 8}px`;
    }
    toast.classList.add("gcg-toast-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("gcg-toast-show");
    }, 4000);
  }

  // 切替処理中のビジー表示(チップと管理パネル行の両方)
  function setGroupBusy(groupId, busy) {
    const chip = document.querySelector(
      `#${BAR_ID} .gcg-chip[data-group-id="${groupId}"]`
    );
    if (chip) chip.classList.toggle("gcg-busy", busy);
    const row = document.querySelector(
      `#${PANEL_ID} .gcg-row[data-group-id="${groupId}"]`
    );
    if (row) row.classList.toggle("gcg-busy", busy);
  }

  // ---------- コーチマーク(対象を指す吹き出し) ----------
  // 「その機能が意味を持つ瞬間に1つだけ」出すジャストインタイム型。
  // 暗転オーバーレイは使わない(GCal利用の邪魔をしないため)。

  let coach = null; // { el, flagKey, getTarget }

  function showCoachmark({ text, getTarget, flagKey }) {
    dismissCoachmark(false);
    const target = getTarget();
    if (!target) return;

    const el = document.createElement("div");
    el.className = "gcg-coach";
    isolateEvents(el);

    const arrow = document.createElement("div");
    arrow.className = "gcg-coach-arrow";

    const body = document.createElement("div");
    body.className = "gcg-coach-body";

    const span = document.createElement("span");
    span.textContent = text;

    const close = document.createElement("button");
    close.className = "gcg-icon-btn gcg-coach-close";
    close.title = "閉じる";
    close.textContent = "×";
    close.addEventListener("click", () => dismissCoachmark(true));

    body.append(span, close);
    el.append(arrow, body);
    document.body.append(el);

    coach = { el, flagKey, getTarget };
    positionCoachmark();
  }

  function positionCoachmark() {
    if (!coach) return;
    const target = coach.getTarget();
    if (!target || !document.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const el = coach.el;
    const width = Math.min(280, window.innerWidth - 16);
    el.style.width = `${width}px`;
    const centerX = rect.left + rect.width / 2;
    const left = Math.min(
      Math.max(centerX - width / 2, 8),
      window.innerWidth - width - 8
    );
    el.style.left = `${left}px`;
    el.style.top = `${rect.bottom + 10}px`;
    // 矢印はカード内で対象の中心を指す位置に
    const arrow = el.querySelector(".gcg-coach-arrow");
    const arrowX = Math.min(Math.max(centerX - left - 6, 12), width - 24);
    arrow.style.left = `${arrowX}px`;
  }

  function dismissCoachmark(persist) {
    if (!coach) return;
    if (persist && coach.flagKey) {
      chrome.storage.local.set({ [coach.flagKey]: true });
      if (coach.flagKey === "gcgOnboarded") onboarded = true;
      if (coach.flagKey === "gcgDragTipShown") dragTipShown = true;
    }
    coach.el.remove();
    coach = null;
  }

  // オーバーレイ内のイベントをGCalのグローバルハンドラに漏らさない
  function isolateEvents(el) {
    const types = [
      "click",
      "mousedown",
      "mouseup",
      "pointerdown",
      "pointerup",
      "keydown",
      "keyup",
      "change",
    ];
    for (const type of types) {
      el.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  // ---------- チップバー ----------

  function buildBar() {
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    isolateEvents(bar);

    // ドラッグハンドル
    const handle = document.createElement("span");
    handle.className = "gcg-handle";
    handle.title = "ドラッグで移動";
    handle.textContent = "⋮⋮";
    setupDrag(bar, handle);
    bar.append(handle);

    const chips = document.createElement("span");
    chips.className = "gcg-chips";
    bar.append(chips);

    const gearBtn = document.createElement("button");
    gearBtn.className = "gcg-bar-btn";
    gearBtn.title = "グループを管理";
    gearBtn.textContent = "⚙";
    gearBtn.addEventListener("click", () => {
      panelOpen = !panelOpen;
      syncPanelVisibility();
      if (panelOpen) renderGroups();
    });
    bar.append(gearBtn);

    return bar;
  }

  function applyBarPos() {
    const bar = document.getElementById(BAR_ID);
    if (!bar) return;
    if (barPos) {
      // 画面内にクランプ
      const x = Math.min(Math.max(barPos.x, 4), window.innerWidth - 60);
      const y = Math.min(Math.max(barPos.y, 4), window.innerHeight - 40);
      bar.style.left = `${x}px`;
      bar.style.top = `${y}px`;
      bar.style.transform = "none";
    } else {
      bar.style.left = "50%";
      bar.style.top = "10px";
      bar.style.transform = "translateX(-50%)";
    }
  }

  function setupDrag(bar, handle) {
    let dragging = false;
    let moved = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = false;
      const rect = bar.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      moved = true;
      barPos = { x: e.clientX - offsetX, y: e.clientY - offsetY };
      applyBarPos();
      positionPanel();
      positionCoachmark(); // 吹き出しはバーに追従
    });
    handle.addEventListener("pointerup", (e) => {
      if (!dragging) return;
      dragging = false;
      handle.releasePointerCapture(e.pointerId);
      saveBarPos();
      // 実際にドラッグできたらドラッグ案内は目的達成
      if (moved && coach && coach.flagKey === "gcgDragTipShown") {
        dismissCoachmark(true);
      }
    });
  }

  function chipClass(state) {
    return {
      on: "gcg-chip gcg-chip-on",
      off: "gcg-chip",
      mixed: "gcg-chip gcg-chip-mixed",
      empty: "gcg-chip gcg-chip-empty",
    }[state];
  }

  function renderChips() {
    const bar = document.getElementById(BAR_ID);
    if (!bar) return;
    const chips = bar.querySelector(".gcg-chips");
    chips.textContent = "";

    if (groups.length === 0) {
      // 初回のみ: 作成への導線チップ(グループができたら消える)
      const createChip = document.createElement("button");
      createChip.className = "gcg-chip gcg-chip-create";
      createChip.textContent = "＋ グループを作成";
      createChip.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPanelForAdd();
      });
      chips.append(createChip);
      return;
    }

    const calMap = findCalendarCheckboxes();
    for (const group of groups) {
      const chip = document.createElement("button");
      const state = displayState(group, calMap);
      chip.className = chipClass(state);
      chip.dataset.groupId = group.id;
      chip.textContent = group.name;
      setChipAria(chip, state);
      chip.title =
        (group.calendars.join("\n") || "カレンダー未割当") +
        (state === "empty" ? "\n(表示中のカレンダーに該当なし)" : "");
      chip.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // クリック時点で毎回再計算する。存在判定は仮想スクロールを
        // 考慮し、DOM不在でも検出名リストにあれば切替可能とする
        const calMapNow = findCalendarCheckboxes();
        const anyKnown = group.calendars.some(
          (n) => calMapNow.has(n) || lastScanNames.has(n)
        );
        if (!anyKnown) {
          showToast(
            "対象のカレンダーが見つかりません。左のサイドバーでカレンダー一覧を表示・展開してください。"
          );
          return;
        }
        // 「選択しているか」を基準にトグル(表示状態からの逆算はしない)
        toggleGroup(group, !activeGroupIds.has(group.id));
      });
      chips.append(chip);
    }
  }

  // スクリーンリーダー向けの状態属性
  function setChipAria(chip, state) {
    chip.setAttribute(
      "aria-pressed",
      state === "on" ? "true" : state === "mixed" ? "mixed" : "false"
    );
  }

  // チップの見た目だけを現状に合わせて更新
  function refreshChips() {
    const bar = document.getElementById(BAR_ID);
    if (!bar) return;
    const calMap = findCalendarCheckboxes();
    for (const chip of bar.querySelectorAll(".gcg-chip")) {
      const group = groups.find((g) => g.id === chip.dataset.groupId);
      if (!group) continue;
      const state = displayState(group, calMap);
      const busy = chip.classList.contains("gcg-busy");
      chip.className = chipClass(state) + (busy ? " gcg-busy" : "");
      setChipAria(chip, state);
    }
  }

  // ---------- 管理パネル ----------

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.style.display = "none";
    isolateEvents(panel);

    const header = document.createElement("div");
    header.className = "gcg-header";

    const title = document.createElement("span");
    title.className = "gcg-title";
    title.textContent = "カレンダーグループの管理";

    const btns = document.createElement("span");
    btns.className = "gcg-header-btns";

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "gcg-icon-btn";
    refreshBtn.title =
      "カレンダー候補を再スキャン(サイドバーを自動スクロールして全カレンダーを検出し、候補を作り直します)";
    refreshBtn.textContent = "↻";
    refreshBtn.addEventListener("click", () => runScan(refreshBtn));

    const closeBtn = document.createElement("button");
    closeBtn.className = "gcg-icon-btn";
    closeBtn.title = "閉じる";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => {
      panelOpen = false;
      syncPanelVisibility();
    });

    btns.append(refreshBtn, closeBtn);
    header.append(title, btns);
    panel.append(header);

    // 表示方法の設定(グループを重ねて表示 = 排他モードの反転)
    const modeRow = document.createElement("div");
    modeRow.className = "gcg-mode-row";

    const modeText = document.createElement("span");
    modeText.textContent = "グループを重ねて表示";
    modeText.title =
      "ON: 複数のグループを同時に重ねて表示できます\nOFF: グループを選ぶと他のグループは自動でオフになり、1グループずつ切り替えて表示します";

    const modeSwitch = document.createElement("button");
    modeSwitch.className = "gcg-switch";
    modeSwitch.setAttribute("role", "switch");

    const syncSwitch = () => {
      const on = !exclusiveMode;
      modeSwitch.classList.toggle("gcg-switch-on", on);
      modeSwitch.setAttribute("aria-checked", on ? "true" : "false");
    };
    syncSwitch();

    const toggleMode = (e) => {
      e.preventDefault();
      e.stopPropagation();
      exclusiveMode = !exclusiveMode;
      saveExclusiveMode();
      syncSwitch();
    };
    modeSwitch.addEventListener("click", toggleMode);
    modeText.addEventListener("click", toggleMode);

    modeRow.append(modeText, modeSwitch);
    panel.append(modeRow);

    const list = document.createElement("div");
    list.className = "gcg-list";
    panel.append(list);

    // インラインのグループ追加行
    const addRow = document.createElement("div");
    addRow.className = "gcg-add-row";

    const addInput = document.createElement("input");
    addInput.type = "text";
    addInput.className = "gcg-search gcg-add-input";
    addInput.placeholder = "新しいグループ名";
    addInput.addEventListener("keydown", (e) => {
      // IME変換確定のEnterでは追加しない
      if (e.key === "Enter" && !e.isComposing) submitAdd();
    });

    const addSubmit = document.createElement("button");
    addSubmit.className = "gcg-done-btn";
    addSubmit.textContent = "追加";
    addSubmit.addEventListener("click", submitAdd);

    function submitAdd() {
      const name = addInput.value.trim();
      if (!name) return;
      if (groups.some((g) => g.name === name)) {
        showToast(`「${name}」という名前のグループは既にあります。`);
        return;
      }
      const group = {
        id: newGroupId(),
        name,
        calendars: [],
      };
      groups.push(group);
      saveGroups();
      addInput.value = "";
      editingGroupId = group.id; // すぐメンバー編集を開く
      renderGroups();
      renderChips();
      maybeAutoScan();
      // 最初のグループができた瞬間 = バーが自分のものになった瞬間に
      // ドラッグ移動を案内する
      if (groups.length === 1 && !dragTipShown) {
        showCoachmark({
          text: "バーは ⋮⋮ をドラッグすると好きな位置に移動できます。",
          getTarget: () =>
            document.querySelector(`#${BAR_ID} .gcg-handle`),
          flagKey: "gcgDragTipShown",
        });
      }
    }

    addRow.append(addInput, addSubmit);
    panel.append(addRow);

    // エクスポート/インポート(チーム共有・バックアップ)
    const ioRow = document.createElement("div");
    ioRow.className = "gcg-io-row";

    const exportBtn = document.createElement("button");
    exportBtn.className = "gcg-io-btn";
    exportBtn.textContent = "エクスポート";
    exportBtn.title =
      "全グループとピン留めをJSONファイルに書き出します(チーム共有・バックアップ用)";
    exportBtn.addEventListener("click", exportGroups);

    const importBtn = document.createElement("button");
    importBtn.className = "gcg-io-btn";
    importBtn.textContent = "インポート";
    importBtn.title =
      "JSONファイルからグループを取り込みます。既存グループはそのまま、同名グループは上書きされます";
    importBtn.addEventListener("click", importGroupsFromFile);

    ioRow.append(exportBtn, importBtn);
    panel.append(ioRow);

    return panel;
  }

  // パネルを開いてグループ追加の入力にフォーカスする
  function openPanelForAdd() {
    // 初回案内は目的達成なので閉じる
    if (coach && coach.flagKey === "gcgOnboarded") dismissCoachmark(true);
    panelOpen = true;
    syncPanelVisibility();
    renderGroups();
    const input = document.querySelector(`#${PANEL_ID} .gcg-add-input`);
    if (input) input.focus();
  }

  // スキャンの実行(↻ボタン・エディタ内リンク・自動実行の共通処理)
  // auto: true のときは自動実行(失敗時に騒がない・トースト控えめ)
  let scanning = false;
  async function runScan(busyEl, auto = false) {
    if (scanning) return;
    scanning = true;
    if (busyEl) busyEl.classList.add("gcg-busy");
    if (!auto) showToast("カレンダーを検出中...");
    try {
      const scanned = await scanAllCalendars();
      if (scanned.size === 0) {
        if (!auto) {
          showToast(
            "カレンダーが見つかりません。左のサイドバーでカレンダー一覧を表示・展開してください。"
          );
        }
        return;
      }
      // スキャン結果 + グループ割当済みで作り直す(古いジャンクは消える)
      const fresh = new Set(scanned);
      for (const g of groups) for (const c of g.calendars) fresh.add(c);
      const before = knownCalendars.size;
      knownCalendars = fresh;
      saveKnownCalendars();
      scanMeta = { at: Date.now(), count: scanned.size };
      lastScanNames = new Set(scanned);
      chrome.storage.local.set({
        [SCAN_META_KEY]: scanMeta,
        gcgScanNames: [...scanned],
      });
      renderGroups();
      const added = fresh.size - before;
      if (!auto) {
        showToast(
          `検出完了: ${scanned.size}件のカレンダーが見つかりました` +
            (added > 0 ? `(候補に${added}件追加)` : "") +
            "。"
        );
      }
    } finally {
      scanning = false;
      if (busyEl) busyEl.classList.remove("gcg-busy");
    }
  }

  // エディタを開くとき、リストが古ければ自動で検出する
  // (未検出、または最終検出から24時間以上経過)
  const AUTO_SCAN_INTERVAL = 24 * 60 * 60 * 1000;
  function maybeAutoScan() {
    if (scanning) return;
    if (scanMeta && Date.now() - scanMeta.at < AUTO_SCAN_INTERVAL) return;
    runScan(null, true);
  }

  function syncPanelVisibility() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.style.display = panelOpen ? "" : "none";
    if (panelOpen) positionPanel();
  }

  // パネルをバーの直下に配置(画面右端をはみ出さないようクランプ)
  function positionPanel() {
    const panel = document.getElementById(PANEL_ID);
    const bar = document.getElementById(BAR_ID);
    if (!panel || !bar || !panelOpen) return;
    const rect = bar.getBoundingClientRect();
    const width = 320;
    const left = Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${rect.bottom + 6}px`;
  }

  function renderGroups() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const list = panel.querySelector(".gcg-list");
    list.textContent = "";

    if (groups.length === 0) {
      const empty = document.createElement("div");
      empty.className = "gcg-empty";
      empty.textContent = "下の入力欄からグループを作成できます";
      list.append(empty);
      return;
    }

    const calMap = findCalendarCheckboxes();

    for (const group of groups) {
      const row = document.createElement("div");
      row.className = "gcg-row";
      row.dataset.groupId = group.id;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "gcg-checkbox";
      applyState(cb, displayState(group, calMap));
      // GCal側にデフォルト動作を潰されるため、明示的にトグルする
      cb.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (cb.disabled) return;
        // 「選択しているか」を基準にトグル
        const turnOn = !activeGroupIds.has(group.id);
        // preventDefault後のブラウザによる巻き戻しを避けて1ティック後に反映
        setTimeout(() => {
          cb.indeterminate = false;
          cb.checked = turnOn;
        }, 0);
        toggleGroup(group, turnOn);
      });

      const name = document.createElement("span");
      name.className = "gcg-name";
      name.textContent = `${group.name} (${group.calendars.length})`;
      name.title = group.calendars.join("\n") || "カレンダー未割当";

      const editBtn = document.createElement("button");
      editBtn.className = "gcg-icon-btn";
      editBtn.title = "メンバーを編集";
      editBtn.textContent = "⚙";
      editBtn.addEventListener("click", () => {
        editingGroupId = editingGroupId === group.id ? null : group.id;
        editorFilter = "";
        renderGroups();
        if (editingGroupId) maybeAutoScan();
      });

      const renameBtn = document.createElement("button");
      renameBtn.className = "gcg-icon-btn";
      renameBtn.title = "名前を変更";
      renameBtn.textContent = "✎";
      renameBtn.addEventListener("click", () => {
        startRename(group, row, name);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "gcg-icon-btn gcg-del-btn";
      delBtn.title = "グループを削除";
      delBtn.textContent = "×";
      // 2段階確認: 1回目で「削除?」に変化、3秒以内の2回目で実行
      delBtn.addEventListener("click", () => {
        if (delBtn.dataset.confirm !== "1") {
          delBtn.dataset.confirm = "1";
          delBtn.textContent = "削除?";
          delBtn.classList.add("gcg-del-confirm");
          setTimeout(() => {
            delBtn.dataset.confirm = "";
            delBtn.textContent = "×";
            delBtn.classList.remove("gcg-del-confirm");
          }, 3000);
          return;
        }
        groups = groups.filter((g) => g.id !== group.id);
        if (editingGroupId === group.id) editingGroupId = null;
        if (activeGroupIds.delete(group.id)) saveActiveGroups();
        saveGroups();
        renderGroups();
        renderChips();
        showToast(`グループ「${group.name}」を削除しました。`);
      });

      row.append(cb, name, editBtn, renameBtn, delBtn);
      list.append(row);

      if (editingGroupId === group.id) {
        list.append(buildEditor(group, calMap));
      }
    }
  }

  function applyState(cb, state) {
    cb.indeterminate = state === "mixed";
    cb.checked = state === "on";
    cb.disabled = state === "empty";
  }

  // グループ名のインライン編集(Enter/フォーカス外れで確定、Escで取消)
  function startRename(group, row, nameEl) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "gcg-search gcg-rename-input";
    input.value = group.name;
    let cancelled = false;

    const commit = () => {
      if (cancelled) return;
      const newName = input.value.trim();
      if (newName && newName !== group.name) {
        group.name = newName;
        saveGroups();
        renderChips();
      }
      renderGroups();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) input.blur();
      if (e.key === "Escape") {
        cancelled = true;
        renderGroups();
      }
    });
    input.addEventListener("blur", commit);

    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  // グループのメンバー編集エリア
  function buildEditor(group, calMap) {
    const editor = document.createElement("div");
    editor.className = "gcg-editor";

    // 現在DOMにあるもの + 過去に検出したキャッシュ + 割当済み、の全部を出す
    const allNames = [
      ...new Set([...calMap.keys(), ...knownCalendars, ...group.calendars]),
    ].sort((a, b) => a.localeCompare(b, "ja"));

    if (allNames.length === 0) {
      const note = document.createElement("div");
      note.className = "gcg-empty";
      note.textContent =
        "カレンダーが見つかりません。サイドバーの一覧を展開してください。";
      editor.append(note);
      return editor;
    }

    // Tips(1度に1つだけ、順番に表示。閉じたら二度と出ない)
    const buildTip = (text, flagKey, onClose) => {
      const tip = document.createElement("div");
      tip.className = "gcg-tip";
      const tipText = document.createElement("span");
      tipText.textContent = text;
      const tipClose = document.createElement("button");
      tipClose.className = "gcg-icon-btn";
      tipClose.title = "閉じる";
      tipClose.textContent = "×";
      tipClose.addEventListener("click", () => {
        chrome.storage.local.set({ [flagKey]: true });
        onClose();
        tip.remove();
      });
      tip.append(tipText, tipClose);
      return tip;
    };

    if (!editorTipShown) {
      editor.append(
        buildTip(
          "💡 このリストは左のサイドバーから自動で検出されます。見当たらないカレンダーがあるときは「カレンダーを再検出」で全カレンダーを読み込めます。",
          "gcgEditorTipShown",
          () => { editorTipShown = true; }
        )
      );
    } else if (!pinTipShown) {
      editor.append(
        buildTip(
          "💡 各行の📌を押すと「常に表示」になり、グループをOFFにしてもそのカレンダーは表示されたままになります。自分のメインカレンダーにおすすめです。",
          "gcgPinTipShown",
          () => { pinTipShown = true; }
        )
      );
    }

    // 絞り込み入力
    const search = document.createElement("input");
    search.type = "text";
    search.className = "gcg-search";
    search.placeholder = "カレンダー名で絞り込み";
    search.value = editorFilter;
    editor.append(search);

    // 開いている間に新しいカレンダーが見つかったときの通知バナー
    // (勝手にリストを組み替えず、更新はユーザー操作で行う)
    const newBanner = document.createElement("div");
    newBanner.className = "gcg-new-banner";
    newBanner.style.display = "none";

    const newBannerText = document.createElement("span");
    const newBannerBtn = document.createElement("button");
    newBannerBtn.className = "gcg-scan-link";
    newBannerBtn.textContent = "リストを更新";
    newBannerBtn.addEventListener("click", () => {
      renderGroups(); // editorFilterは保持されたまま再構築される
    });
    newBanner.append(newBannerText, newBannerBtn);
    editor.append(newBanner);

    const linesWrap = document.createElement("div");
    linesWrap.className = "gcg-editor-lines";
    editor.append(linesWrap);

    // 絞り込み0件時のエンプティステート(問題に気づいた瞬間に解決策を出す)
    const noHit = document.createElement("div");
    noHit.className = "gcg-nohit";
    noHit.style.display = "none";

    const noHitText = document.createElement("div");
    const noHitScan = document.createElement("button");
    noHitScan.className = "gcg-done-btn";
    noHitScan.textContent = "カレンダーを再検出する";
    noHitScan.addEventListener("click", () => runScan(noHitScan));
    noHit.append(noHitText, noHitScan);
    editor.append(noHit);

    const lines = [];
    /** エディタが現在表示している名前の集合(鮮度チェック用) */
    const shownNames = new Set(allNames);
    editor.dataset.gcgEditor = "1";
    editor._gcgShownNames = shownNames;
    editor._gcgNewBanner = { banner: newBanner, text: newBannerText };
    for (const calName of allNames) {
      const line = document.createElement("label");
      line.className = "gcg-editor-line";
      line.dataset.name = calName.toLowerCase();

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = group.calendars.includes(calName);
      // labelクリックも含めて自前でトグルする(GCal対策)
      // 全再描画はせず、部分更新してスクロール位置を保つ
      line.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !group.calendars.includes(calName);
        if (next) {
          group.calendars.push(calName);
        } else {
          group.calendars = group.calendars.filter((c) => c !== calName);
        }
        // preventDefaultされたクリックはイベント処理後に
        // ブラウザがchecked状態を巻き戻すため、1ティック後に反映する
        setTimeout(() => {
          cb.checked = next;
        }, 0);
        saveGroups();
        updateGroupRow(group);
        refreshChips();
      });

      const span = document.createElement("span");
      span.textContent = calName;
      span.className = "gcg-editor-name";
      line.append(cb, span);

      // ピン留め(常に表示)ボタン
      const pinBtn = document.createElement("button");
      const applyPinLook = () => {
        const pinned = pinnedCalendars.has(calName);
        pinBtn.className = "gcg-icon-btn gcg-pin-btn" + (pinned ? " gcg-pinned" : "");
        pinBtn.textContent = "📌";
        pinBtn.title = pinned
          ? "常に表示: ON(グループ操作でOFFになりません)"
          : "常に表示: OFF(クリックでピン留め)";
      };
      applyPinLook();
      pinBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation(); // 行クリック(割当切替)を発火させない
        if (pinnedCalendars.has(calName)) {
          pinnedCalendars.delete(calName);
        } else {
          pinnedCalendars.add(calName);
        }
        savePinned();
        applyPinLook();
      });
      line.append(pinBtn);

      // 存在判定: いまDOMにあるか、または最後の全件検出で見つかったか。
      // GCalは仮想スクロールで画面外の行をDOMから外すため、
      // 「いまDOMに無い」だけでは非表示と断定できない。
      const exists =
        calMap.has(calName) ||
        lastScanNames.has(calName) ||
        lastScanNames.size === 0; // 未検出時は誤バッジを避けて表示扱い
      if (!exists) {
        span.classList.add("gcg-missing");
        const badge = document.createElement("span");
        badge.className = "gcg-badge";
        badge.textContent = "非表示中";
        badge.title =
          "現在サイドバーに見つかりません(セクションが折りたたまれている可能性)。選択は可能です。";
        span.append(badge);

        // 候補から完全に削除するボタン(左パネルから消したカレンダー用)
        const removeBtn = document.createElement("button");
        removeBtn.className = "gcg-icon-btn gcg-remove-btn";
        removeBtn.title = "この候補を削除(すべてのグループの割当からも外します)";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation(); // 行クリック(チェック切替)を発火させない
          knownCalendars.delete(calName);
          saveKnownCalendars();
          let groupsChanged = false;
          for (const g of groups) {
            const len = g.calendars.length;
            g.calendars = g.calendars.filter((c) => c !== calName);
            if (g.calendars.length !== len) groupsChanged = true;
          }
          if (groupsChanged) saveGroups();
          renderGroups();
          renderChips();
          showToast(`「${calName}」を候補から削除しました。`);
        });
        line.append(removeBtn);
      }

      linesWrap.append(line);
      lines.push(line);
    }

    const applyFilter = () => {
      const q = editorFilter.trim().toLowerCase();
      let visible = 0;
      for (const line of lines) {
        const hit = !q || line.dataset.name.includes(q);
        line.style.display = hit ? "" : "none";
        if (hit) visible++;
      }
      // 0件のとき: 原因の仮説と解決アクションをその場で提示
      if (q && visible === 0) {
        noHitText.textContent = `「${editorFilter.trim()}」に一致するカレンダーがありません。最近追加したカレンダーは、まだ検出されていない可能性があります。`;
        noHit.style.display = "";
        linesWrap.style.display = "none";
      } else {
        noHit.style.display = "none";
        linesWrap.style.display = "";
      }
    };
    search.addEventListener("input", () => {
      editorFilter = search.value;
      applyFilter();
    });
    applyFilter();

    const done = document.createElement("button");
    done.className = "gcg-done-btn";
    done.textContent = "閉じる";
    done.addEventListener("click", () => {
      editingGroupId = null;
      editorFilter = "";
      renderGroups();
    });
    editor.append(done);

    // スキャン状態のステータス行(リストの鮮度・網羅性の判断材料)
    const status = document.createElement("div");
    status.className = "gcg-scan-status";

    const statusText = document.createElement("span");
    if (scanning) {
      statusText.textContent = "カレンダーを検出しています...";
    } else if (!scanMeta) {
      status.classList.add("gcg-scan-warn");
      statusText.textContent =
        "リストが不完全な可能性があります。右のボタンで全カレンダーを読み込めます →";
    } else {
      const days = Math.floor((Date.now() - scanMeta.at) / 86400000);
      const d = new Date(scanMeta.at);
      const when =
        days === 0
          ? `今日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`
          : `${days}日前(${d.getMonth() + 1}/${d.getDate()})`;
      statusText.textContent = `候補 ${allNames.length}件 ・ 最終検出: ${when}`;
      if (days >= 7) {
        status.classList.add("gcg-scan-warn");
        statusText.textContent += " — 再検出をおすすめします";
      }
    }

    const scanLink = document.createElement("button");
    scanLink.className = "gcg-scan-link";
    scanLink.textContent = "カレンダーを再検出";
    scanLink.addEventListener("click", () => runScan(scanLink));

    status.append(statusText, scanLink);
    editor.append(status);

    return editor;
  }

  // グループ行(件数・チェック状態)だけを部分更新する
  function updateGroupRow(group) {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const row = panel.querySelector(`.gcg-row[data-group-id="${group.id}"]`);
    if (!row) return;
    const name = row.querySelector(".gcg-name");
    if (name) {
      name.textContent = `${group.name} (${group.calendars.length})`;
      name.title = group.calendars.join("\n") || "カレンダー未割当";
    }
    const cb = row.querySelector(".gcg-checkbox");
    if (cb) applyState(cb, displayState(group, findCalendarCheckboxes()));
  }

  // ネイティブのチェック状態変化に合わせて表示を更新
  function refreshGroupStates() {
    refreshChips();
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !panelOpen) return;
    const calMap = findCalendarCheckboxes();
    for (const row of panel.querySelectorAll(".gcg-row")) {
      const group = groups.find((g) => g.id === row.dataset.groupId);
      const cb = row.querySelector(".gcg-checkbox");
      if (group && cb) applyState(cb, displayState(group, calMap));
    }
    checkEditorFreshness(panel, calMap);
  }

  // 開いているエディタに未表示の新カレンダーがあれば通知バナーを出す
  function checkEditorFreshness(panel, calMap) {
    const editor = panel.querySelector('[data-gcg-editor="1"]');
    if (!editor || !editor._gcgShownNames) return;
    const shown = editor._gcgShownNames;
    const fresh = [];
    for (const name of calMap.keys()) {
      if (!shown.has(name)) fresh.push(name);
    }
    const { banner, text } = editor._gcgNewBanner;
    if (fresh.length > 0) {
      text.textContent =
        fresh.length === 1
          ? `新しいカレンダー「${fresh[0]}」が見つかりました。`
          : `新しいカレンダーが${fresh.length}件見つかりました。`;
      banner.style.display = "";
    } else {
      banner.style.display = "none";
    }
  }

  // ---------- 注入 ----------

  // GCalのDOMには一切触れず、document.body直下に置く。
  function injectUI() {
    if (document.getElementById(BAR_ID)) return true;
    if (!document.body) return false;
    document.body.append(buildBar(), buildPanel());
    applyBarPos();
    renderChips();
    return true;
  }

  // ---------- 監視 ----------

  let renderTimer = null;
  function scheduleRefresh() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(refreshGroupStates, 400);
  }

  async function init() {
    await Promise.all([loadGroups(), loadLocalState()]);

    injectUI();

    // 初回のみ: バーを指すコーチマークで案内(×で閉じるまで残る)
    if (!onboarded) {
      setTimeout(() => {
        if (onboarded) return;
        showCoachmark({
          text: "カレンダーをグループでまとめて表示切替できます。まずは「＋ グループを作成」から始めましょう。",
          getTarget: () => document.getElementById(BAR_ID),
          flagKey: "gcgOnboarded",
        });
      }, 1500);
    }

    // ネイティブ側のチェック変更などに追従して表示を更新
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("resize", () => {
      applyBarPos();
      positionPanel();
      positionCoachmark();
    });

    // 他タブでのグループ変更を反映
    // (自タブの保存でも発火するため、内容が同じなら再描画しない
    //  = エディタのスクロール位置や絞り込みを壊さない)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes[PINNED_KEY]) {
        const next = new Set(changes[PINNED_KEY].newValue || []);
        if ([...next].sort().join("\n") !== [...pinnedCalendars].sort().join("\n")) {
          pinnedCalendars = next;
          renderGroups();
        }
      }
      if (area === "sync" && changes[STORAGE_KEY]) {
        const next = changes[STORAGE_KEY].newValue || [];
        if (JSON.stringify(next) === JSON.stringify(groups)) return;
        groups = next;
        renderGroups();
        renderChips();
      }
    });
  }

  init();
})();
