// ============================================================
// MomoTalk — 블루 아카이브 스타일 채팅 팝업 (FVTT v13 Module)
// ============================================================

const MODULE_ID = "aa-momotalk";

/* ──────────────────────────────────────────────
   MomoTalk Window (순수 DOM 기반)
   ────────────────────────────────────────────── */

class MomoTalkWindow {
  constructor() {
    this.el = null;
    this._dragState = null;
  }

  get rendered() {
    return !!this.el && document.body.contains(this.el);
  }

  /* ── 메시지 정보 추출 ── */
  _getMessageInfo(msg) {
    const avatars = game.settings.get(MODULE_ID, "avatars") || {};
    const speaker = msg.speaker || {};
    const actorId = speaker.actor;
    // 1. 액터 탐색 보강 (씬 상의 Unlinked Token 대응)
    let actor = actorId ? game.actors.get(actorId) : null;
    if (!actor && speaker.token && game.scenes?.active) {
      const tokenDoc = game.scenes.active.tokens.get(speaker.token);
      if (tokenDoc?.actor) {
        actor = tokenDoc.actor;
      }
    }

    const name = speaker.alias || actor?.name || msg.author?.name || "???";
    const speakerKey = String(actorId || name || "");

    // 2. 메시지 보낸 유저(플레이어) 프로필 이미지 추출
    const authorId = msg.author?.id || (typeof msg.author === "string" ? msg.author : null);
    const user = authorId ? game.users.get(authorId) : null;
    const userAvatar = user?.avatar || msg.author?.avatar;
    const hasUserAvatar = userAvatar && !userAvatar.includes("mystery-man.svg") && !userAvatar.includes("mystery-man.png");

    // 3. chat-portrait 스타일의 이미지 획득 우선순위
    let avatar = "";
    
    // (A) 모모톡 설정 창에서 직접 파일 선택기로 수동 매핑한 경로가 1순위
    const mappedAvatar = avatars[actorId] || avatars[name];
    if (mappedAvatar && mappedAvatar.trim() !== "") {
      avatar = mappedAvatar;
    } else if (hasUserAvatar) {
      // (B) 메시지를 보낸 플레이어(유저)의 고해상도 아바타 이미지
      avatar = userAvatar;
    } else {
      // (C) 둘 다 없는 경우: 액터 초상화 -> 토큰 이미지 순
      if (actor?.img && !actor.img.includes("mystery-man.svg") && !actor.img.includes("mystery-man.png")) {
        avatar = actor.img;
      } else if (speaker.token && game.scenes?.active) {
        const tokenDoc = game.scenes.active.tokens.get(speaker.token);
        if (tokenDoc?.texture?.src && !tokenDoc.texture.src.includes("mystery-man.svg")) {
          avatar = tokenDoc.texture.src;
        }
      }
      
      // 최종 폴백 (빈 경로 방어)
      if (!avatar || avatar.trim() === "") {
        avatar = actor?.prototypeToken?.texture?.src
          || "icons/svg/mystery-man.svg";
      }
    }

    // 런타임 진단을 위한 임시 디버그 로그 출력
    console.log(`[MomoTalk Debug] ID: ${msg.id} | Name: ${name} | Avatar Path: ${avatar}`);

    const timestamp = new Date(msg.timestamp).toLocaleTimeString("ko-KR", {
      hour: "2-digit", minute: "2-digit"
    });

    return { id: msg.id, name, speakerKey, avatar, content: msg.content, timestamp };
  }

  /* ── 열기 ── */
  open() {
    if (this.rendered) return;

    // 팝업 컨테이너
    const win = document.createElement("div");
    win.id = "momotalk-window";
    win.className = "momotalk-window";
    win.innerHTML = `
      <div class="momotalk-bar" id="momotalk-drag-handle">
        <span class="momotalk-bar-title">💬 MomoTalk</span>
        <div class="momotalk-bar-controls">
          <button type="button" class="momotalk-bar-btn" id="momotalk-cfg-btn" title="아바타 설정">
            <i class="fas fa-user-cog"></i>
          </button>
          <button type="button" class="momotalk-bar-btn" id="momotalk-close-btn" title="닫기">
            <i class="fas fa-times"></i>
          </button>
        </div>
      </div>
      <div class="momotalk-messages" id="momotalk-msg-area"></div>
      <div class="momotalk-input-container">
        <div class="momotalk-input-wrapper">
          <input type="text" class="momotalk-input-field" placeholder="메시지를 입력하세요..." />
          <button type="button" class="momotalk-send-btn" title="전송">
            <i class="fas fa-paper-plane"></i>
          </button>
        </div>
      </div>
      <div class="momotalk-resize-handle" id="momotalk-resize-handle"></div>
    `;

    document.body.appendChild(win);
    this.el = win;

    // 기존 메시지 로드
    this._loadHistory();

    // 이벤트 바인딩
    win.querySelector("#momotalk-close-btn").addEventListener("click", () => this.close());
    win.querySelector("#momotalk-cfg-btn").addEventListener("click", () => openAvatarConfig());
    this._initDrag(win.querySelector("#momotalk-drag-handle"), win);
    this._initResize(win.querySelector("#momotalk-resize-handle"), win);

    // 입력창 이벤트 처리
    const inputField = win.querySelector(".momotalk-input-field");
    const sendBtn = win.querySelector(".momotalk-send-btn");

    const handleSend = async () => {
      const text = inputField.value.trim();
      if (!text) return;

      // IC (In-Character) 스타일 적용하여 simple-message-window와 같은 화면 연출 모듈 호환
      const chatStyle = (typeof CONST.CHAT_MESSAGE_STYLES !== "undefined")
        ? CONST.CHAT_MESSAGE_STYLES.IC
        : (CONST.CHAT_MESSAGE_TYPES?.IC ?? 1);

      // Foundry VTT 채팅 메시지 생성
      await ChatMessage.create({
        content: text,
        speaker: ChatMessage.getSpeaker(),
        style: chatStyle
      });

      inputField.value = "";
      inputField.focus();
    };

    inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    sendBtn.addEventListener("click", handleSend);
  }

  /* ── 닫기 ── */
  close() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    // 버튼 상태 업데이트
    const btn = document.querySelector("#momotalk-launch");
    if (btn) btn.classList.remove("active");
  }

  /* ── 채팅 기록 로드 ── */
  _loadHistory() {
    const area = this.el?.querySelector("#momotalk-msg-area");
    if (!area) return;

    const messages = game.messages.contents.slice(-100);
    let lastKey = null;

    for (const msg of messages) {
      if (msg.whisper?.length > 0) continue;
      const info = this._getMessageInfo(msg);
      const showAvatar = info.speakerKey !== lastKey;
      lastKey = info.speakerKey;
      area.appendChild(this._createMsgEl(info, showAvatar));
    }

    requestAnimationFrame(() => area.scrollTop = area.scrollHeight);
  }

  /* ── 새 메시지 추가 ── */
  addMessage(msg) {
    if (!this.rendered) return;
    if (msg.whisper?.length > 0) return;

    const area = this.el.querySelector("#momotalk-msg-area");
    if (!area) return;

    const info = this._getMessageInfo(msg);
    const lastEl = area.querySelector(".momotalk-msg:last-child");
    const showAvatar = lastEl?.dataset?.speaker !== info.speakerKey;

    area.appendChild(this._createMsgEl(info, showAvatar));
    requestAnimationFrame(() => area.scrollTop = area.scrollHeight);
  }

  /* ── 메시지 DOM 요소 생성 ── */
  _createMsgEl(info, showAvatar) {
    const div = document.createElement("div");
    div.className = `momotalk-msg ${showAvatar ? "with-avatar" : "continuation"}`;
    div.dataset.speaker = info.speakerKey;

    if (showAvatar) {
      div.innerHTML = `
        <div class="momotalk-msg-row">
          <div class="momotalk-avatar-wrap">
            <img class="momotalk-avatar" src="${info.avatar}" alt="${info.name}" />
          </div>
          <div class="momotalk-msg-body">
            <span class="momotalk-name">${info.name}</span>
            <div class="momotalk-bubble-row">
              <div class="momotalk-bubble">${info.content}</div>
              <span class="momotalk-time">${info.timestamp}</span>
            </div>
          </div>
        </div>`;
    } else {
      div.innerHTML = `
        <div class="momotalk-bubble-row">
          <div class="momotalk-bubble">${info.content}</div>
          <span class="momotalk-time">${info.timestamp}</span>
        </div>`;
    }
    return div;
  }

  /* ── 드래그 이동 ── */
  _initDrag(handle, win) {
    let offsetX, offsetY;

    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      offsetX = e.clientX - win.offsetLeft;
      offsetY = e.clientY - win.offsetTop;
      win.classList.add("dragging");

      const onMove = (ev) => {
        win.style.left = (ev.clientX - offsetX) + "px";
        win.style.top = (ev.clientY - offsetY) + "px";
        win.style.right = "auto";
        win.style.bottom = "auto";
      };
      const onUp = () => {
        win.classList.remove("dragging");
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  /* ── 크기 조절 ── */
  _initResize(handle, win) {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const startWidth = win.offsetWidth;
      const startHeight = win.offsetHeight;
      const startX = e.clientX;
      const startY = e.clientY;

      win.classList.add("resizing");

      const onMove = (ev) => {
        const newWidth = Math.max(300, startWidth + (ev.clientX - startX));
        const newHeight = Math.max(400, startHeight + (ev.clientY - startY));
        win.style.width = newWidth + "px";
        win.style.height = newHeight + "px";
      };
      const onUp = () => {
        win.classList.remove("resizing");
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }
}

/* ──────────────────────────────────────────────
   Avatar Config Dialog
   ────────────────────────────────────────────── */

async function openAvatarConfig() {
  // 이미 열려있으면 닫기
  const existing = document.querySelector("#momotalk-cfg-overlay");
  if (existing) { existing.remove(); return; }

  const avatars = foundry.utils.deepClone(game.settings.get(MODULE_ID, "avatars") || {});
  const actors = game.actors.contents;

  // 오버레이 생성
  const overlay = document.createElement("div");
  overlay.id = "momotalk-cfg-overlay";
  overlay.className = "momo-cfg-overlay";

  let rows = "";
  for (const actor of actors) {
    const current = avatars[actor.id] || actor.img || "icons/svg/mystery-man.svg";
    rows += `
      <div class="momo-cfg-row" data-actor-id="${actor.id}">
        <div class="momo-cfg-img-wrap">
          <img class="momo-cfg-img" src="${current}" alt="${actor.name}" />
        </div>
        <span class="momo-cfg-name">${actor.name}</span>
        <button type="button" class="momo-cfg-pick" data-actor-id="${actor.id}">🖼️</button>
        <button type="button" class="momo-cfg-clear" data-actor-id="${actor.id}">✕</button>
      </div>`;
  }
  if (!actors.length) {
    rows = '<p class="momo-cfg-empty">월드에 액터가 없습니다.</p>';
  }

  overlay.innerHTML = `
    <div class="momo-cfg-dialog">
      <div class="momo-cfg-header">
        <span>MomoTalk 아바타 설정</span>
        <button type="button" class="momo-cfg-close"><i class="fas fa-times"></i></button>
      </div>
      <p class="momo-cfg-desc">각 캐릭터의 모모톡 아바타를 설정합니다.</p>
      <div class="momo-cfg-list">${rows}</div>
      <div class="momo-cfg-actions">
        <button type="button" class="momo-cfg-save">💾 저장</button>
        <button type="button" class="momo-cfg-cancel">취소</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // 닫기 함수
  const close = () => overlay.remove();

  // 배경 클릭 닫기
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".momo-cfg-close").addEventListener("click", close);
  overlay.querySelector(".momo-cfg-cancel").addEventListener("click", close);

  // 저장
  overlay.querySelector(".momo-cfg-save").addEventListener("click", async () => {
    await game.settings.set(MODULE_ID, "avatars", avatars);
    ui.notifications.info("MomoTalk 아바타가 저장되었습니다.");
    close();
  });

  // 이미지 선택 (FilePicker) — 오버레이 숨기고 선택 후 복원
  overlay.querySelectorAll(".momo-cfg-pick").forEach(btn => {
    btn.addEventListener("click", () => {
      const actorId = btn.dataset.actorId;
      const row = overlay.querySelector(`.momo-cfg-row[data-actor-id="${actorId}"]`);

      // 오버레이 숨기기 (FilePicker가 위에 올 수 있도록)
      overlay.style.display = "none";

      const fp = new FilePicker({
        type: "image",
        current: avatars[actorId] || "",
        callback: (path) => {
          avatars[actorId] = path;
          if (row) row.querySelector(".momo-cfg-img").src = path;
          overlay.style.display = "flex";
        }
      });
      fp.render(true);

      // FilePicker 닫힘 감지 (선택 안 하고 닫은 경우)
      const checkClosed = setInterval(() => {
        if (!fp.element || !document.body.contains(fp.element)) {
          clearInterval(checkClosed);
          overlay.style.display = "flex";
        }
      }, 300);
    });
  });

  // 초기화
  overlay.querySelectorAll(".momo-cfg-clear").forEach(btn => {
    btn.addEventListener("click", () => {
      const actorId = btn.dataset.actorId;
      delete avatars[actorId];
      const row = overlay.querySelector(`.momo-cfg-row[data-actor-id="${actorId}"]`);
      const actor = game.actors.get(actorId);
      if (row) row.querySelector(".momo-cfg-img").src = actor?.img || "icons/svg/mystery-man.svg";
    });
  });
}

/* ──────────────────────────────────────────────
   Module Initialization & Hooks
   ────────────────────────────────────────────── */

let momoTalk = null;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "avatars", {
    name: "MomoTalk Avatars",
    hint: "캐릭터별 모모톡 아바타 이미지 매핑",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
});

Hooks.once("ready", () => {
  momoTalk = new MomoTalkWindow();
  console.log("MomoTalk | 모듈 로드 완료");
});

// "모모톡 실행하기" 버튼 — body에 고정, 사이드바 위치에 자동 맞춤
Hooks.on("renderChatLog", () => {
  if (document.querySelector("#momotalk-launch")) return;

  const btn = document.createElement("button");
  btn.id = "momotalk-launch";
  btn.type = "button";
  btn.className = "momotalk-launch-btn";
  btn.innerHTML = '<i class="fas fa-comment-dots"></i> 모모톡 실행하기';
  btn.addEventListener("click", () => {
    console.log("MomoTalk | 버튼 클릭됨");
    if (!momoTalk) momoTalk = new MomoTalkWindow();

    if (momoTalk.rendered) {
      momoTalk.close();
      btn.classList.remove("active");
    } else {
      momoTalk.open();
      btn.classList.add("active");
    }
  });

  document.body.appendChild(btn);
});

// 새 메시지 → 모모톡에 추가
Hooks.on("createChatMessage", (msg) => {
  if (momoTalk?.rendered) {
    momoTalk.addMessage(msg);
  }
});
