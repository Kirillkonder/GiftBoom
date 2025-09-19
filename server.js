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
  { name: "Bot_1", minBet: 1, maxBet: 10, risk: "medium" },
  { name: "Bot_2", minBet: 5, maxBet: 20, risk: "high" },
  { name: "Bot_3", minBet: 0.5, maxBet: 5, risk: "low" }
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

    // Добавляем ставки ботов
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
  let baseSpeed = 0.1; // Базовая скорость
  let acceleration = 0.05; // Ускорение
  
  const flightInterval = setInterval(() => {
    if (rocketGame.status !== 'flying') {
      clearInterval(flightInterval);
      return;
    }

    const elapsed = (Date.now() - startTime) / 1000;
    
    // Экспоненциальное увеличение множителя с ускорением
    // Чем больше времени прошло, тем быстрее растет множитель
    rocketGame.multiplier = 1.00 + (elapsed * baseSpeed * Math.exp(elapsed * acceleration));

    // Проверяем автоматический вывод у ботов
    rocketGame.players.forEach(player => {
      if (player.isBot && !player.cashedOut && rocketGame.multiplier >= player.autoCashout) {
        player.cashedOut = true;
        player.winAmount = player.betAmount * rocketGame.multiplier;
      }
    });

    // Проверяем, достигли ли точки краша
    if (rocketGame.multiplier >= rocketGame.crashPoint) {
      rocketGame.status = 'crashed';
      clearInterval(flightInterval);
      processRocketGameEnd();
    }

    broadcastRocketUpdate();
  }, 100); // Обновляем каждые 100ms
}



function processRocketGameEnd() {
  // Сохраняем игру в историю
  const gameRecord = rocketGames.insert({
    crashPoint: rocketGame.crashPoint,
    maxMultiplier: rocketGame.multiplier,
    startTime: new Date(rocketGame.startTime),
    endTime: new Date(),
    playerCount: rocketGame.players.length,
    totalBets: rocketGame.players.reduce((sum, p) => sum + p.betAmount, 0),
    totalPayouts: rocketGame.players.reduce((sum, p) => sum + (p.cashedOut ? p.winAmount : 0), 0)
  });

  // Обрабатываем выплаты для реальных игроков
  rocketGame.players.forEach(player => {
    if (!player.isBot) {
      const user = users.findOne({ telegram_id: parseInt(player.userId) });
      if (user) {
        if (player.cashedOut) {
          // Игрок выиграл - выплачиваем выигрыш (уже был начислен при cashout)
          // Просто сохраняем транзакцию
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
    multiplier: rocketGame.multiplier
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

// API: Аутентификация админа
app.post('/api/admin/login', async (req, res) => {
    const { telegramId, password } = req.body;
    
    // Список разрешенных администраторов
    const allowedAdmins = [
        parseInt(process.env.OWNER_TELEGRAM_ID), 
        1135073023 // второй администратор
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

// API: Получить данные админки
app.get('/api/admin/dashboard/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    // Разрешаем доступ обоим администраторам
    const allowedAdmins = [
        parseInt(process.env.OWNER_TELEGRAM_ID), 
        1135073023 // второй администратор
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

// API: Вывод прибыли владельцу
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

        // Выводим через Crypto Pay
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

    // Разрешаем доступ обоим администраторам
    const allowedAdmins = [
        parseInt(process.env.OWNER_TELEGRAM_ID), 
        1135073023
    ];
    
    if (!allowedAdmins.includes(parseInt(telegramId))) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        const targetUser = users.findOne({ telegram_id: parseInt(targetTelegramId) });
        
        if (!targetUser) {
            return res.status(404).json({ error: 'Target user not found' });
        }

        users.update({
            ...targetUser,
            demo_balance: targetUser.demo_balance + amount
        });

        logAdminAction('add_demo_balance', telegramId, { 
            target_user: targetTelegramId, 
            amount: amount 
        });

        res.json({
            success: true,
            message: `Added ${amount} demo TON to user ${targetTelegramId}`,
            new_balance: targetUser.demo_balance + amount
        });
    } catch (error) {
        console.error('Add demo balance error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Получить историю игр Mines
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

// API: Получить историю игр Rocket
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

// API: Получить историю ставок Rocket
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

// API: Получить всех пользователей
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

app.post('/api/admin/sync-balance', async (req, res) => {
    const { telegramId } = req.body;
    
    // Разрешаем доступ обоим администраторам
    const allowedAdmins = [
        parseInt(process.env.OWNER_TELEGRAM_ID), 
        1135073023
    ];
    
    if (!allowedAdmins.includes(parseInt(telegramId))) {
        return res.status(403).json({ error: 'Access denied' });
    }

    try {
        await syncCasinoBalance();
        const bank = getCasinoBank();
        
        res.json({
            success: true,
            balance: bank.total_balance,
            message: 'Баланс синхронизирован с Crypto Bot'
        });
    } catch (error) {
        console.error('Sync balance error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Синхронизировать баланс вручную
// API: Создать инвойс для депозита
app.post('/api/create-invoice', async (req, res) => {
    const { telegramId, amount, demoMode } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // НОВАЯ ПРОВЕРКА: Минимальный депозит 3 TON
        if (amount < 3) {
            return res.status(400).json({ error: 'Минимальный депозит: 3 TON' });
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
            // Сохраняем транзакцию как ожидающую
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

// API: Проверить статус инвойса
app.post('/api/check-invoice', async (req, res) => {
    const { invoiceId, demoMode } = req.body;

    try {
        const invoice = await cryptoPayRequest('getInvoices', {
            invoice_ids: invoiceId
        }, demoMode);

        if (invoice.ok && invoice.result.items.length > 0) {
            const invoiceData = invoice.result.items[0];
            
            if (invoiceData.status === 'paid') {
                // Находим транзакцию и обновляем баланс
                const transaction = transactions.findOne({ invoice_id: invoiceId });
                
                if (transaction && transaction.status === 'pending') {
                    const user = users.get(transaction.user_id);
                    
                    if (demoMode) {
                        users.update({
                            ...user,
                            demo_balance: user.demo_balance + transaction.amount,
                            total_deposits: (user.total_deposits || 0) + transaction.amount
                        });
                    } else {
                        users.update({
                            ...user,
                            main_balance: user.main_balance + transaction.amount,
                            total_deposits: (user.total_deposits || 0) + transaction.amount
                        });
                        // ИСПРАВЛЕНО: Депозиты не должны влиять на банк казино
                        // updateCasinoBank(transaction.amount); - убрано
                    }

                    // Обновляем статус транзакции
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
                    res.json({ success: false, status: 'not_found' });
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

// API: Создать вывод средств
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

        // НОВАЯ ПРОВЕРКА: Отыгрыш x3 от общих депозитов
        const totalDeposits = user.total_deposits || 0;
        const requiredWager = totalDeposits * 3;
        
        // Считаем общую сумму ставок пользователя
        const userTransactions = transactions.find({ 
            user_id: user.$loki, 
            demo_mode: demoMode,
            status: 'completed'
        });
        
        const totalWagered = userTransactions
            .filter(t => t.type.includes('loss') || t.type.includes('bet'))
            .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        if (totalWagered < requiredWager) {
            const remaining = requiredWager - totalWagered;
            return res.status(400).json({ 
                error: 'Недостаточно отыгрыша',
                wagered: totalWagered,
                required: requiredWager,
                remaining: remaining,
                message: `Необходимо отыграть еще ${remaining.toFixed(2)} TON (x3 от депозитов)`
            });
        }

        if (demoMode) {
            // Для демо режима просто списываем баланс
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
            // Для реального режима создаем вывод через Crypto Pay
            const transfer = await cryptoPayRequest('transfer', {
                user_id: telegramId,
                asset: 'TON',
                amount: amount.toString(),
                spend_id: `withdrawal_${Date.now()}_${telegramId}`
            }, false);

            if (transfer.ok && transfer.result) {
                // Обновляем баланс пользователя и банк казино
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

// API: Получить транзакции пользователя
app.get('/api/transactions/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    try {
        const user = users.findOne({ telegram_id: telegramId });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userTransactions = transactions.find({ user_id: user.$loki })
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 50);

        res.json(userTransactions);
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Получить баланс пользователя
app.get('/api/user/balance/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);
    // Только эти два пользователя могут использовать демо режим
    const isAdminUser = telegramId === 842428912 || telegramId === 1135073023;

    try {
        const user = users.findOne({ telegram_id: telegramId });
        
        if (!user) {
            // Создаем нового пользователя если не найден
            const newUser = users.insert({
                telegram_id: telegramId,
                main_balance: 0,
                demo_balance: isAdminUser ? 50 : 0, // 50 TON для админов вместо 1000
                total_deposits: 0, // Новое поле
                created_at: new Date(),
                demo_mode: false,
                is_admin: telegramId === parseInt(process.env.OWNER_TELEGRAM_ID) || telegramId === 1135073023
            });
            
            res.json({
                main_balance: newUser.main_balance,
                demo_balance: newUser.demo_balance,
                demo_mode: newUser.demo_mode,
                is_admin: newUser.is_admin,
                total_deposits: newUser.total_deposits
            });
        } else {
            res.json({
                main_balance: user.main_balance,
                demo_balance: user.demo_balance,
                demo_mode: user.demo_mode,
                is_admin: user.is_admin,
                total_deposits: user.total_deposits || 0
            });
        }
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Переключить демо режим (только для админов)
app.post('/api/user/toggle-demo-mode', async (req, res) => {
    const { telegramId } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Проверяем, что это админ (только эти два ID могут использовать демо режим)
        if (parseInt(telegramId) !== 842428912 && parseInt(telegramId) !== 1135073023) {
            return res.status(403).json({ error: 'Demo mode not available' });
        }

        users.update({
            ...user,
            demo_mode: !user.demo_mode
        });

        console.log(`Пользователь ${telegramId} переключил демо режим: ${!user.demo_mode}`);

        res.json({
            success: true,
            demo_mode: !user.demo_mode
        });
    } catch (error) {
        console.error('Toggle demo mode error:', error);
        res.status(500).json({ error: 'Server error' });
    }
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

// Крон задача для проверки инвойсов каждую минуту
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
        demo_balance: user.demo_balance + transaction.amount,
        total_deposits: (user.total_deposits || 0) + transaction.amount
    });
    // Депозит не влияет на банк казино - это пополнение баланса пользователя
} else {
    users.update({
        ...user,
        main_balance: user.main_balance + transaction.amount,
        total_deposits: (user.total_deposits || 0) + transaction.amount
    });
    // Депозит не влияет на банк казино - это пополнение баланса пользователя
    // updateCasinoB    ank(transaction.amount); ← ЭТУ СТРОКУ НУЖНО УБРАТЬ!
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

// Запуск сервера
async function startServer() {
    await initDatabase();
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

startServer();