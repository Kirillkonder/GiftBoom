require('dotenv').config();
const express = require('express');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const Loki = require('lokijs');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.'));

// Для Render сохраняем базу данных в памяти
const dbPath = process.env.NODE_ENV === 'production' ? 
    path.join('/tmp', 'ton-casino.db') : 
    'ton-casino.db';

// LokiJS база данных
let db;
let users, transactions, casinoBank, casinoDemoBank, adminLogs, minesGames, rocketGames, rocketBets;

// WebSocket сервер для ракетки
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

// Глобальные переменные для игры Ракетка
let rocketGame = {
  status: 'waiting', // waiting, counting, flying, crashed
  multiplier: 1.00,
  startTime: null,
  crashPoint: null,
  players: [],
  history: [],
  timeLeft: 0,
  endBetTime: null
};

// RTP система - отслеживание доходности за день
let rtpSystem = {
  realBank: {
    dailyDeposits: 0,      // Общие депозиты за день
    dailyPayouts: 0,       // Общие выплаты за день
    currentRTP: 0,         // Текущий RTP в процентах
    targetRTP: 70,         // Целевой RTP 70%
    lastResetDate: new Date().toDateString()
  },
  demoBank: {
    dailyDeposits: 0,
    dailyPayouts: 0,
    currentRTP: 0,
    targetRTP: 70,
    lastResetDate: new Date().toDateString()
  }
};

// Боты для ракетки
const rocketBots = [
  { name: "Bot_1", minBet: 1, maxBet: 10, risk: "medium" },
  { name: "Bot_2", minBet: 5, maxBet: 20, risk: "high" },
  { name: "Bot_3", minBet: 0.5, maxBet: 5, risk: "low" }
];

// Система защиты от паттернов
let antiPatternSystem = {
    lastHighWins: 0,
    lastLowWins: 0,
    randomSeed: Math.random() * 1000
};

let lastResults = [];
let Xa = []; 
let Yb = {
    c: 0, d: 0, e: Math.random() * 1337
};

function initDatabase() {
    return new Promise((resolve) => {
        db = new Loki(dbPath, {
            autoload: true,
            autoloadCallback: () => {
                users = db.getCollection('users');
                transactions = db.getCollection('transactions');
                casinoBank = db.getCollection('casino_bank');
                casinoDemoBank = db.getCollection('casino_demo_bank');
                adminLogs = db.getCollection('admin_logs');
                minesGames = db.getCollection('mines_games');
                rocketGames = db.getCollection('rocket_games');
                rocketBets = db.getCollection('rocket_bets');

                if (!users) {
                    users = db.addCollection('users', { 
                        unique: ['telegram_id'],
                        indices: ['telegram_id']
                    });
                    
                    // Создаем администратора по умолчанию
                    users.insert({
                        telegram_id: parseInt(process.env.OWNER_TELEGRAM_ID) || 842428912,
                        main_balance: 0,
                        demo_balance: 1000,
                        created_at: new Date(),
                        demo_mode: false,
                        is_admin: true
                    });
                }
                
                if (!transactions) {
                    transactions = db.addCollection('transactions', {
                        indices: ['user_id', 'created_at', 'demo_mode']
                    });
                }

                if (!casinoBank) {
                    casinoBank = db.addCollection('casino_bank');
                    casinoBank.insert({
                        total_balance: 0,
                        owner_telegram_id: process.env.OWNER_TELEGRAM_ID || 842428912,
                        created_at: new Date(),
                        updated_at: new Date()
                    });
                }

                if (!casinoDemoBank) {
                    casinoDemoBank = db.addCollection('casino_demo_bank');
                    casinoDemoBank.insert({
                        total_balance: 10000,
                        owner_telegram_id: process.env.OWNER_TELEGRAM_ID || 842428912,
                        created_at: new Date(),
                        updated_at: new Date()
                    });
                }

                if (!adminLogs) {
                    adminLogs = db.addCollection('admin_logs', {
                        indices: ['created_at']
                    });
                }

                if (!minesGames) {
                    minesGames = db.addCollection('mines_games', {
                        indices: ['user_id', 'created_at', 'demo_mode']
                    });
                }

                if (!rocketGames) {
                    rocketGames = db.addCollection('rocket_games', {
                        indices: ['created_at', 'crashed_at']
                    });
                }

                if (!rocketBets) {
                    rocketBets = db.addCollection('rocket_bets', {
                        indices: ['game_id', 'user_id', 'created_at']
                    });
                }
                
                console.log('LokiJS database initialized');
                resolve(true);
            },
            autosave: true,
            autosaveInterval: 4000
        });
    });
}

// Функция для работы с Crypto Pay API
async function cryptoPayRequest(method, data = {}, demoMode = false) {
  try {
    const cryptoPayApi = demoMode ? 
      'https://testnet-pay.crypt.bot/api' : 
      'https://pay.crypt.bot/api';
      
    const cryptoPayToken = demoMode ?
      process.env.CRYPTO_PAY_TESTNET_TOKEN :
      process.env.CRYPTO_PAY_MAINNET_TOKEN;

    const response = await axios.post(`${cryptoPayApi}/${method}`, data, {
      headers: {
        'Crypto-Pay-API-Token': cryptoPayToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    return response.data;
  } catch (error) {
    console.error('Crypto Pay API error:', error.response?.data || error.message);
    throw error;
  }
}

// Функция логирования админских действий
function logAdminAction(action, telegramId, details = {}) {
  adminLogs.insert({
    action: action,
    telegram_id: telegramId,
    details: details,
    created_at: new Date()
  });
}

// Получить банк казино
function getCasinoBank() {
    return casinoBank.findOne({});
}

function getCasinoDemoBank() {
    return casinoDemoBank.findOne({});
}

// Обновить банк казино
function updateCasinoBank(amount) {
    const bank = getCasinoBank();
    casinoBank.update({
        ...bank,
        total_balance: bank.total_balance + amount,
        updated_at: new Date()
    });
}

function updateCasinoDemoBank(amount) {
    const bank = getCasinoDemoBank();
    casinoDemoBank.update({
        ...bank,
        total_balance: bank.total_balance + amount,
        updated_at: new Date()
    });
}

// Mines Game Functions
function generateMinesGame(minesCount) {
  const totalCells = 25;
  const mines = [];
  
  while (mines.length < minesCount) {
    const randomCell = Math.floor(Math.random() * totalCells);
    if (!mines.includes(randomCell)) {
      mines.push(randomCell);
    }
  }
  
  return {
    mines,
    minesCount,
    revealedCells: [],
    gameOver: false,
    win: false,
    currentMultiplier: 1,
    betAmount: 0
  };
}

function calculateMultiplier(openedCells, displayedMines) {
  const multipliers = {
    3: [1.00, 1.07, 1.14, 1.23, 1.33, 1.45, 1.59, 1.75, 1.95, 2.18, 2.47, 2.83, 3.28, 3.86, 4.62, 5.63, 7.00, 8.92, 11.67, 15.83, 22.50, 34.00, 56.67, 113.33],
    5: [1.00, 1.11, 1.22, 1.35, 1.50, 1.67, 1.88, 2.14, 2.45, 2.86, 3.38, 4.05, 4.95, 6.15, 7.83, 10.21, 13.68, 18.91, 27.14, 40.71, 65.14, 113.99, 227.98, 569.95],
    7: [1.00, 1.20, 1.40, 1.64, 1.92, 2.26, 2.67, 3.17, 3.80, 4.60, 5.63, 6.98, 8.75, 11.11, 14.29, 18.75, 25.00, 34.00, 47.50, 68.00, 100.00, 152.00, 240.00, 400.00]
  };

  const mineMultipliers = multipliers[displayedMines];
  
  if (mineMultipliers && openedCells < mineMultipliers.length) {
    return mineMultipliers[openedCells];
  }
  
  return mineMultipliers ? mineMultipliers[mineMultipliers.length - 1] * 2 : 1.00;
}

// Функция для сброса дневного RTP
function resetDailyRTP() {
    const today = new Date().toDateString();
    
    if (rtpSystem.realBank.lastResetDate !== today) {
        rtpSystem.realBank = {
            dailyDeposits: 0,
            dailyPayouts: 0,
            currentRTP: 0,
            targetRTP: 70,
            lastResetDate: today
        };
        
        lastResults = [];
        antiPatternSystem = {
            lastHighWins: 0,
            lastLowWins: 0,
            randomSeed: Math.random() * 1000
        };
    }
    
    if (rtpSystem.demoBank.lastResetDate !== today) {
        rtpSystem.demoBank = {
            dailyDeposits: 0,
            dailyPayouts: 0,
            currentRTP: 0,
            targetRTP: 70,
            lastResetDate: today
        };
    }
}

// Функция расчета текущего RTP
function calculateCurrentRTP(bankType) {
    const bank = rtpSystem[bankType];
    if (bank.dailyDeposits === 0) return 0;
    return (bank.dailyPayouts / bank.dailyDeposits) * 100;
}

// Функция обновления RTP статистики
function updateRTPStats(bankType, deposit, payout) {
    resetDailyRTP();
    
    const bank = rtpSystem[bankType];
    bank.dailyDeposits += deposit;
    bank.dailyPayouts += payout;
    bank.currentRTP = calculateCurrentRTP(bankType);
}

// RTP алгоритмы
function Zf() {
    return (Yb.e / 42069 + Math.random()) / 2;
}

function Wg(t) {
    if (t === 'h' && Yb.c >= 2) return true;
    if (t === 'l' && Yb.d >= 3) return true;
    return false;
}

function Vh(pt) {
    Xa.unshift(pt);
    if (Xa.length > 10) Xa.pop();
    
    if (pt >= 4.0) {
        Yb.c++; Yb.d = 0;
    } else if (pt <= 1.5) {
        Yb.d++; Yb.c = 0;
    } else {
        Yb.c = 0; Yb.d = 0;
    }
    
    Yb.e = (Yb.e * 9301 + 49297) % 233280;
}

function Ui(amt) {
    const r = Zf() * 100;
    const mb = amt <= 5.0 ? 35 : 15;
    
    if (r < mb) return Zf() * 9.8 + 25.2;
    if (r < 45) return Zf() * 14.8 + 5.2;
    if (r < 70) return Zf() * 2.5 + 2.5;
    return Zf() * 0.8 + 1.2;
}

function Tj() {
    const r = Zf() * 100;
    if (r < 25) return Zf() * 18 + 12;
    if (r < 50) return Zf() * 8 + 4;
    if (r < 75) return Zf() * 2 + 2;
    return Zf() * 0.5 + 1.5;
}

function Sk(amt) {
    if (Wg('h')) return Tj();
    
    const r = Zf() * 100;
    const bb = Yb.d * 12;
    const mb = amt <= 3.0 ? 25 : 8;
    
    if (r < mb + bb) return Zf() * 19.8 + 10.2;
    if (r < 40 + bb) return Zf() * 6 + 4;
    if (r < 70 + bb) return Zf() * 2.2 + 2.8;
    return Zf() * 0.6 + 1.4;
}

function Rj(amt) {
    const r = Zf() * 100;
    const wb = Yb.d * 8;
    const hp = Yb.c * 12;
    const mb = amt <= 2.0 ? 20 : 5;
    
    if (r < 30 - wb) return Zf() * 0.15 + 1.00;
    if (r < 50 - wb) return Zf() * 0.5 + 1.1;
    if (r < 75 - wb) return Zf() * 1.3 + 1.7;
    if (r < 88 - hp + mb) return Zf() * 3.8 + 3.2;
    return Zf() * 22.8 + 7.2;
}

function Qi(amt) {
    if (Wg('l')) return Tj();
    
    const r = Zf() * 100;
    const mb = amt <= 1.0 ? 15 : 3;
    
    if (r < 65) return Zf() * 0.15 + 1.00;
    if (r < 80) return Zf() * 0.4 + 1.0;
    if (r < 92) return Zf() * 0.6 + 1.6;
    if (r < 97 + mb) return Zf() * 2.4 + 2.6;
    return Zf() * 17.4 + 12.6;
}

function Nk(totalBet, bankBalance, rtpStats) {
    if (bankBalance < 50) {
        if (Math.random() < 0.90) {
            return Math.random() * 0.1 + 1.00;
        }
        return Math.random() * 0.3 + 1.1;
    }
    else if (bankBalance < 200) {
        if (Math.random() < 0.80) {
            return Math.random() * 0.15 + 1.00;
        }
        return Math.random() * 0.4 + 1.0;
    }
    
    const currentRTP = rtpStats.currentRTP;
    const targetRTP = rtpStats.targetRTP;
    const rtpVariance = (Math.random() - 0.5) * 10;
    const adjustedTargetRTP = targetRTP + rtpVariance;
    
    if (currentRTP < adjustedTargetRTP - 8) {
        return generateAntiPatternWinningCrashPoint(totalBet);
    }
    else if (currentRTP < adjustedTargetRTP + 3) {
        return generateAntiPatternBalancedCrashPoint(totalBet);
    }
    else {
        return generateAntiPatternLosingCrashPoint(totalBet);
    }
}

function Oj() {
    return Math.random() * 15 + 1.5;
}

function updateAntiPatternSystem(crashPoint) {
    Vh(crashPoint);
}

function getSeededRandom() {
    return Zf();
}

function shouldAvoidPattern(type) {
    return Wg(type === 'high' ? 'h' : 'l');
}

function generateRandomBotCrashPoint() {
    const random = getSeededRandom() * 100;
    
    if (random < 30) return Math.random() * 3 + 2;
    if (random < 60) return Math.random() * 4 + 5;
    if (random < 85) return Math.random() * 6 + 9;
    return Math.random() * 15 + 15;
}

function generateMiddleWinCrashPoint(totalBet) {
    const random = getSeededRandom() * 100;
    
    if (totalBet >= 0.7) {
        return Math.random() * 1.0 + 1.5;
    } else {
        return Math.random() * 1.2 + 1.4;
    }
}

function generateAntiPatternWinningCrashPoint(totalBet) {
    if (shouldAvoidPattern('high')) {
        return generateMiddleWinCrashPoint(totalBet);
    }
    
    const random = getSeededRandom() * 100;
    const bonusChance = antiPatternSystem.lastLowWins * 15;
    
    if (totalBet >= 0.7) {
        if (random < 25 + bonusChance) return Math.random() * 0.4 + 1.0;
        if (random < 55 + bonusChance) return Math.random() * 0.5 + 1.8;
        if (random < 80 + bonusChance) return Math.random() * 1.2 + 4.0;
        return Math.random() * 9.8 + 5.2;
    } else {
        if (random < 15 + bonusChance) return Math.random() * 0.4 + 1.0;
        if (random < 40 + bonusChance) return Math.random() * 0.5 + 1.8;
        if (random < 70 + bonusChance) return Math.random() * 1.2 + 4.0;
        return Math.random() * 9.8 + 5.2;
    }
}

function generateAntiPatternBalancedCrashPoint(totalBet) {
    const random = getSeededRandom() * 100;
    const winBonus = antiPatternSystem.lastLowWins * 10;
    const highWinPenalty = antiPatternSystem.lastHighWins * 15;
    
    if (totalBet >= 0.7) {
        if (random < 45 - winBonus) return Math.random() * 0.15 + 1.00;
        if (random < 65 - winBonus) return Math.random() * 0.4 + 1.0;
        if (random < 80 - winBonus) return Math.random() * 0.5 + 1.8;
        return Math.random() * 1.2 + 4.0;
    } else {
        if (random < 35 - winBonus) return Math.random() * 0.15 + 1.00;
        if (random < 55 - winBonus) return Math.random() * 0.4 + 1.0;
        if (random < 75 - winBonus) return Math.random() * 0.5 + 1.8;
        return Math.random() * 1.5 + 3.5;
    }
}

function generateAntiPatternLosingCrashPoint(totalBet) {
    const random = getSeededRandom() * 100;
    const randomBonus = antiPatternSystem.lastLowWins * 5;
    
    if (totalBet >= 0.7) {
        if (random < 70 - randomBonus) return Math.random() * 0.15 + 1.00;
        if (random < 85 - randomBonus) return Math.random() * 0.4 + 1.0;
        if (random < 95 - randomBonus) return Math.random() * 0.5 + 1.8;
        return Math.random() * 1.2 + 4.0;
    } else {
        if (random < 65 - randomBonus) return Math.random() * 0.15 + 1.00;
        if (random < 80 - randomBonus) return Math.random() * 0.4 + 1.0;
        if (random < 92 - randomBonus) return Math.random() * 0.5 + 1.8;
        return Math.random() * 1.5 + 3.5;
    }
}

function generateCrashPoint(players = []) {
    resetDailyRTP();
    
    const adminIds = [
        parseInt(process.env.OWNER_TELEGRAM_ID) || 842428912,
        1135073023
    ];
    
    const realPlayers = players.filter(p => !p.isBot && !p.demoMode);
    const realNonAdminPlayers = realPlayers.filter(p => !adminIds.includes(parseInt(p.userId)));
    const demoPlayers = players.filter(p => !p.isBot && p.demoMode);
    
    let effectivePlayers = [...players];
    if (realNonAdminPlayers.length > 0) {
        effectivePlayers = players.filter(p => p.isBot || !adminIds.includes(parseInt(p.userId)));
    }
    
    const effectiveRealPlayers = effectivePlayers.filter(p => !p.isBot && !p.demoMode);
    const effectiveDemoPlayers = effectivePlayers.filter(p => !p.isBot && p.demoMode);
    
    const totalRealBet = effectiveRealPlayers.reduce((sum, p) => sum + p.betAmount, 0);
    const totalDemoBet = effectiveDemoPlayers.reduce((sum, p) => sum + p.betAmount, 0);
    
    const realBank = getCasinoBank();
    const demoBank = getCasinoDemoBank();
    
    let crashPoint = 1.00;
    
    if (totalRealBet > 0) {
        crashPoint = Nk(totalRealBet, realBank.total_balance, rtpSystem.realBank);
    } else if (totalDemoBet > 0) {
        crashPoint = Nk(totalDemoBet, demoBank.total_balance, rtpSystem.demoBank);
    } else {
        crashPoint = Oj();
    }
    
    Vh(crashPoint);
    
    return Math.max(1.00, crashPoint);
}

// Rocket Game Main Functions
function startRocketGame() {
    if (rocketGame.status !== 'waiting') return;

    rocketGame.status = 'counting';
    rocketGame.multiplier = 1.00;
    rocketGame.startTime = Date.now();
    rocketGame.endBetTime = Date.now() + 5000;
    rocketGame.players = [];
    
    setTimeout(() => {
        rocketGame.crashPoint = generateCrashPoint(rocketGame.players);
        console.log(`Краш-поинт: ${rocketGame.crashPoint.toFixed(2)}x`);
    }, 5000);

    rocketBots.forEach(bot => {
        const betAmount = bot.minBet + Math.random() * (bot.maxBet - bot.minBet);
        const autoCashout = bot.risk === 'low' ? 2 + Math.random() * 3 : 
                           bot.risk === 'medium' ? 5 + Math.random() * 10 : 
                           10 + Math.random() * 30;
        
        rocketGame.players.push({
            name: bot.name,
            betAmount: parseFloat(betAmount.toFixed(2)),
            autoCashout: parseFloat(autoCashout.toFixed(2)),
            isBot: true,
            cashedOut: false,
            winAmount: 0
        });
    });

    rocketGame.timeLeft = 5;
    broadcastRocketUpdate();

    const syncInterval = setInterval(() => {
        if (rocketGame.status !== 'counting') {
            clearInterval(syncInterval);
            return;
        }
        
        const timeLeft = Math.max(0, Math.ceil((rocketGame.endBetTime - Date.now()) / 1000));
        rocketGame.timeLeft = timeLeft;
        broadcastRocketUpdate();
        
        if (timeLeft <= 0) {
            clearInterval(syncInterval);
            rocketGame.status = 'flying';
            broadcastRocketUpdate();
            startRocketFlight();
        }
    }, 1000);
}

function startRocketFlight() {
  const startTime = Date.now();
  let baseSpeed = 0.1;
  let acceleration = 0.05;
  
  const flightInterval = setInterval(() => {
    if (rocketGame.status !== 'flying') {
      clearInterval(flightInterval);
      return;
    }

    const elapsed = (Date.now() - startTime) / 1000;
    rocketGame.multiplier = 1.00 + (elapsed * baseSpeed * Math.exp(elapsed * acceleration));

    rocketGame.players.forEach(player => {
      if (player.isBot && !player.cashedOut && rocketGame.multiplier >= player.autoCashout) {
        player.cashedOut = true;
        player.winAmount = player.betAmount * rocketGame.multiplier;
      }
    });

    if (rocketGame.multiplier >= rocketGame.crashPoint) {
      rocketGame.status = 'crashed';
      clearInterval(flightInterval);
      processRocketGameEnd();
    }

    broadcastRocketUpdate();
  }, 100);
}

function processRocketGameEnd() {
  const gameRecord = rocketGames.insert({
    crashPoint: rocketGame.crashPoint,
    maxMultiplier: rocketGame.multiplier,
    startTime: new Date(rocketGame.startTime),
    endTime: new Date(),
    playerCount: rocketGame.players.length,
    totalBets: rocketGame.players.reduce((sum, p) => sum + p.betAmount, 0),
    totalPayouts: rocketGame.players.reduce((sum, p) => sum + (p.cashedOut ? p.winAmount : 0), 0)
  });

  rocketGame.players.forEach(player => {
    if (!player.isBot && player.cashedOut) {
      const user = users.findOne({ telegram_id: parseInt(player.userId) });
      if (user) {
        const cashoutMultiplier = player.cashoutMultiplier || rocketGame.multiplier;
        const winAmount = player.betAmount * cashoutMultiplier;
        
        if (player.demoMode) {
          users.update({
            ...user,
            demo_balance: user.demo_balance + winAmount
          });
          updateCasinoDemoBank(-winAmount);
        } else {
          users.update({
            ...user,
            main_balance: user.main_balance + winAmount
          });
          updateCasinoBank(-winAmount);
        }

        transactions.insert({
          user_id: user.$loki,
          amount: winAmount,
          type: 'rocket_win',
          status: 'completed',
          demo_mode: player.demoMode,
          game_id: gameRecord.$loki,
          created_at: new Date()
        });

        rocketBets.insert({
          game_id: gameRecord.$loki,
          user_id: user.$loki,
          bet_amount: player.betAmount,
          cashout_multiplier: cashoutMultiplier,
          win_amount: winAmount,
          demo_mode: player.demoMode,
          created_at: new Date()
        });
      }
    }
  });

  rocketGame.history.unshift({
    crashPoint: rocketGame.crashPoint,
    multiplier: rocketGame.multiplier
  });

  if (rocketGame.history.length > 50) {
    rocketGame.history.pop();
  }

  broadcastRocketUpdate();

  setTimeout(() => {
    rocketGame.status = 'waiting';
    rocketGame.multiplier = 1.00;
    rocketGame.players = [];
    broadcastRocketUpdate();
    startRocketGame();
  }, 5000);
}

function broadcastRocketUpdate() {
    const data = JSON.stringify({
        type: 'rocket_update',
        game: rocketGame
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
}

wss.on('connection', function connection(ws) {
  console.log('Rocket game client connected');
  
  ws.send(JSON.stringify({
    type: 'rocket_update',
    game: rocketGame
  }));

  ws.on('close', () => {
    console.log('Rocket game client disconnected');
  });
});

// API Routes
app.post('/api/admin/login', async (req, res) => {
    const { telegramId, password } = req.body;
    
    const allowedAdmins = [
        parseInt(process.env.OWNER_TELEGRAM_ID), 
        1135073023
    ];
    
    const isAdmin = allowedAdmins.includes(parseInt(telegramId)) && 
                   password === process.env.ADMIN_PASSWORD;

    if (isAdmin) {
        logAdminAction('admin_login', telegramId);
        res.json({ success: true, isAdmin: true });
    } else {
        res.json({ success: false, isAdmin: false });
    }
});

app.get('/api/admin/dashboard/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    const allowedAdmins = [
        parseInt(process.env.OWNER_TELEGRAM_ID), 
        1135073023
    ];
    
    if (!allowedAdmins.includes(telegramId)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const bank = getCasinoBank();
        const demoBank = getCasinoDemoBank();
        const totalUsers = users.count();
        const totalTransactions = transactions.count();
        const totalMinesGames = minesGames.count();
        const totalRocketGames = rocketGames.count();

        res.json({
            bank_balance: bank.total_balance,
            demo_bank_balance: demoBank.total_balance,
            total_users: totalUsers,
            total_transactions: totalTransactions,
            total_mines_games: totalMinesGames,
            total_rocket_games: totalRocketGames
        });
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/withdraw-profit', async (req, res) => {
    const { telegramId, amount } = req.body;

    if (telegramId !== parseInt(process.env.OWNER_TELEGRAM_ID)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const bank = getCasinoBank();
        
        if (bank.total_balance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств в банке казино' });
        }

        const transfer = await cryptoPayRequest('transfer', {
            user_id: telegramId,
            asset: 'TON',
            amount: amount.toString(),
            spend_id: `owner_withdraw_${Date.now()}`
        }, false);

        if (transfer.ok && transfer.result) {
            updateCasinoBank(-amount);
            logAdminAction('withdraw_profit', telegramId, { amount: amount });
            
            res.json({
                success: true,
                message: 'Profit withdrawn successfully',
                hash: transfer.result.hash,
                new_balance: bank.total_balance - amount
            });
        } else {
            res.status(500).json({ error: 'Withdrawal failed' });
        }
    } catch (error) {
        console.error('Withdraw profit error:', error);
        res.status(500).json({ error: 'Withdrawal error' });
    }
});

app.post('/api/admin/add-demo-balance', async (req, res) => {
    const { telegramId, targetTelegramId, amount } = req.body;

    if (telegramId !== parseInt(process.env.OWNER_TELEGRAM_ID)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const user = users.findOne({ telegram_id: parseInt(targetTelegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        users.update({
            ...user,
            demo_balance: user.demo_balance + parseFloat(amount)
        });

        logAdminAction('add_demo_balance', telegramId, {
            target_user: targetTelegramId,
            amount: amount
        });

        res.json({
            success: true,
            message: 'Demo balance added successfully',
            new_balance: user.demo_balance + parseFloat(amount)
        });
    } catch (error) {
        console.error('Add demo balance error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/transactions/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    if (telegramId !== parseInt(process.env.OWNER_TELEGRAM_ID)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const allTransactions = transactions.chain()
            .simplesort('created_at', true)
            .limit(100)
            .data()
            .map(transaction => ({
                ...transaction,
                user: users.get(transaction.user_id)
            }));

        res.json(allTransactions);
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/mines-games/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    if (telegramId !== parseInt(process.env.OWNER_TELEGRAM_ID)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const games = minesGames.chain()
            .simplesort('created_at', true)
            .limit(100)
            .data()
            .map(game => ({
                ...game,
                user: users.get(game.user_id)
            }));

        res.json(games);
    } catch (error) {
        console.error('Get mines games error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/rocket-games/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    if (telegramId !== parseInt(process.env.OWNER_TELEGRAM_ID)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const games = rocketGames.chain()
            .simplesort('startTime', true)
            .limit(100)
            .data();

        res.json(games);
    } catch (error) {
        console.error('Get rocket games error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/rocket-bets/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    if (telegramId !== parseInt(process.env.OWNER_TELEGRAM_ID)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const bets = rocketBets.chain()
            .simplesort('created_at', true)
            .limit(100)
            .data()
            .map(bet => ({
                ...bet,
                user: users.get(bet.user_id),
                game: rocketGames.get(bet.game_id)
            }));

        res.json(bets);
    } catch (error) {
        console.error('Get rocket bets error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/users/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    if (telegramId !== parseInt(process.env.OWNER_TELEGRAM_ID)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const allUsers = users.chain()
            .simplesort('created_at', true)
            .data();

        res.json(allUsers);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/create-invoice', async (req, res) => {
    const { telegramId, amount, demoMode } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const invoice = await cryptoPayRequest('createInvoice', {
            asset: 'TON',
            amount: amount.toString(),
            description: `Deposit for user ${telegramId}`,
            hidden_message: `Deposit ${amount} TON`,
            payload: JSON.stringify({
                telegram_id: telegramId,
                demo_mode: demoMode,
                amount: amount
            }),
            paid_btn_name: 'callback',
            paid_btn_url: 'https://t.me/your_bot',
            allow_comments: false
        }, demoMode);

        if (invoice.ok && invoice.result) {
            transactions.insert({
                user_id: user.$loki,
                amount: amount,
                type: 'deposit',
                status: 'pending',
                invoice_id: invoice.result.invoice_id,
                demo_mode: demoMode,
                created_at: new Date()
            });

            res.json({
                success: true,
                invoice_url: invoice.result.pay_url,
                invoice_id: invoice.result.invoice_id
            });
        } else {
            res.status(500).json({ error: 'Failed to create invoice' });
        }
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/check-invoice', async (req, res) => {
    const { invoiceId, demoMode } = req.body;

    try {
        const invoice = await cryptoPayRequest('getInvoices', {
            invoice_ids: invoiceId
        }, demoMode);

        if (invoice.ok && invoice.result.items.length > 0) {
            const invoiceData = invoice.result.items[0];
            
            if (invoiceData.status === 'paid') {
                const transaction = transactions.findOne({ invoice_id: invoiceId });
                
                if (transaction && transaction.status === 'pending') {
                    const user = users.get(transaction.user_id);
                    
                    if (demoMode) {
                        users.update({
                            ...user,
                            demo_balance: user.demo_balance + transaction.amount
                        });
                        updateCasinoDemoBank(transaction.amount);
                    } else {
                        users.update({
                            ...user,
                            main_balance: user.main_balance + transaction.amount
                        });
                        updateCasinoBank(transaction.amount);
                    }

                    transactions.update({
                        ...transaction,
                        status: 'completed',
                        updated_at: new Date()
                    });

                    res.json({ 
                        success: true, 
                        status: 'paid',
                        amount: transaction.amount
                    });
                } else {
                    res.json({ success: false, status: 'already_processed' });
                }
            } else {
                res.json({ success: true, status: invoiceData.status });
            }
        } else {
            res.json({ success: false, status: 'not_found' });
        }
    } catch (error) {
        console.error('Check invoice error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/create-withdrawal', async (req, res) => {
    const { telegramId, amount, address, demoMode } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balance = demoMode ? user.demo_balance : user.main_balance;
        
        if (balance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        if (demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance - amount
            });

            transactions.insert({
                user_id: user.$loki,
                amount: -amount,
                type: 'withdrawal',
                status: 'completed',
                demo_mode: true,
                address: address,
                created_at: new Date()
            });

            res.json({
                success: true,
                message: 'Withdrawal completed (demo mode)',
                new_balance: user.demo_balance - amount
            });
        } else {
            const transfer = await cryptoPayRequest('transfer', {
                user_id: telegramId,
                asset: 'TON',
                amount: amount.toString(),
                spend_id: `withdrawal_${Date.now()}_${telegramId}`
            }, false);

            if (transfer.ok && transfer.result) {
                users.update({
                    ...user,
                    main_balance: user.main_balance - amount
                });
                
                updateCasinoBank(-amount);

                transactions.insert({
                    user_id: user.$loki,
                    amount: -amount,
                    type: 'withdrawal',
                    status: 'completed',
                    demo_mode: false,
                    address: address,
                    hash: transfer.result.hash,
                    created_at: new Date()
                });

                res.json({
                    success: true,
                    message: 'Withdrawal completed',
                    hash: transfer.result.hash,
                    new_balance: user.main_balance - amount
                });
            } else {
                res.status(500).json({ error: 'Withdrawal failed' });
            }
        }
    } catch (error) {
        console.error('Create withdrawal error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/user/balance/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);
    const isAdminUser = telegramId === 842428912 || telegramId === 1135073023;

    try {
        const user = users.findOne({ telegram_id: telegramId });
        
        if (!user) {
            const newUser = users.insert({
                telegram_id: telegramId,
                main_balance: 0,
                demo_balance: isAdminUser ? 1000 : 0,
                created_at: new Date(),
                demo_mode: false,
                is_admin: telegramId === parseInt(process.env.OWNER_TELEGRAM_ID) || telegramId === 1135073023
            });
            
            res.json({
                main_balance: newUser.main_balance,
                demo_balance: newUser.demo_balance,
                demo_mode: newUser.demo_mode,
                is_admin: newUser.is_admin
            });
        } else {
            res.json({
                main_balance: user.main_balance,
                demo_balance: user.demo_balance,
                demo_mode: user.demo_mode,
                is_admin: user.is_admin
            });
        }
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/user/toggle-demo-mode', async (req, res) => {
    const { telegramId } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (parseInt(telegramId) !== 842428912 && parseInt(telegramId) !== 1135073023) {
            return res.status(403).json({ error: 'Demo mode not available' });
        }

        users.update({
            ...user,
            demo_mode: !user.demo_mode
        });

        res.json({
            success: true,
            demo_mode: !user.demo_mode
        });
    } catch (error) {
        console.error('Toggle demo mode error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/mines/start', async (req, res) => {
    const { telegramId, betAmount, minesCount, demoMode } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balance = demoMode ? user.demo_balance : user.main_balance;
        
        if (balance < betAmount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        const game = minesGames.insert({
            user_id: user.$loki,
            bet_amount: betAmount,
            mines_count: minesCount,
            revealed_cells: [],
            game_over: false,
            win: false,
            current_multiplier: 1,
            demo_mode: demoMode,
            created_at: new Date()
        });

        if (demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance - betAmount
            });
            updateCasinoDemoBank(betAmount);
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance - betAmount
            });
            updateCasinoBank(betAmount);
        }

        res.json({
            success: true,
            game_id: game.$loki,
            new_balance: demoMode ? user.demo_balance - betAmount : user.main_balance - betAmount
        });
    } catch (error) {
        console.error('Mines start error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/mines/open', async (req, res) => {
    const { gameId, cellIndex, telegramId } = req.body;

    try {
        const game = minesGames.get(gameId);
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!game || !user) {
            return res.status(404).json({ error: 'Game or user not found' });
        }

        if (game.game_over) {
            return res.status(400).json({ error: 'Game already finished' });
        }

        if (game.revealed_cells.includes(cellIndex)) {
            return res.status(400).json({ error: 'Ячейка уже открыта' });
        }

        if (!game.mines) {
            const mines = [];
            while (mines.length < game.mines_count) {
                const randomCell = Math.floor(Math.random() * 25);
                if (!mines.includes(randomCell)) {
                    mines.push(randomCell);
                }
            }
            minesGames.update({
                ...game,
                mines: mines
            });
            game.mines = mines;
        }

        if (game.mines.includes(cellIndex)) {
            minesGames.update({
                ...game,
                game_over: true,
                win: false
            });

            res.json({
                success: true,
                game_over: true,
                win: false,
                mine_hit: true,
                multiplier: 0
            });
        } else {
            const revealedCells = [...game.revealed_cells, cellIndex];
            const multiplier = calculateMultiplier(revealedCells.length, game.mines_count);

            minesGames.update({
                ...game,
                revealed_cells: revealedCells,
                current_multiplier: multiplier
            });

            res.json({
                success: true,
                game_over: false,
                mine_hit: false,
                multiplier: multiplier,
                revealed_cells: revealedCells
            });
        }
    } catch (error) {
        console.error('Mines open error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/mines/cashout', async (req, res) => {
    const { gameId, telegramId } = req.body;

    try {
        const game = minesGames.get(gameId);
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!game || !user) {
            return res.status(404).json({ error: 'Game or user not found' });
        }

        if (game.game_over || game.win) {
            return res.status(400).json({ error: 'Игра уже завершена или выигрыш уже забран' });
        }

        const winAmount = game.bet_amount * game.current_multiplier;

        minesGames.update({
            ...game,
            game_over: true,
            win: true,
            win_amount: winAmount
        });

        if (game.demo_mode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance + winAmount
            });
            updateCasinoDemoBank(-winAmount);
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance + winAmount
            });
            updateCasinoBank(-winAmount);
        }

        res.json({
            success: true,
            win_amount: winAmount,
            multiplier: game.current_multiplier,
            new_balance: game.demo_mode ? user.demo_balance + winAmount : user.main_balance + winAmount
        });
    } catch (error) {
        console.error('Mines cashout error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/rocket/bet', async (req, res) => {
    const { telegramId, betAmount, demoMode } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const existingBet = rocketGame.players.find(p => 
           p.userId == telegramId && !p.isBot
        );
        
        if (existingBet) {
            return res.status(400).json({ error: 'Вы уже сделали ставку в этом раунде' });
        }

        if (rocketGame.status !== 'counting' || Date.now() > rocketGame.endBetTime) {
            return res.status(400).json({ error: 'Время для ставок закончилось' });
        }

        const balance = demoMode ? user.demo_balance : user.main_balance;
        
        if (balance < betAmount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        const currentUser = users.findOne({ telegram_id: parseInt(telegramId) });
        const currentBalance = demoMode ? currentUser.demo_balance : currentUser.main_balance;
        
        if (currentBalance < betAmount) {
            return res.status(400).json({ error: 'Недостаточно средств (баланс изменился)' });
        }

        if (demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance - betAmount
            });
            updateCasinoDemoBank(betAmount);
            updateRTPStats('demoBank', betAmount, 0);
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance - betAmount
            });
            updateCasinoBank(betAmount);
            updateRTPStats('realBank', betAmount, 0);
        }

        const player = {
            userId: telegramId,
            name: `User_${telegramId}`,
            betAmount: parseFloat(betAmount),
            demoMode: demoMode,
            cashedOut: false,
            cashoutMultiplier: null,
            winAmount: 0,
            isBot: false
        };

        rocketGame.players.push(player);

        broadcastRocketUpdate();

        res.json({
            success: true,
            new_balance: demoMode ? user.demo_balance - betAmount : user.main_balance - betAmount
        });
     } catch (error) {
        console.error('Rocket bet error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/rocket/cashout', async (req, res) => {
    const { telegramId } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (rocketGame.status !== 'flying') {
            return res.status(400).json({ error: 'Нельзя забрать выигрыш сейчас' });
        }

        const player = rocketGame.players.find(p => p.userId == telegramId && !p.isBot);
        
        if (!player || player.cashedOut) {
            return res.status(400).json({ error: 'Игрок не найден или уже забрал выигрыш' });
        }

        if (player.cashedOut === true) {
            return res.status(400).json({ error: 'Выигрыш уже забран' });
        }

        const winAmount = player.betAmount * rocketGame.multiplier;
        
        if (player.demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance + winAmount
            });
            updateCasinoDemoBank(-winAmount);
            updateRTPStats('demoBank', 0, winAmount);
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance + winAmount
            });
            updateCasinoBank(-winAmount);
            updateRTPStats('realBank', 0, winAmount);
        }

        player.cashedOut = true;
        player.cashoutMultiplier = rocketGame.multiplier;
        player.winAmount = winAmount;

        transactions.insert({
            user_id: user.$loki,
            amount: winAmount,
            type: 'rocket_win',
            status: 'completed',
            demo_mode: player.demoMode,
            created_at: new Date()
        });

        broadcastRocketUpdate();

        res.json({
            success: true,
            multiplier: rocketGame.multiplier,
            winAmount: winAmount,
            new_balance: player.demoMode ? user.demo_balance : user.main_balance
        });
    } catch (error) {
        console.error('Rocket cashout error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/rocket/history', async (req, res) => {
    try {
        res.json(rocketGame.history.slice(0, 20));
    } catch (error) {
        console.error('Get rocket history error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/rocket/current', async (req, res) => {
    try {
        res.json(rocketGame);
    } catch (error) {
        console.error('Get current rocket game error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Крон задача для проверки инвойсов
cron.schedule('* * * * *', async () => {
    try {
        const pendingTransactions = transactions.find({
            status: 'pending',
            type: 'deposit'
        });

        for (const transaction of pendingTransactions) {
            const invoice = await cryptoPayRequest('getInvoices', {
                invoice_ids: transaction.invoice_id
            }, transaction.demo_mode);

            if (invoice.ok && invoice.result.items.length > 0) {
                const invoiceData = invoice.result.items[0];
                
                if (invoiceData.status === 'paid') {
                    const user = users.get(transaction.user_id);
                    
                    if (transaction.demo_mode) {
                        users.update({
                            ...user,
                            demo_balance: user.demo_balance + transaction.amount
                        });
                        updateCasinoDemoBank(transaction.amount);
                    } else {
                        users.update({
                            ...user,
                            main_balance: user.main_balance + transaction.amount
                        });
                        updateCasinoBank(transaction.amount);
                    }

                    transactions.update({
                        ...transaction,
                        status: 'completed',
                        updated_at: new Date()
                    });
                }
            }
        }
    } catch (error) {
        console.error('Cron job error:', error);
    }
});

// Крон задача для сброса RTP каждый день в 00:00
cron.schedule('0 0 * * *', () => {
    console.log('Сброс дневного RTP...');
    resetDailyRTP();
    console.log('RTP сброшен на новый день');
});

// Запуск сервера
async function startServer() {
    await initDatabase();
    resetDailyRTP();
    startRocketGame();
    console.log(`TON Casino Server started on port ${PORT}`);
    console.log(`RTP система инициализирована. Целевой RTP: 70%`);
}

startServer();