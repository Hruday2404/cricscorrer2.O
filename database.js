const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'cricket.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'All-Rounder',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT DEFAULT 'LIMITED_OVERS',
    teams_json TEXT NOT NULL,
    overs_per_match INTEGER DEFAULT 20,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    tournament_id TEXT DEFAULT NULL,
    scorer_pin TEXT NOT NULL,
    match_type TEXT DEFAULT 'UNOFFICIAL',
    match_type_category TEXT NOT NULL,
    format_name TEXT NOT NULL,
    team1 TEXT NOT NULL,
    team2 TEXT NOT NULL,
    team1_squad TEXT,
    team2_squad TEXT,
    players_count INTEGER DEFAULT 11,
    total_overs INTEGER DEFAULT 20,
    overs_per_day INTEGER DEFAULT 90,
    test_days INTEGER DEFAULT 5,
    max_overs_per_bowler INTEGER DEFAULT 4,
    venue TEXT DEFAULT '',
    match_datetime TEXT DEFAULT '',
    umpires TEXT DEFAULT '',
    referee TEXT DEFAULT '',
    toss_winner TEXT,
    toss_decision TEXT,
    status TEXT DEFAULT 'LIVE',
    winner TEXT DEFAULT NULL,
    result_desc TEXT DEFAULT '',
    current_innings INTEGER DEFAULT 1,
    active_striker TEXT DEFAULT '',
    active_non_striker TEXT DEFAULT '',
    active_bowler TEXT DEFAULT '',
    last_bowler TEXT DEFAULT '',
    is_free_hit INTEGER DEFAULT 0,
    dls_applied INTEGER DEFAULT 0,
    revised_target INTEGER DEFAULT NULL,
    follow_on_enforced INTEGER DEFAULT 0,
    test_current_day INTEGER DEFAULT 1,
    test_day_overs_bowled REAL DEFAULT 0,
    test_overs_deducted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(tournament_id) REFERENCES tournaments(id)
  );

  CREATE TABLE IF NOT EXISTS innings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    innings_number INTEGER,
    batting_team TEXT,
    bowling_team TEXT,
    total_runs INTEGER DEFAULT 0,
    wickets INTEGER DEFAULT 0,
    overs INTEGER DEFAULT 0,
    balls INTEGER DEFAULT 0,
    extras_wides INTEGER DEFAULT 0,
    extras_noballs INTEGER DEFAULT 0,
    extras_byes INTEGER DEFAULT 0,
    extras_legbyes INTEGER DEFAULT 0,
    target INTEGER DEFAULT NULL,
    is_completed INTEGER DEFAULT 0,
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS batsmen_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    innings_number INTEGER,
    player_name TEXT,
    team_name TEXT,
    runs INTEGER DEFAULT 0,
    balls INTEGER DEFAULT 0,
    fours INTEGER DEFAULT 0,
    sixes INTEGER DEFAULT 0,
    is_out INTEGER DEFAULT 0,
    dismissal_info TEXT DEFAULT '',
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS bowlers_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    innings_number INTEGER,
    player_name TEXT,
    team_name TEXT,
    balls INTEGER DEFAULT 0,
    maidens INTEGER DEFAULT 0,
    runs_conceded INTEGER DEFAULT 0,
    wickets INTEGER DEFAULT 0,
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS fielders_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    player_name TEXT,
    catches INTEGER DEFAULT 0,
    runouts INTEGER DEFAULT 0,
    stumpings INTEGER DEFAULT 0,
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );

  CREATE TABLE IF NOT EXISTS deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    innings_number INTEGER,
    over_num INTEGER,
    ball_num INTEGER,
    striker TEXT,
    non_striker TEXT,
    bowler TEXT,
    runs_batter INTEGER,
    extra_runs INTEGER DEFAULT 0,
    extra_type TEXT DEFAULT NULL,
    is_wicket INTEGER DEFAULT 0,
    wicket_type TEXT DEFAULT NULL,
    dismissed_player TEXT DEFAULT NULL,
    fielder TEXT DEFAULT NULL,
    is_free_hit INTEGER DEFAULT 0,
    prev_striker TEXT,
    prev_non_striker TEXT,
    commentary TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(match_id) REFERENCES matches(id)
  );
`);

module.exports = db;