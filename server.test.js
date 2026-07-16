import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceAfterAction,
  canPass,
  canUseTactic,
  createRoom,
  drawAfterPlay,
  joinRoom,
  judgeGame,
  leaveRoom,
  maxPossibleFormationScore,
  passTurn,
  playCard,
  publicState,
  requestRestart,
  scoreFormation,
  scoutDraw,
  scoutReturn
} from "./server.js";

const colors = ["red", "blue", "green", "yellow", "purple", "gray"];

function troop(color, value) {
  return { id: `${color}-${value}`, type: "troop", color, value };
}

function tactic(id, name) {
  return { id, type: "tactic", category: "morale", name };
}

function environmentTactic(id, name) {
  return { id, type: "tactic", category: "environment", name };
}

function guileTactic(id, name) {
  return { id, type: "tactic", category: "guile", name };
}

function flag(overrides = {}) {
  return {
    owner: null,
    cards: { p1: [], p2: [] },
    completedAt: { p1: null, p2: null },
    tactics: [],
    ...overrides
  };
}

function flags() {
  return Array.from({ length: 9 }, () => flag());
}

function roomWithGame(gameOverrides = {}) {
  const game = {
    troopDeck: [],
    tacticDeck: [],
    hands: { p1: [], p2: [] },
    usedTactics: { p1: [], p2: [] },
    lastTacticPlayer: null,
    flags: flags(),
    currentPlayer: "p1",
    winner: null,
    pendingDraw: null,
    pendingScout: null,
    lastAutoDraw: null,
    playCount: 0,
    lastClaimEvents: [],
    troopDeckEmptyLogged: true,
    tacticDeckEmptyLogged: true,
    log: [],
    ...gameOverrides
  };
  return {
    id: "TEST",
    players: {
      p1: { name: "A", token: "a", lastSeenAt: Date.now() },
      p2: { name: "B", token: "b", lastSeenAt: Date.now() }
    },
    restartVotes: { p1: false, p2: false },
    leftBy: null,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    game
  };
}

function assertStatus(error, status) {
  assert.equal(error.status, status);
}

function availableTroops(exposedCards) {
  const exposedIds = new Set(exposedCards.map((card) => card.id));
  return colors
    .flatMap((color) => Array.from({ length: 10 }, (_, index) => troop(color, index + 1)))
    .filter((card) => !exposedIds.has(card.id));
}

function canProveClaim(ownCards, opponentCards) {
  const ownScore = scoreFormation(ownCards);
  const opponentMax = maxPossibleFormationScore(opponentCards, availableTroops([...ownCards, ...opponentCards]));
  return {
    ownScore,
    opponentMax,
    claimable: opponentMax.total <= ownScore.total
  };
}

test("盾は2,3と組んだスカーミッシャーで青3・紫7に対して証明できる", () => {
  const result = canProveClaim(
    [troop("red", 2), troop("green", 3), tactic("tactic-shield-bearers", "盾")],
    [troop("blue", 3), troop("purple", 7)]
  );

  assert.equal(result.ownScore.rankName, "スカーミッシャー");
  assert.equal(result.opponentMax.rankName, "ホスト");
  assert.equal(result.claimable, true);
});

test("盾は同色2,3と組んだウェッジで青3・紫7に対して証明できる", () => {
  const result = canProveClaim(
    [troop("red", 2), troop("red", 3), tactic("tactic-shield-bearers", "盾")],
    [troop("blue", 3), troop("purple", 7)]
  );

  assert.equal(result.ownScore.rankName, "ウェッジ");
  assert.equal(result.opponentMax.rankName, "ホスト");
  assert.equal(result.claimable, true);
});

test("援軍騎兵は7,9と組んだスカーミッシャーで青3・紫7に対して証明できる", () => {
  const result = canProveClaim(
    [troop("red", 7), troop("green", 9), tactic("tactic-companion-cavalry", "援軍騎兵")],
    [troop("blue", 3), troop("purple", 7)]
  );

  assert.equal(result.ownScore.rankName, "スカーミッシャー");
  assert.equal(result.opponentMax.rankName, "ホスト");
  assert.equal(result.claimable, true);
});

test("リーダーは2,3と組んだウェッジで青3・紫7に対して証明できる", () => {
  const result = canProveClaim(
    [troop("red", 2), troop("red", 3), tactic("tactic-alexander", "アレクサンドロス")],
    [troop("blue", 3), troop("purple", 7)]
  );

  assert.equal(result.ownScore.rankName, "ウェッジ");
  assert.equal(result.opponentMax.rankName, "ホスト");
  assert.equal(result.claimable, true);
});

test("通常ドローで片方の山札だけ残っている場合は自動で残り山札を引く", async () => {
  const game = {
    troopDeck: [troop("red", 10)],
    tacticDeck: [],
    hands: { p1: [], p2: [] },
    flags: flags(),
    pendingDraw: null,
    currentPlayer: "p1",
    lastAutoDraw: null,
    lastAutoPass: null,
    usedTactics: { p1: [], p2: [] },
    troopDeckEmptyLogged: false,
    tacticDeckEmptyLogged: true,
    log: []
  };
  const room = {
    players: {
      p1: { name: "A" },
      p2: { name: "B" }
    }
  };

  advanceAfterAction(game, "p1", room);

  assert.equal(game.pendingDraw, null);
  assert.equal(game.currentPlayer, "p1");
  assert.equal(game.hands.p1.length, 1);
  assert.equal(game.lastAutoDraw.deckType, "troop");
  assert.equal(game.lastAutoPass.playerId, "p2");
  assert.match(game.lastAutoDraw.message, /戦術山札がないため/);
});

// Additional regression coverage for the current playable MVP.
test("room creation waits for the second player and then starts a game", () => {
  const room = createRoom();
  const p1 = joinRoom(room, "Alice");

  assert.equal(p1.playerId, "p1");
  assert.equal(room.game, null);

  const p2 = joinRoom(room, "Bob");

  assert.equal(p2.playerId, "p2");
  assert.ok(room.game);
  assert.equal(room.game.hands.p1.length, 7);
  assert.equal(room.game.hands.p2.length, 7);
  assert.ok(["p1", "p2"].includes(room.game.currentPlayer));
});

test("player names are limited to ten characters", () => {
  const room = createRoom();

  assert.throws(
    () => joinRoom(room, "12345678901"),
    /10/
  );
});

test("normal play waits for deck choice before changing turns", () => {
  const room = roomWithGame({
    troopDeck: [troop("red", 2)],
    tacticDeck: [environmentTactic("tactic-fog", "Fog")],
    hands: { p1: [troop("red", 1)], p2: [] },
    troopDeckEmptyLogged: false,
    tacticDeckEmptyLogged: false
  });

  playCard(room, "p1", "red-1", 0);

  assert.deepEqual(room.game.pendingDraw, { playerId: "p1" });
  assert.equal(room.game.currentPlayer, "p1");

  drawAfterPlay(room, "p1", "tactic");

  assert.equal(room.game.pendingDraw, null);
  assert.equal(room.game.currentPlayer, "p1");
  assert.equal(room.game.hands.p1[0].id, "tactic-fog");
  assert.equal(room.game.lastAutoPass.playerId, "p2");
});

test("tactic use is blocked when own used tactics already exceed opponent", () => {
  const room = roomWithGame({
    hands: { p1: [environmentTactic("tactic-fog", "Fog")], p2: [] },
    usedTactics: { p1: [environmentTactic("tactic-mud", "Mud")], p2: [] }
  });

  assert.equal(canUseTactic(room.game, "p1"), false);
  assert.throws(() => playCard(room, "p1", "tactic-fog", 0), (error) => {
    assertStatus(error, 400);
    return true;
  });
});

test("both players can use the first tactic while counts are tied", () => {
  const room = roomWithGame({
    hands: { p1: [environmentTactic("tactic-fog", "Fog")], p2: [] }
  });

  assert.equal(canUseTactic(room.game, "p1"), true);
  playCard(room, "p1", "tactic-fog", 0);

  assert.equal(room.game.flags[0].tactics[0].id, "tactic-fog");
  assert.equal(room.game.usedTactics.p1.length, 1);
});

test("same player cannot use tactics on consecutive tactic plays", () => {
  const room = roomWithGame({
    hands: {
      p1: [environmentTactic("tactic-fog", "Fog"), environmentTactic("tactic-mud", "Mud")],
      p2: [environmentTactic("tactic-mud", "Mud")]
    },
    tacticDeck: [environmentTactic("tactic-scout", "Scout")],
    currentPlayer: "p1",
    tacticDeckEmptyLogged: false
  });

  playCard(room, "p1", "tactic-fog", 0);

  assert.equal(canUseTactic(room.game, "p1"), false);

  room.game.currentPlayer = "p1";
  assert.throws(() => playCard(room, "p1", "tactic-mud", 1), (error) => {
    assertStatus(error, 400);
    return true;
  });

  room.game.currentPlayer = "p2";
  assert.equal(canUseTactic(room.game, "p2"), true);
});

test("mud requires four cards per side before judging the flag", () => {
  const mudFlag = flag({
    cards: {
      p1: [troop("red", 1), troop("blue", 3), troop("green", 5)],
      p2: [troop("blue", 8), troop("blue", 9), troop("blue", 10)]
    },
    tactics: [environmentTactic("tactic-mud", "Mud")]
  });
  const testFlags = flags();
  testFlags[0] = mudFlag;
  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [troop("yellow", 7)], p2: [troop("blue", 7)] },
    currentPlayer: "p1"
  });

  playCard(room, "p1", "yellow-7", 0);
  assert.equal(room.game.flags[0].owner, null);
  assert.equal(publicState(room, "p1").game.flags[0].requiredCards, 4);

  playCard(room, "p2", "blue-7", 0);
  assert.equal(room.game.flags[0].owner, "p2");
});

test("mud proof waits until my side has four cards even with a leader", () => {
  const testFlags = flags();
  testFlags[0] = flag({
    cards: {
      p1: [troop("red", 7), troop("blue", 9), tactic("tactic-darius", "Darius")],
      p2: [troop("red", 1), troop("blue", 4), troop("green", 8), troop("yellow", 4)]
    },
    completedAt: { p1: null, p2: 4 },
    tactics: [environmentTactic("tactic-mud", "Mud")]
  });
  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [], p2: [] },
    currentPlayer: "p1",
    playCount: 4
  });

  advanceAfterAction(room.game, "p2", room);

  assert.equal(room.game.flags[0].owner, null);
});

test("mud proof works after my fourth card completes a leader formation", () => {
  const testFlags = flags();
  testFlags[0] = flag({
    cards: {
      p1: [troop("red", 7), troop("blue", 9), tactic("tactic-darius", "Darius")],
      p2: [troop("red", 1), troop("blue", 4), troop("green", 8), troop("yellow", 4)]
    },
    completedAt: { p1: null, p2: 4 },
    tactics: [environmentTactic("tactic-mud", "Mud")]
  });
  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [troop("gray", 1)], p2: [] },
    currentPlayer: "p1",
    playCount: 4
  });

  playCard(room, "p1", "gray-1", 0);

  assert.equal(room.game.flags[0].owner, "p1");
});

test("fog makes a completed flag compare sums instead of formations", () => {
  const fogFlag = flag({
    cards: {
      p1: [troop("blue", 10), troop("green", 9), troop("yellow", 8)],
      p2: [troop("red", 1), troop("red", 2)]
    },
    completedAt: { p1: 1, p2: null },
    tactics: [environmentTactic("tactic-fog", "Fog")]
  });
  const testFlags = flags();
  testFlags[0] = fogFlag;
  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [], p2: [troop("red", 3)] },
    currentPlayer: "p2",
    playCount: 1
  });

  playCard(room, "p2", "red-3", 0);

  assert.equal(room.game.flags[0].owner, "p1");
});

test("playing fog can immediately prove a completed flag by sum", () => {
  const testFlags = flags();
  testFlags[0] = flag({
    cards: {
      p1: [troop("blue", 10), troop("green", 9), troop("yellow", 8)],
      p2: [troop("red", 1), troop("red", 2)]
    },
    completedAt: { p1: 1, p2: null }
  });
  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [environmentTactic("tactic-fog", "Fog")], p2: [] },
    currentPlayer: "p1",
    playCount: 1
  });

  playCard(room, "p1", "tactic-fog", 0);

  assert.equal(room.game.flags[0].owner, "p1");
  assert.equal(room.game.lastClaimEvents[0].owner, "p1");
  assert.equal(room.game.lastClaimEvents[0].type, "proven");
});

test("scout draws three cards, returns two, and skips normal draw", () => {
  const scout = guileTactic("tactic-scout", "Scout");
  const room = roomWithGame({
    troopDeck: [troop("red", 1), troop("red", 2)],
    tacticDeck: [environmentTactic("tactic-fog", "Fog")],
    hands: { p1: [scout], p2: [] },
    troopDeckEmptyLogged: false,
    tacticDeckEmptyLogged: false
  });

  playCard(room, "p1", "tactic-scout", null);
  assert.deepEqual(room.game.pendingScout, {
    playerId: "p1",
    drawRemaining: 3,
    returnRemaining: 2,
    drawnCardIds: []
  });

  scoutDraw(room, "p1", "troop");
  scoutDraw(room, "p1", "tactic");
  scoutDraw(room, "p1", "troop");
  assert.equal(room.game.pendingScout.drawRemaining, 0);
  assert.equal(room.game.hands.p1.length, 3);

  const [first, second] = room.game.hands.p1;
  scoutReturn(room, "p1", first.id);
  scoutReturn(room, "p1", second.id);

  assert.equal(room.game.pendingScout, null);
  assert.equal(room.game.pendingDraw, null);
  assert.equal(room.game.currentPlayer, "p1");
  assert.equal(room.game.lastAutoPass.playerId, "p2");
  assert.equal(room.game.hands.p1.length, 1);
  assert.equal(room.game.log.filter((entry) => entry.includes("偵察でカードを1枚山札に戻した")).length, 2);
  assert.equal(room.game.log.some((entry) => entry.includes(first.id) || entry.includes(second.id)), false);
});

test("second leader is rejected even when tactic count allows a tactic", () => {
  const room = roomWithGame({
    hands: { p1: [tactic("tactic-darius", "Darius")], p2: [] },
    usedTactics: {
      p1: [tactic("tactic-alexander", "Alexander")],
      p2: [environmentTactic("tactic-fog", "Fog")]
    }
  });

  assert.equal(canUseTactic(room.game, "p1"), true);
  assert.throws(() => playCard(room, "p1", "tactic-darius", 0), (error) => {
    assertStatus(error, 400);
    return true;
  });
});

test("redeploy moves own unit-like card to another own flag", () => {
  const testFlags = flags();
  testFlags[0].cards.p1.push(troop("red", 5));
  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [guileTactic("tactic-redeploy", "Redeploy")], p2: [] }
  });

  playCard(room, "p1", "tactic-redeploy", null, {
    source: { flagIndex: 0, playerId: "p1", cardIndex: 0 },
    targetFlagIndex: 1
  });

  assert.equal(room.game.flags[0].cards.p1.length, 0);
  assert.equal(room.game.flags[1].cards.p1[0].id, "red-5");
  assert.equal(room.game.usedTactics.p1[0].id, "tactic-redeploy");
});

test("deserter removes an opponent unit-like card", () => {
  const testFlags = flags();
  testFlags[0].cards.p2.push(troop("blue", 6));
  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [guileTactic("tactic-deserter", "Deserter")], p2: [] }
  });

  playCard(room, "p1", "tactic-deserter", null, {
    source: { flagIndex: 0, playerId: "p2", cardIndex: 0 }
  });

  assert.equal(room.game.flags[0].cards.p2.length, 0);
});

test("traitor moves an opponent troop card to own empty flag space", () => {
  const testFlags = flags();
  testFlags[0].cards.p2.push(troop("blue", 6));
  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [guileTactic("tactic-traitor", "Traitor")], p2: [] }
  });

  playCard(room, "p1", "tactic-traitor", null, {
    source: { flagIndex: 0, playerId: "p2", cardIndex: 0 },
    targetFlagIndex: 1
  });

  assert.equal(room.game.flags[0].cards.p2.length, 0);
  assert.equal(room.game.flags[1].cards.p1[0].id, "blue-6");
});

test("pass is available only when there is no playable card or drawable deck", () => {
  const passRoom = roomWithGame({
    hands: { p1: [], p2: [] }
  });

  assert.equal(canPass(passRoom.game, "p1"), true);
  passTurn(passRoom, "p1");
  assert.equal(passRoom.game.currentPlayer, "p2");

  const blockedRoom = roomWithGame({
    hands: { p1: [troop("red", 1)], p2: [] }
  });
  assert.equal(canPass(blockedRoom.game, "p1"), false);
});

test("five claimed flags wins the game", () => {
  const room = roomWithGame();
  for (let index = 0; index < 5; index += 1) {
    room.game.flags[index].owner = "p1";
  }

  judgeGame(room.game, room);

  assert.equal(room.game.winner, "p1");
});

test("three consecutive claimed flags wins the game", () => {
  const room = roomWithGame();
  room.game.flags[3].owner = "p2";
  room.game.flags[4].owner = "p2";
  room.game.flags[5].owner = "p2";

  judgeGame(room.game, room);

  assert.equal(room.game.winner, "p2");
});

test("restart requires both players and leaving marks the room ended", () => {
  const room = roomWithGame();
  room.game.winner = "p1";
  const previousGame = room.game;

  requestRestart(room, "p1");
  assert.equal(room.restartVotes.p1, true);
  assert.equal(room.game, previousGame);

  requestRestart(room, "p2");
  assert.notEqual(room.game, previousGame);
  assert.deepEqual(room.restartVotes, { p1: false, p2: false });

  leaveRoom(room, "p1");
  assert.equal(room.leftBy, "p1");
  assert.deepEqual(room.restartVotes, { p1: false, p2: false });
});

test("public state exposes opponent hand breakdown and restart flags", () => {
  const room = roomWithGame({
    hands: {
      p1: [troop("red", 1)],
      p2: [troop("blue", 2), environmentTactic("tactic-fog", "Fog")]
    }
  });
  room.restartVotes.p2 = true;

  const state = publicState(room, "p1");

  assert.deepEqual(state.game.opponentHandBreakdown, { troop: 1, tactic: 1 });
  assert.deepEqual(state.game.restartVotes, { p1: false, p2: true });
});

test("opponent play can prove my completed flag when public cards block every comeback", () => {
  const testFlags = flags();
  testFlags[0] = flag({
    cards: {
      p1: [troop("purple", 1), troop("purple", 2), troop("purple", 3)],
      p2: []
    },
    completedAt: { p1: 3, p2: null }
  });
  testFlags[1].cards.p1.push(troop("green", 2), troop("green", 3));
  testFlags[2].cards.p2.push(troop("green", 5), troop("green", 6), troop("green", 7));

  const room = roomWithGame({
    flags: testFlags,
    hands: { p1: [], p2: [troop("green", 4)] },
    currentPlayer: "p2",
    playCount: 3
  });

  playCard(room, "p2", "green-4", 0);

  assert.equal(room.game.flags[0].owner, "p1");
  assert.equal(room.game.lastClaimEvents[0].owner, "p1");
  assert.equal(room.game.lastClaimEvents[0].type, "proven");
});
