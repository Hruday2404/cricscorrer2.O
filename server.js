const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { calculateAdvancedDLS, checkFollowOnEligibility, getTestSessionInfo } = require('./dlsEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Standardize player names to prevent case-sensitive duplication
function formatPlayerName(name) {
  if (!name) return '';
  const trimmed = name.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function registerGlobalPlayer(playerName, teamName = '') {
  if (!playerName) return;
  const cleanName = formatPlayerName(playerName);
  const exists = db.prepare(`SELECT id FROM players WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`).get(cleanName);
  if (!exists) {
    const pId = 'P_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    db.prepare(`INSERT INTO players (id, name) VALUES (?, ?)`).run(pId, cleanName);
  }
}

function getFullMatchState(matchId) {
  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId);
  if (!match) return null;

  const currentInnings = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND innings_number = ?`).get(matchId, match.current_innings);
  const allInningsList = db.prepare(`SELECT * FROM innings WHERE match_id = ? ORDER BY innings_number ASC`).all(matchId);
  
  const inningsDetails = allInningsList.map(inn => {
    const batsmen = db.prepare(`SELECT * FROM batsmen_stats WHERE match_id = ? AND innings_number = ?`).all(matchId, inn.innings_number);
    const bowlers = db.prepare(`SELECT * FROM bowlers_stats WHERE match_id = ? AND innings_number = ?`).all(matchId, inn.innings_number);
    const deliveries = db.prepare(`SELECT * FROM deliveries WHERE match_id = ? AND innings_number = ? ORDER BY id DESC`).all(matchId, inn.innings_number);
    return { innings: inn, batsmen, bowlers, deliveries };
  });

  const currentOverDeliveries = db.prepare(`
    SELECT * FROM deliveries 
    WHERE match_id = ? AND innings_number = ? AND over_num = ?
    ORDER BY id ASC
  `).all(matchId, match.current_innings, currentInnings ? currentInnings.overs : 0);

  let testSessionData = null;
  if (match.match_type_category === 'TEST') {
    testSessionData = getTestSessionInfo(match.overs_per_day, match.test_day_overs_bowled, match.test_overs_deducted);
  }

  return {
    match,
    currentInnings,
    inningsDetails,
    currentOverDeliveries,
    testSessionData,
    team1Squad: JSON.parse(match.team1_squad || '[]'),
    team2Squad: JSON.parse(match.team2_squad || '[]')
  };
}

function isDeviceMasterScorer(match, deviceKey) {
  if (!match || !deviceKey) return false;
  return match.scorer_pin === deviceKey.toString().trim();
}

// 1. MATCH CREATION
app.post('/api/matches', (req, res) => {
  try {
    const { 
      tournamentId = null,
      deviceKey = 'DEV_' + Date.now(),
      matchType = 'UNOFFICIAL', 
      matchTypeCategory = 'LIMITED_OVERS', 
      formatName, 
      team1 = 'Team 1', 
      team2 = 'Team 2', 
      team1Squad = [], 
      team2Squad = [], 
      playersCount = 11, 
      totalOvers = 20, 
      oversPerDay = 90, 
      testDays = 5, 
      venue = '', 
      matchDatetime = '', 
      umpires = '', 
      referee = '', 
      tossWinner = 'Team 1', 
      tossDecision = 'BAT',
      status = 'LIVE'
    } = req.body;

    const matchId = 'M_' + Date.now();
    const masterKey = deviceKey.toString().trim();
    const parsedPlayers = Math.max(2, parseInt(playersCount) || 11);
    const numOvers = matchTypeCategory === 'TEST' ? 9999 : (parseInt(totalOvers) || 20);
    const maxBowlerOvers = matchTypeCategory === 'TEST' ? 999 : Math.max(1, Math.ceil(numOvers / 5));

    const cleanT1Squad = (team1Squad || []).map(formatPlayerName);
    const cleanT2Squad = (team2Squad || []).map(formatPlayerName);

    cleanT1Squad.forEach(p => registerGlobalPlayer(p, team1));
    cleanT2Squad.forEach(p => registerGlobalPlayer(p, team2));

    db.prepare(`
      INSERT INTO matches (
        id, tournament_id, scorer_pin, match_type, match_type_category, format_name, team1, team2, 
        team1_squad, team2_squad, players_count, total_overs, overs_per_day, test_days, 
        max_overs_per_bowler, venue, match_datetime, umpires, referee, 
        toss_winner, toss_decision, status, current_innings
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      matchId, tournamentId, masterKey, matchType, matchTypeCategory,
      formatName || (matchTypeCategory === 'TEST' ? 'Test Match' : `${numOvers}-Over Match`),
      team1, team2, JSON.stringify(cleanT1Squad), JSON.stringify(cleanT2Squad),
      parsedPlayers, numOvers, parseInt(oversPerDay) || 90, parseInt(testDays) || 5,
      maxBowlerOvers, venue || '', matchDatetime || '', umpires || '', referee || '',
      tossWinner, tossDecision, status, 1
    );

    const battingTeam = tossDecision === 'BAT' ? tossWinner : (tossWinner === team1 ? team2 : team1);
    const bowlingTeam = tossDecision === 'BAT' ? (tossWinner === team1 ? team2 : team1) : tossWinner;

    db.prepare(`INSERT INTO innings (match_id, innings_number, batting_team, bowling_team, is_completed) VALUES (?, 1, ?, ?, 0)`).run(matchId, battingTeam, bowlingTeam);

    const state = getFullMatchState(matchId);
    state.deviceKey = masterKey;
    res.json(state);
  } catch (err) {
    console.error("Match Setup Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. TRANSFER SCORING KEY
app.post('/api/matches/:id/claim-scorer', (req, res) => {
  const matchId = req.params.id;
  const { newDeviceKey } = req.body;
  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId);
  if (!match) return res.status(404).json({ error: "Match not found" });

  db.prepare(`UPDATE matches SET scorer_pin = ? WHERE id = ?`).run(newDeviceKey.toString().trim(), matchId);
  const state = getFullMatchState(matchId);
  io.emit(`match_${matchId}`, state);
  res.json({ success: true, state });
});

// 3. PLAYER CAREER PROFILE (CASE-INSENSITIVE)
app.get('/api/players/:name/profile', (req, res) => {
  const pName = formatPlayerName(req.params.name);
  const player = db.prepare(`SELECT * FROM players WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))`).get(pName) || { name: pName, role: 'All-Rounder' };

  const batStats = db.prepare(`
    SELECT 
      COUNT(DISTINCT match_id) as matches,
      COUNT(id) as innings,
      SUM(runs) as total_runs,
      SUM(balls) as total_balls,
      SUM(fours) as total_fours,
      SUM(sixes) as total_sixes,
      MAX(runs) as high_score,
      SUM(CASE WHEN runs >= 50 AND runs < 100 THEN 1 ELSE 0 END) as fifties,
      SUM(CASE WHEN runs >= 100 THEN 1 ELSE 0 END) as hundreds,
      SUM(CASE WHEN is_out = 0 THEN 1 ELSE 0 END) as not_outs
    FROM batsmen_stats 
    WHERE LOWER(TRIM(player_name)) = LOWER(TRIM(?))
  `).get(pName);

  const bowlStats = db.prepare(`
    SELECT 
      COUNT(id) as innings,
      SUM(balls) as total_balls,
      SUM(maidens) as total_maidens,
      SUM(runs_conceded) as runs_conceded,
      SUM(wickets) as total_wickets,
      MAX(wickets) as best_wickets,
      SUM(CASE WHEN wickets >= 3 AND wickets < 5 THEN 1 ELSE 0 END) as three_fers,
      SUM(CASE WHEN wickets >= 5 THEN 1 ELSE 0 END) as five_fers
    FROM bowlers_stats 
    WHERE LOWER(TRIM(player_name)) = LOWER(TRIM(?))
  `).get(pName);

  const fieldStats = db.prepare(`
    SELECT SUM(catches) as catches, SUM(runouts) as runouts, SUM(stumpings) as stumpings
    FROM fielders_stats 
    WHERE LOWER(TRIM(player_name)) = LOWER(TRIM(?))
  `).get(pName);

  const recentMatches = db.prepare(`
    SELECT DISTINCT m.id, m.format_name, m.team1, m.team2, m.created_at, m.winner, m.result_desc,
      COALESCE(bs.runs, 0) as batter_runs, COALESCE(bs.balls, 0) as batter_balls,
      COALESCE(bw.wickets, 0) as bowler_wickets, COALESCE(bw.runs_conceded, 0) as bowler_runs
    FROM matches m
    LEFT JOIN batsmen_stats bs ON bs.match_id = m.id AND LOWER(TRIM(bs.player_name)) = LOWER(TRIM(?))
    LEFT JOIN bowlers_stats bw ON bw.match_id = m.id AND LOWER(TRIM(bw.player_name)) = LOWER(TRIM(?))
    WHERE bs.id IS NOT NULL OR bw.id IS NOT NULL
    ORDER BY m.created_at DESC LIMIT 10
  `).all(pName, pName);

  const totalRuns = batStats?.total_runs || 0;
  const totalBalls = batStats?.total_balls || 0;
  const dismissals = (batStats?.innings || 0) - (batStats?.not_outs || 0);
  const batAvg = dismissals > 0 ? (totalRuns / dismissals).toFixed(2) : totalRuns.toFixed(2);
  const batSR = totalBalls > 0 ? ((totalRuns / totalBalls) * 100).toFixed(2) : "0.00";

  const totalWickets = bowlStats?.total_wickets || 0;
  const bowlRuns = bowlStats?.runs_conceded || 0;
  const bowlBalls = bowlStats?.total_balls || 0;
  const bowlAvg = totalWickets > 0 ? (bowlRuns / totalWickets).toFixed(2) : "0.00";
  const bowlEcon = bowlBalls > 0 ? ((bowlRuns / bowlBalls) * 6).toFixed(2) : "0.00";

  res.json({
    player,
    batting: {
      matches: batStats?.matches || 0,
      innings: batStats?.innings || 0,
      runs: totalRuns,
      balls: totalBalls,
      high_score: batStats?.high_score || 0,
      fifties: batStats?.fifties || 0,
      hundreds: batStats?.hundreds || 0,
      fours: batStats?.total_fours || 0,
      sixes: batStats?.total_sixes || 0,
      average: batAvg,
      strike_rate: batSR
    },
    bowling: {
      innings: bowlStats?.innings || 0,
      overs: `${Math.floor(bowlBalls / 6)}.${bowlBalls % 6}`,
      wickets: totalWickets,
      runs_conceded: bowlRuns,
      maidens: bowlStats?.total_maidens || 0,
      average: bowlAvg,
      economy: bowlEcon,
      three_fers: bowlStats?.three_fers || 0,
      five_fers: bowlStats?.five_fers || 0
    },
    fielding: {
      catches: fieldStats?.catches || 0,
      runouts: fieldStats?.runouts || 0,
      stumpings: fieldStats?.stumpings || 0
    },
    recentMatches
  });
});

// 4. INJURY BOWLER REPLACEMENT
app.post('/api/matches/:id/change-bowler-injury', (req, res) => {
  const matchId = req.params.id;
  const { newBowler, deviceKey } = req.body;
  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId);
  
  if (!match || !isDeviceMasterScorer(match, deviceKey)) {
    return res.status(403).json({ error: "Unauthorized: Only official scorer device can change bowler." });
  }

  const inn = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND innings_number = ?`).get(matchId, match.current_innings);
  const cleanBowler = formatPlayerName(newBowler);
  registerGlobalPlayer(cleanBowler, inn.bowling_team);

  const bStat = db.prepare(`SELECT balls FROM bowlers_stats WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(matchId, match.current_innings, cleanBowler);
  if (bStat && match.match_type_category !== 'TEST') {
    const oversDone = Math.floor(bStat.balls / 6);
    if (oversDone >= match.max_overs_per_bowler) {
      return res.status(400).json({ error: `Rule Violation: ${cleanBowler} has already completed quota.` });
    }
  }

  const exists = db.prepare(`SELECT id FROM bowlers_stats WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(matchId, match.current_innings, cleanBowler);
  if (!exists) {
    db.prepare(`INSERT INTO bowlers_stats (match_id, innings_number, player_name, team_name) VALUES (?, ?, ?, ?)`).run(matchId, match.current_innings, cleanBowler, inn.bowling_team);
  }

  db.prepare(`UPDATE matches SET active_bowler = ? WHERE id = ?`).run(cleanBowler, matchId);
  const state = getFullMatchState(matchId);
  io.emit(`match_${matchId}`, state);
  res.json(state);
});

// 5. DELIVERY RECORDING (CASE-INSENSITIVE PLAYER MATCHING)
app.post('/api/matches/:id/delivery', (req, res) => {
  const matchId = req.params.id;
  let { striker, nonStriker, bowler, runsBatter, extraType, isWicket, wicketType, dismissedPlayer, fielder, newBatsman, deviceKey } = req.body;

  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId);
  if (!match || match.status === 'COMPLETED') {
    return res.status(400).json({ error: "Match has already concluded." });
  }

  if (!isDeviceMasterScorer(match, deviceKey)) {
    return res.status(403).json({ error: "Viewer Access: This device is in Read-Only Spectator mode." });
  }

  const inn = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND innings_number = ?`).get(matchId, match.current_innings);
  if (!inn || inn.is_completed === 1) {
    return res.status(400).json({ error: `Innings ${match.current_innings} has concluded.` });
  }

  striker = formatPlayerName(striker);
  nonStriker = formatPlayerName(nonStriker);
  bowler = formatPlayerName(bowler);
  newBatsman = formatPlayerName(newBatsman);
  fielder = formatPlayerName(fielder);
  dismissedPlayer = formatPlayerName(dismissedPlayer);

  let t1Squad = JSON.parse(match.team1_squad || '[]');
  let t2Squad = JSON.parse(match.team2_squad || '[]');

  const battingIsTeam1 = inn.batting_team === match.team1;
  let battingSquad = battingIsTeam1 ? t1Squad : t2Squad;
  let bowlingSquad = battingIsTeam1 ? t2Squad : t1Squad;

  const validateAndRegisterPlayer = (player, squad, teamName) => {
    if (!player) return null;
    registerGlobalPlayer(player, teamName);
    const inSquad = squad.some(p => p.toLowerCase().trim() === player.toLowerCase().trim());
    if (!inSquad) {
      if (squad.length >= match.players_count) {
        return `Squad Limit Exceeded: ${teamName} already has ${match.players_count} players. Cannot add '${player}'.`;
      }
      squad.push(player);
    }
    return null;
  };

  let err = validateAndRegisterPlayer(striker, battingSquad, inn.batting_team);
  if (err) return res.status(400).json({ error: err });
  err = validateAndRegisterPlayer(nonStriker, battingSquad, inn.batting_team);
  if (err) return res.status(400).json({ error: err });
  if (isWicket && newBatsman) {
    err = validateAndRegisterPlayer(newBatsman, battingSquad, inn.batting_team);
    if (err) return res.status(400).json({ error: err });
  }
  err = validateAndRegisterPlayer(bowler, bowlingSquad, inn.bowling_team);
  if (err) return res.status(400).json({ error: err });

  if (fielder) registerGlobalPlayer(fielder, inn.bowling_team);

  if (battingIsTeam1) {
    t1Squad = battingSquad;
    t2Squad = bowlingSquad;
  } else {
    t2Squad = battingSquad;
    t1Squad = bowlingSquad;
  }

  db.prepare(`UPDATE matches SET team1_squad = ?, team2_squad = ? WHERE id = ?`).run(JSON.stringify(t1Squad), JSON.stringify(t2Squad), matchId);

  if (inn.balls === 0 && inn.overs > 0 && match.last_bowler && match.last_bowler.toLowerCase().trim() === bowler.toLowerCase().trim()) {
    return res.status(400).json({ error: `Rule Violation: ${bowler} bowled the previous over. Bowlers cannot bowl consecutive overs.` });
  }

  const bStat = db.prepare(`SELECT balls FROM bowlers_stats WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(matchId, match.current_innings, bowler);
  if (bStat && match.match_type_category !== 'TEST') {
    const oversDone = Math.floor(bStat.balls / 6);
    if (oversDone >= match.max_overs_per_bowler) {
      return res.status(400).json({ error: `Rule Violation: ${bowler} reached maximum quota (${match.max_overs_per_bowler} overs).` });
    }
  }

  let extraRuns = 0;
  let isLegal = true;
  let nextFreeHit = 0;

  if (extraType === 'WIDE') {
    extraRuns = 1;
    isLegal = false;
    db.prepare(`UPDATE innings SET extras_wides = extras_wides + 1 WHERE id = ?`).run(inn.id);
  } else if (extraType === 'NO_BALL') {
    extraRuns = 1;
    isLegal = false;
    nextFreeHit = 1;
    db.prepare(`UPDATE innings SET extras_noballs = extras_noballs + 1 WHERE id = ?`).run(inn.id);
  } else if (extraType === 'BYE') {
    extraRuns = parseInt(runsBatter) || 0;
    db.prepare(`UPDATE innings SET extras_byes = extras_byes + ? WHERE id = ?`).run(extraRuns, inn.id);
  } else if (extraType === 'LEG_BYE') {
    extraRuns = parseInt(runsBatter) || 0;
    db.prepare(`UPDATE innings SET extras_legbyes = extras_legbyes + ? WHERE id = ?`).run(extraRuns, inn.id);
  }

  const effectiveBatterRuns = (extraType === 'BYE' || extraType === 'LEG_BYE' || extraType === 'WIDE') ? 0 : (parseInt(runsBatter) || 0);
  const totalBallRuns = (extraType === 'BYE' || extraType === 'LEG_BYE') ? extraRuns : (effectiveBatterRuns + extraRuns);

  const initBatter = (name) => {
    if (!name) return;
    const exists = db.prepare(`SELECT id FROM batsmen_stats WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(matchId, match.current_innings, name);
    if (!exists) db.prepare(`INSERT INTO batsmen_stats (match_id, innings_number, player_name, team_name) VALUES (?, ?, ?, ?)`).run(matchId, match.current_innings, name, inn.batting_team);
  };
  initBatter(striker);
  initBatter(nonStriker);

  const initBowler = (name) => {
    if (!name) return;
    const exists = db.prepare(`SELECT id FROM bowlers_stats WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(matchId, match.current_innings, name);
    if (!exists) db.prepare(`INSERT INTO bowlers_stats (match_id, innings_number, player_name, team_name) VALUES (?, ?, ?, ?)`).run(matchId, match.current_innings, name, inn.bowling_team);
  };
  initBowler(bowler);

  if (extraType !== 'WIDE') {
    const isFour = effectiveBatterRuns === 4 ? 1 : 0;
    const isSix = effectiveBatterRuns === 6 ? 1 : 0;
    db.prepare(`
      UPDATE batsmen_stats 
      SET runs = runs + ?, balls = balls + 1, fours = fours + ?, sixes = sixes + ?
      WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))
    `).run(effectiveBatterRuns, isFour, isSix, matchId, match.current_innings, striker);
  }

  const isBowlerWicket = isWicket && wicketType !== 'Run Out';
  const bowlerConceded = (extraType === 'BYE' || extraType === 'LEG_BYE') ? 0 : totalBallRuns;
  db.prepare(`
    UPDATE bowlers_stats 
    SET runs_conceded = runs_conceded + ?, balls = balls + ?, wickets = wickets + ?
    WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))
  `).run(bowlerConceded, isLegal ? 1 : 0, isBowlerWicket ? 1 : 0, matchId, match.current_innings, bowler);

  if (isWicket && fielder) {
    const exists = db.prepare(`SELECT id FROM fielders_stats WHERE match_id = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(matchId, fielder);
    if (!exists) db.prepare(`INSERT INTO fielders_stats (match_id, player_name) VALUES (?, ?)`).run(matchId, fielder);
    if (wicketType === 'Caught') db.prepare(`UPDATE fielders_stats SET catches = catches + 1 WHERE match_id = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).run(matchId, fielder);
    else if (wicketType === 'Run Out') db.prepare(`UPDATE fielders_stats SET runouts = runouts + 1 WHERE match_id = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).run(matchId, fielder);
    else if (wicketType === 'Stumped') db.prepare(`UPDATE fielders_stats SET stumpings = stumpings + 1 WHERE match_id = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).run(matchId, fielder);
  }

  let nextBalls = inn.balls + (isLegal ? 1 : 0);
  let nextOvers = inn.overs;
  let overCompleted = false;

  if (nextBalls === 6) {
    nextOvers += 1;
    nextBalls = 0;
    overCompleted = true;
    db.prepare(`UPDATE matches SET last_bowler = ? WHERE id = ?`).run(bowler, matchId);

    if (match.match_type_category === 'TEST') {
      let updatedDayOvers = match.test_day_overs_bowled + 1;
      let currentDay = match.test_current_day;
      if (updatedDayOvers >= match.overs_per_day) {
        currentDay += 1;
        updatedDayOvers = 0;
      }
      db.prepare(`UPDATE matches SET test_day_overs_bowled = ?, test_current_day = ? WHERE id = ?`).run(updatedDayOvers, currentDay, matchId);
    }
  }

  const updatedWickets = inn.wickets + (isWicket ? 1 : 0);
  const updatedRuns = inn.total_runs + totalBallRuns;

  db.prepare(`UPDATE innings SET total_runs = ?, wickets = ?, overs = ?, balls = ? WHERE id = ?`).run(updatedRuns, updatedWickets, nextOvers, nextBalls, inn.id);

  if (isWicket) {
    const outGuy = dismissedPlayer || striker;
    let dismissalText = 'Out';
    if (wicketType === 'Caught') dismissalText = `c ${fielder || 'sub'} b ${bowler}`;
    else if (wicketType === 'Bowled') dismissalText = `b ${bowler}`;
    else if (wicketType === 'LBW') dismissalText = `lbw b ${bowler}`;
    else if (wicketType === 'Run Out') dismissalText = `run out (${fielder || ''})`;
    else if (wicketType === 'Stumped') dismissalText = `st ${fielder || 'wk'} b ${bowler}`;
    else if (wicketType === 'Hit Wicket') dismissalText = `hit wicket b ${bowler}`;

    db.prepare(`UPDATE batsmen_stats SET is_out = 1, dismissal_info = ? WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`)
      .run(dismissalText, matchId, match.current_innings, outGuy);
    if (newBatsman) initBatter(newBatsman);
  }

  if (isLegal && match.is_free_hit === 1) {
    db.prepare(`UPDATE matches SET is_free_hit = 0 WHERE id = ?`).run(matchId);
  } else if (nextFreeHit === 1) {
    db.prepare(`UPDATE matches SET is_free_hit = 1 WHERE id = ?`).run(matchId);
  }

  const commentary = `${nextOvers}.${nextBalls}: ${bowler} to ${striker}, ${totalBallRuns} run(s) ${extraType ? `(${extraType})` : ''} ${isWicket ? `[WICKET: ${wicketType}${fielder ? ` by ${fielder}` : ''}]` : ''} ${match.is_free_hit ? '[FREE HIT]' : ''}`;

  db.prepare(`
    INSERT INTO deliveries (match_id, innings_number, over_num, ball_num, striker, non_striker, bowler, runs_batter, extra_runs, extra_type, is_wicket, wicket_type, dismissed_player, fielder, is_free_hit, prev_striker, prev_non_striker, commentary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(matchId, match.current_innings, inn.overs, isLegal ? (inn.balls + 1) : inn.balls, striker, nonStriker, bowler, effectiveBatterRuns, extraRuns, extraType || null, isWicket ? 1 : 0, wicketType || null, dismissedPlayer || null, fielder || null, match.is_free_hit, striker, nonStriker, commentary);

  let curStriker = isWicket ? (newBatsman || striker) : striker;
  let curNonStriker = nonStriker;

  const physicalRuns = (extraType === 'BYE' || extraType === 'LEG_BYE') ? extraRuns : (parseInt(runsBatter) || 0);
  const isOddRuns = (physicalRuns % 2 === 1);

  if (isOddRuns) {
    const temp = curStriker;
    curStriker = curNonStriker;
    curNonStriker = temp;
  }

  if (overCompleted) {
    const temp = curStriker;
    curStriker = curNonStriker;
    curNonStriker = temp;
  }

  db.prepare(`UPDATE matches SET active_striker = ?, active_non_striker = ?, active_bowler = ? WHERE id = ?`)
    .run(curStriker, curNonStriker, overCompleted ? '' : bowler, matchId);

  let matchWon = false;
  if (match.current_innings === 2 && inn.target && updatedRuns >= inn.target && match.match_type_category !== 'TEST') {
    db.prepare(`UPDATE matches SET status = 'COMPLETED', winner = ?, result_desc = ? WHERE id = ?`)
      .run(inn.batting_team, `${inn.batting_team} won by ${match.players_count - 1 - updatedWickets} wickets`, matchId);
    db.prepare(`UPDATE innings SET is_completed = 1 WHERE id = ?`).run(inn.id);
    matchWon = true;
  }

  const maxWickets = Math.max(1, match.players_count - 1);
  let shouldPromptInningsBreak = false;

  if (!matchWon) {
    if (updatedWickets >= maxWickets) {
      shouldPromptInningsBreak = true;
    } else if (match.match_type_category !== 'TEST' && nextOvers >= match.total_overs && nextBalls === 0) {
      shouldPromptInningsBreak = true;
    }
  }

  const state = getFullMatchState(matchId);
  state.overCompleted = overCompleted;
  state.lastCompletedBowler = bowler;
  state.shouldPromptInningsBreak = shouldPromptInningsBreak;
  state.matchWon = matchWon;

  io.emit(`match_${matchId}`, state);
  res.json(state);
});

// 6. DLS METHOD INTERRUPTION API (HOLISTIC INNINGS 1 & 2 MATCH CONDITION JUDGMENT)
app.post('/api/matches/:id/dls', (req, res) => {
  const matchId = req.params.id;
  const { interruptedInnings = 2, revisedTotalOvers, deviceKey } = req.body;

  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId);
  if (!match || !isDeviceMasterScorer(match, deviceKey)) {
    return res.status(403).json({ error: "Unauthorized: Only official scorer device can apply DLS." });
  }

  const inn1 = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND innings_number = 1`).get(matchId);
  const inn2 = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND innings_number = 2`).get(matchId);

  const t1Runs = inn1 ? inn1.total_runs : 0;
  const t1Overs = inn1 ? inn1.overs : match.total_overs;
  const t1Wkts = inn1 ? inn1.wickets : 0;

  const t2CurOvers = inn2 ? inn2.overs : 0;
  const t2CurWkts = inn2 ? inn2.wickets : 0;

  const dlsResult = calculateAdvancedDLS({
    interruptedInnings: parseInt(interruptedInnings) || match.current_innings,
    totalOvers: match.total_overs,
    team1FinalRuns: t1Runs,
    team1OversBatted: t1Overs,
    team1WicketsLost: t1Wkts,
    team2RevisedOvers: parseInt(revisedTotalOvers) || match.total_overs,
    team2CurrentOvers: t2CurOvers,
    team2CurrentWickets: t2CurWkts
  });

  const finalTarget = dlsResult.target;

  // Persist DLS state to DB
  db.prepare(`UPDATE matches SET dls_applied = 1, revised_target = ?, total_overs = ? WHERE id = ?`).run(finalTarget, parseInt(revisedTotalOvers) || match.total_overs, matchId);
  
  if (inn2) {
    db.prepare(`UPDATE innings SET target = ? WHERE id = ?`).run(finalTarget, inn2.id);
  }

  const state = getFullMatchState(matchId);
  io.emit(`match_${matchId}`, state);
  res.json({ target: finalTarget, dlsResult, state });
});

// 7. UNDO LAST DELIVERY
app.post('/api/matches/:id/undo', (req, res) => {
  const matchId = req.params.id;
  const { deviceKey } = req.body;

  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId);
  if (!match || !isDeviceMasterScorer(match, deviceKey)) {
    return res.status(403).json({ error: "Unauthorized: Only master device can undo deliveries." });
  }

  const lastBall = db.prepare(`SELECT * FROM deliveries WHERE match_id = ? AND innings_number = ? ORDER BY id DESC LIMIT 1`).get(matchId, match.current_innings);
  if (!lastBall) {
    return res.status(400).json({ error: "No deliveries to undo in current innings." });
  }

  const inn = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND innings_number = ?`).get(matchId, match.current_innings);
  const isLegal = (lastBall.extra_type !== 'WIDE' && lastBall.extra_type !== 'NO_BALL');
  const totalRunsRevert = lastBall.runs_batter + lastBall.extra_runs;

  let prevBalls = inn.balls;
  let prevOvers = inn.overs;

  if (isLegal) {
    if (prevBalls === 0 && prevOvers > 0) {
      prevOvers -= 1;
      prevBalls = 5;
    } else if (prevBalls > 0) {
      prevBalls -= 1;
    }
  }

  if (lastBall.extra_type === 'WIDE') db.prepare(`UPDATE innings SET extras_wides = extras_wides - 1 WHERE id = ?`).run(inn.id);
  if (lastBall.extra_type === 'NO_BALL') db.prepare(`UPDATE innings SET extras_noballs = extras_noballs - 1 WHERE id = ?`).run(inn.id);
  if (lastBall.extra_type === 'BYE') db.prepare(`UPDATE innings SET extras_byes = extras_byes - ? WHERE id = ?`).run(lastBall.extra_runs, inn.id);
  if (lastBall.extra_type === 'LEG_BYE') db.prepare(`UPDATE innings SET extras_legbyes = extras_legbyes - ? WHERE id = ?`).run(lastBall.extra_runs, inn.id);

  db.prepare(`UPDATE innings SET total_runs = total_runs - ?, wickets = wickets - ?, overs = ?, balls = ? WHERE id = ?`)
    .run(totalRunsRevert, lastBall.is_wicket ? 1 : 0, prevOvers, prevBalls, inn.id);

  if (lastBall.extra_type !== 'WIDE') {
    const isFour = lastBall.runs_batter === 4 ? 1 : 0;
    const isSix = lastBall.runs_batter === 6 ? 1 : 0;
    db.prepare(`
      UPDATE batsmen_stats 
      SET runs = runs - ?, balls = balls - 1, fours = fours - ?, sixes = sixes - ?
      WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))
    `).run(lastBall.runs_batter, isFour, isSix, matchId, match.current_innings, lastBall.striker);
  }

  if (lastBall.is_wicket) {
    const outGuy = lastBall.dismissed_player || lastBall.striker;
    db.prepare(`UPDATE batsmen_stats SET is_out = 0, dismissal_info = '' WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`)
      .run(matchId, match.current_innings, outGuy);
  }

  const bowlerConcededRevert = (lastBall.extra_type === 'BYE' || lastBall.extra_type === 'LEG_BYE') ? 0 : totalRunsRevert;
  const isBowlerWicket = lastBall.is_wicket && lastBall.wicket_type !== 'Run Out';
  db.prepare(`
    UPDATE bowlers_stats 
    SET runs_conceded = runs_conceded - ?, balls = balls - ?, wickets = wickets - ?
    WHERE match_id = ? AND innings_number = ? AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))
  `).run(bowlerConcededRevert, isLegal ? 1 : 0, isBowlerWicket ? 1 : 0, matchId, match.current_innings, lastBall.bowler);

  db.prepare(`DELETE FROM deliveries WHERE id = ?`).run(lastBall.id);

  db.prepare(`UPDATE matches SET active_striker = ?, active_non_striker = ?, active_bowler = ? WHERE id = ?`)
    .run(lastBall.prev_striker || lastBall.striker, lastBall.prev_non_striker || lastBall.nonStriker, lastBall.bowler, matchId);

  const state = getFullMatchState(matchId);
  io.emit(`match_${matchId}`, state);
  res.json(state);
});

// 8. INNINGS FINISH & FOLLOW-ON API
app.post('/api/matches/:id/end-innings', (req, res) => {
  const matchId = req.params.id;
  const { enforceFollowOn = false, deviceKey } = req.body;
  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId);
  
  if (!match || !isDeviceMasterScorer(match, deviceKey)) {
    return res.status(403).json({ error: "Unauthorized: Only master device can end innings." });
  }

  const currentInn = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND innings_number = ?`).get(matchId, match.current_innings);
  if (currentInn) {
    db.prepare(`UPDATE innings SET is_completed = 1 WHERE id = ?`).run(currentInn.id);
  }

  if (match.current_innings === 1) {
    const nextBatting = currentInn.bowling_team;
    const nextBowling = currentInn.batting_team;
    const target = match.match_type_category === 'TEST' ? null : (match.revised_target || (currentInn.total_runs + 1));

    let deducted = 0;
    if (match.match_type_category === 'TEST') {
      deducted = 2;
      db.prepare(`UPDATE matches SET test_overs_deducted = test_overs_deducted + 2 WHERE id = ?`).run(matchId);
    }

    const existingInn2 = db.prepare(`SELECT id FROM innings WHERE match_id = ? AND innings_number = 2`).get(matchId);
    if (!existingInn2) {
      db.prepare(`INSERT INTO innings (match_id, innings_number, batting_team, bowling_team, target, is_completed) VALUES (?, 2, ?, ?, ?, 0)`).run(matchId, nextBatting, nextBowling, target);
    }

    db.prepare(`UPDATE matches SET current_innings = 2, status = 'LIVE', active_striker = '', active_non_striker = '', active_bowler = '', last_bowler = '' WHERE id = ?`).run(matchId);

    const state = getFullMatchState(matchId);
    state.inningsDeductionAlert = deducted > 0;
    io.emit(`match_${matchId}`, state);
    res.json(state);
  } else if (match.current_innings === 2 && match.match_type_category === 'TEST') {
    const inn1 = db.prepare(`SELECT total_runs FROM innings WHERE match_id = ? AND innings_number = 1`).get(matchId);
    const inn2 = currentInn;
    const lead = inn1.total_runs - inn2.total_runs;
    const followOnCheck = checkFollowOnEligibility(match.test_days, lead);

    if (followOnCheck.eligible && enforceFollowOn) {
      db.prepare(`UPDATE matches SET current_innings = 3, follow_on_enforced = 1, active_striker = '', active_non_striker = '', active_bowler = '', last_bowler = '' WHERE id = ?`).run(matchId);
      db.prepare(`INSERT INTO innings (match_id, innings_number, batting_team, bowling_team, is_completed) VALUES (?, 3, ?, ?, 0)`).run(matchId, inn2.batting_team, inn1.batting_team);
    } else {
      db.prepare(`UPDATE matches SET current_innings = 3, active_striker = '', active_non_striker = '', active_bowler = '', last_bowler = '' WHERE id = ?`).run(matchId);
      db.prepare(`INSERT INTO innings (match_id, innings_number, batting_team, bowling_team, is_completed) VALUES (?, 3, ?, ?, 0)`).run(matchId, inn1.batting_team, inn2.batting_team);
    }

    const state = getFullMatchState(matchId);
    io.emit(`match_${matchId}`, state);
    res.json(state);
  } else {
    let winner = null;
    let resultDesc = "Match Completed";
    if (match.match_type_category !== 'TEST') {
      const inn1 = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND innings_number = 1`).get(matchId);
      const inn2 = currentInn;
      const targetToBeat = match.revised_target || inn2.target || (inn1.total_runs + 1);
      if (inn2.total_runs >= targetToBeat) {
        winner = inn2.batting_team;
        resultDesc = `${inn2.batting_team} won by ${match.players_count - 1 - inn2.wickets} wickets (DLS Method)`;
      } else if (inn1.total_runs > inn2.total_runs) {
        winner = inn1.batting_team;
        resultDesc = `${inn1.batting_team} won by ${targetToBeat - 1 - inn2.total_runs} runs (DLS Method)`;
      } else {
        resultDesc = "Match Tied";
      }
    }
    db.prepare(`UPDATE matches SET status = 'COMPLETED', winner = ?, result_desc = ? WHERE id = ?`).run(winner, resultDesc, matchId);
    const state = getFullMatchState(matchId);
    io.emit(`match_${matchId}`, state);
    res.json(state);
  }
});

// 9. TOURNAMENTS
app.post('/api/tournaments', (req, res) => {
  const { name, category, teams, oversPerMatch, deviceKey } = req.body;
  const id = 'T_' + Date.now();
  const masterKey = (deviceKey && deviceKey.toString().trim()) || ('DEV_' + Date.now());
  const teamsList = Array.isArray(teams) ? teams : teams.split(',').map(t => t.trim()).filter(Boolean);

  db.prepare(`INSERT INTO tournaments (id, name, category, teams_json, overs_per_match) VALUES (?, ?, ?, ?, ?)`).run(
    id, name, category || 'LIMITED_OVERS', JSON.stringify(teamsList), parseInt(oversPerMatch) || 20
  );

  for (let i = 0; i < teamsList.length; i++) {
    for (let j = i + 1; j < teamsList.length; j++) {
      const matchId = 'M_' + Date.now() + '_' + i + '_' + j;
      db.prepare(`
        INSERT INTO matches (id, tournament_id, scorer_pin, match_type, match_type_category, format_name, team1, team2, total_overs, status)
        VALUES (?, ?, ?, 'OFFICIAL', 'LIMITED_OVERS', ?, ?, ?, ?, 'SCHEDULED')
      `).run(matchId, id, masterKey, `${name} Match`, teamsList[i], teamsList[j], parseInt(oversPerMatch) || 20);

      db.prepare(`INSERT INTO innings (match_id, innings_number, batting_team, bowling_team, is_completed) VALUES (?, 1, ?, ?, 0)`).run(matchId, teamsList[i], teamsList[j]);
    }
  }

  res.json({ id, name, teamsCount: teamsList.length, masterKey });
});

app.get('/api/tournaments/:id', (req, res) => {
  const tId = req.params.id;
  const tourney = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tId);
  if (!tourney) return res.status(404).json({ error: "Tournament not found" });

  const teams = JSON.parse(tourney.teams_json || '[]');
  const matches = db.prepare(`SELECT * FROM matches WHERE tournament_id = ? ORDER BY created_at ASC`).all(tId);

  const standings = teams.map(team => {
    let played = 0, won = 0, lost = 0, tied = 0, points = 0;
    let runsFor = 0, oversFor = 0, runsAgainst = 0, oversAgainst = 0;

    matches.filter(m => m.status === 'COMPLETED' && (m.team1 === team || m.team2 === team)).forEach(m => {
      played++;
      if (m.winner === team) { won++; points += 2; }
      else if (m.winner === null && m.result_desc === 'Match Tied') { tied++; points += 1; }
      else { lost++; }

      const innFor = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND batting_team = ?`).get(m.id, team);
      const innAgainst = db.prepare(`SELECT * FROM innings WHERE match_id = ? AND bowling_team = ?`).get(m.id, team);

      if (innFor) {
        runsFor += innFor.total_runs;
        oversFor += innFor.overs + (innFor.balls / 6);
      }
      if (innAgainst) {
        runsAgainst += innAgainst.total_runs;
        oversAgainst += innAgainst.overs + (innAgainst.balls / 6);
      }
    });

    const forRate = oversFor > 0 ? (runsFor / oversFor) : 0;
    const againstRate = oversAgainst > 0 ? (runsAgainst / oversAgainst) : 0;
    const nrr = (forRate - againstRate).toFixed(3);

    return { team, played, won, lost, tied, points, nrr: (nrr > 0 ? `+${nrr}` : `${nrr}`) };
  }).sort((a, b) => b.points - a.points || parseFloat(b.nrr) - parseFloat(a.nrr));

  res.json({ tournament: tourney, standings, matches });
});

app.get('/api/tournaments/:id/stats', (req, res) => {
  const tournamentId = req.params.id;
  const matchIds = db.prepare(`SELECT id FROM matches WHERE tournament_id = ?`).all(tournamentId).map(m => m.id);

  if (matchIds.length === 0) {
    return res.json({ topBatsmen: [], topBowlers: [], mvpList: [] });
  }

  const placeholders = matchIds.map(() => '?').join(',');

  const topBatsmen = db.prepare(`
    SELECT player_name, team_name, SUM(runs) as total_runs, SUM(balls) as total_balls, SUM(fours) as total_fours, SUM(sixes) as total_sixes,
    ROUND((CAST(SUM(runs) AS REAL) / NULLIF(SUM(balls), 0)) * 100, 2) as strike_rate
    FROM batsmen_stats
    WHERE match_id IN (${placeholders})
    GROUP BY LOWER(TRIM(player_name)), team_name
    ORDER BY total_runs DESC LIMIT 10
  `).all(...matchIds);

  const topBowlers = db.prepare(`
    SELECT player_name, team_name, SUM(wickets) as total_wickets, SUM(runs_conceded) as total_runs, SUM(balls) as total_balls,
    ROUND((CAST(SUM(runs_conceded) AS REAL) / NULLIF(SUM(balls), 0)) * 6, 2) as economy
    FROM bowlers_stats
    WHERE match_id IN (${placeholders})
    GROUP BY LOWER(TRIM(player_name)), team_name
    ORDER BY total_wickets DESC LIMIT 10
  `).all(...matchIds);

  const allPlayers = db.prepare(`
    SELECT DISTINCT player_name FROM batsmen_stats WHERE match_id IN (${placeholders})
    UNION
    SELECT DISTINCT player_name FROM bowlers_stats WHERE match_id IN (${placeholders})
  `).all(...matchIds, ...matchIds);

  const mvpList = allPlayers.map(p => {
    const pName = p.player_name;
    const b = db.prepare(`SELECT SUM(runs) as r FROM batsmen_stats WHERE match_id IN (${placeholders}) AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(...matchIds, pName);
    const bw = db.prepare(`SELECT SUM(wickets) as w FROM bowlers_stats WHERE match_id IN (${placeholders}) AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(...matchIds, pName);
    const f = db.prepare(`SELECT SUM(catches) as c, SUM(runouts) as ro FROM fielders_stats WHERE match_id IN (${placeholders}) AND LOWER(TRIM(player_name)) = LOWER(TRIM(?))`).get(...matchIds, pName);

    const runs = b?.r || 0;
    const wickets = bw?.w || 0;
    const fieldPts = ((f?.c || 0) + (f?.ro || 0)) * 10;
    const mvpPoints = runs + (wickets * 25) + fieldPts;

    return { player_name: pName, runs, wickets, fielding: (f?.c || 0) + (f?.ro || 0), mvpPoints };
  }).sort((a, b) => b.mvpPoints - a.mvpPoints).slice(0, 10);

  res.json({ topBatsmen, topBowlers, mvpList });
});

app.get('/api/tournaments', (req, res) => {
  const list = db.prepare(`SELECT * FROM tournaments ORDER BY created_at DESC`).all();
  res.json(list);
});

app.get('/api/matches/recent', (req, res) => {
  const matches = db.prepare(`SELECT * FROM matches ORDER BY created_at DESC LIMIT 50`).all();
  res.json(matches);
});

app.get('/api/matches/:id', (req, res) => {
  const state = getFullMatchState(req.params.id);
  if (!state) return res.status(404).json({ error: 'Match not found' });
  res.json(state);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 CricScorer Pro Production Server Online on Port ${PORT}`);
});