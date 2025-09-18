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
  history: []
};

// RTP система - отслеживание доходности за день
let rtpSystem = {
  realBank: {
    dailyDeposits: 0,      // Общие депозиты за день
    dailyPayouts: 0,       // Общие выплаты за день
    currentRTP: 0,         // Текущий RTP в процентах
    targetRTP: 65,         // Целевой RTP 65% (оптимальный для казино)
    lastResetDate: new Date().toDateString()
  },
  demoBank: {
    dailyDeposits: 0,
    dailyPayouts: 0,
    currentRTP: 0,
    targetRTP: 75,         // Демо более щедрый для привлечения
    lastResetDate: new Date().toDateString()
  }
};

// Система профилирования игроков для психологического управления
let playerProfiles = new Map(); // telegramId -> profile

// Создание/обновление профиля игрока
function updatePlayerProfile(telegramId, betAmount, result, demoMode) {
  const key = `${telegramId}_${demoMode ? 'demo' : 'real'}`;
  
  if (!playerProfiles.has(key)) {
    playerProfiles.set(key, {
      totalBets: 0,
      totalWins: 0,
      totalLosses: 0,
      avgBetSize: 0,
      maxBet: 0,
      winStreak: 0,
      lossStreak: 0,
      lastResults: [],
      riskLevel: 'unknown', // unknown, conservative, moderate, aggressive
      hookLevel: 0, // 0-100, уровень "подсадки"
      lastActivity: new Date(),
      betProgression: [], // история размеров ставок
      emotionalState: 'neutral' // neutral, excited, frustrated, hooked
    });
  }
  
  const profile = playerProfiles.get(key);
  profile.totalBets++;
  profile.avgBetSize = (profile.avgBetSize * (profile.totalBets - 1) + betAmount) / profile.totalBets;
  profile.maxBet = Math.max(profile.maxBet, betAmount);
  profile.lastActivity = new Date();
  profile.betProgression.push(betAmount);
  
  // Ограничиваем историю ставок
  if (profile.betProgression.length > 20) {
    profile.betProgression.shift();
  }
  
  if (result === 'win') {
    profile.totalWins++;
    profile.winStreak++;
    profile.lossStreak = 0;
  } else if (result === 'loss') {
    profile.totalLosses++;
    profile.lossStreak++;
    profile.winStreak = 0;
  }
  
  // Добавляем результат в историю
  profile.lastResults.unshift({result, betAmount, timestamp: new Date()});
  if (profile.lastResults.length > 15) {
    profile.lastResults.pop();
  }
  
  // Определяем уровень риска игрока
  if (profile.totalBets >= 5) {
    if (profile.avgBetSize >= 1.0) {
      profile.riskLevel = 'aggressive';
    } else if (profile.avgBetSize >= 0.3) {
      profile.riskLevel = 'moderate'; 
    } else {
      profile.riskLevel = 'conservative';
    }
  }
  
  // Рассчитываем уровень подсадки
  calculateHookLevel(profile);
  
  // Определяем эмоциональное состояние
  updateEmotionalState(profile);
  
  playerProfiles.set(key, profile);
}

// Расчет уровня "подсадки" игрока
function calculateHookLevel(profile) {
  let hookLevel = 0;
  
  // Частота игры (больше игр = больше подсадки)
  hookLevel += Math.min(profile.totalBets * 2, 30);
  
  // Прогрессия ставок (увеличение ставок = признак азарта)
  if (profile.betProgression.length >= 5) {
    const recent = profile.betProgression.slice(-5);
    const early = profile.betProgression.slice(0, 5);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const earlyAvg = early.reduce((a, b) => a + b, 0) / early.length;
    
    if (recentAvg > earlyAvg * 1.5) {
      hookLevel += 25; // Сильно увеличивает ставки = сильная подсадка
    } else if (recentAvg > earlyAvg * 1.2) {
      hookLevel += 15; // Умеренное увеличение
    }
  }
  
  // Длительные сессии
  if (profile.totalBets >= 20) hookLevel += 20;
  
  // Соотношение выигрышей к проигрышам
  const winRate = profile.totalWins / (profile.totalWins + profile.totalLosses);
  if (winRate < 0.3) hookLevel += 15; // Много проигрывает, но продолжает
  
  profile.hookLevel = Math.min(hookLevel, 100);
}

// Обновление эмоционального состояния
function updateEmotionalState(profile) {
  if (profile.winStreak >= 3) {
    profile.emotionalState = 'excited';
  } else if (profile.lossStreak >= 4) {
    profile.emotionalState = 'frustrated';
  } else if (profile.hookLevel >= 60) {
    profile.emotionalState = 'hooked';
  } else {
    profile.emotionalState = 'neutral';
  }
}

// Получение профиля игрока
function getPlayerProfile(telegramId, demoMode) {
  const key = `${telegramId}_${demoMode ? 'demo' : 'real'}`;
  return playerProfiles.get(key) || null;
}

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
            targetRTP: 65,  // Оптимизировано для прибыльности
            lastResetDate: today
        };
        
        // Сбрасываем также счетчики паттернов при дневном сбросе
        lastResults = [];
        antiPatternSystem = {
            lastHighWins: 0,
            lastLowWins: 0,
            randomSeed: Math.random() * 10000,
            sessionBias: Math.random(),
            microCycles: 0,
            lastPlayerTypes: []
        };
        
        // Очищаем старые профили игроков (старше 7 дней)
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        
        for (const [key, profile] of playerProfiles.entries()) {
            if (profile.lastActivity < weekAgo) {
                playerProfiles.delete(key);
            }
        }
        
        console.log('🔄 Сброшены дневные статистики RTP, паттерны и старые профили игроков');
    }
    
    if (rtpSystem.demoBank.lastResetDate !== today) {
        rtpSystem.demoBank = {
            dailyDeposits: 0,
            dailyPayouts: 0,
            currentRTP: 0,
            targetRTP: 75,  // Демо более щедрый
            lastResetDate: today
        };
    }
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

// НОВЫЙ ПСИХОЛОГИЧЕСКИ ХИТРЫЙ АЛГОРИТМ с профилированием игроков

// Усложненная система защиты от паттернов
let lastResults = []; // Память последних результатов
let antiPatternSystem = {
    lastHighWins: 0,    
    lastLowWins: 0,     
    randomSeed: Math.random() * 10000,
    sessionBias: Math.random(), // Смещение для всей сессии
    microCycles: 0, // Микроциклы для дополнительной непредсказуемости
    lastPlayerTypes: [] // История типов игроков (conservative/aggressive)
};

// Более сложный генератор случайных чисел
function getAdvancedRandom(seed = 0) {
    const baseSeed = antiPatternSystem.randomSeed + seed;
    const sessionFactor = antiPatternSystem.sessionBias;
    const timeFactor = (Date.now() % 86400000) / 86400000; // Время дня как фактор
    const cycleFactor = Math.sin(antiPatternSystem.microCycles * 0.1);
    
    return ((baseSeed * 9301 + 49297) % 233280 / 233280 + 
            Math.random() + 
            sessionFactor * 0.3 + 
            timeFactor * 0.2 + 
            cycleFactor * 0.1) % 1;
}

// Психологический анализ ситуации
function analyzePlayerPsychology(players) {
    const analysis = {
        shouldHookSmallBetters: false,
        shouldPunishLargeBetters: false,
        aggressionLevel: 0, // 0-10
        manipulationStrategy: 'neutral', // neutral, hook, punish, balance
        riskFactor: 1.0
    };
    
    let smallBetters = [];
    let largeBetters = [];
    let hookedPlayers = [];
    let frustratedPlayers = [];
    
    players.forEach(player => {
        if (player.isBot) return;
        
        const profile = getPlayerProfile(player.userId, player.demoMode);
        
        if (player.betAmount < 0.5) {
            smallBetters.push({player, profile});
        } else if (player.betAmount >= 1.0) {
            largeBetters.push({player, profile});
        }
        
        if (profile) {
            if (profile.hookLevel >= 50) {
                hookedPlayers.push({player, profile});
            }
            if (profile.emotionalState === 'frustrated') {
                frustratedPlayers.push({player, profile});
            }
        }
    });
    
    // Стратегия подсадки малых игроков
    if (smallBetters.length > 0 && largeBetters.length === 0) {
        // Только малые ставки - даем выигрыши для подсадки
        analysis.shouldHookSmallBetters = true;
        analysis.manipulationStrategy = 'hook';
        analysis.aggressionLevel = 2;
    }
    
    // Стратегия против крупных игроков  
    if (largeBetters.length > 0) {
        // Есть крупные ставки - больше вероятность слива
        analysis.shouldPunishLargeBetters = true;
        analysis.manipulationStrategy = 'punish';
        analysis.aggressionLevel = 7;
        
        // Но если игрок сильно фрустрирован, иногда даем выигрыш чтобы не потерять
        const veryFrustratedLarge = largeBetters.some(({profile}) => 
            profile && profile.lossStreak >= 6
        );
        if (veryFrustratedLarge && getAdvancedRandom() < 0.25) {
            analysis.aggressionLevel = 4; // Снижаем агрессию
        }
    }
    
    // Смешанная стратегия
    if (smallBetters.length > 0 && largeBetters.length > 0) {
        analysis.manipulationStrategy = 'balance';
        analysis.aggressionLevel = 5;
        
        // Если много подсаженных игроков, можем быть агрессивнее
        if (hookedPlayers.length >= 2) {
            analysis.aggressionLevel = 7;
        }
    }
    
    return analysis;
}

// Генерация краш-поинта для подсадки малых игроков
function generateHookingCrashPoint(totalBet, profiles) {
    const random = getAdvancedRandom();
    
    // Анализируем профили для определения стратегии
    let shouldGiveBigWin = false;
    let newPlayerCount = 0;
    
    profiles.forEach(profile => {
        if (!profile || profile.totalBets <= 3) {
            newPlayerCount++;
        }
    });
    
    // Новых игроков подсаживаем особенно щедро
    if (newPlayerCount > 0 && random < 0.6) {
        shouldGiveBigWin = true;
    }
    
    // Фрустрированным игрокам иногда даем надежду
    const frustratedCount = profiles.filter(p => 
        p && p.emotionalState === 'frustrated'
    ).length;
    
    if (frustratedCount > 0 && random < 0.4) {
        shouldGiveBigWin = true;
    }
    
    // Избегаем слишком очевидных паттернов
    if (shouldAvoidPattern('high')) {
        shouldGiveBigWin = false;
    }
    
    if (shouldGiveBigWin) {
        // Большие выигрыши для подсадки
        if (random < 0.3) return Math.random() * 3.0 + 4.0;  // 4x-7x
        if (random < 0.6) return Math.random() * 8.0 + 7.0;  // 7x-15x  
        return Math.random() * 15.0 + 15.0; // 15x-30x ДЖЕКПОТ!
    } else {
        // Умеренные выигрыши
        if (random < 0.15) return Math.random() * 0.2 + 1.0;  // 1.0x-1.2x
        if (random < 0.40) return Math.random() * 1.0 + 1.5;  // 1.5x-2.5x
        if (random < 0.75) return Math.random() * 2.0 + 2.5;  // 2.5x-4.5x
        return Math.random() * 4.0 + 5.0; // 5x-9x
    }
}

// Генерация краш-поинта для наказания крупных игроков
function generatePunishingCrashPoint(totalBet, profiles) {
    const random = getAdvancedRandom();
    
    // Анализ агрессивности крупных игроков
    let maxBetPlayer = null;
    let maxBet = 0;
    
    profiles.forEach(profile => {
        if (profile && profile.maxBet > maxBet) {
            maxBet = profile.maxBet;
            maxBetPlayer = profile;
        }
    });
    
    // Особо крупных игроков наказываем сильнее
    let aggressionMultiplier = 1.0;
    if (totalBet >= 5.0) aggressionMultiplier = 1.5;
    if (totalBet >= 10.0) aggressionMultiplier = 2.0;
    
    // Но избегаем слишком очевидного паттерна проигрышей
    if (shouldAvoidPattern('low')) {
        aggressionMultiplier *= 0.6;
    }
    
    const adjustedRandom = random * aggressionMultiplier;
    
    if (adjustedRandom < 0.65) {
        // Высокая вероятность проигрыша для крупных ставок
        return Math.random() * 0.25 + 1.00; // 1.00x-1.25x
    } else if (adjustedRandom < 0.85) {
        // Малые выигрыши  
        return Math.random() * 0.8 + 1.3; // 1.3x-2.1x
    } else if (adjustedRandom < 0.95) {
        // Средние выигрыши
        return Math.random() * 2.0 + 2.5; // 2.5x-4.5x
    } else {
        // Редкие крупные выигрыши для поддержания интереса
        return Math.random() * 8.0 + 6.0; // 6x-14x
    }
}

// Сбалансированная генерация для смешанных ставок
function generateBalancedManipulativeCrashPoint(totalBet, profiles, analysis) {
    const random = getAdvancedRandom();
    
    // Учитываем общий анализ ситуации
    let baseChance = 0.4; // Базовый шанс проигрыша
    
    // Корректируем в зависимости от уровня агрессии
    baseChance += (analysis.aggressionLevel - 5) * 0.05;
    
    // Учитываем состояние RTP
    const currentRTP = rtpSystem.realBank.currentRTP || rtpSystem.demoBank.currentRTP;
    if (currentRTP < 60) baseChance -= 0.1; // Если RTP низкий, даем больше выигрышей
    if (currentRTP > 75) baseChance += 0.15; // Если RTP высокий, больше проигрышей
    
    // Защита от паттернов
    if (shouldAvoidPattern('low')) baseChance -= 0.2;
    if (shouldAvoidPattern('high')) baseChance += 0.1;
    
    if (random < baseChance) {
        // Проигрыш
        return Math.random() * 0.3 + 1.0; // 1.0x-1.3x
    } else if (random < baseChance + 0.3) {
        // Малый выигрыш
        return Math.random() * 1.0 + 1.5; // 1.5x-2.5x
    } else if (random < baseChance + 0.5) {
        // Средний выигрыш  
        return Math.random() * 2.5 + 3.0; // 3x-5.5x
    } else {
        // Крупный выигрыш
        return Math.random() * 10.0 + 6.0; // 6x-16x
    }
}


// Обновляем систему защиты от паттернов
function updateAntiPatternSystem(crashPoint) {
    // Добавляем результат в историю
    lastResults.unshift(crashPoint);
    if (lastResults.length > 10) {
        lastResults.pop(); // Храним только последние 10 результатов
    }
    
    // Обновляем счетчики паттернов
    if (crashPoint >= 4.0) {
        antiPatternSystem.lastHighWins++;
        antiPatternSystem.lastLowWins = 0;
    } else if (crashPoint <= 1.5) {
        antiPatternSystem.lastLowWins++;
        antiPatternSystem.lastHighWins = 0;
    } else {
        antiPatternSystem.lastHighWins = 0;
        antiPatternSystem.lastLowWins = 0;
    }
    
    // Обновляем случайное семя для дополнительной непредсказуемости
    antiPatternSystem.randomSeed = (antiPatternSystem.randomSeed * 9301 + 49297) % 233280;
}

// Генерация среднего выигрыша для избежания паттернов
function generateMiddleWinCrashPoint(totalBet) {
    const random = getAdvancedRandom() * 100;
    
    if (totalBet >= 0.7) {
        return Math.random() * 2.0 + 2.0; // 2.0x - 4.0x средние выигрыши (улучшено)
    } else {
        return Math.random() * 3.0 + 2.5; // 2.5x - 5.5x для малых ставок (значительно улучшено)
    }
}

// Генерация для ботов с красивыми результатами
function generateRandomBotCrashPoint() {
    const random = getAdvancedRandom() * 100;
    
    if (random < 25) return Math.random() * 2 + 2; // 2x - 4x
    if (random < 50) return Math.random() * 4 + 4; // 4x - 8x
    if (random < 75) return Math.random() * 8 + 8; // 8x - 16x
    if (random < 90) return Math.random() * 15 + 15; // 15x - 30x
    return Math.random() * 30 + 30; // 30x - 60x (иногда очень высокие для красоты)
}

// Генерация краш-поинта с защитой от паттернов (выигрышный)
function generateAntiPatternWinningCrashPoint(totalBet) {
    // Если было много высоких выигрышей - даем средний
    if (shouldAvoidPattern('high')) {
        return generateMiddleWinCrashPoint(totalBet);
    }
    
    const random = getAdvancedRandom() * 100;
    const bonusChance = antiPatternSystem.lastLowWins * 15; // Бонус за предыдущие проигрыши
    
    // Учитываем размер ставки с улучшенной системой для малых ставок
    if (totalBet >= 0.7) { // Большие ставки - более консервативно
        if (random < 20 + bonusChance) return Math.random() * 0.4 + 1.0; // Малый выигрыш 1.0-1.4x
        if (random < 45 + bonusChance) return Math.random() * 0.8 + 1.8; // Средний 1.8-2.6x  
        if (random < 75 + bonusChance) return Math.random() * 2.0 + 3.0; // Большой 3.0-5.0x
        return Math.random() * 15.0 + 5.0; // Крупный 5.0-20x
    } else { // Малые ставки (0.1-0.6) - БОЛЬШЕ ШАНСОВ НА ВЫСОКИЕ МНОЖИТЕЛИ
        if (random < 10 + bonusChance) return Math.random() * 0.4 + 1.0; // Малый 1.0-1.4x
        if (random < 30 + bonusChance) return Math.random() * 1.0 + 2.0; // Средний 2.0-3.0x
        if (random < 60 + bonusChance) return Math.random() * 5.0 + 4.0; // Большой 4.0-9.0x  
        return Math.random() * 25.0 + 10.0; // КРУПНЫЙ 10.0-35x (увеличено для малых ставок!)
    }
}

// Генерация сбалансированного краш-поинта с защитой от паттернов
function generateAntiPatternBalancedCrashPoint(totalBet) {
    const random = getAdvancedRandom() * 100;
    
    // Если был паттерн проигрышей - увеличиваем шанс выигрыша
    const winBonus = antiPatternSystem.lastLowWins * 10;
    // Если был паттерн выигрышей - уменьшаем шанс высокого выигрыша
    const highWinPenalty = antiPatternSystem.lastHighWins * 15;
    
    if (totalBet >= 0.7) {
        if (random < 35 - winBonus) return Math.random() * 0.15 + 1.00; // Проигрыш
        if (random < 55 - winBonus) return Math.random() * 0.6 + 1.0;   // Малый
        if (random < 75 - winBonus) return Math.random() * 1.0 + 2.0;   // Средний
        if (random < 90 - highWinPenalty) return Math.random() * 3.0 + 4.0; // Большой
        return Math.random() * 18.0 + 7.0; // Крупный 7.0-25x
    } else {
        if (random < 25 - winBonus) return Math.random() * 0.15 + 1.00; // Проигрыш (уменьшено)
        if (random < 40 - winBonus) return Math.random() * 0.8 + 1.2;   // Малый
        if (random < 60 - winBonus) return Math.random() * 2.0 + 2.5;   // Средний  
        if (random < 85 - highWinPenalty) return Math.random() * 8.0 + 5.0; // Большой
        return Math.random() * 30.0 + 15.0; // КРУПНЫЙ 15.0-45x для малых ставок!
    }
}

// Генерация проигрышного краш-поинта с защитой от паттернов
function generateAntiPatternLosingCrashPoint(totalBet) {
    // Если было много проигрышей подряд - даем средний выигрыш
    if (shouldAvoidPattern('low')) {
        return generateMiddleWinCrashPoint(totalBet);
    }
    
    const random = getAdvancedRandom() * 100;
    
    if (totalBet >= 0.7) {
        if (random < 60) return Math.random() * 0.15 + 1.00; // 60% проигрыш (снижено с 75%)
        if (random < 75) return Math.random() * 0.6 + 1.0;   // 15% малый
        if (random < 88) return Math.random() * 1.0 + 2.0;   // 13% средний
        return Math.random() * 6.0 + 4.0; // 12% большой (улучшено)
    } else {
        if (random < 50) return Math.random() * 0.15 + 1.00; // 50% проигрыш (снижено с 65%)
        if (random < 65) return Math.random() * 0.8 + 1.2;   // 15% малый
        if (random < 80) return Math.random() * 2.0 + 2.5;   // 15% средний
        return Math.random() * 12.0 + 6.0; // 20% большой (значительно улучшено для малых ставок)
    }
}

// Обновленная функция проверки паттернов
function shouldAvoidPattern(type) {
    // Более сложная логика избежания паттернов
    if (type === 'high') {
        // Избегаем более 2 подряд высоких выигрышей
        if (antiPatternSystem.lastHighWins >= 2) return true;
        
        // Дополнительная проверка на основе истории
        const recentHighs = lastResults.slice(0, 5).filter(r => r >= 4.0).length;
        if (recentHighs >= 3) return true;
    }
    
    if (type === 'low') {
        // Избегаем более 4 подряд низких результатов  
        if (antiPatternSystem.lastLowWins >= 4) return true;
        
        // Проверяем на слишком много проигрышей подряд
        const recentLows = lastResults.slice(0, 6).filter(r => r <= 1.5).length;
        if (recentLows >= 5) return true;
    }
    
    return false;
}

// Дополнительные функции для более хитрого алгоритма

// Анализ "жадности" игрока по истории ставок
function analyzePlayerGreed(profile) {
    if (!profile || profile.betProgression.length < 3) return 'unknown';
    
    const recent = profile.betProgression.slice(-3);
    const increase = recent[2] - recent[0];
    
    if (increase > profile.avgBetSize * 0.5) return 'greedy'; // Резко увеличивает ставки
    if (increase > profile.avgBetSize * 0.2) return 'moderate';
    return 'conservative';
}

// Определение момента для "крючка" - когда игрок готов увеличить ставку
function isReadyForHook(profile) {
    if (!profile) return false;
    
    // Если игрок уже на крючке - можем быть агрессивнее
    if (profile.hookLevel >= 70) return false;
    
    // Если недавно выиграл и может увеличить ставку
    if (profile.winStreak >= 2 && profile.totalBets >= 5) return true;
    
    // Если фрустрирован, но еще играет - хороший момент для подсадки
    if (profile.emotionalState === 'frustrated' && profile.lossStreak <= 5) return true;
    
    return false;
}

// Расчет "налога на жадность" - чем жаднее игрок, тем меньше шансов
function calculateGreedPenalty(profiles, totalBet) {
    let penalty = 0;
    
    profiles.forEach(profile => {
        if (!profile) return;
        
        const greed = analyzePlayerGreed(profile);
        if (greed === 'greedy' && totalBet >= 1.0) {
            penalty += 0.15; // 15% штраф за жадность на крупных ставках
        } else if (greed === 'moderate' && totalBet >= 2.0) {
            penalty += 0.08; // 8% штраф за умеренную жадность
        }
    });
    
    return Math.min(penalty, 0.4); // Максимум 40% штрафа
}
function generateUnpredictableRealBankCrashPoint(totalBet, bankBalance, rtpStats) {
    // Если банк пустой или очень маленький - пополняем, но не слишком агрессивно
    if (bankBalance < 50) {
        console.log(`Реальный банк критически мал (${bankBalance}), умеренное пополнение`);
        // 70% шанс слива при критически малом банке (снижено с 90%)
        if (getAdvancedRandom() < 0.70) {
            return Math.random() * 0.2 + 1.00; // 1.00x - 1.20x (улучшено)
        }
        // 30% небольшие и средние выигрыши для баланса
        return Math.random() * 1.5 + 1.5; // 1.5x - 3.0x (улучшено)
    }
    // Если банк маленький - продолжаем пополнять, но мягче
    else if (bankBalance < 200) {
        console.log(`Реальный банк мал (${bankBalance}), мягкое пополнение`);
        // Избегаем слишком очевидного паттерна
        if (shouldAvoidPattern('low')) {
            return generateMiddleWinCrashPoint(totalBet);
        }
        // 65% шанс слива при малом банке (снижено с 80%)
        if (getAdvancedRandom() < 0.65) {
            return Math.random() * 0.25 + 1.00; // 1.00x - 1.25x (улучшено)
        }
        // 35% небольшие и средние выигрыши (увеличено с 20%)
        return Math.random() * 1.0 + 1.5; // 1.5x - 2.5x (улучшено)
    }
    
    const currentRTP = rtpStats.currentRTP;
    const targetRTP = rtpStats.targetRTP;
    
    // Добавляем дополнительную случайность к границам RTP
    const rtpVariance = (getAdvancedRandom() - 0.5) * 10; // ±5% случайное отклонение
    const adjustedTargetRTP = targetRTP + rtpVariance;
    
    // Если RTP значительно ниже цели - увеличиваем шансы на выигрыш
    if (currentRTP < adjustedTargetRTP - 10) {
        return generateAntiPatternWinningCrashPoint(totalBet);
    }
    // Если RTP приближается к цели - балансируем с учетом паттернов
    else if (currentRTP < adjustedTargetRTP + 5) {
        return generateAntiPatternBalancedCrashPoint(totalBet);
    }
    // Если RTP превышает цель - больше проигрышей, но избегаем паттернов
    else {
        return generateAntiPatternLosingCrashPoint(totalBet);
    }
}

// Непредсказуемый алгоритм для демо банка
function generateUnpredictableDemoBankCrashPoint(totalBet, rtpStats) {
    const currentRTP = rtpStats.currentRTP;
    const targetRTP = rtpStats.targetRTP;
    
    // Добавляем случайность к границам RTP
    const rtpVariance = (getAdvancedRandom() - 0.5) * 8;
    const adjustedTargetRTP = targetRTP + rtpVariance;
    
    if (currentRTP < adjustedTargetRTP - 8) {
        return generateAntiPatternWinningCrashPoint(totalBet);
    } else if (currentRTP < adjustedTargetRTP + 3) {
        return generateAntiPatternBalancedCrashPoint(totalBet);
    } else {
        return generateAntiPatternLosingCrashPoint(totalBet);
    }
}

function generateCrashPoint(players = []) {
    resetDailyRTP();
    
    // Обновляем микроциклы для дополнительной непредсказуемости
    antiPatternSystem.microCycles++;
    if (antiPatternSystem.microCycles > 1000) {
        antiPatternSystem.microCycles = 0;
        antiPatternSystem.sessionBias = Math.random(); // Новое смещение сессии
    }
    
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
    
    // Получаем банки
    const realBank = getCasinoBank();
    const demoBank = getCasinoDemoBank();
    
    // НОВАЯ ПСИХОЛОГИЧЕСКАЯ ЛОГИКА
    let crashPoint = 1.00;
    let activePlayers = [];
    let bankType = '';
    let totalBet = 0;
    
    if (totalRealBet > 0) {
        activePlayers = effectiveRealPlayers;
        bankType = 'realBank';
        totalBet = totalRealBet;
    } else if (totalDemoBet > 0) {
        activePlayers = effectiveDemoPlayers;
        bankType = 'demoBank';
        totalBet = totalDemoBet;
    } else {
        // Только боты - красивый случайный краш
        crashPoint = generateRandomBotCrashPoint();
        updateAntiPatternSystem(crashPoint);
        return Math.max(1.00, crashPoint);
    }
    
    // Получаем профили игроков
    const playerProfiles = activePlayers.map(player => {
        return getPlayerProfile(player.userId, player.demoMode);
    });
    
    // Психологический анализ ситуации
    const psychology = analyzePlayerPsychology(activePlayers);
    
    // Определяем стратегию генерации на основе анализа
    switch (psychology.manipulationStrategy) {
        case 'hook':
            // Подсаживаем малых игроков
            crashPoint = generateHookingCrashPoint(totalBet, playerProfiles);
            console.log(`🎣 ПОДСАДКА малых игроков (${totalBet} TON), краш: ${crashPoint.toFixed(2)}x`);
            break;
            
        case 'punish':
            // Наказываем крупных игроков  
            crashPoint = generatePunishingCrashPoint(totalBet, playerProfiles);
            console.log(`💸 НАКАЗАНИЕ крупных игроков (${totalBet} TON), краш: ${crashPoint.toFixed(2)}x`);
            break;
            
        case 'balance':
            // Сбалансированный подход
            crashPoint = generateBalancedManipulativeCrashPoint(totalBet, playerProfiles, psychology);
            console.log(`⚖️ БАЛАНС смешанных ставок (${totalBet} TON), краш: ${crashPoint.toFixed(2)}x`);
            break;
            
        default:
            // Fallback на старую логику
            if (bankType === 'realBank') {
                crashPoint = generateUnpredictableRealBankCrashPoint(totalBet, realBank.total_balance, rtpSystem.realBank);
            } else {
                crashPoint = generateUnpredictableDemoBankCrashPoint(totalBet, rtpSystem.demoBank, demoBank.total_balance);
            }
    }
    
    // Финальная проверка и корректировка
    crashPoint = Math.max(1.00, crashPoint);
    
    // Обновляем профили игроков с результатами
    const isWin = crashPoint >= 1.2; // Условная граница выигрыша
    activePlayers.forEach(player => {
        const result = isWin ? 'win' : 'loss';
        updatePlayerProfile(player.userId, player.betAmount, result, player.demoMode);
    });
    
    // Записываем результат в историю для анализа паттернов
    updateAntiPatternSystem(crashPoint);
    
    // Обновляем семя для следующего раунда
    antiPatternSystem.randomSeed = (antiPatternSystem.randomSeed * 16807) % 2147483647;
    
    return crashPoint;
}







// Генерация проигрышного краш-поинта с защитой от паттернов
function generateAntiPatternLosingCrashPoint(totalBet) {
    // Если было много проигрышей подряд - даем средний выигрыш
    if (shouldAvoidPattern('low')) {
        return generateMiddleWinCrashPoint(totalBet);
    }
    
    const random = getAdvancedRandom() * 100;
    
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
    console.log(`🎰 RTP система инициализирована. Психологический алгоритм активен. Реал: 65%, Демо: 75%`);
}

// Крон задача для сброса RTP каждый день в 00:00
cron.schedule('0 0 * * *', () => {
    console.log('Сброс дневного RTP...');
    resetDailyRTP();
    console.log('RTP сброшен на новый день');
});

startServer();