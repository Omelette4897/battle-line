const state = {
  roomId: localStorage.getItem("lineDuelRoomId"),
  playerId: localStorage.getItem("lineDuelPlayerId"),
  token: localStorage.getItem("lineDuelToken"),
  selectedCardId: null,
  snapshot: null
};

const lobby = document.querySelector("#lobby");
const lobbyStart = document.querySelector("#lobbyStart");
const game = document.querySelector("#game");
const nameInput = document.querySelector("#nameInput");
const roomInput = document.querySelector("#roomInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const surrenderButton = document.querySelector("#surrenderButton");
const ruleButton = document.querySelector("#ruleButton");
const logButton = document.querySelector("#logButton");
const closeLogButton = document.querySelector("#closeLogButton");
const closeRuleButton = document.querySelector("#closeRuleButton");
const resultModal = document.querySelector("#resultModal");
const resultTitle = document.querySelector("#resultTitle");
const resultMessage = document.querySelector("#resultMessage");
const resultRestartButton = document.querySelector("#resultRestartButton");
const resultLobbyButton = document.querySelector("#resultLobbyButton");
const roomIdLabel = document.querySelector("#roomIdLabel");
const statusLabel = document.querySelector("#statusLabel");
const p1Card = document.querySelector("#p1Card");
const p2Card = document.querySelector("#p2Card");
const deckLabel = document.querySelector("#deckLabel");
const deckCount = document.querySelector("#deckCount");
const waitingPanel = document.querySelector("#waitingPanel");
const waitingRoomId = document.querySelector("#waitingRoomId");
const waitingCopyButton = document.querySelector("#waitingCopyButton");
const waitingBackButton = document.querySelector("#waitingBackButton");
const battlefield = document.querySelector(".battlefield");
const handPanel = document.querySelector(".hand-panel");
const board = document.querySelector("#board");
const boardOpponentLabel = document.querySelector("#boardOpponentLabel");
const boardYouLabel = document.querySelector("#boardYouLabel");
const hand = document.querySelector("#hand");
const handHint = document.querySelector("#handHint");
const log = document.querySelector("#log");
const logDrawer = document.querySelector("#logDrawer");
const ruleDrawer = document.querySelector("#ruleDrawer");

createRoomButton.addEventListener("click", async () => {
  const name = requireName();
  if (!name) return;
  const data = await api("/api/rooms", {
    method: "POST",
    body: { name }
  });
  saveAuth(data);
  await refresh();
});

joinRoomButton.addEventListener("click", async () => {
  const name = requireName();
  if (!name) return;
  const roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) return showError("部屋IDを入力してください");
  const data = await api(`/api/rooms/${roomId}/join`, {
    method: "POST",
    body: { name }
  });
  saveAuth(data);
  await refresh();
});

waitingCopyButton.addEventListener("click", async () => {
  await copyRoomId(waitingCopyButton, "コピー");
});

waitingBackButton.addEventListener("click", () => {
  returnToLobby();
});

async function copyRoomId(button, defaultText) {
  await navigator.clipboard.writeText(state.roomId);
  button.textContent = "コピー済み";
  setTimeout(() => {
    button.textContent = defaultText;
  }, 1200);
}

surrenderButton.addEventListener("click", async () => {
  await surrenderGame();
});

resultRestartButton.addEventListener("click", async () => {
  await restartGame();
});

resultLobbyButton.addEventListener("click", async () => {
  await returnToLobby();
});

async function surrenderGame() {
  if (!window.confirm("負けを認めますか？このゲームは終了します。")) return;
  await api(`/api/rooms/${state.roomId}/surrender`, { method: "POST", auth: true });
  state.selectedCardId = null;
  await refresh();
}

async function restartGame() {
  try {
    await api(`/api/rooms/${state.roomId}/restart`, { method: "POST", auth: true });
    state.selectedCardId = null;
    await refresh();
  } catch (error) {
    await returnToLobby({
      notifyServer: false,
      message: "相手がゲームを終了したため、ロビーに戻りました。"
    });
  }
}

async function returnToLobby({ notifyServer = true, message = "" } = {}) {
  if (notifyServer && state.roomId && state.playerId && state.token) {
    try {
      await api(`/api/rooms/${state.roomId}/leave`, { method: "POST", auth: true });
    } catch (error) {
      // ロビーへ戻る操作を優先するため、通知失敗は握りつぶす。
    }
  }
  localStorage.removeItem("lineDuelRoomId");
  localStorage.removeItem("lineDuelPlayerId");
  localStorage.removeItem("lineDuelToken");
  state.roomId = null;
  state.playerId = null;
  state.token = null;
  state.selectedCardId = null;
  state.snapshot = null;
  resultModal.classList.add("hidden");
  showLobby();
  if (message) showLobbyMessage(message);
}

logButton.addEventListener("click", () => {
  logDrawer.classList.remove("hidden");
});

ruleButton.addEventListener("click", () => {
  ruleDrawer.classList.remove("hidden");
});

closeLogButton.addEventListener("click", () => {
  logDrawer.classList.add("hidden");
});

closeRuleButton.addEventListener("click", () => {
  ruleDrawer.classList.add("hidden");
});

logDrawer.addEventListener("click", (event) => {
  if (event.target === logDrawer) {
    logDrawer.classList.add("hidden");
  }
});

ruleDrawer.addEventListener("click", (event) => {
  if (event.target === ruleDrawer) {
    ruleDrawer.classList.add("hidden");
  }
});

function saveAuth(data) {
  state.roomId = data.roomId;
  state.playerId = data.playerId;
  state.token = data.token;
  localStorage.setItem("lineDuelRoomId", state.roomId);
  localStorage.setItem("lineDuelPlayerId", state.playerId);
  localStorage.setItem("lineDuelToken", state.token);
}

async function refresh() {
  if (!state.roomId || !state.playerId || !state.token) {
    showLobby();
    return;
  }
  try {
    state.snapshot = await api(`/api/rooms/${state.roomId}/state`, { auth: true });
    render();
  } catch (error) {
    const hadRoom = Boolean(state.roomId);
    localStorage.removeItem("lineDuelRoomId");
    localStorage.removeItem("lineDuelPlayerId");
    localStorage.removeItem("lineDuelToken");
    state.roomId = null;
    state.playerId = null;
    state.token = null;
    showLobby();
    if (hadRoom) {
      showLobbyMessage("部屋が見つかりません。サーバー再起動または時間切れのため、ロビーに戻りました。");
    }
  }
}

function render() {
  const snapshot = state.snapshot;
  const currentName = snapshot.players[snapshot.playerId].name;
  const otherId = snapshot.playerId === "p1" ? "p2" : "p1";
  const otherName = snapshot.players[otherId].name;
  roomIdLabel.textContent = snapshot.roomId;
  waitingRoomId.textContent = snapshot.roomId;

  if (!snapshot.game) {
    showWaitingLobby();
    return;
  }

  showGame();
  const { game } = snapshot;
  if (game.opponentLeft) {
    returnToLobby({
      notifyServer: false,
      message: "相手がゲームを終了したため、ロビーに戻りました。"
    });
    return;
  }
  battlefield.classList.remove("hidden");
  handPanel.classList.remove("hidden");
  deckCount.textContent = game.deckCount;
  deckLabel.textContent = game.deckEmpty ? "山札切れ" : "山札";
  document.querySelector(".deck-card").classList.toggle("empty-deck", game.deckEmpty);
  renderPlayerCards(snapshot, game);
  renderBoardLabels(snapshot);
  surrenderButton.disabled = Boolean(game.winner);
  p1Card.classList.toggle("active", game.currentPlayer === "p1" && !game.winner);
  p2Card.classList.toggle("active", game.currentPlayer === "p2" && !game.winner);

  if (game.winner) {
    statusLabel.textContent = game.winner === snapshot.playerId ? "あなたの勝ち" : `${otherName}の勝ち`;
    handHint.textContent = "";
    renderResultModal(snapshot, game);
  } else if (game.currentPlayer === snapshot.playerId) {
    statusLabel.textContent = "カードを配置";
    handHint.textContent = state.selectedCardId ? "置きたい旗を選んでください" : "出すカードを選んでください";
    resultModal.classList.add("hidden");
  } else {
    statusLabel.textContent = "相手の手番";
    handHint.textContent = "相手の手番です";
    resultModal.classList.add("hidden");
  }

  renderBoard(game, snapshot);
  renderHand(game);
  renderLog(game.log);
}

function renderBoard(gameState, snapshot) {
  board.innerHTML = "";
  const playerId = snapshot.playerId;
  gameState.flags.forEach((flag, index) => {
    const flagButton = document.createElement("button");
    flagButton.className = "flag";
    const topPlayerId = playerId === "p1" ? "p2" : "p1";
    const bottomPlayerId = playerId;
    const playable =
      !flag.owner &&
      !gameState.winner &&
      gameState.currentPlayer === playerId &&
      flag.cards[playerId].length < 3;
    flagButton.disabled = !playable;
    flagButton.classList.toggle("playable", playable && Boolean(state.selectedCardId));
    flagButton.classList.toggle("claimed", Boolean(flag.owner));
    flagButton.classList.toggle("claimed-by-me", flag.owner === playerId);
    flagButton.classList.toggle("claimed-by-other", Boolean(flag.owner) && flag.owner !== playerId);
    flagButton.addEventListener("click", () => playSelected(index));

    flagButton.innerHTML = `
      ${renderBattleLane(flag.cards[topPlayerId], flag.scores[topPlayerId], "top")}
      <div class="flag-marker">
        <i></i>
        ${flag.owner ? `<span>${escapeHtml(snapshot.players[flag.owner].name)} 獲得</span>` : ""}
      </div>
      ${renderBattleLane(flag.cards[bottomPlayerId], flag.scores[bottomPlayerId], "bottom")}
    `;
    board.appendChild(flagButton);
  });
}

function renderResultModal(snapshot, gameState) {
  const won = gameState.winner === snapshot.playerId;
  const winnerName = snapshot.players[gameState.winner].name;
  const otherId = snapshot.playerId === "p1" ? "p2" : "p1";
  const voted = Boolean(gameState.restartVotes?.[snapshot.playerId]);
  const otherVoted = Boolean(gameState.restartVotes?.[otherId]);

  if (voted) {
    resultTitle.textContent = "再戦待ち";
    resultMessage.textContent = "再戦希望を送りました。相手が再戦を選ぶと新しいゲームが始まります。";
    resultRestartButton.textContent = "再戦申請済み";
    resultRestartButton.disabled = true;
  } else {
    resultTitle.textContent = won ? "あなたの勝ち" : `${winnerName}の勝ち`;
    resultMessage.textContent = otherVoted
      ? "相手が再戦を希望しています。再戦するか、ロビーに戻るか選んでください。"
      : "このゲームは決着しました。再戦は両者が選んだときだけ始まります。";
    resultRestartButton.textContent = "再戦する";
    resultRestartButton.disabled = false;
  }
  resultModal.classList.remove("hidden");
}

function renderBattleLane(cards, score, side) {
  const slots = Array.from({ length: 3 }, (_, index) => cards[index]);
  return `
    <div class="lane ${side}">
      <div class="lane-score">${score.sum ? `合計 ${score.sum}` : ""}</div>
      <div class="mini-cards">
        ${slots.map((card) => (card ? cardMarkup(card, "mini") : '<i class="empty"></i>')).join("")}
      </div>
    </div>
  `;
}

function renderHand(gameState) {
  hand.innerHTML = "";
  gameState.hand.forEach((card) => {
    const button = document.createElement("button");
    button.className = `card game-card ${card.color}`;
    button.classList.toggle("selected", state.selectedCardId === card.id);
    button.disabled = gameState.currentPlayer !== state.playerId || gameState.winner;
    button.innerHTML = cardFaceMarkup(card);
    button.addEventListener("click", () => {
      state.selectedCardId = state.selectedCardId === card.id ? null : card.id;
      render();
    });
    hand.appendChild(button);
  });
}

function renderLog(entries) {
  const orderedEntries = [...entries];
  if (orderedEntries.length > 1 && orderedEntries.at(-1) === "ゲーム開始") {
    orderedEntries.reverse();
  }
  log.innerHTML = orderedEntries
    .map((entry, index) => `<li value="${index + 1}">${escapeHtml(entry)}</li>`)
    .join("");
}

async function playSelected(flagIndex) {
  if (!state.selectedCardId) {
    showError("先にカードを選んでください");
    return;
  }
  try {
    await api(`/api/rooms/${state.roomId}/play`, {
      method: "POST",
      auth: true,
      body: { cardId: state.selectedCardId, flagIndex }
    });
    state.selectedCardId = null;
    await refresh();
  } catch (error) {
    showError(error.message);
    await refresh();
  }
}

function cardMarkup(card, size) {
  return `<b class="${size} game-card ${card.color}">${cardFaceMarkup(card)}</b>`;
}

function cardFaceMarkup(card) {
  return `
    <span class="card-sigil" aria-hidden="true"></span>
    <strong>${card.value}</strong>
  `;
}

async function api(path, options = {}) {
  const headers = { "content-type": "application/json" };
  if (options.auth) {
    headers["x-player-id"] = state.playerId;
    headers["x-player-token"] = state.token;
  }
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "通信エラー");
  return data;
}

function showLobby() {
  lobby.classList.remove("hidden");
  lobbyStart.classList.remove("hidden");
  waitingPanel.classList.add("hidden");
  game.classList.add("hidden");
}

function showWaitingLobby() {
  lobby.classList.remove("hidden");
  lobbyStart.classList.add("hidden");
  waitingPanel.classList.remove("hidden");
  game.classList.add("hidden");
  resultModal.classList.add("hidden");
}

function showGame() {
  lobby.classList.add("hidden");
  waitingPanel.classList.add("hidden");
  game.classList.remove("hidden");
}

function showError(message) {
  statusLabel.textContent = message;
}

function renderPlayerCards(snapshot, gameState) {
  p1Card.innerHTML = playerCardMarkup(snapshot, gameState, "p1");
  p2Card.innerHTML = playerCardMarkup(snapshot, gameState, "p2");
}

function playerCardMarkup(snapshot, gameState, playerId) {
  const player = snapshot.players[playerId];
  const count = gameState.claimedCounts?.[playerId] || 0;
  const isTurn = gameState.currentPlayer === playerId && !gameState.winner;
  return `
    <span class="player-name">${escapeHtml(player.name)}${isTurn ? '<em>手番</em>' : ""}</span>
    <span class="player-flags" aria-label="獲得旗数">
      <small>獲得旗</small><strong>${count}</strong>
    </span>
  `;
}

function renderBoardLabels(snapshot) {
  const otherId = snapshot.playerId === "p1" ? "p2" : "p1";
  boardOpponentLabel.textContent = snapshot.players[otherId].name;
  boardYouLabel.textContent = snapshot.players[snapshot.playerId].name;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requireName() {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    nameInput.classList.add("input-error");
    showLobbyMessage("名前を入力してください");
    return "";
  }
  nameInput.classList.remove("input-error");
  return name;
}

function showLobbyMessage(message) {
  const hint = document.querySelector(".hint");
  hint.textContent = message;
  hint.classList.add("error-text");
}

refresh();
setInterval(refresh, 1200);
