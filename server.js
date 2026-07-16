import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const rooms = new Map();
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const ROOM_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const PLAYER_INACTIVE_MS = 15 * 1000;
const MAX_PLAYER_NAME_LENGTH = 10;

const COLORS = ["red", "blue", "green", "yellow", "purple", "gray"];
const COLOR_NAMES = {
  red: "赤",
  blue: "青",
  green: "緑",
  yellow: "黄",
  purple: "紫",
  gray: "灰"
};
const HAND_SIZE = 7;
const FLAG_COUNT = 9;
const MAX_CARDS_PER_FLAG = 3;
const MUD_CARDS_PER_FLAG = 4;
const IMPLEMENTED_TACTICS = new Set([
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
]);
const FORMATIONS = {
  wedge: { rank: 5, name: "ウェッジ" },
  phalanx: { rank: 4, name: "ファランクス" },
  battalion: { rank: 3, name: "バタリオン" },
  skirmisher: { rank: 2, name: "スカーミッシャー" },
  host: { rank: 1, name: "ホスト" },
  empty: { rank: 0, name: "未配置" }
};

function makeTroopDeck() {
  return shuffle(makeTroopCards());
}

function makeTroopCards() {
  const cards = [];
  for (const color of COLORS) {
    for (let value = 1; value <= 10; value += 1) {
      cards.push({ id: `${color}-${value}`, type: "troop", color, value });
    }
  }
  return cards;
}

function makeTacticDeck() {
  return shuffle([
    { id: "tactic-alexander", type: "tactic", category: "morale", name: "アレクサンドロス", text: "士気: 色と数字を解決時に決めるリーダー" },
    { id: "tactic-darius", type: "tactic", category: "morale", name: "ダリウス", text: "士気: 色と数字を解決時に決めるリーダー" },
    { id: "tactic-companion-cavalry", type: "tactic", category: "morale", name: "援軍騎兵", text: "士気: 数字8として扱い、色を解決時に決める" },
    { id: "tactic-shield-bearers", type: "tactic", category: "morale", name: "盾", text: "士気: 数字1から3として扱い、色を解決時に決める" },
    { id: "tactic-fog", type: "tactic", category: "environment", name: "霧", text: "環境: 役を無効にし、合計値だけで判定する" },
    { id: "tactic-mud", type: "tactic", category: "environment", name: "泥濘", text: "環境: その旗は両者4枚で判定する" },
    { id: "tactic-scout", type: "tactic", category: "guile", name: "偵察", text: "謀略: 3枚引き、手札から2枚を山札に戻す" },
    { id: "tactic-redeploy", type: "tactic", category: "guile", name: "再配置", text: "謀略: 自分の未獲得旗のカードを移動または捨てる" },
    { id: "tactic-deserter", type: "tactic", category: "guile", name: "脱走", text: "謀略: 相手の未獲得旗のカードを1枚捨てる" },
    { id: "tactic-traitor", type: "tactic", category: "guile", name: "裏切り", text: "謀略: 相手の部隊カードを自分側の空きに移す" }
  ]);
}

function shuffle(cards) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function draw(deck, count) {
  return deck.splice(0, count);
}

function createGame(room) {
  const troopDeck = makeTroopDeck();
  const tacticDeck = makeTacticDeck();
  const firstPlayer = Math.random() < 0.5 ? "p1" : "p2";
  const firstPlayerName = room ? playerName(room, firstPlayer) : firstPlayer;
  return {
    troopDeck,
    tacticDeck,
    hands: {
      p1: draw(troopDeck, HAND_SIZE),
      p2: draw(troopDeck, HAND_SIZE)
    },
    usedTactics: { p1: [], p2: [] },
    lastTacticPlayer: null,
    flags: Array.from({ length: FLAG_COUNT }, () => ({
      owner: null,
      cards: { p1: [], p2: [] },
      completedAt: { p1: null, p2: null },
      tactics: []
    })),
    currentPlayer: firstPlayer,
    winner: null,
    pendingDraw: null,
    pendingScout: null,
    lastAutoDraw: null,
    lastAutoPass: null,
    playCount: 0,
    lastClaimEvents: [],
    troopDeckEmptyLogged: false,
    tacticDeckEmptyLogged: false,
    log: ["ゲーム開始", `${firstPlayerName} が先攻`]
  };
}

function createRoom() {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  const room = {
    id,
    players: {},
    restartVotes: { p1: false, p2: false },
    leftBy: null,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    game: null
  };
  rooms.set(id, room);
  return room;
}

function joinRoom(room, name) {
  if (room.leftBy) {
    throw statusError(410, "この部屋は終了しています");
  }
  const playerName = normalizePlayerName(name);
  if (!room.players.p1) {
    room.players.p1 = { token: randomUUID(), name: playerName, lastSeenAt: Date.now() };
    return { playerId: "p1", token: room.players.p1.token };
  }
  if (!room.players.p2) {
    room.players.p2 = { token: randomUUID(), name: playerName, lastSeenAt: Date.now() };
    room.game = createGame(room);
    room.restartVotes = { p1: false, p2: false };
    room.leftBy = null;
    return { playerId: "p2", token: room.players.p2.token };
  }
  throw statusError(409, "部屋は満員です");
}

function normalizePlayerName(name) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw statusError(400, "名前を入力してください");
  }
  if (normalized.length > MAX_PLAYER_NAME_LENGTH) {
    throw statusError(400, `名前は${MAX_PLAYER_NAME_LENGTH}文字以内で入力してください`);
  }
  return normalized;
}

function statusError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requirePlayer(room, playerId, token) {
  if (!room.players[playerId] || room.players[playerId].token !== token) {
    throw statusError(403, "参加情報が一致しません");
  }
  touchRoom(room);
  touchPlayer(room, playerId);
}

function touchRoom(room) {
  room.lastSeenAt = Date.now();
}

function touchPlayer(room, playerId) {
  if (room.players[playerId]) {
    room.players[playerId].lastSeenAt = Date.now();
  }
}

function cleanupRooms(now = Date.now()) {
  for (const [roomId, room] of rooms) {
    if (now - room.lastSeenAt > ROOM_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}

function playCard(room, playerId, cardId, flagIndex, options = {}) {
  const game = room.game;
  if (!game) throw statusError(400, "まだ2人揃っていません");
  if (game.winner) throw statusError(400, "ゲームは終了しています");
  if (game.pendingDraw) throw statusError(400, "先にカードを引いてください");
  if (game.pendingScout) throw statusError(400, "先に偵察の処理を終えてください");
  if (game.currentPlayer !== playerId) throw statusError(400, "相手の手番です");

  const hand = game.hands[playerId];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) throw statusError(400, "そのカードは手札にありません");

  const card = hand[cardIndex];
  if (card.type === "tactic") {
    playTacticCard(room, playerId, cardIndex, flagIndex, options);
    return;
  }

  if (!Number.isInteger(flagIndex) || flagIndex < 0 || flagIndex >= FLAG_COUNT) {
    throw statusError(400, "旗の指定が不正です");
  }

  const flag = game.flags[flagIndex];
  if (flag.owner) throw statusError(400, "獲得済みの旗です");
  if (flag.cards[playerId].length >= requiredCardsForFlag(flag)) {
    throw statusError(400, "この旗にはもう置けません");
  }

  hand.splice(cardIndex, 1);
  flag.cards[playerId].push(card);
  game.playCount += 1;
  if (flag.cards[playerId].length === requiredCardsForFlag(flag) && flag.completedAt[playerId] === null) {
    flag.completedAt[playerId] = game.playCount;
  }

  const label = flagIndex + 1;
  game.log.push(`${playerName(room, playerId)} が旗${label}に ${cardLabel(card)} を配置`);
  const claimEvents = claimAvailableFlags(game, playerId, room);
  game.lastClaimEvents = claimEvents.map((event) => ({
    ...event,
    actionId: game.playCount
  }));
  judgeGame(game, room);

  if (!game.winner) {
    advanceAfterAction(game, playerId, room);
  }
}

function playTacticCard(room, playerId, cardIndex, flagIndex, options = {}) {
  const game = room.game;
  const hand = game.hands[playerId];
  const card = hand[cardIndex];
  if (!canUseTactic(game, playerId)) {
    throw statusError(400, "戦術カードは相手の使用数より1枚多いところまでしか使えません");
  }
  if (!IMPLEMENTED_TACTICS.has(card.id)) {
    throw statusError(400, `${card.name} は次の拡張で実装予定です`);
  }

  if (isMoraleCard(card)) {
    playMoraleCard(room, playerId, cardIndex, flagIndex);
    return;
  }

  if (card.id === "tactic-scout") {
    if (game.troopDeck.length + game.tacticDeck.length < 3) {
      throw statusError(400, "偵察に必要な3枚を引ける山札が残っていません");
    }
    hand.splice(cardIndex, 1);
    recordTacticUse(game, playerId, card);
    game.playCount += 1;
    game.pendingScout = { playerId, drawRemaining: 3, returnRemaining: 2, drawnCardIds: [] };
    game.log.push(`${playerName(room, playerId)} が偵察を使用`);
    return;
  }

  if (card.id === "tactic-redeploy" || card.id === "tactic-deserter" || card.id === "tactic-traitor") {
    playGuileCard(room, playerId, cardIndex, options);
    return;
  }

  if (!Number.isInteger(flagIndex) || flagIndex < 0 || flagIndex >= FLAG_COUNT) {
    throw statusError(400, "戦術カードを置く旗を選んでください");
  }

  const flag = game.flags[flagIndex];
  if (flag.owner) throw statusError(400, "獲得済みの旗には戦術カードを置けません");
  if (flag.tactics.some((tactic) => tactic.id === card.id)) {
    throw statusError(400, "この旗には同じ戦術カードがすでに置かれています");
  }

  hand.splice(cardIndex, 1);
  flag.tactics.push({ ...card, playedBy: playerId });
  recordTacticUse(game, playerId, card);
  game.playCount += 1;
  game.log.push(`${playerName(room, playerId)} が旗${flagIndex + 1}に ${card.name} を配置`);

  for (const side of ["p1", "p2"]) {
    if (flag.cards[side].length < requiredCardsForFlag(flag)) {
      flag.completedAt[side] = null;
    } else if (flag.cards[side].length === requiredCardsForFlag(flag) && flag.completedAt[side] === null) {
      flag.completedAt[side] = game.playCount;
    }
  }

  const claimEvents = claimAvailableFlags(game, playerId, room);
  game.lastClaimEvents = claimEvents.map((event) => ({
    ...event,
    actionId: game.playCount
  }));
  judgeGame(game, room);

  if (!game.winner) {
    advanceAfterAction(game, playerId, room);
  }
}

function playMoraleCard(room, playerId, cardIndex, flagIndex) {
  const game = room.game;
  const hand = game.hands[playerId];
  const card = hand[cardIndex];
  if (isLeaderCard(card) && hasUsedLeader(game, playerId)) {
    throw statusError(400, "リーダーは1人につき1枚までしか使えません");
  }
  if (!Number.isInteger(flagIndex) || flagIndex < 0 || flagIndex >= FLAG_COUNT) {
    throw statusError(400, "士気カードを置く旗を選んでください");
  }
  const flag = game.flags[flagIndex];
  if (flag.owner) throw statusError(400, "獲得済みの旗には置けません");
  if (flag.cards[playerId].length >= requiredCardsForFlag(flag)) {
    throw statusError(400, "この旗にはもう置けません");
  }

  hand.splice(cardIndex, 1);
  flag.cards[playerId].push(card);
  recordTacticUse(game, playerId, card);
  game.playCount += 1;
  refreshCompletedAt(flag, game.playCount);
  game.log.push(`${playerName(room, playerId)} が旗${flagIndex + 1}に ${card.name} を配置`);
  finishActionAfterBoardChange(game, playerId, room);
}

function playGuileCard(room, playerId, cardIndex, options) {
  const game = room.game;
  const hand = game.hands[playerId];
  const card = hand[cardIndex];
  const source = options.source || {};
  const sourceFlagIndex = Number(source.flagIndex);
  const sourcePlayerId = source.playerId;
  const sourceCardIndex = Number(source.cardIndex);
  if (!Number.isInteger(sourceFlagIndex) || sourceFlagIndex < 0 || sourceFlagIndex >= FLAG_COUNT) {
    throw statusError(400, "対象カードを選んでください");
  }
  const sourceFlag = game.flags[sourceFlagIndex];
  if (sourceFlag.owner) throw statusError(400, "獲得済みの旗のカードは対象にできません");
  const sourceCards = sourceFlag.cards[sourcePlayerId] || [];
  if (!Number.isInteger(sourceCardIndex) || sourceCardIndex < 0 || sourceCardIndex >= sourceCards.length) {
    throw statusError(400, "対象カードが見つかりません");
  }
  const targetCard = sourceCards[sourceCardIndex];

  if (card.id === "tactic-redeploy") {
    if (sourcePlayerId !== playerId) throw statusError(400, "再配置は自分のカードだけ対象にできます");
    if (!isUnitLikeCard(targetCard)) throw statusError(400, "再配置できるカードではありません");
    const action = options.action === "discard" ? "discard" : "move";
    if (action === "move") {
      moveCardBetweenFlags(game, sourceFlagIndex, sourcePlayerId, sourceCardIndex, playerId, options.targetFlagIndex);
      game.log.push(`${playerName(room, playerId)} が再配置でカードを移動`);
    } else {
      sourceCards.splice(sourceCardIndex, 1);
      refreshCompletedAt(sourceFlag, game.playCount);
      game.log.push(`${playerName(room, playerId)} が再配置で ${cardLabel(targetCard)} を除外`);
    }
  }

  if (card.id === "tactic-deserter") {
    if (sourcePlayerId !== opponent(playerId)) throw statusError(400, "脱走は相手のカードだけ対象にできます");
    if (!isUnitLikeCard(targetCard)) throw statusError(400, "脱走で除外できるカードではありません");
    sourceCards.splice(sourceCardIndex, 1);
    refreshCompletedAt(sourceFlag, game.playCount);
    game.log.push(`${playerName(room, playerId)} が脱走で ${cardLabel(targetCard)} を除外`);
  }

  if (card.id === "tactic-traitor") {
    if (sourcePlayerId !== opponent(playerId)) throw statusError(400, "裏切りは相手の部隊カードだけ対象にできます");
    if (targetCard.type !== "troop") throw statusError(400, "裏切りは部隊カードだけ対象にできます");
    moveCardBetweenFlags(game, sourceFlagIndex, sourcePlayerId, sourceCardIndex, playerId, options.targetFlagIndex);
    game.log.push(`${playerName(room, playerId)} が裏切りで ${cardLabel(targetCard)} を移動`);
  }

  hand.splice(cardIndex, 1);
  recordTacticUse(game, playerId, card);
  game.playCount += 1;
  refreshAllCompletedAt(game);
  finishActionAfterBoardChange(game, playerId, room);
}

function moveCardBetweenFlags(game, sourceFlagIndex, sourcePlayerId, sourceCardIndex, targetPlayerId, targetFlagIndex) {
  const targetIndex = Number(targetFlagIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= FLAG_COUNT) {
    throw statusError(400, "移動先の旗を選んでください");
  }
  const sourceFlag = game.flags[sourceFlagIndex];
  const targetFlag = game.flags[targetIndex];
  if (targetFlag.owner) throw statusError(400, "獲得済みの旗には移動できません");
  if (targetFlag.cards[targetPlayerId].length >= requiredCardsForFlag(targetFlag)) {
    throw statusError(400, "移動先の旗には空きがありません");
  }
  const [movedCard] = sourceFlag.cards[sourcePlayerId].splice(sourceCardIndex, 1);
  targetFlag.cards[targetPlayerId].push(movedCard);
  refreshCompletedAt(sourceFlag, game.playCount);
  refreshCompletedAt(targetFlag, game.playCount);
}

function finishActionAfterBoardChange(game, playerId, room) {
  const claimEvents = claimAvailableFlags(game, playerId, room);
  game.lastClaimEvents = claimEvents.map((event) => ({
    ...event,
    actionId: game.playCount
  }));
  judgeGame(game, room);

  if (!game.winner) {
    advanceAfterAction(game, playerId, room);
  }
}

function drawAfterPlay(room, playerId, deckType) {
  const game = room.game;
  if (!game) throw statusError(400, "まだ2人揃っていません");
  if (game.winner) throw statusError(400, "ゲームは終了しています");
  if (game.pendingScout) throw statusError(400, "先に偵察の処理を終えてください");
  if (!game.pendingDraw || game.pendingDraw.playerId !== playerId) {
    throw statusError(400, "今はカードを引くタイミングではありません");
  }

  const deck = deckType === "tactic" ? game.tacticDeck : deckType === "troop" ? game.troopDeck : null;
  if (!deck) throw statusError(400, "山札の指定が不正です");
  if (deck.length === 0) throw statusError(400, "その山札は空です");

  const [card] = draw(deck, 1);
  game.hands[playerId].push(card);
  game.log.push(`${playerName(room, playerId)} が${deckType === "tactic" ? "戦術" : "部隊"}カードをドロー`);
  logDeckEmpty(game, deckType);
  game.pendingDraw = null;
  game.currentPlayer = opponent(playerId);
  resolveAutomaticPasses(game, room);
}

export function advanceAfterAction(game, playerId, room) {
  game.lastAutoDraw = null;
  game.lastAutoPass = null;
  const drawableDecks = availableDeckTypes(game);
  if (drawableDecks.length === 0) {
    game.currentPlayer = opponent(playerId);
    resolveAutomaticPasses(game, room);
    return;
  }
  if (drawableDecks.length === 1) {
    autoDrawAfterAction(game, playerId, room, drawableDecks[0]);
    game.currentPlayer = opponent(playerId);
    resolveAutomaticPasses(game, room);
    return;
  }
  game.pendingDraw = { playerId };
}

function availableDeckTypes(game) {
  const types = [];
  if (game.troopDeck.length > 0) types.push("troop");
  if (game.tacticDeck.length > 0) types.push("tactic");
  return types;
}

function autoDrawAfterAction(game, playerId, room, deckType) {
  const deck = deckType === "tactic" ? game.tacticDeck : game.troopDeck;
  const [card] = draw(deck, 1);
  game.hands[playerId].push(card);
  const drawnTypeName = deckType === "tactic" ? "戦術" : "部隊";
  const emptyTypeName = deckType === "tactic" ? "部隊" : "戦術";
  const message = `${emptyTypeName}山札がないため、${playerName(room, playerId)} が${drawnTypeName}カードを自動でドロー`;
  game.lastAutoDraw = { playerId, deckType, message };
  game.log.push(message);
  logDeckEmpty(game, deckType);
}

function scoutDraw(room, playerId, deckType) {
  const game = room.game;
  if (!game) throw statusError(400, "まだ2人揃っていません");
  if (game.winner) throw statusError(400, "ゲームは終了しています");
  if (!game.pendingScout || game.pendingScout.playerId !== playerId) {
    throw statusError(400, "今は偵察で引くタイミングではありません");
  }
  if (game.pendingScout.drawRemaining <= 0) {
    throw statusError(400, "先に手札から2枚戻してください");
  }

  const deck = deckType === "tactic" ? game.tacticDeck : deckType === "troop" ? game.troopDeck : null;
  if (!deck) throw statusError(400, "山札の指定が不正です");
  if (deck.length === 0) throw statusError(400, "その山札は空です");

  const [card] = draw(deck, 1);
  game.hands[playerId].push(card);
  game.pendingScout.drawnCardIds.push(card.id);
  game.pendingScout.drawRemaining -= 1;
  game.log.push(`${playerName(room, playerId)} が偵察で${deckType === "tactic" ? "戦術" : "部隊"}カードをドロー`);
  logDeckEmpty(game, deckType);
}

function scoutReturn(room, playerId, cardId) {
  const game = room.game;
  if (!game) throw statusError(400, "まだ2人揃っていません");
  if (game.winner) throw statusError(400, "ゲームは終了しています");
  if (!game.pendingScout || game.pendingScout.playerId !== playerId) {
    throw statusError(400, "今は偵察で戻すタイミングではありません");
  }
  if (game.pendingScout.drawRemaining > 0) {
    throw statusError(400, "先に偵察で3枚引いてください");
  }
  if (game.pendingScout.returnRemaining <= 0) {
    throw statusError(400, "戻すカードはすでに選び終えています");
  }

  const hand = game.hands[playerId];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) throw statusError(400, "そのカードは手札にありません");
  const [card] = hand.splice(cardIndex, 1);
  const deck = card.type === "tactic" ? game.tacticDeck : game.troopDeck;
  deck.unshift(card);
  game.pendingScout.returnRemaining -= 1;
  game.log.push(`${playerName(room, playerId)} が偵察でカードを1枚山札に戻した`);

  if (game.pendingScout.returnRemaining === 0) {
    game.pendingScout = null;
    game.currentPlayer = opponent(playerId);
    resolveAutomaticPasses(game, room);
  }
}

function passTurn(room, playerId) {
  const game = room.game;
  if (!game) throw statusError(400, "まだ2人揃っていません");
  if (game.winner) throw statusError(400, "ゲームは終了しています");
  if (game.pendingDraw || game.pendingScout) throw statusError(400, "処理中の操作を先に終えてください");
  if (game.currentPlayer !== playerId) throw statusError(400, "相手の手番です");
  if (!canPass(game, playerId)) throw statusError(400, "今はパスできません");

  game.log.push(`${playerName(room, playerId)} がパス`);
  game.currentPlayer = opponent(playerId);
  resolveAutomaticPasses(game, room);
}

function resolveAutomaticPasses(game, room) {
  if (game.winner || game.pendingDraw || game.pendingScout) return;
  const passedPlayers = new Set();
  while (canPass(game, game.currentPlayer) && !passedPlayers.has(game.currentPlayer)) {
    const passedPlayer = game.currentPlayer;
    passedPlayers.add(passedPlayer);
    const message = `${playerName(room, passedPlayer)} は置けるカードがないため自動でパスしました`;
    game.lastAutoPass = { playerId: passedPlayer, message };
    game.log.push(message);
    game.currentPlayer = opponent(passedPlayer);
  }
}

function hasDrawableDeck(game) {
  return game.troopDeck.length > 0 || game.tacticDeck.length > 0;
}

function canUseTactic(game, playerId) {
  const ownUsed = game.usedTactics?.[playerId] || [];
  const otherUsed = game.usedTactics?.[opponent(playerId)] || [];
  return ownUsed.length <= otherUsed.length && game.lastTacticPlayer !== playerId;
}

function recordTacticUse(game, playerId, card) {
  game.usedTactics[playerId].push(card);
  game.lastTacticPlayer = playerId;
}

function canPass(game, playerId) {
  return !canPlayAnyTroop(game, playerId) && !canPlayAnyImplementedTactic(game, playerId);
}

function canPlayAnyTroop(game, playerId) {
  const flags = game.flags || [];
  const hand = game.hands?.[playerId] || [];
  const hasTroop = hand.some((card) => card.type === "troop");
  if (!hasTroop) return false;
  return flags.some((flag) => !flag.owner && flag.cards[playerId].length < requiredCardsForFlag(flag));
}

function canPlayAnyImplementedTactic(game, playerId) {
  if (!canUseTactic(game, playerId)) return false;
  const hand = game.hands?.[playerId] || [];
  return hand.some((card) => card.type === "tactic" && canPlayTacticCard(game, playerId, card));
}

function canPlayTacticCard(game, playerId, card) {
  const flags = game.flags || [];
  if (!IMPLEMENTED_TACTICS.has(card.id)) return false;
  if (card.id === "tactic-scout") return game.troopDeck.length + game.tacticDeck.length >= 3;
  if (isMoraleCard(card)) {
    if (isLeaderCard(card) && hasUsedLeader(game, playerId)) return false;
    return flags.some((flag) => !flag.owner && flag.cards[playerId].length < requiredCardsForFlag(flag));
  }
  if (card.id === "tactic-fog" || card.id === "tactic-mud") {
    return flags.some((flag) => !flag.owner && !flag.tactics.some((tactic) => tactic.id === card.id));
  }
  if (card.id === "tactic-redeploy") {
    return flags.some((flag) => !flag.owner && flag.cards[playerId].some((unit) => isUnitLikeCard(unit)));
  }
  if (card.id === "tactic-deserter") {
    const otherId = opponent(playerId);
    return flags.some((flag) => !flag.owner && flag.cards[otherId].some((unit) => isUnitLikeCard(unit)));
  }
  if (card.id === "tactic-traitor") {
    const otherId = opponent(playerId);
    return flags.some((flag) => !flag.owner && flag.cards[otherId].some((unit) => unit.type === "troop")) &&
      flags.some((flag) => !flag.owner && flag.cards[playerId].length < requiredCardsForFlag(flag));
  }
  return false;
}

function logDeckEmpty(game, deckType) {
  if (deckType === "troop" && game.troopDeck.length === 0 && !game.troopDeckEmptyLogged) {
    game.troopDeckEmptyLogged = true;
    game.log.push("部隊山札切れ");
  }
  if (deckType === "tactic" && game.tacticDeck.length === 0 && !game.tacticDeckEmptyLogged) {
    game.tacticDeckEmptyLogged = true;
    game.log.push("戦術山札切れ");
  }
}

function surrenderGame(room, playerId) {
  const game = room.game;
  if (!game) throw statusError(400, "まだ2人揃っていません");
  if (game.winner) throw statusError(400, "ゲームは終了しています");

  const winnerId = opponent(playerId);
  game.winner = winnerId;
  game.log.push(`${playerName(room, playerId)} が降参。${playerName(room, winnerId)} の勝利`);
}

function requestRestart(room, playerId) {
  const game = room.game;
  if (!game) throw statusError(400, "まだ2人揃っていません");
  if (!game.winner) throw statusError(400, "ゲームはまだ終了していません");
  if (room.leftBy) throw statusError(400, "相手がロビーに戻りました");

  room.restartVotes[playerId] = true;
  if (room.restartVotes.p1 && room.restartVotes.p2) {
    room.game = createGame(room);
    room.restartVotes = { p1: false, p2: false };
  }
}

function leaveRoom(room, playerId) {
  room.leftBy = playerId;
  room.restartVotes = { p1: false, p2: false };
}

function claimAvailableFlags(game, playerId, room) {
  return claimAvailableFlagsForPlayers(game, [playerId, opponent(playerId)], room);
}

function claimAvailableFlagsForPlayers(game, playerIds, room) {
  const claimEvents = [];
  game.flags.forEach((flag, index) => {
    if (flag.owner) return;
    const required = requiredCardsForFlag(flag);
    if (flag.cards.p1.length === required && flag.cards.p2.length === required) {
      const event = judgeCompletedFlag(game, flag, index, room);
      if (event) claimEvents.push(event);
      return;
    }
    for (const claimPlayerId of playerIds) {
      const event = claimProvenFlag(game, flag, index, claimPlayerId, room);
      if (event) {
        claimEvents.push(event);
        break;
      }
    }
  });
  return claimEvents;
}

function judgeCompletedFlag(game, flag, flagIndex, room) {
  const required = requiredCardsForFlag(flag);
  if (flag.cards.p1.length !== required || flag.cards.p2.length !== required) {
    return;
  }

  const p1Score = scoreFlagFormation(flag.cards.p1, flag);
  const p2Score = scoreFlagFormation(flag.cards.p2, flag);
  flag.owner = decideFlagWinner(flag, p1Score, p2Score);
  const winnerScore = flag.owner === "p1" ? p1Score : p2Score;
  const loserScore = flag.owner === "p1" ? p2Score : p1Score;
  const tieNote = p1Score.total === p2Score.total ? "・先に完成" : "";
  game.log.push(
    `${playerName(room, flag.owner)} が旗${flagIndex + 1}を獲得（${winnerScore.rankName} ${winnerScore.sum} 対 ${loserScore.rankName} ${loserScore.sum}${tieNote}）`
  );
  return {
    flagIndex,
    owner: flag.owner,
    type: "completed"
  };
}

function claimProvenFlag(game, flag, flagIndex, playerId, room) {
  const otherId = opponent(playerId);
  const required = requiredCardsForFlag(flag);
  if (flag.cards[playerId].length !== required) return;
  if (flag.cards[otherId].length >= required) return;

  const playerScore = scoreFlagFormation(flag.cards[playerId], flag);
  const maxOtherScore = maxPossibleFormationScore(flag.cards[otherId], publicCandidateCards(game), flag);
  if (maxOtherScore.total > playerScore.total) return;

  flag.owner = playerId;
  game.log.push(
    `${playerName(room, playerId)} が旗${flagIndex + 1}を獲得（公開情報上、相手は最大でも ${maxOtherScore.rankName} ${maxOtherScore.sum}）`
  );
  return {
    flagIndex,
    owner: playerId,
    type: "proven"
  };
}

export function decideFlagWinner(flag, p1Score, p2Score) {
  if (p1Score.total > p2Score.total) return "p1";
  if (p2Score.total > p1Score.total) return "p2";
  return flag.completedAt.p1 < flag.completedAt.p2 ? "p1" : "p2";
}

export function scoreFormation(cards) {
  return scoreFormationForRules(cards, MAX_CARDS_PER_FLAG, false);
}

function scoreFlagFormation(cards, flag) {
  return scoreFormationForRules(cards, requiredCardsForFlag(flag), hasFlagTactic(flag, "tactic-fog"));
}

function scoreFormationForRules(cards, requiredCount, fog) {
  if (cards.some((card) => isMoraleCard(card))) {
    let best = null;
    for (const concreteCards of concreteMoraleAssignments(cards)) {
      const score = scoreConcreteFormation(concreteCards, requiredCount, fog);
      if (!best || score.total > best.total) best = score;
    }
    return best || scoreConcreteFormation(cards.filter((card) => card.type === "troop"), requiredCount, fog);
  }
  return scoreConcreteFormation(cards, requiredCount, fog);
}

function scoreConcreteFormation(cards, requiredCount, fog) {
  const values = cards.map((card) => card.value).sort((a, b) => a - b);
  const colors = new Set(cards.map((card) => card.color));
  const sum = values.reduce((total, value) => total + value, 0);
  if (fog) {
    const complete = cards.length === requiredCount;
    return {
      rank: 1,
      rankName: complete ? "合計勝負" : "合計候補",
      sum,
      total: sum,
      complete
    };
  }

  const sameColor = cards.length > 0 && colors.size === 1;
  const straight = isConsecutive(values);
  const sameValue = cards.length > 0 && values.every((value) => value === values[0]);

  let formation = FORMATIONS.host;
  if (cards.length === 0) formation = FORMATIONS.empty;
  else if (sameColor && straight) formation = FORMATIONS.wedge;
  else if (sameValue) formation = FORMATIONS.phalanx;
  else if (sameColor) formation = FORMATIONS.battalion;
  else if (straight) formation = FORMATIONS.skirmisher;

  const complete = cards.length === requiredCount;
  let rankName = formation.name;
  if (cards.length === 1) rankName = "候補";
  else if (!complete && formation !== FORMATIONS.empty) rankName = `${formation.name}候補`;
  return {
    rank: formation.rank,
    rankName,
    sum,
    total: formation.rank * 100 + sum,
    complete
  };
}

function concreteMoraleAssignments(cards) {
  const options = cards.map((card) => concreteOptionsForCard(card));
  const result = [];
  function walk(index, picked) {
    if (index === options.length) {
      result.push(picked);
      return;
    }
    for (const option of options[index]) {
      walk(index + 1, [...picked, option]);
    }
  }
  walk(0, []);
  return result;
}

function concreteOptionsForCard(card) {
  if (card.type !== "tactic") return [card];
  if (card.id === "tactic-companion-cavalry") {
    return COLORS.map((color) => ({ id: `${card.id}-${color}-8`, type: "troop", color, value: 8 }));
  }
  if (card.id === "tactic-shield-bearers") {
    return COLORS.flatMap((color) =>
      [1, 2, 3].map((value) => ({ id: `${card.id}-${color}-${value}`, type: "troop", color, value }))
    );
  }
  if (isLeaderCard(card)) {
    return COLORS.flatMap((color) =>
      Array.from({ length: 10 }, (_, index) => {
        const value = index + 1;
        return { id: `${card.id}-${color}-${value}`, type: "troop", color, value };
      })
    );
  }
  return [card];
}

export function maxPossibleFormationScore(existingCards, candidateCards, flag = null) {
  const required = flag ? requiredCardsForFlag(flag) : MAX_CARDS_PER_FLAG;
  const needed = required - existingCards.length;
  if (needed <= 0) return flag ? scoreFlagFormation(existingCards, flag) : scoreFormation(existingCards);

  let best = null;
  for (const pickedCards of combinations(candidateCards, needed)) {
    const cards = [...existingCards, ...pickedCards];
    const score = flag ? scoreFlagFormation(cards, flag) : scoreFormation(cards);
    if (!best || score.total > best.total) best = score;
  }
  return best || (flag ? scoreFlagFormation(existingCards, flag) : scoreFormation(existingCards));
}

function combinations(cards, count) {
  const result = [];
  function walk(start, picked) {
    if (picked.length === count) {
      result.push(picked);
      return;
    }
    const remaining = count - picked.length;
    for (let index = start; index <= cards.length - remaining; index += 1) {
      walk(index + 1, [...picked, cards[index]]);
    }
  }
  walk(0, []);
  return result;
}

function publicCandidateCards(game) {
  const exposedCardIds = new Set();
  for (const flag of game.flags) {
    for (const playerId of ["p1", "p2"]) {
      for (const card of flag.cards[playerId]) {
        exposedCardIds.add(card.id);
      }
    }
  }
  return makeTroopCards().filter((card) => !exposedCardIds.has(card.id));
}

function requiredCardsForFlag(flag) {
  return hasFlagTactic(flag, "tactic-mud") ? MUD_CARDS_PER_FLAG : MAX_CARDS_PER_FLAG;
}

function hasFlagTactic(flag, tacticId) {
  return flag.tactics.some((tactic) => tactic.id === tacticId);
}

function isMoraleCard(card) {
  return card.type === "tactic" && card.category === "morale";
}

function isLeaderCard(card) {
  return card.id === "tactic-alexander" || card.id === "tactic-darius";
}

function isUnitLikeCard(card) {
  return card.type === "troop" || isMoraleCard(card);
}

function hasUsedLeader(game, playerId) {
  const usedTactics = game.usedTactics?.[playerId] || [];
  const flags = game.flags || [];
  return usedTactics.some((card) => isLeaderCard(card)) ||
    flags.some((flag) => flag.cards[playerId].some((card) => isLeaderCard(card)));
}

function refreshCompletedAt(flag, playCount) {
  for (const playerId of ["p1", "p2"]) {
    if (flag.cards[playerId].length < requiredCardsForFlag(flag)) {
      flag.completedAt[playerId] = null;
    } else if (flag.cards[playerId].length === requiredCardsForFlag(flag) && flag.completedAt[playerId] === null) {
      flag.completedAt[playerId] = playCount;
    }
  }
}

function refreshAllCompletedAt(game) {
  for (const flag of game.flags) {
    refreshCompletedAt(flag, game.playCount);
  }
}

function isConsecutive(values) {
  if (values.length < 2) return false;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] + 1 !== values[index]) return false;
  }
  return true;
}

function judgeGame(game, room) {
  const owners = game.flags.map((flag) => flag.owner);
  for (const playerId of ["p1", "p2"]) {
    const claimed = owners.filter((owner) => owner === playerId).length;
    const hasThreeRow = owners.some((owner, index) =>
      index <= FLAG_COUNT - 3 &&
      owner === playerId &&
      owners[index + 1] === playerId &&
      owners[index + 2] === playerId
    );
    if (claimed >= 5 || hasThreeRow) {
      game.winner = playerId;
      const reason = claimed >= 5 ? `${claimed}旗獲得` : "連続3旗獲得";
      game.log.push(`${playerName(room, playerId)} の勝利（${reason}）`);
      return;
    }
  }
}

function publicState(room, playerId) {
  const game = room.game;
  const otherId = opponent(playerId);
  const otherLastSeenAt = room.players[otherId]?.lastSeenAt || 0;
  const flags = game ? game.flags.map((flag) => withFlagScores(flag)) : [];
  const claimedCounts = game
    ? {
        p1: game.flags.filter((flag) => flag.owner === "p1").length,
        p2: game.flags.filter((flag) => flag.owner === "p2").length
      }
    : { p1: 0, p2: 0 };
  return {
    roomId: room.id,
    playerId,
    players: {
      p1: room.players.p1 ? { name: room.players.p1.name, joined: true } : { name: "Player 1", joined: false },
      p2: room.players.p2 ? { name: room.players.p2.name, joined: true } : { name: "Player 2", joined: false }
    },
    game: game
      ? {
          deckCount: game.troopDeck.length,
          deckEmpty: game.troopDeck.length === 0,
          troopDeckCount: game.troopDeck.length,
          tacticDeckCount: game.tacticDeck.length,
          pendingDraw: game.pendingDraw,
          pendingScout: game.pendingScout,
          currentPlayer: game.currentPlayer,
          winner: game.winner,
          hand: game.hands[playerId],
          opponentHandCount: game.hands[opponent(playerId)].length,
          opponentHandBreakdown: handBreakdown(game.hands[opponent(playerId)]),
          usedTactics: game.usedTactics,
          canUseTactic: canUseTactic(game, playerId),
          canPass: canPass(game, playerId),
          claimedCounts,
          flags,
          lastClaimEvents: game.lastClaimEvents,
          lastAutoDraw: game.lastAutoDraw,
          lastAutoPass: game.lastAutoPass,
          restartVotes: room.restartVotes,
          opponentLeft: Boolean(room.leftBy && room.leftBy !== playerId),
          opponentInactive: Boolean(room.players[otherId]) && Date.now() - otherLastSeenAt > PLAYER_INACTIVE_MS,
          leftBy: room.leftBy,
          log: game.log
        }
      : null
  };
}

function withFlagScores(flag) {
  return {
    owner: flag.owner,
    cards: flag.cards,
    completedAt: flag.completedAt,
    tactics: flag.tactics,
    requiredCards: requiredCardsForFlag(flag),
    scores: {
      p1: scoreFlagFormation(flag.cards.p1, flag),
      p2: scoreFlagFormation(flag.cards.p2, flag)
    }
  };
}

function opponent(playerId) {
  return playerId === "p1" ? "p2" : "p1";
}

function playerName(room, playerId) {
  return room.players[playerId]?.name || (playerId === "p1" ? "Player 1" : "Player 2");
}

function handBreakdown(hand) {
  return {
    troop: hand.filter((card) => card.type !== "tactic").length,
    tactic: hand.filter((card) => card.type === "tactic").length
  };
}

function cardLabel(card) {
  if (card.type === "tactic") return card.name;
  return `${COLOR_NAMES[card.color] || card.color}${card.value}`;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJson(req);
    const room = createRoom();
    const auth = joinRoom(room, body.name);
    touchRoom(room);
    sendJson(res, { roomId: room.id, ...auth });
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(join|state|play|draw|scout-draw|scout-return|pass|restart|surrender|leave))?$/);
  if (!roomMatch) throw statusError(404, "見つかりません");

  const room = rooms.get(roomMatch[1].toUpperCase());
  if (!room) throw statusError(404, "部屋が見つかりません");
  const action = roomMatch[2];

  if (req.method === "POST" && action === "join") {
    const body = await readJson(req);
    const auth = joinRoom(room, body.name);
    touchRoom(room);
    sendJson(res, { roomId: room.id, ...auth });
    return;
  }

  const playerId = req.headers["x-player-id"];
  const token = req.headers["x-player-token"];
  requirePlayer(room, playerId, token);

  if (req.method === "GET" && action === "state") {
    sendJson(res, publicState(room, playerId));
    return;
  }

  if (req.method === "POST" && action === "play") {
    const body = await readJson(req);
    playCard(room, playerId, body.cardId, body.flagIndex, body);
    sendJson(res, publicState(room, playerId));
    return;
  }

  if (req.method === "POST" && action === "draw") {
    const body = await readJson(req);
    drawAfterPlay(room, playerId, body.deckType);
    sendJson(res, publicState(room, playerId));
    return;
  }

  if (req.method === "POST" && action === "scout-draw") {
    const body = await readJson(req);
    scoutDraw(room, playerId, body.deckType);
    sendJson(res, publicState(room, playerId));
    return;
  }

  if (req.method === "POST" && action === "scout-return") {
    const body = await readJson(req);
    scoutReturn(room, playerId, body.cardId);
    sendJson(res, publicState(room, playerId));
    return;
  }

  if (req.method === "POST" && action === "pass") {
    passTurn(room, playerId);
    sendJson(res, publicState(room, playerId));
    return;
  }

  if (req.method === "POST" && action === "surrender") {
    surrenderGame(room, playerId);
    sendJson(res, publicState(room, playerId));
    return;
  }

  if (req.method === "POST" && action === "restart") {
    requestRestart(room, playerId);
    sendJson(res, publicState(room, playerId));
    return;
  }

  if (req.method === "POST" && action === "leave") {
    leaveRoom(room, playerId);
    sendJson(res, publicState(room, playerId));
    return;
  }

  throw statusError(404, "見つかりません");
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function handleStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(publicDir, pathname);
  const data = await readFile(filePath);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
  };
  res.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
  res.end(data);
}

export const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
    } else {
      await handleStatic(req, res);
    }
  } catch (error) {
    if (req.url.startsWith("/api/")) {
      sendJson(res, { error: error.message || "エラーが起きました" }, error.status || 500);
    } else {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
    }
  }
});

export {
  canPass,
  canUseTactic,
  cleanupRooms,
  createRoom,
  drawAfterPlay,
  joinRoom,
  judgeGame,
  leaveRoom,
  passTurn,
  playCard,
  publicState,
  requestRestart,
  scoutDraw,
  scoutReturn
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  cleanupRooms();
  setInterval(cleanupRooms, ROOM_CLEANUP_INTERVAL_MS);
  server.listen(port, () => {
    console.log(`Battle Line: http://localhost:${port}`);
  });
}
