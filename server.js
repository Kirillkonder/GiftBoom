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
    targetRTP: 70,         // Целевой RTP 70% (увеличено с 60%)
    lastResetDate: new Date().toDateString()
  },
  demoBank: {
    dailyDeposits: 0,
    dailyPayouts: 0,
    currentRTP: 0,
    targetRTP: 70,         // Целевой RTP 70% (увеличено с 60%)
    lastResetDate: new Date().toDateString()
  }
};

// Боты для ракетки
const rocketBots = [
  { name: "Bot_1", minBet: 1, maxBet: 10, risk: "medium" },
  { name: "Bot_2", minBet: 5, maxBet: 20, risk: "high" },
  { name: "Bot_3", minBet: 0.5, maxBet: 5, risk: "low" }
];

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

                // Добавляем демо-банк казино
                if (!casinoDemoBank) {
                    casinoDemoBank = db.addCollection('casino_demo_bank');
                    casinoDemoBank.insert({
                        total_balance: 10000, // 10000 TON демо-банк
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
            targetRTP: 70,  // Увеличено до 70%
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
            targetRTP: 70,  // Увеличено до 70%
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

// НОВЫЙ ПСИХОЛОГИЧЕСКИЙ АЛГОРИТМ - подлавливаем игроков на азарте
let lastResults = []; // Память последних результатов
let playerBetHistory = new Map(); // История ставок каждого игрока

// Психологическая система управления
let psychologySystem = {
    lastHighWins: 0,    // Счетчик последовательных высоких выигрышей  
    lastLowWins: 0,     // Счетчик последовательных низких выигрышей
    randomSeed: Math.random() * 1000, // Случайное семя для непредсказуемости
    
    // Новые психологические параметры
    heatupPhase: false,  // Фаза "подогрева" - даем выигрыши на малых ставках
    trapMode: false,     // Режим "ловушки" - ждем большую ставку для слива
    consecutiveSmallWins: 0, // Подряд выигрышей на малых ставках
    lastBigBetResult: null   // Результат последней большой ставки
};

// Генерируем случайное число с учетом семени и психологии
function getSeededRandom() {
    return (psychologySystem.randomSeed / 233280 + Math.random()) / 2;
}

// Обновляем историю ставок игрока
function updatePlayerBetHistory(userId, betAmount, result) {
    if (!playerBetHistory.has(userId)) {
        playerBetHistory.set(userId, []);
    }
    
    const history = playerBetHistory.get(userId);
    history.unshift({ bet: betAmount, result: result, timestamp: Date.now() });
    
    // Храним только последние 20 ставок
    if (history.length > 20) {
        history.pop();
    }
}

// Анализ паттерна ставок игрока - определяем, стоит ли его "подогреть"
function analyzePlayerPattern(userId, currentBet) {
    const history = playerBetHistory.get(userId) || [];
    
    const recentBets = history.slice(0, 5); // Последние 5 ставок
    const smallBets = recentBets.filter(h => h.bet < 0.5).length;
    const recentWins = recentBets.filter(h => h.result >= 2.0).length;
    
    return {
        isNewPlayer: history.length < 3,           // Новый игрок
        preferSmallBets: smallBets >= 3,           // Предпочитает малые ставки  
        recentlyWon: recentWins >= 2,              // Недавно выигрывал
        currentBetSize: currentBet < 0.5 ? 'small' : currentBet < 2.0 ? 'medium' : 'big',
        increasedBet: history.length > 0 && currentBet > history[0].bet * 1.5  // Увеличил ставку
    };
}

// Определяем психологическую стратегию
function getPsychologyStrategy(totalBet, players) {
    const realPlayers = players.filter(p => !p.isBot && !p.demoMode);
    
    if (realPlayers.length === 0) return 'neutral';
    
    // Анализируем каждого игрока
    let shouldHeatup = false;
    let shouldTrap = false;
    
    realPlayers.forEach(player => {
        const pattern = analyzePlayerPattern(player.userId, player.betAmount);
        
        // Стратегия подогрева: новые игроки или те, кто ставит мало
        if (pattern.isNewPlayer || (pattern.preferSmallBets && pattern.currentBetSize === 'small')) {
            shouldHeatup = true;
        }
        
        // Стратегия ловушки: игрок увеличил ставку после выигрышей
        if (pattern.recentlyWon && pattern.increasedBet && pattern.currentBetSize !== 'small') {
            shouldTrap = true;
        }
    });
    
    // Обновляем состояние системы
    if (shouldHeatup && !shouldTrap) {
        psychologySystem.heatupPhase = true;
        psychologySystem.trapMode = false;
        return 'heatup'; // Подогреваем
    } else if (shouldTrap) {
        psychologySystem.trapMode = true;  
        psychologySystem.heatupPhase = false;
        return 'trap'; // Ловушка
    } else {
        return 'balanced'; // Обычная игра
    }
}

// Проверяем, нужно ли избегать паттерна
function shouldAvoidPattern(type) {
    if (type === 'high' && psychologySystem.lastHighWins >= 2) {
        return true; // Избегаем третий подряд высокий выигрыш
    }
    if (type === 'low' && psychologySystem.lastLowWins >= 4) {
        return true; // Избегаем пятый подряд низкий результат
    }
    return false;
}

// Обновляем систему защиты от паттернов (старая версия - удалена)

// ПСИХОЛОГИЧЕСКИЕ ФУНКЦИИ ГЕНЕРАЦИИ КРАШ-ПОИНТОВ

// Функция подогрева - даем выигрыши на малых ставках
function generateHeatupCrashPoint(totalBet) {
    const random = getSeededRandom() * 100;
    
    console.log(`🔥 ПОДОГРЕВ: ставка ${totalBet}, генерируем выигрышный результат`);
    
    if (totalBet < 0.5) {
        // Малые ставки - очень щедро!
        if (random < 15) return Math.random() * 0.3 + 1.2; // 15% мини-выигрыш 1.2-1.5x
        if (random < 45) return Math.random() * 1.5 + 2.0; // 30% средний 2.0-3.5x
        if (random < 75) return Math.random() * 3.0 + 4.0; // 30% хороший 4.0-7.0x
        return Math.random() * 15.0 + 8.0; // 25% отличный 8.0-23x
    } else if (totalBet < 2.0) {
        // Средние ставки - щедро, но не слишком
        if (random < 25) return Math.random() * 0.5 + 1.2; // 25% мини 1.2-1.7x
        if (random < 60) return Math.random() * 1.0 + 2.0; // 35% средний 2.0-3.0x
        if (random < 85) return Math.random() * 2.0 + 3.5; // 25% хороший 3.5-5.5x
        return Math.random() * 8.0 + 6.0; // 15% отличный 6.0-14x
    } else {
        // Большие ставки - умеренно
        if (random < 40) return Math.random() * 0.3 + 1.2; // 40% мини
        if (random < 70) return Math.random() * 0.8 + 2.0; // 30% средний
        if (random < 90) return Math.random() * 1.5 + 3.0; // 20% хороший
        return Math.random() * 5.0 + 5.0; // 10% отличный
    }
}

// Функция ловушки - сливаем после подогрева
function generateTrapCrashPoint(totalBet) {
    const random = getSeededRandom() * 100;
    
    console.log(`🪤 ЛОВУШКА: ставка ${totalBet}, сливаем после подогрева`);
    
    if (totalBet < 0.5) {
        // Малые ставки - все еще даем шанс (чтобы не спугнуть)
        if (random < 60) return Math.random() * 0.2 + 1.0; // 60% слив 1.0-1.2x
        if (random < 80) return Math.random() * 0.8 + 1.5; // 20% мини 1.5-2.3x
        return Math.random() * 2.0 + 2.5; // 20% средний 2.5-4.5x
    } else if (totalBet < 2.0) {
        // Средние ставки - больше сливов
        if (random < 75) return Math.random() * 0.15 + 1.0; // 75% слив 1.0-1.15x
        if (random < 90) return Math.random() * 0.5 + 1.3; // 15% мини 1.3-1.8x
        return Math.random() * 1.0 + 2.0; // 10% средний 2.0-3.0x  
    } else {
        // Большие ставки - жестко сливаем!
        if (random < 85) return Math.random() * 0.1 + 1.0; // 85% жесткий слив 1.0-1.1x
        if (random < 95) return Math.random() * 0.3 + 1.2; // 10% мини 1.2-1.5x
        return Math.random() * 1.0 + 1.8; // 5% средний 1.8-2.8x
    }
}

// Сбалансированная функция с учетом психологии
function generatePsychologyBalancedCrashPoint(totalBet) {
    const random = getSeededRandom() * 100;
    
    // Учитываем размер ставки в балансированной стратегии
    if (totalBet < 0.5) {
        // Малые ставки - слегка в пользу игрока
        if (random < 35) return Math.random() * 0.2 + 1.0; // 35% слив
        if (random < 60) return Math.random() * 0.8 + 1.5; // 25% мини
        if (random < 80) return Math.random() * 1.5 + 2.5; // 20% средний
        return Math.random() * 6.0 + 4.0; // 20% хороший
    } else if (totalBet < 2.0) {
        // Средние ставки - нейтрально
        if (random < 50) return Math.random() * 0.15 + 1.0; // 50% слив
        if (random < 75) return Math.random() * 0.8 + 1.5; // 25% мини
        if (random < 90) return Math.random() * 1.2 + 2.5; // 15% средний
        return Math.random() * 4.0 + 4.0; // 10% хороший
    } else {
        // Большие ставки - в пользу казино
        if (random < 65) return Math.random() * 0.15 + 1.0; // 65% слив
        if (random < 85) return Math.random() * 0.6 + 1.3; // 20% мини
        if (random < 95) return Math.random() * 1.0 + 2.0; // 10% средний
        return Math.random() * 3.0 + 3.5; // 5% хороший
    }
}

// НОВЫЙ ПСИХОЛОГИЧЕСКИЙ АЛГОРИТМ - основная функция генерации
function generateUnpredictableRealBankCrashPoint(totalBet, bankBalance, rtpStats, players = []) {
    resetDailyRTP();
    
    // Определяем психологическую стратегию
    const strategy = getPsychologyStrategy(totalBet, players);
    
    console.log(`💰 Реальный банк: ${bankBalance}, стратегия: ${strategy}, ставка: ${totalBet}`);
    
    // Если банк критически мал - пополняем, но с учетом психологии
    if (bankBalance < 50) {
        console.log(`⚠️ Критически малый банк (${bankBalance}), пополняем`);
        
        if (strategy === 'heatup' && totalBet < 0.5) {
            // Даем небольшой выигрыш даже при малом банке для подогрева
            if (getSeededRandom() < 0.3) {
                return Math.random() * 1.0 + 1.5; // 30% шанс на 1.5-2.5x
            }
        }
        
        // Основной слив при малом банке
        if (getSeededRandom() < 0.75) {
            return Math.random() * 0.15 + 1.00; // 75% слив 1.0-1.15x
        }
        return Math.random() * 0.5 + 1.2; // 25% мини выигрыш
    }
    
    // Если банк мал - пополняем мягче
    if (bankBalance < 200) {
        console.log(`⚠️ Малый банк (${bankBalance}), мягкое пополнение`);
        
        if (strategy === 'heatup') {
            // В режиме подогрева даем больше шансов
            if (getSeededRandom() < 0.5) {
                return generateHeatupCrashPoint(totalBet);
            }
        }
        
        // Обычный слив при малом банке  
        if (getSeededRandom() < 0.65) {
            return Math.random() * 0.2 + 1.00; // 65% слив
        }
        return Math.random() * 1.5 + 1.5; // 35% средний выигрыш
    }
    
    // Основная психологическая логика
    const currentRTP = rtpStats.currentRTP;
    const targetRTP = rtpStats.targetRTP;
    const rtpVariance = (getSeededRandom() - 0.5) * 8;
    const adjustedTargetRTP = targetRTP + rtpVariance;
    
    // Выбираем алгоритм в зависимости от стратегии
    switch (strategy) {
        case 'heatup':
            // Подогреваем - даем выигрыши
            psychologySystem.consecutiveSmallWins++;
            return generateHeatupCrashPoint(totalBet);
            
        case 'trap':
            // Ловушка - сливаем после подогрева
            psychologySystem.consecutiveSmallWins = 0;
            return generateTrapCrashPoint(totalBet);
            
        case 'balanced':
        default:
            // Обычная логика с учетом RTP и психологии
            if (currentRTP < adjustedTargetRTP - 10) {
                return generatePsychologyBalancedCrashPoint(totalBet);
            } else if (currentRTP < adjustedTargetRTP + 5) {
                return generatePsychologyBalancedCrashPoint(totalBet);
            } else {
                // RTP превышен - больше сливов, но учитываем размер ставки
                if (totalBet < 0.5) {
                    return generatePsychologyBalancedCrashPoint(totalBet); // Малые ставки - щадим
                } else {
                    return generateTrapCrashPoint(totalBet); // Большие ставки - сливаем
                }
            }
    }
}

// НОВЫЙ АЛГОРИТМ ДЛЯ ДЕМО БАНКА - более щадящий
function generateUnpredictableDemoBankCrashPoint(totalBet, rtpStats, players = []) {
    const strategy = getPsychologyStrategy(totalBet, players);
    
    console.log(`🎮 Демо банк, стратегия: ${strategy}, ставка: ${totalBet}`);
    
    // Демо банк более щедрый - RTP выше
    const currentRTP = rtpStats.currentRTP;
    const targetRTP = rtpStats.targetRTP + 5; // +5% к целевому RTP для демо
    const rtpVariance = (getSeededRandom() - 0.5) * 6;
    const adjustedTargetRTP = targetRTP + rtpVariance;
    
    switch (strategy) {
        case 'heatup':
            return generateHeatupCrashPoint(totalBet);
            
        case 'trap':
            // В демо режиме ловушки мягче
            const random = getSeededRandom() * 100;
            if (totalBet < 1.0) {
                // Малые ставки в демо - очень щадим
                if (random < 40) return Math.random() * 0.3 + 1.0; // 40% слив
                return generatePsychologyBalancedCrashPoint(totalBet);
            } else {
                return generateTrapCrashPoint(totalBet);
            }
            
        case 'balanced':
        default:
            if (currentRTP < adjustedTargetRTP - 5) {
                return generateHeatupCrashPoint(totalBet); // Даем выигрыши
            } else {
                return generatePsychologyBalancedCrashPoint(totalBet);
            }
    }
}

// ГЛАВНАЯ ФУНКЦИЯ ГЕНЕРАЦИИ С ПСИХОЛОГИЧЕСКИМ АЛГОРИТМОМ
function generateCrashPoint(players = []) {
    resetDailyRTP();
    
    // Администраторы (могут играть на демо балансе)
    const adminIds = [
        parseInt(process.env.OWNER_TELEGRAM_ID) || 842428912,
        1135073023
    ];
    
    // Фильтруем игроков: исключаем ставки админов если есть реальные игроки
    const realPlayers = players.filter(p => !p.isBot && !p.demoMode);
    const realNonAdminPlayers = realPlayers.filter(p => !adminIds.includes(parseInt(p.userId)));
    const demoPlayers = players.filter(p => !p.isBot && p.demoMode);
    
    // Если есть хотя бы один реальный игрок (не админ), исключаем ставки админов
    let effectivePlayers = [...players];
    if (realNonAdminPlayers.length > 0) {
        effectivePlayers = players.filter(p => p.isBot || !adminIds.includes(parseInt(p.userId)));
        console.log(`Исключены ставки админов: есть ${realNonAdminPlayers.length} реальных игроков`);
    }
    
    const effectiveRealPlayers = effectivePlayers.filter(p => !p.isBot && !p.demoMode);
    const effectiveDemoPlayers = effectivePlayers.filter(p => !p.isBot && p.demoMode);
    
    const totalRealBet = effectiveRealPlayers.reduce((sum, p) => sum + p.betAmount, 0);
    const totalDemoBet = effectiveDemoPlayers.reduce((sum, p) => sum + p.betAmount, 0);
    
    // Получаем состояние банков
    const realBank = getCasinoBank();
    const demoBank = getCasinoDemoBank();
    
    // Основная психологическая логика
    let crashPoint = 1.00;
    
    if (totalRealBet > 0) {
        // Передаем игроков для психологического анализа
        crashPoint = generateUnpredictableRealBankCrashPoint(
            totalRealBet, 
            realBank.total_balance, 
            rtpSystem.realBank,
            effectiveRealPlayers
        );
        
        // Обновляем историю ставок реальных игроков
        effectiveRealPlayers.forEach(player => {
            updatePlayerBetHistory(player.userId, player.betAmount, crashPoint);
        });
        
    } else if (totalDemoBet > 0) {
        // Демо игроки
        crashPoint = generateUnpredictableDemoBankCrashPoint(
            totalDemoBet, 
            rtpSystem.demoBank,
            effectiveDemoPlayers
        );
        
        // Обновляем историю ставок демо игроков
        effectiveDemoPlayers.forEach(player => {
            updatePlayerBetHistory(player.userId, player.betAmount, crashPoint);
        });
        
    } else {
        // Только боты - случайный краш для красоты
        crashPoint = generateRandomBotCrashPoint();
    }
    
    // Обновляем психологическую систему
    updatePsychologySystem(crashPoint, totalRealBet + totalDemoBet);
    
    return Math.max(1.00, crashPoint);
}

// Обновляем психологическую систему после каждой игры
function updatePsychologySystem(crashPoint, totalBet) {
    // Добавляем результат в историю
    lastResults.unshift(crashPoint);
    if (lastResults.length > 15) {
        lastResults.pop(); // Храним только последние 15 результатов
    }
    
    // Обновляем счетчики паттернов
    if (crashPoint >= 4.0) {
        psychologySystem.lastHighWins++;
        psychologySystem.lastLowWins = 0;
    } else if (crashPoint <= 1.3) {
        psychologySystem.lastLowWins++;
        psychologySystem.lastHighWins = 0;
    } else {
        psychologySystem.lastHighWins = 0;
        psychologySystem.lastLowWins = 0;
    }
    
    // Обновляем случайное семя для дополнительной непредсказуемости
    psychologySystem.randomSeed = (psychologySystem.randomSeed * 9301 + 49297) % 233280;
    
    // Логируем для анализа
    console.log(`🎲 Результат: ${crashPoint.toFixed(2)}x, ставка: ${totalBet}, система: подряд высоких: ${psychologySystem.lastHighWins}, подряд низких: ${psychologySystem.lastLowWins}`);
}

// Генерация для ботов с красивыми результатами
function generateRandomBotCrashPoint() {
    const random = getSeededRandom() * 100;
    
    if (random < 25) return Math.random() * 2 + 2; // 2x - 4x
    if (random < 50) return Math.random() * 4 + 4; // 4x - 8x
    if (random < 75) return Math.random() * 8 + 8; // 8x - 16x
    if (random < 90) return Math.random() * 15 + 15; // 15x - 30x
    return Math.random() * 30 + 30; // 30x - 60x (иногда очень высокие для красоты)
}

// УДАЛЕНЫ СТАРЫЕ ДУБЛИРУЮЩИЕСЯ ФУНКЦИИ - ИСПОЛЬЗУЕМ ТОЛЬКО НОВЫЙ ПСИХОЛОГИЧЕСКИЙ АЛГОРИТМ

// УДАЛЕНА СТАРАЯ ВЕРСИЯ ДЕМО ФУНКЦИИ - ИСПОЛЬЗУЕТСЯ НОВАЯ ВЫШЕ

// Генерация для ботов с красивыми результатами
function generateRandomBotCrashPoint() {
    const random = getSeededRandom() * 100;
    
    if (random < 25) return Math.random() * 2 + 2; // 2x - 4x
    if (random < 50) return Math.random() * 4 + 4; // 4x - 8x
    if (random < 75) return Math.random() * 8 + 8; // 8x - 16x
    if (random < 90) return Math.random() * 15 + 15; // 15x - 30x
    return Math.random() * 30 + 30; // 30x - 60x (иногда очень высокие для красоты)
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


// server.js - исправленная функция processRocketGameEnd
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
          // Игрок выиграл - выплачиваем выигрыш
          const winAmount = player.betAmount * player.cashoutMultiplier;
          
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

          // Записываем транзакцию
          transactions.insert({
            user_id: user.$loki,
            amount: winAmount,
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
            win_amount: winAmount,
            demo_mode: player.demoMode,
            created_at: new Date()
          });
        } else {
          // Игрок проиграл - ставка остается в банке казино (уже была добавлена при ставке)
          // Записываем проигрышную транзакцию
          transactions.insert({
            user_id: user.$loki,
            amount: -player.betAmount,
            type: 'rocket_loss',
            status: 'completed',
            demo_mode: player.demoMode,
            game_id: gameRecord.$loki,
            created_at: new Date()
          });

          // Сохраняем проигрышную ставку
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

// API: Получить историю транзакций
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

// API: Создать инвойс для депозита
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
                            demo_balance: user.demo_balance + transaction.amount
                        });
                    } else {
                        users.update({
                            ...user,
                            main_balance: user.main_balance + transaction.amount
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
                demo_balance: isAdminUser ? 1000 : 0, // Демо баланс только для админов
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

        // Списываем ставку
       if (demoMode) {
    users.update({
        ...user,
        demo_balance: user.demo_balance - betAmount
    });
    updateCasinoDemoBank(betAmount); // ИСПРАВЛЕНО: добавлено обновление демо банка
} else {
    users.update({
        ...user,
        main_balance: user.main_balance - betAmount
    });
    updateCasinoBank(betAmount); // Реальный банк
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

        // Проверяем, попал ли на мину
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
            // Добавляем открытую ячейку
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
    updateCasinoDemoBank(-winAmount); // Демо-банк
} else {
    users.update({
        ...user,
        main_balance: user.main_balance + winAmount
    });
    updateCasinoBank(-winAmount); // Реальный банк
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
    const { telegramId, betAmount, demoMode } = req.body;

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

        if (rocketGame.status !== 'counting') {
            return res.status(400).json({ error: 'Ставки не принимаются' });
        }

        // Списываем ставку и обновляем RTP статистику
        if (demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance - betAmount
            });
            updateCasinoDemoBank(betAmount); // ИСПРАВЛЕНО: ставки должны добавляться в банк (+)
            // Обновляем RTP статистику для демо банка
            updateRTPStats('demoBank', betAmount, 0);
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance - betAmount
            });
            updateCasinoBank(betAmount);
            // Обновляем RTP статистику для реального банка
            updateRTPStats('realBank', betAmount, 0);
        }

        // Добавляем игрока в текущую игру
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

        // Начисляем выигрыш и обновляем RTP статистику
        const winAmount = player.betAmount * rocketGame.multiplier;
        
        if (player.demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance + winAmount
            });
            updateCasinoDemoBank(-winAmount);
            // Обновляем RTP статистику для демо банка (только выплата)
            updateRTPStats('demoBank', 0, winAmount);
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance + winAmount
            });
            updateCasinoBank(-winAmount);
            // Обновляем RTP статистику для реального банка (только выплата)
            updateRTPStats('realBank', 0, winAmount);
        }

        // Обновляем данные игрока
        player.cashedOut = true;
        player.cashoutMultiplier = rocketGame.multiplier;
        player.winAmount = winAmount;

        // Сохраняем транзакцию сразу
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
        demo_balance: user.demo_balance + transaction.amount
    });
    updateCasinoDemoBank(transaction.amount); // Демо-банк
} else {
    users.update({
        ...user,
        main_balance: user.main_balance + transaction.amount
    });
    updateCasinoBank(transaction.amount); // Реальный банк
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
    resetDailyRTP(); // Инициализируем RTP систему
    startRocketGame(); // Запускаем игру ракетка
    console.log(`TON Casino Server started on port ${PORT}`);
    console.log(`RTP система инициализирована. Целевой RTP: 60%`);
}

// Крон задача для сброса RTP каждый день в 00:00
cron.schedule('0 0 * * *', () => {
    console.log('Сброс дневного RTP...');
    resetDailyRTP();
    console.log('RTP сброшен на новый день');
});

startServer();