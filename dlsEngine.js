function getResourceRemaining(oversLeft, wicketsLost, totalOvers) {
  if (oversLeft <= 0 || wicketsLost >= 10) return 0.0;
  const wicketWeight = [1.0, 0.934, 0.851, 0.749, 0.626, 0.487, 0.345, 0.218, 0.116, 0.047, 0.0];
  const w = wicketWeight[Math.min(wicketsLost, 10)];
  const frac = Math.min(oversLeft / (totalOvers || 50), 1.0);
  return (w * 100) * Math.pow(frac, 0.45);
}

function calculateDLSTarget(team1Score, originalOvers, team2OversLost, wicketsAtInterruption) {
  const team2OversLeft = Math.max(0, originalOvers - team2OversLost);
  const r1 = getResourceRemaining(originalOvers, 0, originalOvers);
  const r2 = getResourceRemaining(team2OversLeft, wicketsAtInterruption, originalOvers);

  if (r2 >= r1) return team1Score + 1;
  return Math.floor(team1Score * (r2 / r1)) + 1;
}

function checkFollowOnEligibility(testDays, leadRuns) {
  const days = parseInt(testDays) || 5;
  let requiredLead = 200;
  if (days >= 5) requiredLead = 200;
  else if (days === 3 || days === 4) requiredLead = 150;
  else if (days === 2) requiredLead = 100;
  else requiredLead = 75;

  return {
    eligible: leadRuns >= requiredLead,
    leadRuns,
    requiredLead
  };
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

  return {
    session,
    sessionCapacity,
    sessionOversLeft,
    dayOversLeft
  };
}

module.exports = { calculateDLSTarget, checkFollowOnEligibility, getTestSessionInfo };