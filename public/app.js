const socket = io();
let currentMatchId = null;
let currentMatchData = null;
let lastOverBowler = null;
let selectedInningsView = 1;
let isEndingInnings = false;
let activeTournamentId = null;

// -------------------------------------------------------------
// UNIQUE DEVICE MASTER KEY HELPER
// -------------------------------------------------------------
function getOrCreateDeviceKey() {
  let key = localStorage.getItem('cricscorer_master_device_key');
  if (!key) {
    key = 'DEV_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
    localStorage.setItem('cricscorer_master_device_key', key);
  }
  return key;
}

function isDeviceMasterAuthorized(match) {
  if (!match) return false;
  const myKey = getOrCreateDeviceKey();
  return match.scorer_pin && match.scorer_pin.trim() === myKey.trim();
}

async function claimScorerControlOnThisDevice() {
  const confirmTransfer = confirm("Do you want to transfer official scoring control to this device?");
  if (!confirmTransfer) return;

  const res = await fetch(`/api/matches/${currentMatchId}/claim-scorer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newDeviceKey: getOrCreateDeviceKey() })
  });

  if (res.ok) {
    const data = await res.json();
    alert("🟢 Scoring control transferred to this device!");
    handleServerUpdate(data.state);
  } else {
    alert("Could not transfer scoring.");
  }
}

// -------------------------------------------------------------
// APP SCREEN ROUTER
// -------------------------------------------------------------
function navigateToScreen(screenId) {
  document.querySelectorAll('.app-screen').forEach(el => el.classList.add('hidden'));
  const target = document.getElementById(screenId);
  if (target) target.classList.remove('hidden');

  ['home', 'tournaments', 'recent', 'setup'].forEach(nav => {
    const btn = document.getElementById(`nav-${nav}`);
    if (btn) {
      if (`screen-${nav}` === screenId) {
        btn.className = 'px-3.5 py-2 rounded-xl text-xs font-bold transition-all bg-emerald-600 text-white shadow';
      } else {
        btn.className = 'px-3.5 py-2 rounded-xl text-xs font-bold transition-all glass-inner text-gray-400 hover:text-white';
      }
    }
  });

  if (screenId === 'screen-home') loadHomeLiveMatches();
  if (screenId === 'screen-tournaments') loadTournamentListDropdown();
  if (screenId === 'screen-recent') loadRecentMatchesPortal();
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  ['dark', 'light', 'contrast'].forEach(t => {
    const btn = document.getElementById(`t-${t}`);
    if (btn) {
      if (t === theme) {
        btn.className = 'px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-500 text-white';
      } else {
        btn.className = 'px-2.5 py-1 text-xs font-semibold rounded-lg text-gray-400 hover:text-white';
      }
    }
  });
}

function toggleOfficialFields() {
  const matchTypeEl = document.querySelector('input[name="matchType"]:checked');
  const matchType = matchTypeEl ? matchTypeEl.value : 'UNOFFICIAL';
  const officialSection = document.getElementById('officialDetailsSection');
  if (officialSection) {
    if (matchType === 'OFFICIAL') officialSection.classList.remove('hidden');
    else officialSection.classList.add('hidden');
  }
}

function handleFormatCategoryChange() {
  const cat = document.getElementById('matchTypeCategory')?.value;
  const limitedSec = document.getElementById('limitedOversSection');
  const testSec = document.getElementById('testMatchSection');
  const fmtName = document.getElementById('formatName');

  if (cat === 'TEST') {
    if (limitedSec) limitedSec.classList.add('hidden');
    if (testSec) testSec.classList.remove('hidden');
    if (fmtName) fmtName.value = "ICC World Test Championship";
    updateTestBreakdown();
  } else {
    if (limitedSec) limitedSec.classList.remove('hidden');
    if (testSec) testSec.classList.add('hidden');
    if (fmtName) fmtName.value = "T20 Championship";
    updateBowlerQuota();
  }
}

function updateBowlerQuota() {
  const totalOversInput = document.getElementById('totalOvers');
  const quotaDisplay = document.getElementById('bowlerQuotaDisplay');
  if (totalOversInput && quotaDisplay) {
    const customOvers = parseInt(totalOversInput.value) || 1;
    quotaDisplay.value = `${Math.max(1, Math.ceil(customOvers / 5))} Overs Max / Bowler`;
  }
}

function updateTestBreakdown() {
  const oversPerDayInput = document.getElementById('oversPerDay');
  const breakdownText = document.getElementById('sessionBreakdownText');
  if (oversPerDayInput && breakdownText) {
    const totalOvers = parseInt(oversPerDayInput.value) || 90;
    const s1 = Math.floor(totalOvers / 3);
    const s2 = Math.floor(totalOvers / 3);
    const s3 = totalOvers - (s1 + s2);

    breakdownText.innerHTML = `
      <span>• Session 1: <b>${s1} Overs</b></span>
      <span>• Session 2: <b>${s2} Overs</b></span>
      <span>• Session 3: <b>${s3} Overs</b></span>
    `;
  }
}

// -------------------------------------------------------------
// MATCH SETUP SUBMIT (MASTER DEVICE REGISTRATION)
// -------------------------------------------------------------
document.getElementById('matchSetupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const matchTypeEl = document.querySelector('input[name="matchType"]:checked');
  const matchType = matchTypeEl ? matchTypeEl.value : 'UNOFFICIAL';
  const matchTypeCategory = document.getElementById('matchTypeCategory')?.value || 'LIMITED_OVERS';

  let team1Squad = [];
  let team2Squad = [];

  const t1SquadEl = document.getElementById('t1Squad');
  const t2SquadEl = document.getElementById('t2Squad');
  if (matchType === 'OFFICIAL' && t1SquadEl && t2SquadEl) {
    team1Squad = t1SquadEl.value.split(',').map(s => s.trim()).filter(Boolean);
    team2Squad = t2SquadEl.value.split(',').map(s => s.trim()).filter(Boolean);
  }

  const payload = {
    tournamentId: document.getElementById('matchTournamentLink')?.value || null,
    deviceKey: getOrCreateDeviceKey(),
    matchType,
    matchTypeCategory,
    formatName: document.getElementById('formatName')?.value || 'Match',
    team1: document.getElementById('t1')?.value || 'Team 1',
    team2: document.getElementById('t2')?.value || 'Team 2',
    playersCount: document.getElementById('pCount')?.value || 11,
    team1Squad,
    team2Squad,
    totalOvers: matchTypeCategory === 'TEST' ? 9999 : (document.getElementById('totalOvers')?.value || 20),
    oversPerDay: document.getElementById('oversPerDay')?.value || 90,
    testDays: document.getElementById('testDays')?.value || 5,
    venue: document.getElementById('venue')?.value || '',
    matchDatetime: document.getElementById('matchDatetime')?.value || '',
    umpires: document.getElementById('umpires')?.value || '',
    referee: document.getElementById('referee')?.value || '',
    tossWinner: document.getElementById('tossWinner')?.value || document.getElementById('t1')?.value,
    tossDecision: document.getElementById('tossDecision')?.value || 'BAT'
  };

  try {
    const res = await fetch('/api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      alert("Error starting match: " + (err.error || "Server error"));
      return;
    }

    const data = await res.json();
    currentMatchId = data.match.id;
    selectedInningsView = data.match.current_innings;

    socket.on(`match_${currentMatchId}`, (state) => handleServerUpdate(state));

    navigateToScreen('screen-scoring');
    handleServerUpdate(data);
  } catch (error) {
    console.error("Fetch Error:", error);
    alert("Could not connect to backend server.");
  }
});

function getActiveBowler() {
  const isOfficial = currentMatchData?.match?.match_type === 'OFFICIAL';
  return isOfficial ? document.getElementById('bowlerSelect').value : document.getElementById('bowlerInput').value;
}

function getActiveStriker() {
  const isOfficial = currentMatchData?.match?.match_type === 'OFFICIAL';
  return isOfficial ? document.getElementById('strikerSelect').value : document.getElementById('strikerInput').value;
}

function getActiveNonStriker() {
  const isOfficial = currentMatchData?.match?.match_type === 'OFFICIAL';
  return isOfficial ? document.getElementById('nonStrikerSelect').value : document.getElementById('nonStrikerInput').value;
}

// -------------------------------------------------------------
// DELIVERY RECORDING
// -------------------------------------------------------------
async function recordBall(runsBatter, extraType = null, isWicket = false, wicketType = null, newBatsman = null, fielder = null) {
  const bowler = getActiveBowler()?.trim();
  const striker = getActiveStriker()?.trim();
  const nonStriker = getActiveNonStriker()?.trim();

  if (!striker) {
    alert("Please enter Striker batsman name before scoring!");
    if (document.getElementById('strikerInput')) document.getElementById('strikerInput').focus();
    return;
  }
  if (!nonStriker) {
    alert("Please enter Non-Striker batsman name before scoring!");
    if (document.getElementById('nonStrikerInput')) document.getElementById('nonStrikerInput').focus();
    return;
  }
  if (!bowler) {
    alert("Please enter Bowler name before scoring!");
    if (document.getElementById('bowlerInput')) document.getElementById('bowlerInput').focus();
    return;
  }

  if (striker.toLowerCase() === nonStriker.toLowerCase()) {
    alert("Striker and Non-Striker cannot be the same player!");
    return;
  }

  if (lastOverBowler && bowler === lastOverBowler) {
    alert(`Rule Error: ${bowler} bowled the previous over. Bowlers cannot bowl consecutive overs!`);
    return;
  }

  const payload = {
    striker,
    nonStriker,
    bowler,
    runsBatter,
    extraType,
    isWicket,
    wicketType,
    dismissedPlayer: striker,
    fielder,
    newBatsman,
    deviceKey: getOrCreateDeviceKey()
  };

  const res = await fetch(`/api/matches/${currentMatchId}/delivery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error);
    return;
  }

  const data = await res.json();
  handleServerUpdate(data);
}

// -------------------------------------------------------------
// UNDO DELIVERY
// -------------------------------------------------------------
async function undoLastDeliveryTrigger() {
  if (!confirm("Are you sure you want to undo the last delivery?")) return;

  const res = await fetch(`/api/matches/${currentMatchId}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceKey: getOrCreateDeviceKey() })
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error);
    return;
  }

  const data = await res.json();
  handleServerUpdate(data);
}

// -------------------------------------------------------------
// INJURY BOWLER REPLACEMENT
// -------------------------------------------------------------
async function triggerInjuryBowlerChange() {
  const currentBowler = getActiveBowler();

  const isTeam1 = currentMatchData.currentInnings.bowling_team === currentMatchData.match.team1;
  const registeredSquad = isTeam1 ? currentMatchData.team1Squad : currentMatchData.team2Squad;

  let msg = `Replace injured bowler (${currentBowler}). Enter new bowler name:`;
  if (registeredSquad.length >= currentMatchData.match.players_count) {
    msg = `Replace injured bowler (${currentBowler}). Choose from squad (${registeredSquad.filter(p => p !== currentBowler).join(', ')}):`;
  }

  const newBowler = prompt(msg);
  if (!newBowler || !newBowler.trim()) return;

  const res = await fetch(`/api/matches/${currentMatchId}/change-bowler-injury`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newBowler: newBowler.trim(), deviceKey: getOrCreateDeviceKey() })
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error);
    return;
  }

  const data = await res.json();
  handleServerUpdate(data);
}

// WICKET PROMPT
function triggerOutModal() {
  const currentWickets = currentMatchData?.currentInnings?.wickets || 0;
  const totalPlayers = currentMatchData?.match?.players_count || 11;
  const maxWickets = Math.max(1, totalPlayers - 1);
  const isLastWicket = (currentWickets + 1) >= maxWickets;

  const wicketType = prompt("Dismissal type (Caught, Bowled, LBW, Run Out, Stumped, Hit Wicket):", "Caught");
  if (!wicketType) return;

  let fielder = null;
  if (wicketType.toLowerCase() === 'caught') fielder = prompt("Enter Fielder / Catcher name:");
  else if (wicketType.toLowerCase() === 'run out') fielder = prompt("Enter Fielder who executed the Run Out:");
  else if (wicketType.toLowerCase() === 'stumped') fielder = prompt("Enter Wicketkeeper name:");

  if (isLastWicket) {
    alert(`Last wicket fallen! Team is All-Out (${currentWickets + 1}/${maxWickets} wickets).`);
    recordBall(0, null, true, wicketType.trim(), null, fielder ? fielder.trim() : null);
    return;
  }

  const battingTeam = currentMatchData.currentInnings.batting_team;
  const isTeam1 = battingTeam === currentMatchData.match.team1;
  const registeredSquad = isTeam1 ? currentMatchData.team1Squad : currentMatchData.team2Squad;

  let promptMsg = "Enter new incoming batsman name:";
  if (registeredSquad.length >= totalPlayers) {
    promptMsg = `Select new batsman from squad (${registeredSquad.join(', ')}):`;
  }

  const newBatsman = prompt(promptMsg);
  if (newBatsman && newBatsman.trim()) {
    recordBall(0, null, true, wicketType.trim(), newBatsman.trim(), fielder ? fielder.trim() : null);
  }
}

// INNINGS DECLARE / FOLLOW-ON
async function endInningsTrigger() {
  if (isEndingInnings) return;

  let enforceFollowOn = false;
  if (currentMatchData?.match?.match_type_category === 'TEST' && currentMatchData?.match?.current_innings === 2) {
    const inn1 = currentMatchData.inningsDetails[0]?.innings?.total_runs || 0;
    const inn2 = currentMatchData.currentInnings?.total_runs || 0;
    const lead = inn1 - inn2;

    const days = currentMatchData.match.test_days || 5;
    let reqLead = 200;
    if (days >= 5) reqLead = 200;
    else if (days === 3 || days === 4) reqLead = 150;
    else if (days === 2) reqLead = 100;
    else reqLead = 75;

    if (lead >= reqLead) {
      enforceFollowOn = confirm(`🏏 ICC Test Follow-On Rule Activated!\nLead is ${lead} runs (Req: ${reqLead}).\nDo you want to ENFORCE FOLLOW-ON on ${currentMatchData.currentInnings.batting_team}?`);
    }
  }

  if (!confirm("Are you sure you want to officially declare/end this innings?")) return;

  isEndingInnings = true;
  try {
    const res = await fetch(`/api/matches/${currentMatchId}/end-innings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enforceFollowOn, deviceKey: getOrCreateDeviceKey() })
    });
    const data = await res.json();
    selectedInningsView = data.match.current_innings;
    handleServerUpdate(data);
  } finally {
    isEndingInnings = false;
  }
}

// DLS METHOD WITH INSTANT RE-CALCULATION
async function triggerDLSModal() {
  const oversLost = prompt("Enter total overs lost due to rain interruption:", "5");
  if (!oversLost) return;
  const wickets = prompt("Enter wickets fallen at interruption:", "2");

  try {
    const res = await fetch(`/api/matches/${currentMatchId}/dls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        oversLost, 
        wicketsAtStoppage: wickets || 0,
        deviceKey: getOrCreateDeviceKey()
      })
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || "DLS Error");
      return;
    }

    const data = await res.json();
    alert(`🌧️ DLS Applied! Revised Target: ${data.target} runs.`);
    handleServerUpdate(data.state);
  } catch (err) {
    console.error("DLS Error:", err);
  }
}

function selectScorecardInnings(innNum) {
  selectedInningsView = innNum;
  renderScorecardTables();
}

function renderScorecardTables() {
  if (!currentMatchData || !currentMatchData.inningsDetails) return;

  const targetInnData = currentMatchData.inningsDetails.find(i => i.innings.innings_number === selectedInningsView) || currentMatchData.inningsDetails[0];
  if (!targetInnData) return;

  const pillContainer = document.getElementById('inningsPillContainer');
  pillContainer.innerHTML = '';
  currentMatchData.inningsDetails.forEach(innObj => {
    const isCurrent = innObj.innings.innings_number === selectedInningsView;
    const isLive = innObj.innings.innings_number === currentMatchData.match.current_innings && currentMatchData.match.status === 'LIVE';
    
    pillContainer.innerHTML += `
      <button type="button" onclick="selectScorecardInnings(${innObj.innings.innings_number})" 
        class="px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${isCurrent ? 'bg-emerald-600 text-white shadow-lg' : 'glass-inner text-gray-400 hover:text-white'}">
        <span>Inn ${innObj.innings.innings_number}: ${innObj.innings.batting_team}</span>
        <span class="ml-1 opacity-90">(${innObj.innings.total_runs}/${innObj.innings.wickets} in ${innObj.innings.overs}.${innObj.innings.balls} ov)</span>
        ${isLive ? '<span class="ml-1 px-1.5 py-0.5 rounded bg-red-600 text-[10px] text-white animate-pulse">LIVE</span>' : ''}
      </button>
    `;
  });

  const batTable = document.getElementById('battingTable');
  batTable.innerHTML = '';
  if (targetInnData.batsmen.length === 0) {
    batTable.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-gray-500 text-xs">No batting data yet for this innings</td></tr>`;
  } else {
    targetInnData.batsmen.forEach(b => {
      const sr = b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0";
      batTable.innerHTML += `
        <tr class="border-b border-gray-800">
          <td class="p-3 font-semibold">
            <span class="cursor-pointer text-emerald-400 hover:underline" onclick="openPlayerProfileModal('${b.player_name}')">${b.player_name}</span>
            ${b.is_out ? `<span class="text-xs text-red-400 ml-1">(${b.dismissal_info})</span>` : '<span class="text-xs text-emerald-400 font-bold ml-1">*not out</span>'}
          </td>
          <td class="p-3 font-bold">${b.runs}</td>
          <td class="p-3">${b.balls}</td>
          <td class="p-3">${b.fours}</td>
          <td class="p-3">${b.sixes}</td>
          <td class="p-3 text-gray-400">${sr}</td>
        </tr>
      `;
    });
  }

  const bowlTable = document.getElementById('bowlingTable');
  bowlTable.innerHTML = '';
  if (targetInnData.bowlers.length === 0) {
    bowlTable.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-gray-500 text-xs">No bowling data yet for this innings</td></tr>`;
  } else {
    targetInnData.bowlers.forEach(bw => {
      const o = `${Math.floor(bw.balls / 6)}.${bw.balls % 6}`;
      const econ = bw.balls > 0 ? ((bw.runs_conceded / bw.balls) * 6).toFixed(2) : "0.00";
      bowlTable.innerHTML += `
        <tr class="border-b border-gray-800">
          <td class="p-3 font-semibold">
            <span class="cursor-pointer text-purple-400 hover:underline" onclick="openPlayerProfileModal('${bw.player_name}')">${bw.player_name}</span>
          </td>
          <td class="p-3">${o}</td>
          <td class="p-3">${bw.runs_conceded}</td>
          <td class="p-3 font-bold">${bw.wickets}</td>
          <td class="p-3 text-gray-400">${econ}</td>
        </tr>
      `;
    });
  }
}

// -------------------------------------------------------------
// MAIN STATE SYNC & LIVE VISUAL STRIKE INDICATOR
// -------------------------------------------------------------
function handleServerUpdate(state) {
  currentMatchData = state;
  const { match, currentInnings, testSessionData, currentOverDeliveries, overCompleted, lastCompletedBowler, shouldPromptInningsBreak, matchWon, inningsDeductionAlert } = state;

  document.getElementById('matchHeaderDetails').innerText = `${match.team1} vs ${match.team2} | ${match.format_name} (${match.match_type})`;
  
  const venueEl = document.getElementById('matchHeaderVenue');
  if (match.match_type === 'OFFICIAL' && match.venue) {
    venueEl.classList.remove('hidden');
    venueEl.innerText = `📍 ${match.venue} ${match.match_datetime ? `| 🕒 ${new Date(match.match_datetime).toLocaleString()}` : ''}`;
  } else {
    venueEl.classList.add('hidden');
  }

  const tourneyBackBox = document.getElementById('tournamentBackBtnBox');
  if (match.tournament_id) {
    activeTournamentId = match.tournament_id;
    tourneyBackBox.classList.remove('hidden');
  } else {
    tourneyBackBox.classList.add('hidden');
  }

  document.getElementById('currentBattingTeam').innerText = `${currentInnings.batting_team} - Innings ${match.current_innings}`;
  document.getElementById('scoreRuns').innerText = currentInnings.total_runs;
  document.getElementById('scoreWickets').innerText = currentInnings.wickets;
  document.getElementById('scoreOvers').innerText = `${currentInnings.overs}.${currentInnings.balls}`;

  const maxWickets = Math.max(1, match.players_count - 1);
  document.getElementById('playersMaxInfo').innerText = `(${match.players_count} players/side | All-Out at ${maxWickets} wkts)`;

  const totalBalls = (currentInnings.overs * 6) + currentInnings.balls;
  const crr = totalBalls > 0 ? ((currentInnings.total_runs / totalBalls) * 6).toFixed(2) : "0.00";
  document.getElementById('scoreCRR').innerText = crr;

  renderThisOverTimeline(currentInnings.overs + 1, currentOverDeliveries);

  // AUTH CHECK: Master Device Scorer vs Spectator
  const isMaster = isDeviceMasterAuthorized(match);
  const authBadge = document.getElementById('scorerAuthHeaderBadge');

  if (isMaster && match.status === 'LIVE') {
    document.getElementById('scorerControlPanel').classList.remove('hidden');
    document.getElementById('viewerNotice').classList.add('hidden');
    authBadge.innerHTML = `
      <span class="px-2.5 py-1 rounded bg-emerald-950 border border-emerald-500 text-emerald-400 text-[10px] font-black uppercase">🟢 Scorer Device</span>
    `;
  } else {
    document.getElementById('scorerControlPanel').classList.add('hidden');
    document.getElementById('viewerNotice').classList.remove('hidden');
    authBadge.innerHTML = `
      <div class="flex items-center space-x-2">
        <span class="px-2.5 py-1 rounded bg-blue-950 border border-blue-500 text-blue-400 text-[10px] font-black uppercase">👀 Spectator Mode</span>
        <button type="button" onclick="claimScorerControlOnThisDevice()" class="px-2.5 py-1 rounded bg-emerald-700 text-white text-[10px] font-bold">Claim Scoring</button>
      </div>
    `;
  }

  // POPULATE & RESTORE PLAYERS
  if (match.match_type === 'OFFICIAL') {
    document.getElementById('strikerInput').classList.add('hidden');
    document.getElementById('nonStrikerInput').classList.add('hidden');
    document.getElementById('bowlerInput').classList.add('hidden');

    document.getElementById('strikerSelect').classList.remove('hidden');
    document.getElementById('nonStrikerSelect').classList.remove('hidden');
    document.getElementById('bowlerSelect').classList.remove('hidden');

    const battingSquad = currentInnings.batting_team === match.team1 ? state.team1Squad : state.team2Squad;
    const bowlingSquad = currentInnings.bowling_team === match.team1 ? state.team1Squad : state.team2Squad;

    populateSelect('strikerSelect', battingSquad);
    populateSelect('nonStrikerSelect', battingSquad);
    populateSelect('bowlerSelect', bowlingSquad);
  } else {
    document.getElementById('strikerInput').classList.remove('hidden');
    document.getElementById('nonStrikerInput').classList.remove('hidden');
    document.getElementById('bowlerInput').classList.remove('hidden');

    document.getElementById('strikerSelect').classList.add('hidden');
    document.getElementById('nonStrikerSelect').classList.add('hidden');
    document.getElementById('bowlerSelect').classList.add('hidden');
  }

  // Restore active values
  if (match.active_striker) {
    if (document.getElementById('strikerInput')) document.getElementById('strikerInput').value = match.active_striker;
    if (document.getElementById('strikerSelect')) document.getElementById('strikerSelect').value = match.active_striker;
  }
  if (match.active_non_striker) {
    if (document.getElementById('nonStrikerInput')) document.getElementById('nonStrikerInput').value = match.active_non_striker;
    if (document.getElementById('nonStrikerSelect')) document.getElementById('nonStrikerSelect').value = match.active_non_striker;
  }
  if (match.active_bowler) {
    if (document.getElementById('bowlerInput')) document.getElementById('bowlerInput').value = match.active_bowler;
    if (document.getElementById('bowlerSelect')) document.getElementById('bowlerSelect').value = match.active_bowler;
  }

  const strikerCard = document.getElementById('strikerCardBox');
  const nonStrikerCard = document.getElementById('nonStrikerCardBox');
  if (strikerCard && nonStrikerCard) {
    strikerCard.className = "glass-inner p-3.5 rounded-xl relative border-2 border-emerald-500 shadow-lg bg-emerald-950/20";
    nonStrikerCard.className = "glass-inner p-3.5 rounded-xl relative border border-gray-700 opacity-90";
  }

  const totalDeliveriesInInnings = (currentInnings.overs * 6) + currentInnings.balls;
  const isOngoingInnings = totalDeliveriesInInnings > 0;

  if (isOngoingInnings && match.active_striker && match.active_non_striker) {
    document.getElementById('strikerInput').disabled = true;
    document.getElementById('nonStrikerInput').disabled = true;
    document.getElementById('strikerSelect').disabled = true;
    document.getElementById('nonStrikerSelect').disabled = true;
    document.getElementById('creaseLockBadge').innerText = "🔒 In Play";
    document.getElementById('creaseLockBadge').className = "text-[10px] font-bold px-2 py-0.5 rounded bg-blue-900/50 text-blue-300";
  } else {
    document.getElementById('strikerInput').disabled = false;
    document.getElementById('nonStrikerInput').disabled = false;
    document.getElementById('strikerSelect').disabled = false;
    document.getElementById('nonStrikerSelect').disabled = false;
    document.getElementById('creaseLockBadge').innerText = "🟢 Ready";
    document.getElementById('creaseLockBadge').className = "text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300";
  }

  const isBowlerLocked = (isOngoingInnings && currentInnings.balls > 0);
  document.getElementById('bowlerInput').disabled = isBowlerLocked;
  document.getElementById('bowlerSelect').disabled = isBowlerLocked;

  const sessionBanner = document.getElementById('testSessionLiveStatus');
  if (match.match_type_category === 'TEST' && testSessionData) {
    sessionBanner.classList.remove('hidden');
    sessionBanner.innerText = `Day ${match.test_current_day} | Session ${testSessionData.session} (${testSessionData.sessionOversLeft} ov left in session | ${testSessionData.dayOversLeft} ov left today)${match.follow_on_enforced ? ' [FOLLOW-ON]' : ''}`;
    if (inningsDeductionAlert) {
      alert(`Innings Break in Test Match: 2 overs deducted from session quota.`);
    }
  } else {
    sessionBanner.classList.add('hidden');
  }

  const targetBanner = document.getElementById('targetBanner');
  const rrrBox = document.getElementById('rrrBox');
  if (currentInnings.target && match.match_type_category !== 'TEST') {
    targetBanner.classList.remove('hidden');
    targetBanner.innerText = `Target: ${currentInnings.target} | Need ${Math.max(0, currentInnings.target - currentInnings.total_runs)} runs to win`;

    const remainingBalls = Math.max(0, (match.total_overs * 6) - totalBalls);
    if (remainingBalls > 0) {
      const rrr = (((currentInnings.target - currentInnings.total_runs) / remainingBalls) * 6).toFixed(2);
      rrrBox.classList.remove('hidden');
      document.getElementById('scoreRRR').innerText = rrr;
    } else {
      rrrBox.classList.add('hidden');
    }
  } else {
    targetBanner.classList.add('hidden');
    rrrBox.classList.add('hidden');
  }

  if (match.is_free_hit === 1) document.getElementById('freeHitBanner').classList.remove('hidden');
  else document.getElementById('freeHitBanner').classList.add('hidden');

  if (matchWon) {
    alert(`🎉 MATCH OVER! ${currentInnings.batting_team} won the match!`);
    return;
  }

  if (shouldPromptInningsBreak && match.current_innings === 1) {
    alert("Innings quota / wickets reached! Click 'End Innings' to begin 2nd Innings.");
  }

  if (overCompleted && isMaster) {
    lastOverBowler = lastCompletedBowler;
    setTimeout(() => {
      const bowlingTeam = currentInnings.bowling_team;
      const isTeam1 = bowlingTeam === match.team1;
      const registeredSquad = isTeam1 ? state.team1Squad : state.team2Squad;

      let msg = `Over completed! ${lastOverBowler} cannot bowl consecutive overs. Enter next bowler name:`;
      if (registeredSquad.length >= match.players_count) {
        msg = `Over completed! Choose next bowler from squad (${registeredSquad.filter(p => p !== lastOverBowler).join(', ')}):`;
      }

      const nextBowler = prompt(msg);
      if (nextBowler) {
        if (match.match_type === 'OFFICIAL') document.getElementById('bowlerSelect').value = nextBowler.trim();
        else document.getElementById('bowlerInput').value = nextBowler.trim();
      }
    }, 100);
  }

  renderScorecardTables();
  renderCommentaryFeed();
}

function returnToActiveTournament() {
  if (activeTournamentId) {
    navigateToScreen('screen-tournaments');
    const sel = document.getElementById('tourneySelector');
    if (sel) {
      sel.value = activeTournamentId;
      fetchTournamentDetails(activeTournamentId);
    }
  } else {
    navigateToScreen('screen-tournaments');
  }
}

// -------------------------------------------------------------
// PLAYER CAREER PROFILE POPUP
// -------------------------------------------------------------
async function openPlayerProfileModal(playerName) {
  if (!playerName) return;
  const res = await fetch(`/api/players/${encodeURIComponent(playerName)}/profile`);
  const data = await res.json();

  document.getElementById('profilePlayerName').innerText = data.player.name;
  document.getElementById('profileInitial').innerText = data.player.name.charAt(0).toUpperCase();
  document.getElementById('profileRole').innerText = data.player.role || 'All-Rounder';

  const b = data.batting;
  document.getElementById('profileBattingGrid').innerHTML = `
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Matches</span><span class="text-base font-black text-white">${b.matches}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Innings</span><span class="text-base font-black text-white">${b.innings}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-yellow-400 block uppercase">Runs</span><span class="text-base font-black text-yellow-400">${b.runs}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Highest</span><span class="text-base font-black text-white">${b.high_score}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Average</span><span class="text-base font-black text-emerald-400">${b.average}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Strike Rate</span><span class="text-base font-black text-emerald-400">${b.strike_rate}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">50s / 100s</span><span class="text-base font-black text-white">${b.fifties} / ${b.hundreds}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">4s / 6s</span><span class="text-base font-black text-white">${b.fours} / ${b.sixes}</span></div>
  `;

  const bw = data.bowling;
  document.getElementById('profileBowlingGrid').innerHTML = `
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Innings</span><span class="text-base font-black text-white">${bw.innings}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Overs</span><span class="text-base font-black text-white">${bw.overs}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-purple-400 block uppercase">Wickets</span><span class="text-base font-black text-purple-400">${bw.wickets}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Economy</span><span class="text-base font-black text-emerald-400">${bw.economy}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Average</span><span class="text-base font-black text-white">${bw.average}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Runs Given</span><span class="text-base font-black text-white">${bw.runs_conceded}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">Maidens</span><span class="text-base font-black text-white">${bw.maidens}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-gray-400 block uppercase">3w / 5w</span><span class="text-base font-black text-white">${bw.three_fers} / ${bw.five_fers}</span></div>
  `;

  const f = data.fielding;
  document.getElementById('profileFieldingGrid').innerHTML = `
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-blue-400 block uppercase">Catches</span><span class="text-base font-black text-white">${f.catches}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-blue-400 block uppercase">Run Outs</span><span class="text-base font-black text-white">${f.runouts}</span></div>
    <div class="glass-inner p-3 rounded-xl"><span class="text-[10px] text-blue-400 block uppercase">Stumpings</span><span class="text-base font-black text-white">${f.stumpings}</span></div>
  `;

  const recList = document.getElementById('profileRecentMatchesList');
  recList.innerHTML = '';
  if (data.recentMatches.length === 0) {
    recList.innerHTML = '<div class="text-gray-500 p-2">No past matches recorded yet.</div>';
  } else {
    data.recentMatches.forEach(m => {
      recList.innerHTML += `
        <div class="glass-inner p-3 rounded-xl flex justify-between items-center border border-gray-800">
          <div>
            <div class="font-extrabold text-white">${m.team1} vs ${m.team2}</div>
            <div class="text-[10px] text-gray-400">${m.format_name} | ${new Date(m.created_at).toLocaleDateString()}</div>
          </div>
          <div class="text-right mono">
            <span class="text-yellow-400 font-bold block">${m.batter_runs} runs (${m.batter_balls}b)</span>
            <span class="text-purple-400 font-semibold text-[11px]">${m.bowler_wickets} wkts (${m.bowler_runs}r)</span>
          </div>
        </div>
      `;
    });
  }

  document.getElementById('playerProfileModal').classList.remove('hidden');
}

function closePlayerProfileModal() {
  document.getElementById('playerProfileModal').classList.add('hidden');
}

// -------------------------------------------------------------
// THIS OVER TIMELINE RENDERER
// -------------------------------------------------------------
function renderThisOverTimeline(overNum, deliveries) {
  const container = document.getElementById('thisOverTimeline');
  document.getElementById('thisOverNum').innerText = `Over ${overNum}`;

  if (!deliveries || deliveries.length === 0) {
    container.innerHTML = `<span class="text-xs text-gray-500">Over in progress...</span>`;
    document.getElementById('thisOverSummary').innerText = `0 runs`;
    return;
  }

  let runsInOver = 0;
  container.innerHTML = '';

  deliveries.forEach(d => {
    const runs = d.runs_batter + d.extra_runs;
    runsInOver += runs;

    let badgeClass = "bg-gray-800 text-gray-200 border-gray-700";
    let badgeText = `${d.runs_batter}`;

    if (d.is_wicket) {
      badgeClass = "bg-red-600 text-white font-black border-red-500 shadow-md";
      badgeText = "W";
    } else if (d.runs_batter === 4) {
      badgeClass = "bg-blue-600 text-white font-black border-blue-500 shadow";
      badgeText = "4";
    } else if (d.runs_batter === 6) {
      badgeClass = "bg-emerald-600 text-white font-black border-emerald-500 shadow";
      badgeText = "6";
    } else if (d.extra_type === 'WIDE') {
      badgeClass = "bg-yellow-600 text-white font-bold border-yellow-500";
      badgeText = "Wd";
    } else if (d.extra_type === 'NO_BALL') {
      badgeClass = "bg-yellow-700 text-white font-bold border-yellow-600";
      badgeText = "Nb";
    } else if (d.extra_type === 'BYE') {
      badgeClass = "bg-indigo-600 text-white font-bold";
      badgeText = `${d.extra_runs}B`;
    } else if (d.extra_type === 'LEG_BYE') {
      badgeClass = "bg-indigo-700 text-white font-bold";
      badgeText = `${d.extra_runs}Lb`;
    }

    container.innerHTML += `
      <div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-bold border ${badgeClass}">
        ${badgeText}
      </div>
    `;
  });

  document.getElementById('thisOverSummary').innerText = `${runsInOver} runs`;
}

// COMMENTARY (DESCENDING)
function renderCommentaryFeed() {
  if (!currentMatchData || !currentMatchData.inningsDetails) return;

  const comm = document.getElementById('commList');
  comm.innerHTML = '';
  
  let allDeliveries = [];
  currentMatchData.inningsDetails.forEach(innObj => {
    allDeliveries = allDeliveries.concat(innObj.deliveries);
  });

  allDeliveries.sort((a, b) => b.id - a.id);

  document.getElementById('commCount').innerText = `${allDeliveries.length} Deliveries`;

  if (allDeliveries.length === 0) {
    comm.innerHTML = `<div class="text-center text-gray-500 text-xs py-8">Match started. Ball-by-ball commentary will appear here once the first ball is bowled.</div>`;
    return;
  }

  allDeliveries.forEach(d => {
    comm.innerHTML += `
      <div class="p-3.5 glass-inner rounded-xl border-l-4 ${d.is_wicket ? 'border-red-500 bg-red-950/40 text-red-200' : (d.runs_batter >= 4 ? 'border-emerald-500 bg-emerald-950/30 text-emerald-200 font-bold' : 'border-gray-700')} text-xs sm:text-sm delivery-card-anim">
        <div class="flex justify-between items-center text-[10px] text-gray-400 mb-1">
          <span>Innings ${d.innings_number} | Over ${d.over_num}.${d.ball_num}</span>
          <span>${d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : ''}</span>
        </div>
        <div>${d.commentary}</div>
      </div>
    `;
  });
}

function populateSelect(elemId, list) {
  const el = document.getElementById(elemId);
  if (el) {
    el.innerHTML = '<option value="">-- Choose Player --</option>' + list.map(item => `<option value="${item}">${item}</option>`).join('');
  }
}

function switchMainTab(tabId) {
  document.getElementById('tab-scorecard').classList.add('hidden');
  document.getElementById('tab-commentary').classList.add('hidden');
  document.getElementById(tabId).classList.remove('hidden');

  document.getElementById('btn-tab-scorecard').className = 'px-8 py-4 font-bold text-xs tracking-wider text-gray-400 hover:text-white transition-all';
  document.getElementById('btn-tab-commentary').className = 'px-8 py-4 font-bold text-xs tracking-wider text-gray-400 hover:text-white transition-all';

  document.getElementById(`btn-${tabId}`).className = 'px-8 py-4 font-black text-xs tracking-wider border-b-2 border-emerald-500 text-emerald-400';

  if (tabId === 'tab-commentary') renderCommentaryFeed();
  else renderScorecardTables();
}

// -------------------------------------------------------------
// APP SCREENS LOGIC & DATA LOADERS
// -------------------------------------------------------------
async function loadHomeLiveMatches() {
  const res = await fetch('/api/matches/recent');
  const matches = await res.json();
  const liveMatches = matches.filter(m => m.status === 'LIVE');
  
  const container = document.getElementById('homeLiveList');
  document.getElementById('homeLiveCount').innerText = `${liveMatches.length} Live Matches`;

  if (liveMatches.length === 0) {
    container.innerHTML = `<div class="text-xs text-gray-500 p-4">No active live matches right now.</div>`;
    return;
  }

  container.innerHTML = '';
  liveMatches.forEach(m => {
    container.innerHTML += `
      <div class="glass-inner p-4 rounded-xl space-y-2 border">
        <div class="flex justify-between items-center text-xs">
          <span class="font-bold text-emerald-400">${m.format_name}</span>
          <span class="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-bold animate-pulse">LIVE</span>
        </div>
        <div class="text-base font-extrabold">${m.team1} vs ${m.team2}</div>
        <div class="text-xs text-gray-400">${m.venue ? `📍 ${m.venue}` : ''} | Toss: ${m.toss_winner} (${m.toss_decision})</div>
        <button onclick="loadExistingMatch('${m.id}')" class="btn-primary w-full py-2 rounded-lg text-xs font-bold mt-2">Score / Watch Live</button>
      </div>
    `;
  });
}

async function loadRecentMatchesPortal() {
  const res = await fetch('/api/matches/recent');
  const matches = await res.json();
  const container = document.getElementById('recentMatchesGrid');
  container.innerHTML = '';

  if (matches.length === 0) {
    container.innerHTML = `<div class="text-xs text-gray-500 p-4">No match records found.</div>`;
    return;
  }

  matches.forEach(m => {
    container.innerHTML += `
      <div class="glass-panel p-5 rounded-2xl space-y-3 border hover:border-emerald-500 transition-all">
        <div class="flex justify-between items-center text-xs">
          <span class="font-bold text-emerald-400 uppercase">${m.format_name} (${m.match_type_category})</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${m.status === 'LIVE' ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-gray-300'}">${m.status}</span>
        </div>
        <div class="text-lg font-black">${m.team1} vs ${m.team2}</div>
        <div class="text-xs text-yellow-400 font-semibold">${m.result_desc || 'Match In Progress'}</div>
        <div class="text-[11px] text-gray-400">${m.venue ? `📍 ${m.venue}` : ''} | ${new Date(m.created_at).toLocaleDateString()}</div>
        <button onclick="loadExistingMatch('${m.id}')" class="btn-primary w-full py-2.5 rounded-xl text-xs font-bold">Open Full Scorecard</button>
      </div>
    `;
  });
}

async function loadExistingMatch(matchId) {
  currentMatchId = matchId;
  const res = await fetch(`/api/matches/${matchId}`);
  const data = await res.json();

  socket.on(`match_${currentMatchId}`, (state) => handleServerUpdate(state));
  navigateToScreen('screen-scoring');
  handleServerUpdate(data);
}

// TOURNAMENT MODULE LOGIC
async function loadTournamentListDropdown() {
  const res = await fetch('/api/tournaments');
  const list = await res.json();
  const select = document.getElementById('tourneySelector');
  const linkSelect = document.getElementById('matchTournamentLink');

  select.innerHTML = '<option value="">-- Choose League / Tournament --</option>';
  linkSelect.innerHTML = '<option value="">-- Standalone Match --</option>';

  list.forEach(t => {
    select.innerHTML += `<option value="${t.id}">${t.name}</option>`;
    linkSelect.innerHTML += `<option value="${t.id}">${t.name}</option>`;
  });

  if (list.length > 0) {
    select.value = list[0].id;
    fetchTournamentDetails(list[0].id);
  }
}

async function createNewTournamentPrompt() {
  const name = prompt("Enter Tournament Name (e.g. ICC T20 Premier League 2026):");
  if (!name) return;
  const teamsInput = prompt("Enter Participating Teams (Comma-separated, e.g. India, Australia, England, South Africa):", "India, Australia, England, South Africa");
  if (!teamsInput) return;
  const overs = prompt("Overs per league match:", "20");

  const res = await fetch('/api/tournaments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      name, 
      teams: teamsInput, 
      oversPerMatch: overs || 20, 
      deviceKey: getOrCreateDeviceKey() 
    })
  });

  const data = await res.json();
  alert(`Tournament '${data.name}' Created with ${data.teamsCount} Teams & Automated League Fixtures!`);
  loadTournamentListDropdown();
}

async function fetchTournamentDetails(tId) {
  if (!tId) {
    document.getElementById('activeTourneyView').classList.add('hidden');
    return;
  }

  activeTournamentId = tId;
  document.getElementById('activeTourneyView').classList.remove('hidden');

  const res = await fetch(`/api/tournaments/${tId}`);
  const data = await res.json();

  const standingsBody = document.getElementById('tourneyStandingsBody');
  standingsBody.innerHTML = '';
  data.standings.forEach((s, idx) => {
    standingsBody.innerHTML += `
      <tr class="border-b border-gray-800 ${idx === 0 ? 'bg-yellow-950/20 font-bold' : ''}">
        <td class="p-3 font-bold">${idx + 1}</td>
        <td class="p-3 font-extrabold text-emerald-400">${s.team}</td>
        <td class="p-3">${s.played}</td>
        <td class="p-3 text-green-400">${s.won}</td>
        <td class="p-3 text-red-400">${s.lost}</td>
        <td class="p-3">${s.tied}</td>
        <td class="p-3 ${parseFloat(s.nrr) >= 0 ? 'text-green-400' : 'text-red-400'}">${s.nrr}</td>
        <td class="p-3 font-black text-yellow-400">${s.points}</td>
      </tr>
    `;
  });

  const fixturesContainer = document.getElementById('tourneyFixturesList');
  fixturesContainer.innerHTML = '';
  data.matches.forEach(m => {
    fixturesContainer.innerHTML += `
      <div class="glass-inner p-4 rounded-xl space-y-2 border">
        <div class="flex justify-between items-center text-xs">
          <span class="font-bold text-gray-400">${m.format_name}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${m.status === 'LIVE' ? 'bg-red-600 text-white animate-pulse' : (m.status === 'COMPLETED' ? 'bg-gray-800 text-green-400' : 'bg-blue-900/50 text-blue-300')}">${m.status}</span>
        </div>
        <div class="text-sm font-black">${m.team1} vs ${m.team2}</div>
        <div class="text-xs text-yellow-400">${m.result_desc || 'Scheduled Fixture'}</div>
        <button onclick="loadExistingMatch('${m.id}')" class="btn-primary w-full py-1.5 rounded-lg text-xs font-bold mt-1">
          ${m.status === 'COMPLETED' ? 'View Scorecard' : 'Start / Score Match'}
        </button>
      </div>
    `;
  });

  const statsRes = await fetch(`/api/tournaments/${tId}/stats`);
  const stats = await statsRes.json();

  const oCap = document.getElementById('tourneyOrangeCap');
  oCap.innerHTML = stats.topBatsmen.length === 0 ? '<div class="text-gray-500">No batting records yet</div>' : '';
  stats.topBatsmen.forEach((b, i) => {
    oCap.innerHTML += `
      <div class="flex justify-between items-center border-b border-gray-800 pb-1.5">
        <span class="cursor-pointer text-emerald-400 hover:underline" onclick="openPlayerProfileModal('${b.player_name}')"><b>${i + 1}. ${b.player_name}</b> <span class="text-gray-400 text-[10px]">(${b.team_name})</span></span>
        <span class="font-extrabold text-yellow-400">${b.total_runs} <span class="text-[10px] text-gray-400 font-normal">(${b.total_balls}b, SR:${b.strike_rate})</span></span>
      </div>
    `;
  });

  const pCap = document.getElementById('tourneyPurpleCap');
  pCap.innerHTML = stats.topBowlers.length === 0 ? '<div class="text-gray-500">No bowling records yet</div>' : '';
  stats.topBowlers.forEach((bw, i) => {
    pCap.innerHTML += `
      <div class="flex justify-between items-center border-b border-gray-800 pb-1.5">
        <span class="cursor-pointer text-purple-400 hover:underline" onclick="openPlayerProfileModal('${bw.player_name}')"><b>${i + 1}. ${bw.player_name}</b> <span class="text-gray-400 text-[10px]">(${bw.team_name})</span></span>
        <span class="font-extrabold text-purple-400">${bw.total_wickets} wkts <span class="text-[10px] text-gray-400 font-normal">(Econ:${bw.economy})</span></span>
      </div>
    `;
  });

  const mvp = document.getElementById('tourneyMVP');
  mvp.innerHTML = stats.mvpList.length === 0 ? '<div class="text-gray-500">No player points yet</div>' : '';
  stats.mvpList.forEach((m, i) => {
    mvp.innerHTML += `
      <div class="flex justify-between items-center border-b border-gray-800 pb-1.5">
        <span class="cursor-pointer text-emerald-400 hover:underline" onclick="openPlayerProfileModal('${m.player_name}')"><b>${i + 1}. ${m.player_name}</b></span>
        <span class="font-extrabold text-emerald-400">${m.mvpPoints} pts <span class="text-[10px] text-gray-400 font-normal">(${m.runs}r, ${m.wickets}w, ${m.fielding}f)</span></span>
      </div>
    `;
  });
}

// Initial Screen Navigation
navigateToScreen('screen-home');