const state = {
  roomId: localStorage.getItem("lineDuelRoomId"),
  playerId: localStorage.getItem("lineDuelPlayerId"),
  token: localStorage.getItem("lineDuelToken"),
  selectedCardId: null,
  snapshot: null,
  handSort: localStorage.getItem("lineDuelHandSort") || "original",
  previousHandIds: null,
  drawnCardId: null,
  drawnCardTimer: null,
  seenClaimActionId: null,
  claimFlashFlags: [],
  tacticModalCardId: null,
  pendingTacticAction: null,
  resultModalOpen: false,
  confirmFlagIndex: null,
  confirmTacticSource: null
};

const lobby = document.querySelector("#lobby");
const lobbyStart = document.querySelector("#lobbyStart");
const game = document.querySelector("#game");
const nameInput = document.querySelector("#nameInput");
const roomInput = document.querySelector("#roomInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const surrenderButton = document.querySelector("#surrenderButton");
const passButton = document.querySelector("#passButton");
const ruleButton = document.querySelector("#ruleButton");
const logButton = document.querySelector("#logButton");
const closeLogButton = document.querySelector("#closeLogButton");
const closeRuleButton = document.querySelector("#closeRuleButton");
const resultModal = document.querySelector("#resultModal");
const resultTitle = document.querySelector("#resultTitle");
const resultMessage = document.querySelector("#resultMessage");
const resultRestartButton = document.querySelector("#resultRestartButton");
const resultLobbyButton = document.querySelector("#resultLobbyButton");
const tacticModal = document.querySelector("#tacticModal");
const tacticModalCategory = document.querySelector("#tacticModalCategory");
const tacticModalTitle = document.querySelector("#tacticModalTitle");
const tacticModalText = document.querySelector("#tacticModalText");
const tacticModalStatus = document.querySelector("#tacticModalStatus");
const tacticUseButton = document.querySelector("#tacticUseButton");
const tacticCloseButton = document.querySelector("#tacticCloseButton");
const statusLabel = document.querySelector("#statusLabel");
const p1Card = document.querySelector("#p1Card");
const p2Card = document.querySelector("#p2Card");
const deckLabel = document.querySelector("#deckLabel");
const deckCount = document.querySelector("#deckCount");
const tacticDeckCount = document.querySelector("#tacticDeckCount");
const troopDeckButton = document.querySelector("#troopDeckButton");
const tacticDeckButton = document.querySelector("#tacticDeckButton");
const p1Tactics = document.querySelector("#p1Tactics");
const p2Tactics = document.querySelector("#p2Tactics");
const turnPrompt = document.querySelector("#turnPrompt");
const drawPrompt = document.querySelector("#drawPrompt");
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
const tacticActionBar = document.querySelector("#tacticActionBar");
const tacticActionText = document.querySelector("#tacticActionText");
const tacticMoveButton = document.querySelector("#tacticMoveButton");
const tacticDiscardButton = document.querySelector("#tacticDiscardButton");
const tacticCancelButton = document.querySelector("#tacticCancelButton");
const reviewBanner = document.querySelector("#reviewBanner");
const reviewTitle = document.querySelector("#reviewTitle");
const reviewText = document.querySelector("#reviewText");
const reviewResultButton = document.querySelector("#reviewResultButton");
const sortOriginalButton = document.querySelector("#sortOriginalButton");
const sortColorButton = document.querySelector("#sortColorButton");
const sortValueButton = document.querySelector("#sortValueButton");
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

reviewResultButton.addEventListener("click", () => {
  if (!state.snapshot?.game?.winner) return;
  state.resultModalOpen = true;
  renderResultModal(state.snapshot, state.snapshot.game);
});

tacticCloseButton.addEventListener("click", () => closeTacticModal());
tacticUseButton.addEventListener("click", async () => useTacticFromModal());

sortOriginalButton.addEventListener("click", () => setHandSort("original"));
sortColorButton.addEventListener("click", () => setHandSort("color"));
sortValueButton.addEventListener("click", () => setHandSort("value"));
troopDeckButton.addEventListener("click", () => handleDeckClick("troop"));
tacticDeckButton.addEventListener("click", () => handleDeckClick("tactic"));
passButton.addEventListener("click", () => passTurn());
tacticMoveButton.addEventListener("click", () => chooseTacticMove());
tacticDiscardButton.addEventListener("click", () => discardSelectedTacticCard());
tacticCancelButton.addEventListener("click", () => cancelTacticAction());

function setHandSort(mode) {
  state.handSort = mode;
  localStorage.setItem("lineDuelHandSort", mode);
  if (state.snapshot?.game) render();
}

async function surrenderGame() {
  if (!window.confirm("負けを認めますか？このゲームは終了します。")) return;
  await api(`/api/rooms/${state.roomId}/surrender`, { method: "POST", auth: true });
  state.selectedCardId = null;
  state.resultModalOpen = false;
  await refresh();
}

async function restartGame() {
  try {
    await api(`/api/rooms/${state.roomId}/restart`, { method: "POST", auth: true });
    state.selectedCardId = null;
    state.resultModalOpen = false;
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
  state.previousHandIds = null;
  state.drawnCardId = null;
  state.resultModalOpen = false;
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

tacticModal.addEventListener("click", (event) => {
  if (event.target === tacticModal) {
    closeTacticModal();
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
    const snapshot = await api(`/api/rooms/${state.roomId}/state`, { auth: true });
    updateHandTracking(snapshot);
    state.snapshot = snapshot;
    render();
  } catch (error) {
    if (!error.status || error.status >= 500) {
      showReconnectState();
      return;
    }
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

function updateHandTracking(snapshot) {
  if (!snapshot.game) {
    state.previousHandIds = null;
    state.drawnCardId = null;
    return;
  }
  const nextIds = snapshot.game.hand.map((card) => card.id);
  if (state.previousHandIds) {
    const previousIds = new Set(state.previousHandIds);
    const addedId = nextIds.find((id) => !previousIds.has(id));
    if (addedId) {
      state.drawnCardId = addedId;
      window.clearTimeout(state.drawnCardTimer);
      state.drawnCardTimer = window.setTimeout(() => {
        state.drawnCardId = null;
        if (state.snapshot) render();
      }, 5000);
    }
  }
  state.previousHandIds = nextIds;
}

function showReconnectState() {
  if (state.snapshot?.game) {
    showGame();
    statusLabel.textContent = "再接続中";
    handHint.textContent = "通信が戻ったら自動で復帰します";
    return;
  }
  showLobby();
  showLobbyMessage("再接続中です。通信が戻るまで少し待ってください。");
}

function render() {
  const snapshot = state.snapshot;
  const currentName = snapshot.players[snapshot.playerId].name;
  const otherId = snapshot.playerId === "p1" ? "p2" : "p1";
  const otherName = snapshot.players[otherId].name;
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
  tacticDeckCount.textContent = game.tacticDeckCount;
  deckLabel.textContent = game.deckEmpty ? "部隊切れ" : "部隊";
  troopDeckButton.classList.toggle("empty-deck", game.troopDeckCount === 0);
  tacticDeckButton.classList.toggle("empty-deck", game.tacticDeckCount === 0);
  renderDrawControls(game);
  renderTacticStatus(snapshot, game);
  renderTurnPrompt(snapshot, game);
  renderPlayerCards(snapshot, game);
  renderBoardLabels(snapshot);
  surrenderButton.disabled = Boolean(game.winner);
  passButton.disabled = !game.canPass || game.currentPlayer !== snapshot.playerId || Boolean(game.winner) || Boolean(game.pendingDraw) || Boolean(game.pendingScout);
  p1Card.classList.toggle("active", game.currentPlayer === "p1" && !game.winner);
  p2Card.classList.toggle("active", game.currentPlayer === "p2" && !game.winner);
  statusLabel.textContent = `プレイヤー名: ${currentName}`;

  if (!game.winner) state.resultModalOpen = false;

  if (game.winner) {
    handHint.textContent = game.winner === snapshot.playerId ? "あなたの勝ち" : `${otherName}の勝ち`;
    renderResultModal(snapshot, game);
  } else if (game.pendingScout?.playerId === snapshot.playerId) {
    handHint.textContent = game.pendingScout.drawRemaining > 0
      ? `偵察：山札をあと${game.pendingScout.drawRemaining}枚選んでください`
      : `偵察：戻すカードをあと${game.pendingScout.returnRemaining}枚選んでください。偵察で引いたカードは右側に表示されます`;
    resultModal.classList.add("hidden");
  } else if (game.pendingScout) {
    handHint.textContent = "相手が偵察を処理しています";
    resultModal.classList.add("hidden");
  } else if (game.pendingDraw?.playerId === snapshot.playerId) {
    handHint.textContent = "引く山札を選んでください";
    resultModal.classList.add("hidden");
  } else if (game.pendingDraw) {
    handHint.textContent = "相手が山札を選んでいます";
    resultModal.classList.add("hidden");
  } else if (game.lastAutoDraw?.playerId === snapshot.playerId) {
    handHint.textContent = game.lastAutoDraw.message;
    resultModal.classList.add("hidden");
  } else if (game.lastAutoDraw) {
    handHint.textContent = game.lastAutoDraw.message;
    resultModal.classList.add("hidden");
  } else if (game.currentPlayer === snapshot.playerId) {
    handHint.textContent = state.selectedCardId ? "置きたい旗を選んでください" : "出すカードを選んでください";
    resultModal.classList.add("hidden");
  } else {
    handHint.textContent = "相手の手番です";
    resultModal.classList.add("hidden");
  }
  if (!game.winner && game.opponentInactive) {
    handHint.textContent = `${otherName}の通信待ち`;
  }
  syncClaimFlash(game);

  renderBoard(game, snapshot);
  renderTacticActionBar(game);
  renderReviewBanner(snapshot, game);
  renderHand(game);
  renderLog(game.log);
}

function renderDrawControls(gameState) {
  const scoutDrawing = gameState.pendingScout?.playerId === state.playerId && gameState.pendingScout.drawRemaining > 0;
  const canDraw = gameState.pendingDraw?.playerId === state.playerId && !gameState.winner;
  const canUseDeck = canDraw || scoutDrawing;
  troopDeckButton.disabled = !canUseDeck || gameState.troopDeckCount === 0;
  tacticDeckButton.disabled = !canUseDeck || gameState.tacticDeckCount === 0;
  troopDeckButton.classList.toggle("draw-choice", canUseDeck && gameState.troopDeckCount > 0);
  tacticDeckButton.classList.toggle("draw-choice", canUseDeck && gameState.tacticDeckCount > 0);
  drawPrompt.textContent = scoutDrawing
    ? `偵察であと${gameState.pendingScout.drawRemaining}枚`
    : gameState.pendingScout
      ? "偵察の処理中"
      : canDraw
    ? "引く山札を選んでください"
    : gameState.pendingDraw
      ? "相手が山札を選んでいます"
    : "カード配置後に山札を選択";
}

function renderTurnPrompt(snapshot, gameState) {
  if (gameState.winner) {
    turnPrompt.textContent = gameState.winner === snapshot.playerId ? "あなたの勝ち" : "相手の勝ち";
    turnPrompt.classList.toggle("my-turn", gameState.winner === snapshot.playerId);
    return;
  }
  const currentName = snapshot.players[gameState.currentPlayer]?.name || "プレイヤー";
  const isMyTurn = gameState.currentPlayer === snapshot.playerId;
  turnPrompt.textContent = isMyTurn ? "自分の手番" : `${currentName}の手番`;
  turnPrompt.classList.toggle("my-turn", isMyTurn);
}

function renderTacticStatus(snapshot, gameState) {
  p1Tactics.textContent = "";
  p2Tactics.textContent = "";
}

function renderTacticActionBar(gameState) {
  const action = state.pendingTacticAction;
  const card = action?.source ? boardCardAt(action.source) : null;
  if (!action || gameState.winner || gameState.pendingDraw || gameState.pendingScout) {
    tacticActionBar.classList.add("hidden");
    return;
  }

  tacticActionBar.classList.remove("hidden");
  tacticActionText.textContent = tacticActionBarText(action, card);
  const hasSource = Boolean(card);
  tacticMoveButton.classList.toggle("hidden", !hasSource || action.type !== "tactic-redeploy" || action.phase === "target");
  tacticDiscardButton.classList.toggle("hidden", !hasSource || action.type !== "tactic-redeploy");
  tacticMoveButton.disabled = !hasSource || action.type !== "tactic-redeploy" || action.phase === "target";
  tacticDiscardButton.disabled = !hasSource || action.type !== "tactic-redeploy";
}

function tacticActionBarText(action, card) {
  if (!card) return tacticActionHint(action.type);
  const label = cardShortName(card);
  if (action.type === "tactic-redeploy") {
    if (action.phase === "target") return `選択中: ${label}。移動先の旗を選んでください`;
    return `選択中: ${label}。移動するか、除外するか選んでください`;
  }
  if (action.type === "tactic-traitor") return `選択中: ${label}。置きたい旗を選んでください`;
  return `選択中: ${label}`;
}

function tacticStatusText(playerName, tactics) {
  const names = tactics.map((card) => card.name).join(" / ");
  return `${playerName} 戦術 ${tactics.length}${names ? `：${names}` : ""}`;
}

function syncClaimFlash(gameState) {
  const claimEvents = gameState.lastClaimEvents || [];
  const latestActionId = claimEvents.at(-1)?.actionId;
  if (!latestActionId || state.seenClaimActionId === latestActionId) return;
  state.seenClaimActionId = latestActionId;
  state.claimFlashFlags = claimEvents.map((event) => event.flagIndex);
  showClaimNoticeInHand(claimEvents);
  window.setTimeout(() => {
    state.claimFlashFlags = [];
    if (state.snapshot) render();
  }, 1400);
}

function showClaimNoticeInHand(claimEvents) {
  if (!claimEvents.length) return;
  const countText = claimEvents.length === 1 ? "旗を獲得" : `${claimEvents.length}本の旗を獲得`;
  const hasCompleted = claimEvents.some((event) => event.type === "completed");
  const hasProven = claimEvents.some((event) => event.type === "proven");
  let reason = "獲得条件を満たしました";
  if (hasCompleted && hasProven) reason = "両者3枚の判定と逆転不能の証明";
  else if (hasProven) reason = "公開情報上、相手が逆転不能";
  else if (hasCompleted) reason = "両者3枚完成で判定";

  handHint.textContent = `${countText}：${reason}`;
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
      !gameState.pendingDraw &&
      !gameState.pendingScout &&
      gameState.currentPlayer === playerId &&
      isFlagPlayableForSelection(flag, playerId);
    const tacticTargeting = Boolean(state.pendingTacticAction);
    flagButton.disabled = !playable && !tacticTargeting;
    flagButton.classList.toggle("playable", playable && Boolean(state.selectedCardId));
    flagButton.classList.toggle("tactic-targeting", tacticTargeting);
    flagButton.classList.toggle("tactic-source-picking", state.pendingTacticAction?.phase === "source");
    flagButton.classList.toggle("tactic-target-picking", state.pendingTacticAction?.phase === "target");
    flagButton.classList.toggle("tactic-target-ready", isTacticTargetReady(flag, index, playerId));
    flagButton.classList.toggle("claimed", Boolean(flag.owner));
    flagButton.classList.toggle("claimed-by-me", flag.owner === playerId);
    flagButton.classList.toggle("claimed-by-other", Boolean(flag.owner) && flag.owner !== playerId);
    flagButton.classList.toggle("claim-flash", state.claimFlashFlags.includes(index));
    flagButton.classList.toggle("tap-confirm-target", state.confirmFlagIndex === index && Boolean(state.selectedCardId));
    flagButton.classList.toggle("has-fog", flag.tactics?.some((tactic) => tactic.id === "tactic-fog"));
    flagButton.classList.toggle("has-mud", flag.tactics?.some((tactic) => tactic.id === "tactic-mud"));
    flagButton.addEventListener("click", (event) => {
      if (state.pendingTacticAction) {
        handleTacticBoardClick(event, index);
        return;
      }
      playSelected(index);
    });

    flagButton.innerHTML = `
      ${renderBattleLane(flag.cards[topPlayerId], flag.scores[topPlayerId], "top", flag.requiredCards, index, topPlayerId)}
      <div class="flag-marker">
        <i></i>
        ${renderFlagTactics(flag)}
        ${flag.owner ? `<span>${escapeHtml(snapshot.players[flag.owner].name)} 獲得</span>` : ""}
      </div>
      ${renderBattleLane(flag.cards[bottomPlayerId], flag.scores[bottomPlayerId], "bottom", flag.requiredCards, index, bottomPlayerId)}
    `;
    board.appendChild(flagButton);
  });
}

function isFlagPlayableForSelection(flag, playerId) {
  const selectedCard = currentSelectedCard();
  if (!selectedCard) return flag.cards[playerId].length < flag.requiredCards;
  if (selectedCard.type === "troop") return flag.cards[playerId].length < flag.requiredCards;
  if (selectedCard.category === "morale") return flag.cards[playerId].length < flag.requiredCards;
  if (selectedCard.id === "tactic-fog" || selectedCard.id === "tactic-mud") {
    return !flag.tactics.some((tactic) => tactic.id === selectedCard.id);
  }
  return false;
}

function renderFlagTactics(flag) {
  if (!flag.tactics?.length) return "";
  return `<div class="flag-tactics">${flag.tactics.map((tactic) => `<b class="${tactic.id === "tactic-fog" ? "fog" : tactic.id === "tactic-mud" ? "mud" : ""}">${escapeHtml(tacticShortLabel(tactic))}</b>`).join("")}</div>`;
}

function tacticShortLabel(tactic) {
  if (tactic.id === "tactic-fog") return "霧:合計";
  if (tactic.id === "tactic-mud") return "泥濘:4枚";
  return tactic.name;
}

async function handleTacticBoardClick(event, flagIndex) {
  const action = state.pendingTacticAction;
  if (!action) return;
  const cardEl = event.target.closest("[data-card-index]");
  if (action.phase === "source") {
    if (!cardEl) {
      showError("対象にするカードを選んでください");
      return;
    }
    const source = {
      flagIndex: Number(cardEl.dataset.flagIndex),
      playerId: cardEl.dataset.playerId,
      cardIndex: Number(cardEl.dataset.cardIndex)
    };
    if (!validTacticSource(action.type, source)) return;
    if (action.type === "tactic-deserter" && needsTapConfirmation() && !sameBoardSource(state.confirmTacticSource || {}, source)) {
      state.confirmTacticSource = source;
      render();
      handHint.textContent = "このカードを脱走させるなら、同じカードをもう一度タップ";
      return;
    }
    if (action.type === "tactic-deserter") {
      await playTacticAction({ cardId: action.cardId, source });
      return;
    }
    state.pendingTacticAction = {
      ...action,
      source,
      phase: action.type === "tactic-redeploy" ? "choice" : "target"
    };
    state.confirmTacticSource = null;
    state.confirmFlagIndex = null;
    handHint.textContent = tacticTargetHint(action.type, source);
    render();
    return;
  }

  if (action.phase === "choice") {
    return;
  }

  if (action.phase === "target") {
    if (needsTapConfirmation() && state.confirmFlagIndex !== flagIndex) {
      state.confirmFlagIndex = flagIndex;
      render();
      handHint.textContent = "この旗を移動先にするなら、同じ旗をもう一度タップ";
      return;
    }
    await playTacticAction({ cardId: action.cardId, source: action.source, targetFlagIndex: flagIndex, action: "move" });
  }
}

function validTacticSource(type, source) {
  const gameState = state.snapshot?.game;
  const flag = gameState?.flags?.[source.flagIndex];
  const card = flag?.cards?.[source.playerId]?.[source.cardIndex];
  if (!flag || flag.owner || !card) {
    showError("そのカードは対象にできません");
    return false;
  }
  const otherId = state.playerId === "p1" ? "p2" : "p1";
  if (type === "tactic-redeploy" && source.playerId !== state.playerId) {
    showError("再配置は自分のカードを選んでください");
    return false;
  }
  if ((type === "tactic-deserter" || type === "tactic-traitor") && source.playerId !== otherId) {
    showError("相手のカードを選んでください");
    return false;
  }
  if (type === "tactic-traitor" && card.type !== "troop") {
    showError("裏切りは部隊カードだけ対象にできます");
    return false;
  }
  return true;
}

function renderReviewBanner(snapshot, gameState) {
  if (!gameState.winner) {
    reviewBanner.classList.add("hidden");
    return;
  }

  const won = gameState.winner === snapshot.playerId;
  const winnerName = snapshot.players[gameState.winner].name;
  reviewTitle.textContent = won ? "あなたの勝ち" : `${winnerName}の勝ち`;
  reviewText.textContent = "盤面を確認してから結果画面を開けます";
  reviewBanner.classList.remove("hidden");
}

function renderResultModal(snapshot, gameState) {
  if (!state.resultModalOpen) return;

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

function renderBattleLane(cards, score, side, requiredCards = 3, flagIndex = 0, playerId = "") {
  const slots = Array.from({ length: requiredCards }, (_, index) => cards[index]);
  return `
    <div class="lane ${side}">
      <div class="mini-cards">
        ${slots.map((card, index) => (
          card
            ? cardMarkup(card, "mini", `data-flag-index="${flagIndex}" data-player-id="${playerId}" data-card-index="${index}"`, boardCardClasses(card, flagIndex, playerId, index))
            : '<i class="empty"></i>'
        )).join("")}
      </div>
    </div>
  `;
}

function boardCardClasses(card, flagIndex, playerId, cardIndex) {
  const action = state.pendingTacticAction;
  if (!action) return "";
  const source = { flagIndex, playerId, cardIndex };
  const classes = [];
  if (action.source && sameBoardSource(action.source, source)) {
    classes.push("tactic-source-selected");
  } else if (action.phase === "source" && sourceMatchesTactic(action.type, source, card)) {
    classes.push("tactic-source-candidate");
  }
  if (state.confirmTacticSource && sameBoardSource(state.confirmTacticSource, source)) {
    classes.push("tap-confirm-card");
  }
  return classes.join(" ");
}

function sourceMatchesTactic(type, source, card) {
  const otherId = state.playerId === "p1" ? "p2" : "p1";
  if (type === "tactic-redeploy") return source.playerId === state.playerId && isBoardUnitCard(card);
  if (type === "tactic-deserter") return source.playerId === otherId && isBoardUnitCard(card);
  if (type === "tactic-traitor") return source.playerId === otherId && card.type === "troop";
  return false;
}

function isBoardUnitCard(card) {
  return card.type === "troop" || card.category === "morale";
}

function sameBoardSource(a, b) {
  return Number(a.flagIndex) === Number(b.flagIndex) &&
    a.playerId === b.playerId &&
    Number(a.cardIndex) === Number(b.cardIndex);
}

function isTacticTargetReady(flag, flagIndex, playerId) {
  const action = state.pendingTacticAction;
  if (!action || action.phase !== "target" || flag.owner) return false;
  if (action.type !== "tactic-redeploy" && action.type !== "tactic-traitor") return false;
  return flag.cards[playerId].length < flag.requiredCards;
}

function renderHand(gameState) {
  hand.innerHTML = "";
  updateSortControls();
  const returningScoutCard =
    gameState.pendingScout?.playerId === state.playerId &&
    gameState.pendingScout.drawRemaining === 0 &&
    gameState.pendingScout.returnRemaining > 0;
  sortedHand(gameState.hand, gameState).forEach((card) => {
    const button = document.createElement("button");
    button.className = card.type === "tactic" ? "card game-card tactic-card" : `card game-card ${card.color}`;
    button.classList.toggle("selected", state.selectedCardId === card.id);
    button.classList.toggle("drawn", state.drawnCardId === card.id);
    button.classList.toggle("scout-drawn", scoutDrawnCardIds(gameState).includes(card.id));
    button.classList.toggle("scout-returnable", returningScoutCard);
    button.disabled = card.type !== "tactic" && !returningScoutCard && (
      Boolean(gameState.pendingDraw) ||
      Boolean(gameState.pendingScout) ||
      gameState.currentPlayer !== state.playerId ||
      gameState.winner
    );
    button.innerHTML = `${cardFaceMarkup(card)}${cardLabelsMarkup(card, gameState)}`;
    button.addEventListener("click", async () => {
      if (returningScoutCard) {
        await returnScoutCard(card.id);
        return;
      }
      if (card.type === "tactic") {
        openTacticModal(card);
        return;
      }
      state.selectedCardId = state.selectedCardId === card.id ? null : card.id;
      state.confirmFlagIndex = null;
      render();
    });
    hand.appendChild(button);
  });
}

function canSelectTactic(gameState, card) {
  if (!gameState.canUseTactic) return false;
  return card.type === "tactic";
}

function openTacticModal(card) {
  state.tacticModalCardId = card.id;
  tacticModalCategory.textContent = `${tacticCategoryName(card.category)} / 戦術カード`;
  tacticModalTitle.textContent = card.name;
  tacticModalText.textContent = tacticDescription(card);

  const gameState = state.snapshot?.game;
  const usable = canUseTacticNow(gameState, card);
  const unavailableReason = tacticUnavailableReason(gameState, card);
  tacticModalStatus.textContent = usable
    ? "このカードは使用できます。"
    : implementedTactic(card)
      ? unavailableReason
      : "このカードの効果は次フェーズで実装予定です。";
  tacticUseButton.classList.toggle("hidden", !usable);
  tacticModal.classList.remove("hidden");
}

function closeTacticModal() {
  state.tacticModalCardId = null;
  tacticModal.classList.add("hidden");
}

async function useTacticFromModal() {
  const card = (state.snapshot?.game?.hand || []).find((handCard) => handCard.id === state.tacticModalCardId);
  if (!card) return closeTacticModal();
  closeTacticModal();
  if (card.id === "tactic-scout") {
    await playCard(card.id, null);
    return;
  }
  if (["tactic-redeploy", "tactic-deserter", "tactic-traitor"].includes(card.id)) {
    state.pendingTacticAction = { cardId: card.id, type: card.id, phase: "source" };
    state.selectedCardId = null;
    state.confirmFlagIndex = null;
    state.confirmTacticSource = null;
    handHint.textContent = tacticActionHint(card.id);
    render();
    return;
  }
  state.selectedCardId = card.id;
  state.confirmFlagIndex = null;
  state.confirmTacticSource = null;
  handHint.textContent = isMoraleTactic(card) ? "士気カードを置く旗を選んでください" : "戦術カードを置く旗を選んでください";
  render();
}

function canUseTacticNow(gameState, card) {
  if (!gameState || !implementedTactic(card)) return false;
  if (gameState.currentPlayer !== state.playerId || gameState.winner || gameState.pendingDraw || gameState.pendingScout) return false;
  if (!gameState.canUseTactic) return false;
  if (isLeaderTactic(card) && hasUsedLeaderTactic(gameState)) return false;
  if (card.id === "tactic-scout") return true;
  return implementedTactic(card);
}

function tacticUnavailableReason(gameState, card) {
  if (isLeaderTactic(card) && hasUsedLeaderTactic(gameState)) {
    return "リーダーは1人1枚までです。このカードは使えません。";
  }
  if (!gameState || gameState.currentPlayer !== state.playerId) return "今は相手の手番です。効果確認だけできます。";
  if (gameState.pendingDraw) return "先に山札を選んでカードを引いてください。";
  if (gameState.pendingScout) return "先に偵察の処理を終えてください。";
  if (!gameState.canUseTactic) return "戦術カードの使用数制限により、今は使えません。";
  return "今は使用できません。";
}

function isLeaderTactic(card) {
  return card?.id === "tactic-alexander" || card?.id === "tactic-darius";
}

function hasUsedLeaderTactic(gameState) {
  const used = gameState?.usedTactics?.[state.playerId] || [];
  if (used.some((card) => isLeaderTactic(card))) return true;
  return (gameState?.flags || []).some((flag) =>
    (flag.cards?.[state.playerId] || []).some((card) => isLeaderTactic(card))
  );
}

function implementedTactic(card) {
  return [
    "tactic-alexander",
    "tactic-darius",
    "tactic-companion-cavalry",
    "tactic-shield-bearers",
    "tactic-fog",
    "tactic-mud",
    "tactic-scout",
    "tactic-redeploy",
    "tactic-deserter",
    "tactic-traitor"
  ].includes(card.id);
}

function isMoraleTactic(card) {
  return card.category === "morale";
}

function tacticActionHint(tacticId) {
  if (tacticId === "tactic-redeploy") return "再配置する自分のカードを選んでください";
  if (tacticId === "tactic-deserter") return "脱走させる相手のカードを選んでください";
  if (tacticId === "tactic-traitor") return "裏切らせる相手の部隊カードを選んでください";
  return "対象カードを選んでください";
}

function tacticTargetHint(tacticId, source) {
  const card = boardCardAt(source);
  const label = card ? cardShortName(card) : "選択中のカード";
  if (tacticId === "tactic-redeploy") {
    return `${label} を移動するか、除外するか選んでください`;
  }
  if (tacticId === "tactic-traitor") {
    return `${label} を自分側の空き枠へ移します。置きたい旗を選んでください`;
  }
  return "移動先を選んでください";
}

function chooseTacticMove() {
  const action = state.pendingTacticAction;
  if (!action || action.type !== "tactic-redeploy" || !action.source) return;
  state.pendingTacticAction = { ...action, phase: "target" };
  handHint.textContent = tacticTargetHint(action.type, action.source).replace("移動するか、除外するか選んでください", "移動先の旗を選んでください");
  render();
}

async function discardSelectedTacticCard() {
  const action = state.pendingTacticAction;
  if (!action || action.type !== "tactic-redeploy" || !action.source) return;
  await playTacticAction({ cardId: action.cardId, source: action.source, action: "discard" });
}

function cancelTacticAction() {
  state.pendingTacticAction = null;
  state.selectedCardId = null;
  handHint.textContent = "出すカードを選んでください";
  render();
}

function boardCardAt(source) {
  const flag = state.snapshot?.game?.flags?.[Number(source.flagIndex)];
  return flag?.cards?.[source.playerId]?.[Number(source.cardIndex)] || null;
}

function cardShortName(card) {
  if (card.type === "tactic") return card.name;
  return `${card.value}`;
}

function tacticDescription(card) {
  const descriptions = {
    "tactic-alexander": "フラッグ獲得時に好きな色と数字として扱うリーダー。各プレイヤー1枚まで使用できます。",
    "tactic-darius": "フラッグ獲得時に好きな色と数字として扱うリーダー。各プレイヤー1枚まで使用できます。",
    "tactic-companion-cavalry": "フラッグ獲得時に好きな色の8として扱います。",
    "tactic-shield-bearers": "フラッグ獲得時に好きな色の1、2、3のいずれかとして扱います。",
    "tactic-fog": "この旗は役を無視し、配置カードの合計値で勝負します。",
    "tactic-mud": "この旗は4枚でフォーメーションを作ります。",
    "tactic-scout": "山札から合計3枚引き、手札から2枚を対応する山札の上に戻します。このターンの通常ドローはありません。",
    "tactic-redeploy": "自分の未獲得旗上の部隊カードまたは士気カードを、別の空き枠へ移すか除外します。",
    "tactic-deserter": "相手の未獲得旗上の部隊カードまたは士気カードを1枚除外します。",
    "tactic-traitor": "相手の未獲得旗上の部隊カード1枚を、自分側の空き枠へ移します。"
  };
  return descriptions[card.id] || card.text || "戦術カードです。";
}

function currentSelectedCard() {
  const handCards = state.snapshot?.game?.hand || [];
  return handCards.find((card) => card.id === state.selectedCardId) || null;
}

function sortedHand(cards, gameState = null) {
  const scoutIds = new Set(scoutDrawnCardIds(gameState));
  const scoutCards = cards.filter((card) => scoutIds.has(card.id));
  const drawnCards = cards.filter((card) => card.id === state.drawnCardId && !scoutIds.has(card.id));
  const regularCards = cards.filter((card) => card.id !== state.drawnCardId && !scoutIds.has(card.id));
  const regularTroops = regularCards.filter((card) => card.type !== "tactic");
  const regularTactics = regularCards.filter((card) => card.type === "tactic");
  const sortedCards = [...regularTroops];
  if (state.handSort === "color") {
    sortedCards.sort((a, b) => colorOrder(a.color) - colorOrder(b.color) || a.value - b.value);
  } else if (state.handSort === "value") {
    sortedCards.sort((a, b) => a.value - b.value || colorOrder(a.color) - colorOrder(b.color));
  }
  return [...sortedCards, ...regularTactics, ...scoutCards, ...drawnCards];
}

function scoutDrawnCardIds(gameState) {
  const scout = gameState?.pendingScout;
  if (scout?.playerId !== state.playerId) return [];
  return scout.drawnCardIds || [];
}

function cardLabelsMarkup(card, gameState) {
  const labels = [];
  if (scoutDrawnCardIds(gameState).includes(card.id)) labels.push('<span class="scout-label">偵察</span>');
  else if (state.drawnCardId === card.id) labels.push('<span class="drawn-label">NEW</span>');
  return labels.join("");
}

function colorOrder(color) {
  return ["red", "blue", "green", "yellow", "purple", "gray"].indexOf(color);
}

function updateSortControls() {
  const buttons = {
    original: sortOriginalButton,
    color: sortColorButton,
    value: sortValueButton
  };
  for (const [mode, button] of Object.entries(buttons)) {
    button.classList.toggle("active", state.handSort === mode);
  }
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
  if (needsTapConfirmation() && state.confirmFlagIndex !== flagIndex) {
    state.confirmFlagIndex = flagIndex;
    render();
    handHint.textContent = "この旗に置くなら、同じ旗をもう一度タップ";
    return;
  }
  await playCard(state.selectedCardId, flagIndex);
}

function needsTapConfirmation() {
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

async function playCard(cardId, flagIndex) {
  try {
    await api(`/api/rooms/${state.roomId}/play`, {
      method: "POST",
      auth: true,
      body: { cardId, flagIndex }
    });
    state.selectedCardId = null;
    state.confirmFlagIndex = null;
    await refresh();
  } catch (error) {
    state.confirmFlagIndex = null;
    showError(error.message);
    await refresh();
  }
}

async function playTacticAction(payload) {
  try {
    await api(`/api/rooms/${state.roomId}/play`, {
      method: "POST",
      auth: true,
      body: payload
    });
    state.pendingTacticAction = null;
    state.selectedCardId = null;
    state.confirmFlagIndex = null;
    state.confirmTacticSource = null;
    await refresh();
  } catch (error) {
    state.confirmFlagIndex = null;
    state.confirmTacticSource = null;
    showError(error.message);
    await refresh();
  }
}

async function handleDeckClick(deckType) {
  const gameState = state.snapshot?.game;
  if (gameState?.pendingScout?.playerId === state.playerId && gameState.pendingScout.drawRemaining > 0) {
    await drawScoutCard(deckType);
    return;
  }
  await drawFromDeck(deckType);
}

async function drawFromDeck(deckType) {
  try {
    await api(`/api/rooms/${state.roomId}/draw`, {
      method: "POST",
      auth: true,
      body: { deckType }
    });
    state.selectedCardId = null;
    await refresh();
  } catch (error) {
    showError(error.message);
    await refresh();
  }
}

async function drawScoutCard(deckType) {
  try {
    await api(`/api/rooms/${state.roomId}/scout-draw`, {
      method: "POST",
      auth: true,
      body: { deckType }
    });
    state.selectedCardId = null;
    await refresh();
  } catch (error) {
    showError(error.message);
    await refresh();
  }
}

async function returnScoutCard(cardId) {
  try {
    await api(`/api/rooms/${state.roomId}/scout-return`, {
      method: "POST",
      auth: true,
      body: { cardId }
    });
    state.selectedCardId = null;
    await refresh();
  } catch (error) {
    showError(error.message);
    await refresh();
  }
}

async function passTurn() {
  try {
    await api(`/api/rooms/${state.roomId}/pass`, { method: "POST", auth: true });
    state.selectedCardId = null;
    await refresh();
  } catch (error) {
    showError(error.message);
    await refresh();
  }
}

function cardMarkup(card, size, attrs = "", extraClass = "") {
  const baseClass = card.type === "tactic" ? `${size} game-card tactic-card` : `${size} game-card ${card.color}`;
  const cardClass = `${baseClass}${extraClass ? ` ${extraClass}` : ""}`;
  return `<b class="${cardClass}" ${attrs}>${cardFaceMarkup(card)}</b>`;
}

function cardFaceMarkup(card) {
  if (card.type === "tactic") {
    return `
      <span class="tactic-mark">策</span>
      <span class="card-sigil" aria-hidden="true"></span>
      <strong class="tactic-name">${escapeHtml(card.name)}</strong>
    `;
  }
  return `
    <span class="unit-mark">兵</span>
    <span class="card-sigil" aria-hidden="true"></span>
    <strong>${card.value}</strong>
  `;
}

function tacticCategoryName(category) {
  if (category === "morale") return "士気";
  if (category === "environment") return "環境";
  if (category === "guile") return "謀略";
  return "戦術";
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
  if (!response.ok) {
    const error = new Error(data.error || "通信エラー");
    error.status = response.status;
    throw error;
  }
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
  const turnLabel = playerId === snapshot.playerId ? "自分の手番" : "相手の手番";
  const tacticCount = gameState.usedTactics?.[playerId]?.length || 0;
  const turnRibbon = isTurn ? `<span class="turn-ribbon">${turnLabel}</span>` : "";
  const handInfo = playerId === snapshot.playerId
    ? ""
    : `<span class="opponent-hand-info">手札 部隊${gameState.opponentHandBreakdown?.troop ?? 0} / 戦術${gameState.opponentHandBreakdown?.tactic ?? 0}</span>`;
  return `
    ${turnRibbon}
    <span class="player-name"><span class="player-name-text">${escapeHtml(player.name)}</span><span class="player-tactics">使用戦術 ${tacticCount}</span>${handInfo}</span>
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
