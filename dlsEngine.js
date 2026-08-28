// Standard ICC DLS Standard Edition Resource Table Reference Model
function getResourceRemaining(oversLeft, wicketsLost, totalOvers) {
  if (oversLeft <= 0 || wicketsLost >= 10) return 0.0;
  
  // Exponential decay weights based on wickets lost (0 to 10)
  const wicketWeights = [1.0, 0.934, 0.851, 0.749, 0.626, 0.487, 0.345, 0.218, 0.116, 0.047, 0.0];
  const w = wicketWeights[Math.min(Math.max(0, wicketsLost), 10)];
  const maxOvers = Math.max(1, totalOvers || 50);
  const frac = Math.min(Math.max(0, oversLeft) / maxOvers, 1.0);
  
  return (w * 100) * Math.pow(frac, 0.52);
}

/**
 * ICC Dynamic DLS Engine
 * Handles both Innings 1 and Innings 2 interruptions.
 */
function calculateAdvancedDLS({
  interruptedInnings = 2,
  totalOvers = 20,
  team1FinalRuns = 0,
  team1OversBatted = 20,
  team1WicketsLost = 0,
  team2RevisedOvers = 20,
  team2CurrentOvers = 0,
  team2CurrentWickets = 0,
  g50 = 245 // Standard G50 benchmark for limited overs
}) {
  const origOvers = parseInt(totalOvers) || 20;
  const inn = parseInt(interruptedInnings) || 2;

  // Innings 1 was interrupted / shortened
  if (inn === 1) {
    const t1OversLeftAtInterruption = Math.max(0, origOvers - team1OversBatted);
    const r1Lost = getResourceRemaining(t1OversLeftAtInterruption, team1WicketsLost, origOvers);
    const r1Total = 100.0 - r1Lost;

    // Team 2 gets revised overs
    const r2Total = 100.0 - getResourceRemaining(origOvers - team2RevisedOvers, 0, origOvers);

    if (r2Total < r1Total) {
      // Team 2 has fewer resources
      const target = Math.floor(team1FinalRuns * (r2Total / r1Total)) + 1;
      return { target: Math.max(1, target), r1: r1Total.toFixed(1), r2: r2Total.toFixed(1), parScore: target - 1 };
    } else {
      // Team 2 has equal or more resources
      const target = Math.floor(team1FinalRuns + ((r2Total - r1Total) / 100.0) * g50) + 1;
      return { target: Math.max(1, target), r1: r1Total.toFixed(1), r2: r2Total.toFixed(1), parScore: target - 1 };
    }
  }

  // Innings 2 Interrupted (Match shortened during chase)
  const r1Total = 100.0; // Team 1 used complete resources
  const t2OversRemaining = Math.max(0, team2RevisedOvers - team2CurrentOvers);
  const r2Lost = getResourceRemaining(t2OversRemaining, team2CurrentWickets, origOvers);
  const r2Available = 100.0 - r2Lost;

  if (r2Available < r1Total) {
    const target = Math.floor(team1FinalRuns * (r2Available / r1Total)) + 1;
    const parScore = Math.floor(team1FinalRuns * (r2Available / r1Total));
    return { target: Math.max(1, target), r1: r1Total.toFixed(1), r2: r2Available.toFixed(1), parScore };
  } else {
    const target = Math.floor(team1FinalRuns + ((r2Available - r1Total) / 100.0) * g50) + 1;
    return { target: Math.max(1, target), r1: r1Total.toFixed(1), r2: r2Available.toFixed(1), parScore: target - 1 };
  }
}

function checkFollowOnEligibility(testDays, leadRuns) {
  const days = parseInt(testDays) || 5;
  let requiredLead = 200;
  if (days >= 5) requiredLead = 200;
  else if (days === 3 || days === 4) requiredLead = 150;
  else if (days === 2) requiredLead = 100;
  else requiredLead = 75;

  return { eligible: leadRuns >= requiredLead, leadRuns, requiredLead };
}

function getTestSessionInfo(oversPerDay, totalDayOversBowled, oversDeducted = 0) {
  const opd = Math.max(3, parseInt(oversPerDay) || 90);
  const s1Cap = Math.floor(opd / 3);
  const s2Cap = Math.floor(opd / 3);
  const s3Cap = opd - (s1Cap + s2Cap);

  const effectiveDayOvers = totalDayOversBowled + oversDeducted;
  let session = 1;
  let sessionCapacity = s1Cap;
  let sessionOversBowled = effectiveDayOvers;

  if (effectiveDayOvers < s1Cap) {
    session = 1;
    sessionCapacity = s1Cap;
    sessionOversBowled = effectiveDayOvers;
  } else if (effectiveDayOvers < (s1Cap + s2Cap)) {
    session = 2;
    sessionCapacity = s2Cap;
    sessionOversBowled = effectiveDayOvers - s1Cap;
  } else {
    session = 3;
    sessionCapacity = s3Cap;
    sessionOversBowled = effectiveDayOvers - (s1Cap + s2Cap);
  }

  const sessionOversLeft = Math.max(0, sessionCapacity - Math.floor(sessionOversBowled));
  const dayOversLeft = Math.max(0, opd - Math.floor(effectiveDayOvers));

  return { session, sessionCapacity, sessionOversLeft, dayOversLeft };
}

module.exports = { calculateAdvancedDLS, checkFollowOnEligibility, getTestSessionInfo };