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
let users, transactions, casinoBank, adminLogs, minesGames, rocketGames, rocketBets;

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
  history: []
};

// RTP система - отслеживание доходности за день
let rtpSystem = {
  realBank: {
    dailyDeposits: 0,      // Общие депозиты за день
    dailyPayouts: 0,       // Общие выплаты за день
    currentRTP: 0,         // Текущий RTP в процентах
    targetRTP: 50,         // Целевой RTP 50%
    lastResetDate: new Date().toDateString()
  },
  demoBank: {
    dailyDeposits: 0,
    dailyPayouts: 0,
    currentRTP: 0,
    targetRTP: 50,         // Целевой RTP 50%
    lastResetDate: new Date().toDateString()
  }
};

// Боты для ракетки
const rocketBots = [
  { name: "niwssomi", minBet: 1, maxBet: 10, risk: "medium" },
  { name: "openhgj", minBet: 5, maxBet: 20, risk: "high" },
  { name: "lonis", minBet: 0.5, maxBet: 5, risk: "low" },
  { name: "kartoshka", minBet: 2, maxBet: 8, risk: "medium" },
  { name: "tonmaster", minBet: 3, maxBet: 15, risk: "high" },
  { name: "cryptoking", minBet: 1, maxBet: 12, risk: "medium" },
  { name: "spaceman", minBet: 4, maxBet: 25, risk: "high" },
  { name: "moonrider", minBet: 0.8, maxBet: 6, risk: "low" },
  { name: "stargazer", minBet: 2.5, maxBet: 18, risk: "medium" },
  { name: "cosmicbet", minBet: 6, maxBet: 30, risk: "high" },
  { name: "lucky777", minBet: 1.5, maxBet: 7, risk: "low" },
  { name: "risk_taker", minBet: 8, maxBet: 35, risk: "high" }
];

function getUserDisplayName(userData) {
    // Получаем данные пользователя из Telegram WebApp
    const tg = global.Telegram?.WebApp;
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const tgUser = tg.initDataUnsafe.user;
        if (tgUser.username) return tgUser.username;
        if (tgUser.first_name && tgUser.last_name) return `${tgUser.first_name} ${tgUser.last_name}`;
        if (tgUser.first_name) return tgUser.first_name;
        return `User_${tgUser.id}`;
    }
    
    // Если нет данных из Telegram, используем то что есть
    if (userData.username) return userData.username;
    if (userData.first_name && userData.last_name) return `${userData.first_name} ${userData.last_name}`;
    if (userData.first_name) return userData.first_name;
    return `User_${userData.telegram_id || userData.id || 'unknown'}`;
}

function initDatabase() {
    return new Promise((resolve) => {
        db = new Loki(dbPath, {
            autoload: true,
            autoloadCallback: () => {
                users = db.getCollection('users');
                transactions = db.getCollection('transactions');
                casinoBank = db.getCollection('casino_bank');
                casinoDemoBank = db.getCollection('casino_demo_bank'); // Новая коллекция
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
                        demo_balance: 50, // 50 TON вместо 1000
                        total_deposits: 0, // Новое поле для отслеживания депозитов
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

                // Добавляем демо-банк казино
                if (!casinoDemoBank) {
                    casinoDemoBank = db.addCollection('casino_demo_bank');
                    casinoDemoBank.insert({
                        total_balance: 500, // 500 TON демо-банк вместо 10000
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

// Функция синхронизации баланса с реальным Crypto Bot
async function syncCasinoBalance() {
    try {
        console.log('🔄 Синхронизируем реальный баланс с Crypto Bot...');
        
        const response = await axios.get('https://pay.crypt.bot/api/getBalance', {
            headers: {
                'Crypto-Pay-API-Token': process.env.CRYPTO_PAY_MAINNET_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (response.data.ok) {
            const tonBalance = response.data.result.find(asset => asset.currency_code === 'TON');
            if (tonBalance) {
                const realBalance = parseFloat(tonBalance.available);
                const currentBank = getCasinoBank();
                
                // Логируем для отладки
                console.log(`💰 Crypto Bot баланс: ${realBalance} TON`);
                console.log(`🏦 Наш банк: ${currentBank.total_balance} TON`);
                
                // Синхронизируем только если расхождение больше 0.01 TON
                if (Math.abs(currentBank.total_balance - realBalance) > 0.01) {
                    console.log(`🔄 Синхронизация: ${currentBank.total_balance} → ${realBalance} TON`);
                    
                    casinoBank.update({
                        ...currentBank,
                        total_balance: realBalance,
                        updated_at: new Date()
                    });
                    
                    console.log('✅ Баланс синхронизирован');
                } else {
                    console.log('✅ Баланс уже синхронизирован');
                }
            }
        } else {
            console.error('❌ Ошибка Crypto Bot API:', response.data.error);
        }
    } catch (error) {
        console.error('❌ Ошибка синхронизации баланса:', error.message);
    }
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

// 🔥 НОВАЯ ФУНКЦИЯ МНОЖИТЕЛЕЙ КАК В 1WIN
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

// Функция для сброса дневного RTP (вызывается каждый день)
function resetDailyRTP() {
    const today = new Date().toDateString();
    
    if (rtpSystem.realBank.lastResetDate !== today) {
        rtpSystem.realBank = {
            dailyDeposits: 0,
            dailyPayouts: 0,
            currentRTP: 0,
            targetRTP: 50,  // Снижено до 50%
            lastResetDate: today
        };
        
        // Сбрасываем также счетчики паттернов при дневном сбросе
        lastResults = [];
        psychologySystem = {
            lastHighWins: 0,    
            lastLowWins: 0,     
            randomSeed: Math.random() * 1000,
            heatupPhase: false,  
            trapMode: false,     
            consecutiveSmallWins: 0, 
            lastBigBetResult: null   
        };
        
        console.log('Сброшены дневные статистики RTP и счетчики паттернов');
    }
    
    if (rtpSystem.demoBank.lastResetDate !== today) {
        rtpSystem.demoBank = {
            dailyDeposits: 0,
            dailyPayouts: 0,
            currentRTP: 0,
            targetRTP: 50,  // Снижено до 50%
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
    resetDailyRTP(); // Проверяем, нужно ли сбросить дневную статистику
    
    const bank = rtpSystem[bankType];
    bank.dailyDeposits += deposit;
    bank.dailyPayouts += payout;
    bank.currentRTP = calculateCurrentRTP(bankType);
    
    console.log(`${bankType} RTP: ${bank.currentRTP.toFixed(2)}% (Депозиты: ${bank.dailyDeposits}, Выплаты: ${bank.dailyPayouts})`);
}

// ПРОСТОЙ РАНДОМНЫЙ АЛГОРИТМ с RTP 50%
let gameStats = {
    totalBets: 0,
    totalPayouts: 0,
    gamesCount: 0,
    randomSeed: Math.random() * 10000
};

// Генерируем полностью случайное число
function getRandomFloat() {
    gameStats.randomSeed = (gameStats.randomSeed * 9301 + 49297) % 233280;
    return (gameStats.randomSeed / 233280 + Math.random()) / 2;
}

// Простая функция для определения результата игры
function shouldWin(betAmount) {
    const random = Math.random() * 100;
    const currentRTP = gameStats.totalBets > 0 ? (gameStats.totalPayouts / gameStats.totalBets) * 100 : 0;
    
    // Базовый шанс выигрыша зависит от текущего RTP
    let winChance = 45; // Базовый шанс 45%
    
    // Если RTP ниже целевого - немного увеличиваем шанс
    if (currentRTP < 45) {
        winChance += Math.min(8, (45 - currentRTP) * 1.5);
    }
    // Если RTP выше целевого - уменьшаем шанс
    else if (currentRTP > 55) {
        winChance -= Math.min(12, (currentRTP - 55) * 1.5);
    }
    
    return random < winChance;
}

// Генерация полностью случайного краш-поинта для реального банка
function generateRandomRealBankCrashPoint(totalBet, bankBalance) {
    // Если банк меньше 5 TON - сливы, RTP не работает
    if (bankBalance < 5) {
        if (Math.random() < 0.85) {
            return Math.random() * 0.15 + 1.0; // 85% слив 1.0-1.15x
        }
        return Math.random() * 0.4 + 1.15; // 15% малый выигрыш 1.15-1.55x
    }
    
    // RTP активирован при 5+ TON - сложный непредсказуемый алгоритм
    const shouldPlayerWin = shouldWin(totalBet);
    const random = getRandomFloat() * 100;
    
    // Шанс на большой икс (добавлено по просьбе)
    const bigWinChance = Math.random() * 100;
    if (bigWinChance < 3) { // 3% шанс на очень большой выигрыш
        return Math.random() * 50.0 + 20.0; // 20x-70x большие иксы!
    }
    
    // Более сложная логика с дополнительной рандомизацией
    const extraRandom = Math.random() * Math.sin(Date.now() / 1000) * 50;
    const adjustedRandom = random + extraRandom;
    
    if (shouldPlayerWin) {
        // Игрок выигрывает - непредсказуемые множители
        if (adjustedRandom < 25) return Math.random() * 0.9 + 1.1; // 1.1-2.0x
        if (adjustedRandom < 50) return Math.random() * 2.0 + 2.0; // 2.0-4.0x  
        if (adjustedRandom < 75) return Math.random() * 4.0 + 4.0; // 4.0-8.0x
        if (adjustedRandom < 92) return Math.random() * 8.0 + 8.0; // 8.0-16.0x
        return Math.random() * 15.0 + 15.0; // 15.0-30.0x крупные выигрыши
    } else {
        // Игрок проигрывает - но с защитой от паттернов
        const lossRandom = Math.random() * Math.cos(Date.now() / 2000) * 30;
        if (lossRandom + random < 65) return Math.random() * 0.12 + 1.0; // 1.0-1.12x
        if (lossRandom + random < 85) return Math.random() * 0.25 + 1.12; // 1.12-1.37x
        return Math.random() * 0.4 + 1.37; // 1.37-1.77x
    }
}

// Генерация полностью случайного краш-поинта для демо банка
function generateRandomDemoBankCrashPoint(totalBet) {
    const shouldPlayerWin = shouldWin(totalBet);
    const random = getRandomFloat() * 100;
    
    if (shouldPlayerWin) {
        // Демо банк чуть щедрее - но не намного
        if (random < 25) return Math.random() * 0.8 + 1.2; // 1.2-2.0x
        if (random < 55) return Math.random() * 1.5 + 2.0; // 2.0-3.5x
        if (random < 80) return Math.random() * 3.0 + 3.5; // 3.5-6.5x
        return Math.random() * 12.0 + 6.5; // 6.5-18.5x
    } else {
        // Проигрыши такие же как в реальном банке
        if (random < 65) return Math.random() * 0.15 + 1.0; // 1.0-1.15x
        if (random < 85) return Math.random() * 0.25 + 1.15; // 1.15-1.4x
        return Math.random() * 0.4 + 1.4; // 1.4-1.8x
    }
}

// Генерация краш-поинта только для ботов
function generateRandomBotCrashPoint() {
    const random = Math.random() * 100;
    
    if (random < 30) return Math.random() * 0.15 + 1.0; // 1.0-1.15x
    if (random < 60) return Math.random() * 1.0 + 1.5; // 1.5-2.5x
    if (random < 85) return Math.random() * 3.0 + 2.5; // 2.5-5.5x
    return Math.random() * 10.0 + 5.5; // 5.5-15.5x
}

// Главная функция генерации краш-поинта
function generateCrashPoint(players) {
    // Разделяем игроков на типы
    const realPlayers = players.filter(p => !p.isBot && !p.demoMode);
    const demoPlayers = players.filter(p => !p.isBot && p.demoMode);
    
    const totalRealBet = realPlayers.reduce((sum, p) => sum + p.betAmount, 0);
    const totalDemoBet = demoPlayers.reduce((sum, p) => sum + p.betAmount, 0);
    
    // Обновляем общую статистику
    gameStats.totalBets += totalRealBet + totalDemoBet;
    gameStats.gamesCount++;
    
    let crashPoint = 1.00;
    
    if (totalRealBet > 0) {
        // Реальные ставки
        const realBank = getCasinoBank();
        crashPoint = generateRandomRealBankCrashPoint(totalRealBet, realBank.total_balance);
        
        // Обновляем статистику выплат
        if (crashPoint > 1.0) {
            const payout = totalRealBet * (crashPoint - 1);
            gameStats.totalPayouts += payout;
        }
        
    } else if (totalDemoBet > 0) {
        // Демо ставки
        crashPoint = generateRandomDemoBankCrashPoint(totalDemoBet);
        
        // Обновляем статистику выплат для демо
        if (crashPoint > 1.0) {
            const payout = totalDemoBet * (crashPoint - 1);
            gameStats.totalPayouts += payout * 0.5; // Демо считаем с коэффициентом
        }
        
    } else {
        // Только боты
        crashPoint = generateRandomBotCrashPoint();
    }
    
    // Логируем статистику
    const currentRTP = gameStats.totalBets > 0 ? (gameStats.totalPayouts / gameStats.totalBets) * 100 : 0;
    console.log(`🎲 Краш: ${crashPoint.toFixed(2)}x, RTP: ${currentRTP.toFixed(1)}%, Игры: ${gameStats.gamesCount}`);
    
    return Math.max(1.00, crashPoint);
}

// НОВЫЕ ФУНКЦИИ С ЗАЩИТОЙ ОТ ПАТТЕРНОВ

// Генерация среднего выигрыша для избежания паттернов
function generateMiddleWinCrashPoint(totalBet) {
    const random = getSeededRandom() * 100;
    
    if (totalBet >= 0.7) {
        return Math.random() * 2.0 + 2.0; // 2.0x - 4.0x средние выигрыши (улучшено)
    } else {
        return Math.random() * 3.0 + 2.5; // 2.5x - 5.5x для малых ставок (значительно улучшено)
    }
}

// Генерация краш-поинта с защитой от паттернов (выигрышный) - ИСПРАВЛЕНО
function generateAntiPatternWinningCrashPoint(totalBet) {
    // Если было много высоких выигрышей - даем средний
    if (shouldAvoidPattern('high')) {
        return generateMiddleWinCrashPoint(totalBet);
    }
    
    const random = getSeededRandom() * 100;
    const bonusChance = psychologySystem.lastLowWins * 15; // Бонус за предыдущие проигрыши
    
    // Учитываем размер ставки с дополнительной случайностью
    if (totalBet >= 0.7) { // Большие ставки
        if (random < 25 + bonusChance) return Math.random() * 0.4 + 1.0; // Малый выигрыш 1.0-1.4x
        if (random < 55 + bonusChance) return Math.random() * 0.5 + 1.8; // Средний 1.8-2.3x  
        if (random < 80 + bonusChance) return Math.random() * 1.2 + 4.0; // Большой 4.0-5.2x
        return Math.random() * 9.8 + 5.2; // Крупный 5.2-15x
    } else { // Малые ставки (0.1-0.6)
        if (random < 15 + bonusChance) return Math.random() * 0.4 + 1.0; // Малый
        if (random < 40 + bonusChance) return Math.random() * 0.5 + 1.8; // Средний
        if (random < 70 + bonusChance) return Math.random() * 1.2 + 4.0; // Большой  
        return Math.random() * 9.8 + 5.2; // Крупный
    }
}

// Генерация сбалансированного краш-поинта с защитой от паттернов - ИСПРАВЛЕНО
function generateAntiPatternBalancedCrashPoint(totalBet) {
    const random = getSeededRandom() * 100;
    
    // Если был паттерн проигрышей - увеличиваем шанс выигрыша
    const winBonus = psychologySystem.lastLowWins * 10;
    // Если был паттерн выигрышей - уменьшаем шанс высокого выигрыша
    const highWinPenalty = psychologySystem.lastHighWins * 15;
    
    if (totalBet >= 0.7) {
        if (random < 45 - winBonus) return Math.random() * 0.15 + 1.00; // Проигрыш
        if (random < 65 - winBonus) return Math.random() * 0.4 + 1.0;   // Малый
        if (random < 80 - winBonus) return Math.random() * 0.5 + 1.8;   // Средний
        if (random < 93 - highWinPenalty) return Math.random() * 1.2 + 4.0; // Большой
        return Math.random() * 9.8 + 5.2; // Крупный
    } else {
        if (random < 35 - winBonus) return Math.random() * 0.15 + 1.00; // Проигрыш
        if (random < 55 - winBonus) return Math.random() * 0.4 + 1.0;   // Малый
        if (random < 75 - winBonus) return Math.random() * 0.5 + 1.8;   // Средний  
        if (random < 92 - highWinPenalty) return Math.random() * 1.2 + 4.0; // Большой
        return Math.random() * 9.8 + 5.2; // Крупный
    }
}

// Генерация проигрышного краш-поинта с защитой от паттернов - ИСПРАВЛЕНО  
function generateAntiPatternLosingCrashPoint(totalBet) {
    // Если было много проигрышей подряд - даем средний выигрыш
    if (shouldAvoidPattern('low')) {
        return generateMiddleWinCrashPoint(totalBet);
    }
    
    const random = getSeededRandom() * 100;
    
    if (totalBet >= 0.7) {
        if (random < 75) return Math.random() * 0.15 + 1.00; // 75% проигрыш (уменьшено с 80%)
        if (random < 88) return Math.random() * 0.4 + 1.0;   // 13% малый
        if (random < 96) return Math.random() * 0.5 + 1.8;   // 8% средний
        return Math.random() * 1.2 + 4.0; // 4% большой
    } else {
        if (random < 65) return Math.random() * 0.15 + 1.00; // 65% проигрыш (уменьшено с 70%)
        if (random < 80) return Math.random() * 0.4 + 1.0;   // 15% малый
        if (random < 92) return Math.random() * 0.5 + 1.8;   // 12% средний
        return Math.random() * 1.2 + 4.0; // 8% большой
    }
}

// Rocket Game Main Functions

function startRocketGame() {
    if (rocketGame.status !== 'waiting') return;

    rocketGame.status = 'counting';
    rocketGame.multiplier = 1.00;
    rocketGame.startTime = Date.now();
    rocketGame.endBetTime = Date.now() + 5000; // 5 секунд на ставки
    rocketGame.players = [];
    
    // Генерируем crashPoint после завершения времени на ставки
    setTimeout(() => {
        // Передаем всех игроков для анализа
        rocketGame.crashPoint = generateCrashPoint(rocketGame.players);
        console.log(`Краш-поинт: ${rocketGame.crashPoint.toFixed(2)}x`);
        
        // Выводим RTP статистику
        console.log(`Реальный банк RTP: ${rtpSystem.realBank.currentRTP.toFixed(2)}%`);
        console.log(`Демо банк RTP: ${rtpSystem.demoBank.currentRTP.toFixed(2)}%`);
    }, 5000);

    // Добавляем ставки ботов с небольшой задержкой для реалистичности
    setTimeout(() => {
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
        broadcastRocketUpdate();
    }, 1000); // Задержка 1 секунда перед добавлением ботов

    // ФИКС: Отправляем начальное значение 5 секунд
    rocketGame.timeLeft = 5;
    broadcastRocketUpdate();

    // Запускаем синхронизацию времени каждую секунду
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


// server.js - исправленная функция startRocketFlight
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

    // ОБНОВЛЕННАЯ ЛОГИКА ДЛЯ БОТОВ - РЕАЛИСТИЧНЫЕ ВЫИГРЫШИ
    rocketGame.players.forEach(player => {
      if (player.isBot && !player.cashedOut) {
        // Шанс выигрыша зависит от risk-профиля бота
        let winChance;
        switch(player.risk) {
          case 'low':
            winChance = 0.6; // 60% шанс выиграть
            break;
          case 'medium':
            winChance = 0.5; // 50% шанс выиграть
            break;
          case 'high':
            winChance = 0.4; // 40% шанс выиграть
            break;
          default:
            winChance = 0.5;
        }

        // Реалистичная логика вывода
        if (rocketGame.multiplier >= player.autoCashout) {
          // Бот всегда выводит на своем autoCashout
          player.cashedOut = true;
          player.winAmount = player.betAmount * player.autoCashout;
          player.cashoutMultiplier = player.autoCashout;
          
          // Визуальное логирование для реалистичности
          console.log(`🤖 Бот ${player.name} выиграл ${player.winAmount.toFixed(2)} TON (${player.autoCashout.toFixed(2)}x)`);
          
        } else if (rocketGame.multiplier > 1.5 && Math.random() < 0.01) {
          // 1% шанс что бот испугается и выведет раньше
          const earlyCashout = rocketGame.multiplier * (0.8 + Math.random() * 0.4);
          player.cashedOut = true;
          player.winAmount = player.betAmount * earlyCashout;
          player.cashoutMultiplier = earlyCashout;
          
          console.log(`🤖 Бот ${player.name} испугался и вывел ${player.winAmount.toFixed(2)} TON (${earlyCashout.toFixed(2)}x)`);
        }
        
        // Шанс что бот проиграет (не успеет вывести)
        if (!player.cashedOut && rocketGame.multiplier >= rocketGame.crashPoint * 0.9) {
          // Если множитель близок к крашу, бот может "не успеть"
          if (Math.random() < 0.3) {
            player.cashedOut = false; // Проиграл
            console.log(`🤖 Бот ${player.name} не успел вывести и проиграл ${player.betAmount.toFixed(2)} TON`);
          }
        }
      }
    });

    // Проверяем, достигли ли точки краша
    if (rocketGame.multiplier >= rocketGame.crashPoint) {
      rocketGame.status = 'crashed';
      clearInterval(flightInterval);
      
      // Обрабатываем проигравших ботов
      rocketGame.players.forEach(player => {
        if (player.isBot && !player.cashedOut) {
          console.log(`🤖 Бот ${player.name} проиграл ${player.betAmount.toFixed(2)} TON при краше ${rocketGame.crashPoint.toFixed(2)}x`);
        }
      });
      
      processRocketGameEnd();
    }

    broadcastRocketUpdate();
  }, 100);
}



function processRocketGameEnd() {
  // Статистика по ботам
  const botStats = rocketGame.players.filter(p => p.isBot);
  const winningBots = botStats.filter(p => p.cashedOut);
  const losingBots = botStats.filter(p => !p.cashedOut);
  
  console.log(`📊 Статистика ботов: ${winningBots.length} выиграли, ${losingBots.length} проиграли`);
  winningBots.forEach(bot => {
    console.log(`   🎉 ${bot.name}: +${bot.winAmount.toFixed(2)} TON (${bot.cashoutMultiplier.toFixed(2)}x)`);
  });
  losingBots.forEach(bot => {
    console.log(`   💥 ${bot.name}: -${bot.betAmount.toFixed(2)} TON`);
  });

  // Сохраняем игру в историю
  const gameRecord = rocketGames.insert({
    crashPoint: rocketGame.crashPoint,
    maxMultiplier: rocketGame.multiplier,
    startTime: new Date(rocketGame.startTime),
    endTime: new Date(),
    playerCount: rocketGame.players.filter(p => !p.isBot).length, // Только реальные игроки
    botCount: rocketGame.players.filter(p => p.isBot).length,
    totalBets: rocketGame.players.reduce((sum, p) => sum + p.betAmount, 0),
    totalPayouts: rocketGame.players.reduce((sum, p) => sum + (p.cashedOut ? p.winAmount : 0), 0),
    botWins: winningBots.length,
    botLosses: losingBots.length
  });

  // Обрабатываем выплаты для реальных игроков
  rocketGame.players.forEach(player => {
    if (!player.isBot) {
      const user = users.findOne({ telegram_id: parseInt(player.userId) });
      if (user) {
        if (player.cashedOut) {
          // Игрок выиграл - выплачиваем выигрыш (уже был начислен при cashout)
          transactions.insert({
            user_id: user.$loki,
            amount: player.winAmount,
            type: 'rocket_win',
            status: 'completed',
            demo_mode: player.demoMode,
            game_id: gameRecord.$loki,
            created_at: new Date()
          });

          // Сохраняем ставку
          rocketBets.insert({
            game_id: gameRecord.$loki,
            user_id: user.$loki,
            bet_amount: player.betAmount,
            cashout_multiplier: player.cashoutMultiplier,
            win_amount: player.winAmount,
            demo_mode: player.demoMode,
            created_at: new Date()
          });
        } else {
          // Игрок проиграл - ставка остается в банке казино (уже была добавлена при ставке)
          transactions.insert({
            user_id: user.$loki,
            amount: -player.betAmount,
            type: 'rocket_loss',
            status: 'completed',
            demo_mode: player.demoMode,
            game_id: gameRecord.$loki,
            created_at: new Date()
          });

          rocketBets.insert({
            game_id: gameRecord.$loki,
            user_id: user.$loki,
            bet_amount: player.betAmount,
            cashout_multiplier: null,
            win_amount: 0,
            demo_mode: player.demoMode,
            created_at: new Date()
          });
        }
      }
    }
  });

  // Добавляем в историю
  rocketGame.history.unshift({
    crashPoint: rocketGame.crashPoint,
    multiplier: rocketGame.multiplier,
    botWins: winningBots.length,
    botLosses: losingBots.length
  });

  if (rocketGame.history.length > 50) {
    rocketGame.history.pop();
  }

  broadcastRocketUpdate();

  // Через 5 секунд начинаем новую игру
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
// WebSocket обработчик
wss.on('connection', function connection(ws) {
  console.log('Rocket game client connected');
  
  // Отправляем текущее состояние игры при подключении
  ws.send(JSON.stringify({
    type: 'rocket_update',
    game: rocketGame
  }));

  ws.on('close', () => {
    console.log('Rocket game client disconnected');
  });
});





// API: Начать игру Mines
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

        // Создаем игру
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

        // Списываем ставку и обновляем банк казино
        if (demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance - betAmount
            });
            updateCasinoDemoBank(betAmount); // Ставка идет в банк казино
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance - betAmount
            });
            updateCasinoBank(betAmount); // Ставка идет в банк казино
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

// API: Открыть ячейку в Mines
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

        // Генерируем мины если еще не сгенерированы
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

        // Проверяем, есть ли мина
        if (game.mines.includes(cellIndex)) {
            // Мина! Игра окончена
            minesGames.update({
                ...game,
                game_over: true,
                win: false,
                revealed_cells: [...game.revealed_cells, cellIndex]
            });

            res.json({
                success: true,
                game_over: true,
                mine_hit: true,
                multiplier: 0,
                revealed_cells: [...game.revealed_cells, cellIndex],
                mines: game.mines
            });
        } else {
            // Безопасная ячейка
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

// API: Забрать выигрыш в Mines
app.post('/api/mines/cashout', async (req, res) => {
    const { gameId, telegramId } = req.body;

    try {
        const game = minesGames.get(gameId);
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!game || !user) {
            return res.status(404).json({ error: 'Game or user not found' });
        }

        if (game.game_over) {
            return res.status(400).json({ error: 'Game already finished' });
        }

        const winAmount = game.bet_amount * game.current_multiplier;

        // Завершаем игру
        minesGames.update({
            ...game,
            game_over: true,
            win: true,
            win_amount: winAmount
        });

        // Начисляем выигрыш
        if (game.demo_mode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance + winAmount
            });
            updateCasinoDemoBank(-winAmount); // Выплата из банка казино
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance + winAmount
            });
            updateCasinoBank(-winAmount); // Выплата из банка казино
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

// API: Сделать ставку в Rocket
app.post('/api/rocket/bet', async (req, res) => {
    const { telegramId, betAmount, demoMode, username} = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // ПРОВЕРКА: Уже есть ставка от этого пользователя
        const existingBet = rocketGame.players.find(p => 
           p.userId == telegramId && !p.isBot
        );
        
        if (existingBet) {
            return res.status(400).json({ error: 'Вы уже сделали ставку в этом раунде' });
        }

        // ПРОВЕРКА: Время для ставок истекло
        if (rocketGame.status !== 'counting' || Date.now() > rocketGame.endBetTime) {
            return res.status(400).json({ error: 'Время для ставок закончилось' });
        }

        const balance = demoMode ? user.demo_balance : user.main_balance;
        
        if (balance < betAmount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        // Списываем ставку
        if (demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance - betAmount
            });
            updateCasinoDemoBank(betAmount); // Ставка идет в демо-банк
            updateRTPStats('demoBank', betAmount, 0);
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance - betAmount
            });
            updateCasinoBank(betAmount); // Ставка идет в реальный банк
            updateRTPStats('realBank', betAmount, 0);
        }

        // Добавляем игрока в текущую игру
       const player = {
            userId: telegramId,
            name: username || getUserDisplayName(user), // Теперь передается корректный объект user
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

// API: Забрать выигрыш в Rocket
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

        // Находим игрока
        const player = rocketGame.players.find(p => p.userId == telegramId && !p.isBot);
        
        if (!player || player.cashedOut) {
            return res.status(400).json({ error: 'Игрок не найден или уже забрал выигрыш' });
        }

        // Начисляем выигрыш
        const winAmount = player.betAmount * rocketGame.multiplier;
        
        if (player.demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance + winAmount
            });
            updateCasinoDemoBank(-winAmount); // Выплата из демо-банка
            updateRTPStats('demoBank', 0, winAmount);
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance + winAmount
            });
            updateCasinoBank(-winAmount); // Выплата из реального банка
            updateRTPStats('realBank', 0, winAmount);
        }

        // Обновляем данные игрока
        player.cashedOut = true;
        player.cashoutMultiplier = rocketGame.multiplier;
        player.winAmount = winAmount;

        broadcastRocketUpdate();

        res.json({
            success: true,
            multiplier: rocketGame.multiplier,
            winAmount: winAmount,
            new_balance: player.demoMode ? user.demo_balance + winAmount : user.main_balance + winAmount
        });
    } catch (error) {
        console.error('Rocket cashout error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Получить историю Rocket
app.get('/api/rocket/history', async (req, res) => {
    try {
        res.json(rocketGame.history.slice(0, 20));
    } catch (error) {
        console.error('Get rocket history error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Получить текущую игру Rocket
app.get('/api/rocket/current', async (req, res) => {
    try {
        res.json(rocketGame);
    } catch (error) {
        console.error('Get current rocket game error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Coin Game Functions
app.post('/api/coin/flip', async (req, res) => {
    const { telegramId, betAmount, choice, demoMode } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balance = demoMode ? user.demo_balance : user.main_balance;
        
        if (balance < betAmount) {
            return res.status(400).json({ error: 'Недостаточно средств' });
        }

        // Проверяем валидность выбора
        if (!['heads', 'tails'].includes(choice)) {
            return res.status(400).json({ error: 'Invalid choice' });
        }

        // Списываем ставку
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
            updateRTPStats('realBank', betAmount, 0);
        }

        // Генерируем результат (50/50)
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        const win = result === choice;
        const winAmount = win ? betAmount * 1.95 : 0; // 1.95x для RTP ~97.5%

        // Начисляем выигрыш если победил
        if (win) {
            if (demoMode) {
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
                updateRTPStats('realBank', 0, winAmount);
            }
        }

        // Сохраняем транзакцию
        transactions.insert({
            user_id: user.$loki,
            amount: win ? winAmount : -betAmount,
            type: win ? 'coin_win' : 'coin_loss',
            status: 'completed',
            demo_mode: demoMode,
            details: {
                choice: choice,
                result: result,
                bet_amount: betAmount,
                win_amount: winAmount
            },
            created_at: new Date()
        });

        res.json({
            success: true,
            result: result,
            win: win,
            win_amount: winAmount,
            new_balance: demoMode ? 
                (win ? user.demo_balance + winAmount : user.demo_balance - betAmount) :
                (win ? user.main_balance + winAmount : user.main_balance - betAmount)
        });

    } catch (error) {
        console.error('Coin flip error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});



// Запуск сервера
async function startServer() {
    await initDatabase();
    const balanceRoutes = require('./balanceRoutes')(db, users, transactions, cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, updateRTPStats);
    app.use('/api', balanceRoutes);

    const cryptoBotRoutes = require('./cryptoBotRoutes')(db, users, transactions, cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, updateRTPStats);
    app.use('/api/crypto', cryptoBotRoutes);

    const adminRoutes = require('./adminRoutes')(db, users, transactions, casinoBank, casinoDemoBank, adminLogs, minesGames, rocketGames, rocketBets, cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, syncCasinoBalance);
    app.use('/api', adminRoutes);
    resetDailyRTP();
    startRocketGame();
    
    // Запускаем синхронизацию баланса
    setTimeout(() => {
        syncCasinoBalance();
        // Синхронизируем каждые 5 минут
        setInterval(syncCasinoBalance, 5 * 60 * 1000);
    }, 10000); // Ждем 10 секунд после старта
    
    console.log(`TON Casino Server started on port ${PORT}`);
    console.log(`Синхронизация баланса активирована (каждые 5 минут)`);
}
// Крон задача для сброса RTP каждый день в 00:00
cron.schedule('0 0 * * *', () => {
    console.log('Сброс дневного RTP...');
    resetDailyRTP();
    console.log('RTP сброшен на новый день');
});

startServer()