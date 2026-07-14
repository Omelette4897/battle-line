import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const rooms = new Map();
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const ROOM_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

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
const FORMATIONS = {
  wedge: { rank: 5, name: "ウェッジ" },
  phalanx: { rank: 4, name: "ファランクス" },
  battalion: { rank: 3, name: "バタリオン" },
  skirmisher: { rank: 2, name: "スカーミッシャー" },
  host: { rank: 1, name: "ホスト" },
  empty: { rank: 0, name: "未配置" }
};

function makeDeck() {
  return shuffle(makeTroopCards());
}

function makeTroopCards() {
  const cards = [];
  for (const color of COLORS) {
    for (let value = 1; value <= 10; value += 1) {
      cards.push({ id: `${color}-${value}`, color, value });
    }
  }
  return cards;
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
  const deck = makeDeck();
  const firstPlayer = Math.random() < 0.5 ? "p1" : "p2";
  const firstPlayerName = room ? playerName(room, firstPlayer) : firstPlayer;
  return {
    deck,
    hands: {
      p1: draw(deck, HAND_SIZE),
      p2: draw(deck, HAND_SIZE)
    },
    flags: Array.from({ length: FLAG_COUNT }, () => ({
      owner: null,
      cards: { p1: [], p2: [] },
      completedAt: { p1: null, p2: null }
    })),
    currentPlayer: firstPlayer,
    winner: null,
    playCount: 0,
    deckEmptyLogged: false,
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
    room.players.p1 = { token: randomUUID(), name: playerName };
    return { playerId: "p1", token: room.players.p1.token };
  }
  if (!room.players.p2) {
    room.players.p2 = { token: randomUUID(), name: playerName };
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
  if (normalized.length > 20) {
    throw statusError(400, "名前は20文字以内で入力してください");
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
}

function touchRoom(room) {
  room.lastSeenAt = Date.now();
}

function cleanupRooms(now = Date.now()) {
  for (const [roomId, room] of rooms) {
    if (now - room.lastSeenAt > ROOM_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}

function playCard(room, playerId, cardId, flagIndex) {
  const game = room.game;
  if (!game) throw statusError(400, "まだ2人揃っていません");
  if (game.winner) throw statusError(400, "ゲームは終了しています");
  if (game.currentPlayer !== playerId) throw statusError(400, "相手の手番です");
  if (!Number.isInteger(flagIndex) || flagIndex < 0 || flagIndex >= FLAG_COUNT) {
    throw statusError(400, "旗の指定が不正です");
  }

  const flag = game.flags[flagIndex];
  if (flag.owner) throw statusError(400, "獲得済みの旗です");
  if (flag.cards[playerId].length >= MAX_CARDS_PER_FLAG) {
    throw statusError(400, "この旗にはもう置けません");
  }

  const hand = game.hands[playerId];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) throw statusError(400, "そのカードは手札にありません");

  const [card] = hand.splice(cardIndex, 1);
  flag.cards[playerId].push(card);
  game.playCount += 1;
  if (flag.cards[playerId].length === MAX_CARDS_PER_FLAG && flag.completedAt[playerId] === null) {
    flag.completedAt[playerId] = game.playCount;
  }

  const label = flagIndex + 1;
  game.log.push(`${playerName(room, playerId)} が旗${label}に ${cardLabel(card)} を配置`);
  claimAvailableFlags(game, playerId, room);
  judgeGame(game, room);

  if (!game.winner) {
    if (game.deck.length > 0) {
      hand.push(...draw(game.deck, 1));
      if (game.deck.length === 0 && !game.deckEmptyLogged) {
        game.deckEmptyLogged = true;
        game.log.push("山札切れ");
      }
    }
    game.currentPlayer = opponent(playerId);
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
  game.flags.forEach((flag, index) => {
    if (flag.owner) return;
    if (flag.cards.p1.length === MAX_CARDS_PER_FLAG && flag.cards.p2.length === MAX_CARDS_PER_FLAG) {
      judgeCompletedFlag(game, flag, index, room);
      return;
    }
    claimProvenFlag(game, flag, index, playerId, room);
  });
}

function judgeCompletedFlag(game, flag, flagIndex, room) {
  if (flag.cards.p1.length !== MAX_CARDS_PER_FLAG || flag.cards.p2.length !== MAX_CARDS_PER_FLAG) {
    return;
  }

  const p1Score = scoreFormation(flag.cards.p1);
  const p2Score = scoreFormation(flag.cards.p2);
  flag.owner = decideFlagWinner(flag, p1Score, p2Score);
  const winnerScore = flag.owner === "p1" ? p1Score : p2Score;
  const loserScore = flag.owner === "p1" ? p2Score : p1Score;
  const tieNote = p1Score.total === p2Score.total ? "・先に完成" : "";
  game.log.push(
    `${playerName(room, flag.owner)} が旗${flagIndex + 1}を獲得（${winnerScore.rankName} ${winnerScore.sum} 対 ${loserScore.rankName} ${loserScore.sum}${tieNote}）`
  );
}

function claimProvenFlag(game, flag, flagIndex, playerId, room) {
  const otherId = opponent(playerId);
  if (flag.cards[playerId].length !== MAX_CARDS_PER_FLAG) return;
  if (flag.cards[otherId].length >= MAX_CARDS_PER_FLAG) return;

  const playerScore = scoreFormation(flag.cards[playerId]);
  const maxOtherScore = maxPossibleFormationScore(flag.cards[otherId], publicCandidateCards(game));
  if (maxOtherScore.total > playerScore.total) return;

  flag.owner = playerId;
  game.log.push(
    `${playerName(room, playerId)} が旗${flagIndex + 1}を獲得（公開情報上、相手は最大でも ${maxOtherScore.rankName} ${maxOtherScore.sum}）`
  );
}

export function decideFlagWinner(flag, p1Score, p2Score) {
  if (p1Score.total > p2Score.total) return "p1";
  if (p2Score.total > p1Score.total) return "p2";
  return flag.completedAt.p1 < flag.completedAt.p2 ? "p1" : "p2";
}

export function scoreFormation(cards) {
  const values = cards.map((card) => card.value).sort((a, b) => a - b);
  const colors = new Set(cards.map((card) => card.color));
  const sum = values.reduce((total, value) => total + value, 0);
  const sameColor = cards.length > 0 && colors.size === 1;
  const straight = isConsecutive(values);
  const sameValue = cards.length > 0 && values.every((value) => value === values[0]);

  let formation = FORMATIONS.host;
  if (cards.length === 0) formation = FORMATIONS.empty;
  else if (sameColor && straight) formation = FORMATIONS.wedge;
  else if (sameValue) formation = FORMATIONS.phalanx;
  else if (sameColor) formation = FORMATIONS.battalion;
  else if (straight) formation = FORMATIONS.skirmisher;

  const complete = cards.length === MAX_CARDS_PER_FLAG;
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

export function maxPossibleFormationScore(existingCards, candidateCards) {
  const needed = MAX_CARDS_PER_FLAG - existingCards.length;
  if (needed <= 0) return scoreFormation(existingCards);

  let best = null;
  for (const pickedCards of combinations(candidateCards, needed)) {
    const score = scoreFormation([...existingCards, ...pickedCards]);
    if (!best || score.total > best.total) best = score;
  }
  return best || scoreFormation(existingCards);
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
          deckCount: game.deck.length,
          deckEmpty: game.deck.length === 0,
          currentPlayer: game.currentPlayer,
          winner: game.winner,
          hand: game.hands[playerId],
          opponentHandCount: game.hands[opponent(playerId)].length,
          claimedCounts,
          flags,
          restartVotes: room.restartVotes,
          opponentLeft: Boolean(room.leftBy && room.leftBy !== playerId),
          leftBy: room.leftBy,
          log: game.log.slice(-30)
        }
      : null
  };
}

function withFlagScores(flag) {
  return {
    owner: flag.owner,
    cards: flag.cards,
    completedAt: flag.completedAt,
    scores: {
      p1: scoreFormation(flag.cards.p1),
      p2: scoreFormation(flag.cards.p2)
    }
  };
}

function opponent(playerId) {
  return playerId === "p1" ? "p2" : "p1";
}

function playerName(room, playerId) {
  return room.players[playerId]?.name || (playerId === "p1" ? "Player 1" : "Player 2");
}

function cardLabel(card) {
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

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(join|state|play|restart|surrender|leave))?$/);
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
    playCard(room, playerId, body.cardId, body.flagIndex);
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

const port = Number(process.env.PORT || 3000);
cleanupRooms();
setInterval(cleanupRooms, ROOM_CLEANUP_INTERVAL_MS);
server.listen(port, () => {
  console.log(`Battle Line: http://localhost:${port}`);
});
