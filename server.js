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

// УЛУЧШЕННАЯ СИСТЕМА RTP с ДИНАМИЧЕСКИМИ НАСТРОЙКАМИ
let advancedRTPSystem = {
  realBank: {
    dailyDeposits: 0,
    dailyPayouts: 0,
    currentRTP: 0,
    targetRTP: 58,           // Снижен до 58% для реального банка
    adaptiveRTP: 58,         // Адаптивный RTP (изменяется динамически)
    maxRTP: 65,              // Максимальный RTP
    minRTP: 50,              // Минимальный RTP
    sessionPayouts: 0,       // Выплаты за сессию (последние 2 часа)
    sessionDeposits: 0,      // Депозиты за сессию
    lastResetDate: new Date().toDateString(),
    volatilityMode: 'normal' // normal, aggressive, conservative
  },
  demoBank: {
    dailyDeposits: 0,
    dailyPayouts: 0,
    currentRTP: 0,
    targetRTP: 62,           // Немного выше для демо-банка
    adaptiveRTP: 62,
    maxRTP: 70,
    minRTP: 55,
    sessionPayouts: 0,
    sessionDeposits: 0,
    lastResetDate: new Date().toDateString(),
    volatilityMode: 'normal'
  }
};

// ПРОДВИНУТАЯ СИСТЕМА ЗАЩИТЫ ОТ ПАТТЕРНОВ
let advancedAntiPatternSystem = {
  // История результатов с метаданными
  gameHistory: [],  
  
  // Отслеживание стриков
  streaks: {
    lowResults: 0,     // Подряд результаты < 2x
    highResults: 0,    // Подряд результаты > 5x
    veryHighResults: 0,// Подряд результаты > 10x
    averageResults: 0   // Подряд результаты 2x-5x
  },
  
  // Анализ ставок
  betAnalysis: {
    smallBetStreak: 0,    // Подряд мелкие ставки выигрывают
    largeBetStreak: 0,    // Подряд крупные ставки проигрывают
    patternDetected: false,
    lastBetSizes: [],     // История размеров ставок
    winRateByBetSize: {}  // Статистика по размерам ставок
  },
  
  // Система семян для непредсказуемости
  seeds: {
    primary: Math.random() * 999999,
    secondary: Math.random() * 777777,
    tertiary: Math.random() * 555555,
    quantum: Date.now() % 333333
  },
  
  // Волатильность
  volatility: {
    current: 1.0,      // Текущая волатильность
    target: 1.0,       // Целевая волатильность
    adjustment: 0.05   // Шаг корректировки
  }
};

// Боты для ракетки с улучшенным поведением
const rocketBots = [
  { name: "CryptoWhale_88", minBet: 2, maxBet: 15, risk: "high", winRate: 0.32 },
  { name: "DiamondHand_Pro", minBet: 0.5, maxBet: 8, risk: "medium", winRate: 0.45 },
  { name: "SafeTrader_21", minBet: 0.2, maxBet: 3, risk: "low", winRate: 0.55 },
  { name: "LuckyShark_777", minBet: 1, maxBet: 12, risk: "medium", winRate: 0.40 },
  { name: "RocketMaster_X", minBet: 3, maxBet: 20, risk: "high", winRate: 0.28 }
];

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

function logAdminAction(action, telegramId, details = {}) {
  adminLogs.insert({
    action: action,
    telegram_id: telegramId,
    details: details,
    created_at: new Date()
  });
}

function getCasinoBank() {
    return casinoBank.findOne({});
}

function getCasinoDemoBank() {
    return casinoDemoBank.findOne({});
}

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

// ================== УЛУЧШЕННЫЙ АЛГОРИТМ РАКЕТЫ ==================

// Сброс дневной статистики с улучшенной логикой
function resetAdvancedDailyRTP() {
    const today = new Date().toDateString();
    
    ['realBank', 'demoBank'].forEach(bankType => {
        const bank = advancedRTPSystem[bankType];
        
        if (bank.lastResetDate !== today) {
            // Сохраняем волатильность и адаптивные настройки
            const oldVolatilityMode = bank.volatilityMode;
            const oldAdaptiveRTP = bank.adaptiveRTP;
            
            bank.dailyDeposits = 0;
            bank.dailyPayouts = 0;
            bank.sessionDeposits = 0;
            bank.sessionPayouts = 0;
            bank.currentRTP = 0;
            bank.lastResetDate = today;
            
            // Корректируем адаптивный RTP на основе предыдущего дня
            if (oldAdaptiveRTP > bank.maxRTP) {
                bank.adaptiveRTP = bank.targetRTP + 2;
            } else if (oldAdaptiveRTP < bank.minRTP) {
                bank.adaptiveRTP = bank.targetRTP - 2;
            } else {
                bank.adaptiveRTP = bank.targetRTP;
            }
            
            console.log(`Сброс статистики ${bankType}: AdaptiveRTP=${bank.adaptiveRTP}%`);
        }
    });
    
    // Сбрасываем системы защиты от паттернов более мягко
    if (advancedAntiPatternSystem.gameHistory.length > 100) {
        advancedAntiPatternSystem.gameHistory = advancedAntiPatternSystem.gameHistory.slice(0, 20);
    }
    
    // Обновляем семена
    advancedAntiPatternSystem.seeds.primary = Math.random() * 999999;
    advancedAntiPatternSystem.seeds.secondary = Math.random() * 777777;
}

// Расчет текущего RTP с учетом сессии
function calculateAdvancedRTP(bankType) {
    const bank = advancedRTPSystem[bankType];
    if (bank.dailyDeposits === 0) return 0;
    
    const dailyRTP = (bank.dailyPayouts / bank.dailyDeposits) * 100;
    const sessionRTP = bank.sessionDeposits > 0 ? (bank.sessionPayouts / bank.sessionDeposits) * 100 : dailyRTP;
    
    // Весовое среднее дневного и сессионного RTP
    return dailyRTP * 0.7 + sessionRTP * 0.3;
}

// Обновление статистики RTP с сессионным трекингом
function updateAdvancedRTPStats(bankType, deposit, payout) {
    resetAdvancedDailyRTP();
    
    const bank = advancedRTPSystem[bankType];
    bank.dailyDeposits += deposit;
    bank.dailyPayouts += payout;
    bank.sessionDeposits += deposit;
    bank.sessionPayouts += payout;
    bank.currentRTP = calculateAdvancedRTP(bankType);
    
    // Адаптивная корректировка RTP
    adjustAdaptiveRTP(bankType);
    
    console.log(`${bankType}: RTP=${bank.currentRTP.toFixed(1)}%, AdaptiveRTP=${bank.adaptiveRTP}%, Volatility=${bank.volatilityMode}`);
}

// Адаптивная корректировка RTP
function adjustAdaptiveRTP(bankType) {
    const bank = advancedRTPSystem[bankType];
    const currentRTP = bank.currentRTP;
    
    // Корректируем адаптивный RTP на основе текущих результатов
    if (currentRTP > bank.targetRTP + 8) {
        bank.adaptiveRTP = Math.max(bank.minRTP, bank.adaptiveRTP - 1);
        bank.volatilityMode = 'aggressive';
    } else if (currentRTP < bank.targetRTP - 8) {
        bank.adaptiveRTP = Math.min(bank.maxRTP, bank.adaptiveRTP + 1);
        bank.volatilityMode = 'conservative';
    } else {
        bank.volatilityMode = 'normal';
    }
}

// Генерация продвинутого случайного числа
function generateAdvancedRandom(multiplier = 1) {
    const seeds = advancedAntiPatternSystem.seeds;
    
    // Комбинируем несколько источников случайности
    const quantum = (seeds.quantum * 16807) % 2147483647;
    const primary = (seeds.primary * 9301 + 49297) % 233280;
    const secondary = Math.sin(seeds.secondary) * 10000;
    const tertiary = Math.cos(seeds.tertiary * multiplier) * 10000;
    
    // Обновляем семена для следующего использования
    seeds.quantum = quantum;
    seeds.primary = primary;
    seeds.secondary = Math.abs(secondary);
    seeds.tertiary = Math.abs(tertiary);
    
    // Комбинированное случайное число
    const combined = (Math.abs(quantum) / 2147483647 + 
                     Math.abs(primary) / 233280 + 
                     Math.abs(secondary % 1) + 
                     Math.abs(tertiary % 1) + 
                     Math.random()) / 5;
    
    return combined % 1;
}

// Анализ размера ставки для применения пенальти
function analyzeBetSize(betAmount) {
    if (betAmount <= 0.1) return 'micro';      // Микро ставки
    if (betAmount <= 0.3) return 'tiny';       // Очень мелкие
    if (betAmount <= 0.6) return 'small';      // Мелкие
    if (betAmount <= 1.5) return 'medium';     // Средние
    if (betAmount <= 5.0) return 'large';      // Крупные
    return 'whale';                            // Киты
}

// Получение множителя пенальти для мелких ставок
function getSmallBetPenalty(betSize, betAmount) {
    const analysis = advancedAntiPatternSystem.betAnalysis;
    
    // Базовые пенальти
    const penalties = {
        micro: 0.85,   // 85% от нормальных шансов (жесткий пенальти)
        tiny: 0.90,    // 90% от нормальных шансов
        small: 0.94,   // 94% от нормальных шансов
        medium: 1.0,   // Без пенальти
        large: 1.05,   // Небольшой бонус
        whale: 1.10    // Бонус для крупных ставок
    };
    
    let penalty = penalties[betSize] || 1.0;
    
    // Дополнительные пенальти за стрики мелких выигрышных ставок
    if (betSize === 'micro' || betSize === 'tiny') {
        if (analysis.smallBetStreak >= 3) {
            penalty *= 0.75; // Дополнительный пенальти за стрик
        } else if (analysis.smallBetStreak >= 2) {
            penalty *= 0.85;
        }
    }
    
    // Отслеживаем размеры ставок для анализа паттернов
    analysis.lastBetSizes.push(betAmount);
    if (analysis.lastBetSizes.length > 20) {
        analysis.lastBetSizes.shift();
    }
    
    return penalty;
}

// Обновление анализа ставок после результата
function updateBetAnalysis(betAmount, crashPoint, won) {
    const betSize = analyzeBetSize(betAmount);
    const analysis = advancedAntiPatternSystem.betAnalysis;
    
    // Обновляем статистику по размерам ставок
    if (!analysis.winRateByBetSize[betSize]) {
        analysis.winRateByBetSize[betSize] = { wins: 0, total: 0 };
    }
    
    analysis.winRateByBetSize[betSize].total++;
    if (won) {
        analysis.winRateByBetSize[betSize].wins++;
    }
    
    // Отслеживаем стрики мелких ставок
    if ((betSize === 'micro' || betSize === 'tiny' || betSize === 'small') && won) {
        analysis.smallBetStreak++;
    } else {
        analysis.smallBetStreak = 0;
    }
    
    // Отслеживаем стрики крупных проигрышных ставок
    if ((betSize === 'large' || betSize === 'whale') && !won) {
        analysis.largeBetStreak++;
    } else {
        analysis.largeBetStreak = 0;
    }
}

// Детекция и предотвращение паттернов
function detectAndPreventPatterns(betAmount) {
    const streaks = advancedAntiPatternSystem.streaks;
    const analysis = advancedAntiPatternSystem.betAnalysis;
    
    let patternPenalty = 1.0;
    let patternBonus = 1.0;
    
    // Предотвращение стриков низких результатов
    if (streaks.lowResults >= 4) {
        patternBonus *= 1.3; // Увеличиваем шансы на хороший результат
    } else if (streaks.lowResults >= 3) {
        patternBonus *= 1.15;
    }
    
    // Предотвращение стриков высоких результатов
    if (streaks.highResults >= 2) {
        patternPenalty *= 0.7; // Уменьшаем шансы на высокий результат
    } else if (streaks.veryHighResults >= 1) {
        patternPenalty *= 0.5; // Сильно уменьшаем шансы на очень высокий
    }
    
    // Корректировка для мелких ставок после анализа паттернов
    const betSize = analyzeBetSize(betAmount);
    if (analysis.smallBetStreak >= 2 && (betSize === 'micro' || betSize === 'tiny')) {
        patternPenalty *= 0.6; // Сильное снижение шансов
    }
    
    return { patternPenalty, patternBonus };
}

// Обновление стриков после результата
function updateStreaks(crashPoint) {
    const streaks = advancedAntiPatternSystem.streaks;
    
    if (crashPoint < 2.0) {
        streaks.lowResults++;
        streaks.highResults = 0;
        streaks.veryHighResults = 0;
        streaks.averageResults = 0;
    } else if (crashPoint >= 10.0) {
        streaks.veryHighResults++;
        streaks.highResults++;
        streaks.lowResults = 0;
        streaks.averageResults = 0;
    } else if (crashPoint >= 5.0) {
        streaks.highResults++;
        streaks.lowResults = 0;
        streaks.veryHighResults = 0;
        streaks.averageResults = 0;
    } else {
        streaks.averageResults++;
        streaks.lowResults = 0;
        streaks.highResults = 0;
        streaks.veryHighResults = 0;
    }
    
    // Сохраняем в истории для дополнительного анализа
    advancedAntiPatternSystem.gameHistory.unshift({
        crashPoint,
        timestamp: Date.now(),
        streaks: { ...streaks }
    });
    
    // Ограничиваем размер истории
    if (advancedAntiPatternSystem.gameHistory.length > 50) {
        advancedAntiPatternSystem.gameHistory.pop();
    }
}

// Генерация краш-поинта для победы (улучшенная)
function generateWinningCrashPoint(totalBet, betSize, penalties) {
    const random = generateAdvancedRandom(totalBet);
    const { patternPenalty, patternBonus } = penalties;
    
    // Применяем пенальти к шансам
    const adjustedRandom = Math.min(0.99, random * patternPenalty * patternBonus);
    
    // Более строгие множители с учетом размера ставки
    switch (betSize) {
        case 'micro':
            if (adjustedRandom < 0.60) return 1.0 + Math.random() * 0.3; // 1.0-1.3x (60%)
            if (adjustedRandom < 0.85) return 1.3 + Math.random() * 0.5; // 1.3-1.8x (25%)
            if (adjustedRandom < 0.96) return 1.8 + Math.random() * 1.0; // 1.8-2.8x (11%)
            return 2.8 + Math.random() * 2.2; // 2.8-5.0x (4%)
            
        case 'tiny':
            if (adjustedRandom < 0.50) return 1.0 + Math.random() * 0.4; // 1.0-1.4x (50%)
            if (adjustedRandom < 0.75) return 1.4 + Math.random() * 0.8; // 1.4-2.2x (25%)
            if (adjustedRandom < 0.92) return 2.2 + Math.random() * 1.5; // 2.2-3.7x (17%)
            return 3.7 + Math.random() * 4.3; // 3.7-8.0x (8%)
            
        case 'small':
            if (adjustedRandom < 0.40) return 1.0 + Math.random() * 0.5; // 1.0-1.5x (40%)
            if (adjustedRandom < 0.65) return 1.5 + Math.random() * 1.0; // 1.5-2.5x (25%)
            if (adjustedRandom < 0.85) return 2.5 + Math.random() * 2.0; // 2.5-4.5x (20%)
            if (adjustedRandom < 0.96) return 4.5 + Math.random() * 4.0; // 4.5-8.5x (11%)
            return 8.5 + Math.random() * 11.5; // 8.5-20x (4%)
            
        case 'medium':
            if (adjustedRandom < 0.30) return 1.0 + Math.random() * 0.6; // 1.0-1.6x (30%)
            if (adjustedRandom < 0.55) return 1.6 + Math.random() * 1.2; // 1.6-2.8x (25%)
            if (adjustedRandom < 0.75) return 2.8 + Math.random() * 2.5; // 2.8-5.3x (20%)
            if (adjustedRandom < 0.90) return 5.3 + Math.random() * 5.0; // 5.3-10.3x (15%)
            return 10.3 + Math.random() * 19.7; // 10.3-30x (10%)
            
        case 'large':
        case 'whale':
            if (adjustedRandom < 0.25) return 1.0 + Math.random() * 0.8; // 1.0-1.8x (25%)
            if (adjustedRandom < 0.45) return 1.8 + Math.random() * 1.5; // 1.8-3.3x (20%)
            if (adjustedRandom < 0.65) return 3.3 + Math.random() * 3.0; // 3.3-6.3x (20%)
            if (adjustedRandom < 0.80) return 6.3 + Math.random() * 6.0; // 6.3-12.3x (15%)
            if (adjustedRandom < 0.92) return 12.3 + Math.random() * 12.0; // 12.3-24.3x (12%)
            return 24.3 + Math.random() * 25.7; // 24.3-50x (8%)
    }
    
    return 1.0 + Math.random() * 0.5; // Fallback
}

// Генерация краш-поинта для проигрыша (улучшенная)
function generateLosingCrashPoint(totalBet, betSize) {
    const random = generateAdvancedRandom(totalBet * 2);
    
    // Более агрессивные проигрыши для мелких ставок
    switch (betSize) {
        case 'micro':
        case 'tiny':
            if (random < 0.85) return 1.0 + Math.random() * 0.05; // 1.0-1.05x (85%)
            return 1.05 + Math.random() * 0.15; // 1.05-1.2x (15%)
            
        case 'small':
            if (random < 0.75) return 1.0 + Math.random() * 0.1; // 1.0-1.1x (75%)
            return 1.1 + Math.random() * 0.2; // 1.1-1.3x (25%)
            
        case 'medium':
            if (random < 0.65) return 1.0 + Math.random() * 0.15; // 1.0-1.15x (65%)
            return 1.15 + Math.random() * 0.25; // 1.15-1.4x (35%)
            
        case 'large':
        case 'whale':
            if (random < 0.55) return 1.0 + Math.random() * 0.2; // 1.0-1.2x (55%)
            return 1.2 + Math.random() * 0.3; // 1.2-1.5x (45%)
    }
    
    return 1.0 + Math.random() * 0.1;
}

// Генерация сбалансированного краш-поинта
function generateBalancedCrashPoint(totalBet, betSize, penalties) {
    const random = generateAdvancedRandom(totalBet * 1.5);
    const { patternPenalty, patternBonus } = penalties;
    
    // Определяем вероятности исходов с учетом пенальти
    let loseChance = 0.45;
    let smallWinChance = 0.30;
    let mediumWinChance = 0.20;
    let bigWinChance = 0.05;
    
    // Корректируем шансы для мелких ставок
    if (betSize === 'micro' || betSize === 'tiny') {
        loseChance *= 1.2;
        bigWinChance *= 0.3;
    } else if (betSize === 'small') {
        loseChance *= 1.1;
        bigWinChance *= 0.7;
    }
    
    // Применяем пенальти и бонусы
    loseChance *= patternPenalty;
    bigWinChance *= patternBonus;
    
    // Нормализуем вероятности
    const total = loseChance + smallWinChance + mediumWinChance + bigWinChance;
    loseChance /= total;
    smallWinChance /= total;
    mediumWinChance /= total;
    
    if (random < loseChance) {
        return generateLosingCrashPoint(totalBet, betSize);
    } else if (random < loseChance + smallWinChance) {
        return 1.0 + Math.random() * 1.5; // 1.0-2.5x
    } else if (random < loseChance + smallWinChance + mediumWinChance) {
        return 2.5 + Math.random() * 2.5; // 2.5-5.0x
    } else {
        return generateWinningCrashPoint(totalBet, betSize, penalties);
    }
}

// Основная функция генерации краш-поинта для реального банка
function generateAdvancedRealBankCrashPoint(totalBet, bankBalance, rtpStats) {
    resetAdvancedDailyRTP();
    
    const currentRTP = rtpStats.currentRTP;
    const targetRTP = rtpStats.adaptiveRTP;
    const volatilityMode = rtpStats.volatilityMode;
    
    // Анализируем размер ставки
    const betSize = analyzeBetSize(totalBet);
    const smallBetPenalty = getSmallBetPenalty(betSize, totalBet);
    
    // Получаем пенальти и бонусы от системы предотвращения паттернов
    const patternAdjustments = detectAndPreventPatterns(totalBet);
    patternAdjustments.patternPenalty *= smallBetPenalty;
    
    // Критическое состояние банка
    if (bankBalance < 100) {
        console.log(`Критически низкий банк: ${bankBalance}, агрессивное пополнение`);
        if (generateAdvancedRandom(bankBalance) < 0.80) {
            return generateLosingCrashPoint(totalBet, betSize);
        }
        return generateBalancedCrashPoint(totalBet, betSize, patternAdjustments);
    }
    
    // Низкий банк
    if (bankBalance < 300) {
        console.log(`Низкий банк: ${bankBalance}, пополнение`);
        if (generateAdvancedRandom(bankBalance) < 0.70) {
            return generateLosingCrashPoint(totalBet, betSize);
        }
        return generateBalancedCrashPoint(totalBet, betSize, patternAdjustments);
    }
    
    // RTP-ориентированная логика с учетом волатильности
    const rtpDifference = currentRTP - targetRTP;
    
    if (volatilityMode === 'aggressive') {
        // Агрессивный режим - больше проигрышей
        if (rtpDifference > 5 || generateAdvancedRandom(totalBet) < 0.60) {
            return generateLosingCrashPoint(totalBet, betSize);
        }
        return generateBalancedCrashPoint(totalBet, betSize, patternAdjustments);
    } else if (volatilityMode === 'conservative') {
        // Консервативный режим - больше выигрышей
        if (rtpDifference < -8) {
            return generateWinningCrashPoint(totalBet, betSize, patternAdjustments);
        }
        return generateBalancedCrashPoint(totalBet, betSize, patternAdjustments);
    } else {
        // Нормальный режим
        if (rtpDifference < -5) {
            return generateWinningCrashPoint(totalBet, betSize, patternAdjustments);
        } else if (rtpDifference > 8) {
            return generateLosingCrashPoint(totalBet, betSize);
        } else {
            return generateBalancedCrashPoint(totalBet, betSize, patternAdjustments);
        }
    }
}

// Основная функция генерации краш-поинта для демо банка
function generateAdvancedDemoBankCrashPoint(totalBet, rtpStats) {
    const currentRTP = rtpStats.currentRTP;
    const targetRTP = rtpStats.adaptiveRTP;
    
    const betSize = analyzeBetSize(totalBet);
    const smallBetPenalty = getSmallBetPenalty(betSize, totalBet);
    
    const patternAdjustments = detectAndPreventPatterns(totalBet);
    patternAdjustments.patternPenalty *= smallBetPenalty;
    
    const rtpDifference = currentRTP - targetRTP;
    
    // Демо банк более щедрый, но с защитой от мелких ставок
    if (rtpDifference < -4) {
        return generateWinningCrashPoint(totalBet, betSize, patternAdjustments);
    } else if (rtpDifference > 6) {
        return generateLosingCrashPoint(totalBet, betSize);
    } else {
        return generateBalancedCrashPoint(totalBet, betSize, patternAdjustments);
    }
}

// Генерация краш-поинта для ботов
function generateBotCrashPoint() {
    const random = generateAdvancedRandom(Date.now());
    
    // Красивые результаты для ботов
    if (random < 0.20) return 1.5 + Math.random() * 1.0; // 1.5-2.5x
    if (random < 0.40) return 2.5 + Math.random() * 2.0; // 2.5-4.5x
    if (random < 0.60) return 4.5 + Math.random() * 3.0; // 4.5-7.5x
    if (random < 0.80) return 7.5 + Math.random() * 7.5; // 7.5-15x
    if (random < 0.95) return 15 + Math.random() * 15;   // 15-30x
    return 30 + Math.random() * 70; // 30-100x (очень редко)
}

// Главная функция генерации краш-поинта
function generateCrashPoint(players = []) {
    resetAdvancedDailyRTP();
    
    const adminIds = [
        parseInt(process.env.OWNER_TELEGRAM_ID) || 842428912,
        1135073023
    ];
    
    // Фильтруем игроков
    const realPlayers = players.filter(p => !p.isBot && !p.demoMode);
    const realNonAdminPlayers = realPlayers.filter(p => !adminIds.includes(parseInt(p.userId)));
    const demoPlayers = players.filter(p => !p.isBot && p.demoMode);
    
    // Исключаем админов если есть реальные игроки
    let effectivePlayers = [...players];
    if (realNonAdminPlayers.length > 0) {
        effectivePlayers = players.filter(p => p.isBot || !adminIds.includes(parseInt(p.userId)));
        console.log(`Админы исключены: ${realNonAdminPlayers.length} реальных игроков`);
    }
    
    const effectiveRealPlayers = effectivePlayers.filter(p => !p.isBot && !p.demoMode);
    const effectiveDemoPlayers = effectivePlayers.filter(p => !p.isBot && p.demoMode);
    
    const totalRealBet = effectiveRealPlayers.reduce((sum, p) => sum + p.betAmount, 0);
    const totalDemoBet = effectiveDemoPlayers.reduce((sum, p) => sum + p.betAmount, 0);
    
    const realBank = getCasinoBank();
    const demoBank = getCasinoDemoBank();
    
    let crashPoint = 1.00;
    
    if (totalRealBet > 0) {
        crashPoint = generateAdvancedRealBankCrashPoint(
            totalRealBet, 
            realBank.total_balance, 
            advancedRTPSystem.realBank
        );
        
        // Обновляем анализ ставок
        effectiveRealPlayers.forEach(p => {
            updateBetAnalysis(p.betAmount, crashPoint, crashPoint >= 1.0);
        });
        
    } else if (totalDemoBet > 0) {
        crashPoint = generateAdvancedDemoBankCrashPoint(
            totalDemoBet, 
            advancedRTPSystem.demoBank
        );
        
        effectiveDemoPlayers.forEach(p => {
            updateBetAnalysis(p.betAmount, crashPoint, crashPoint >= 1.0);
        });
        
    } else {
        // Только боты
        crashPoint = generateBotCrashPoint();
    }
    
    // Обновляем стрики и системы защиты
    updateStreaks(crashPoint);
    
    // Логируем результат для анализа
    console.log(`CrashPoint: ${crashPoint.toFixed(2)}x, RealBet: ${totalRealBet}, DemoBet: ${totalDemoBet}, Streaks: L${advancedAntiPatternSystem.streaks.lowResults}|H${advancedAntiPatternSystem.streaks.highResults}`);
    
    return Math.max(1.00, crashPoint);
}

// Автоматическое добавление ботов
function addRocketBots() {
  if (rocketGame.status !== 'waiting') return;
  
  const botsToAdd = Math.floor(Math.random() * 3) + 1; // 1-3 бота
  
  for (let i = 0; i < botsToAdd; i++) {
    const bot = rocketBots[Math.floor(Math.random() * rocketBots.length)];
    const betAmount = Math.random() * (bot.maxBet - bot.minBet) + bot.minBet;
    const cashoutMultiplier = 1 + Math.random() * 3 + (bot.risk === 'high' ? 2 : bot.risk === 'medium' ? 1 : 0);
    
    // Проверяем, не добавлен ли уже этот бот
    if (!rocketGame.players.find(p => p.userId === bot.name)) {
      rocketGame.players.push({
        userId: bot.name,
        betAmount: Math.round(betAmount * 100) / 100,
        cashedOut: false,
        isBot: true,
        cashoutMultiplier: Math.round(cashoutMultiplier * 100) / 100,
        demoMode: false
      });
    }
  }
}

// Запуск игры ракетка
function startRocketGame() {
  if (rocketGame.status !== 'waiting') return;
  
  // Добавляем ботов
  addRocketBots();
  
  // Начинаем отсчет
  rocketGame.status = 'counting';
  rocketGame.startTime = Date.now() + 8000; // 8 секунд на ставки
  
  broadcastRocketUpdate();
  
  setTimeout(() => {
    if (rocketGame.status === 'counting') {
      launchRocket();
    }
  }, 8000);
}

// Запуск ракеты
function launchRocket() {
  if (rocketGame.status !== 'counting') return;
  
  // Генерируем краш-поинт
  rocketGame.crashPoint = generateCrashPoint(rocketGame.players);
  rocketGame.status = 'flying';
  rocketGame.startTime = Date.now();
  rocketGame.multiplier = 1.00;
  
  console.log(`🚀 Rocket launched! Crash point: ${rocketGame.crashPoint.toFixed(2)}x`);
  
  broadcastRocketUpdate();
  
  // Обновляем множитель каждые 100мс
  const interval = setInterval(() => {
    if (rocketGame.status !== 'flying') {
      clearInterval(interval);
      return;
    }
    
    const elapsed = Date.now() - rocketGame.startTime;
    const newMultiplier = 1 + (elapsed / 1000) * 0.1; // 0.1x каждую секунду
    
    rocketGame.multiplier = Math.round(newMultiplier * 100) / 100;
    
    // Проверяем автокешауты ботов
    rocketGame.players.forEach(player => {
      if (player.isBot && !player.cashedOut && 
          player.cashoutMultiplier <= rocketGame.multiplier) {
        player.cashedOut = true;
        player.winAmount = player.betAmount * player.cashoutMultiplier;
        console.log(`🤖 Bot ${player.userId} cashed out at ${player.cashoutMultiplier}x`);
      }
    });
    
    broadcastRocketUpdate();
    
    // Проверяем краш
    if (rocketGame.multiplier >= rocketGame.crashPoint) {
      crashRocket();
      clearInterval(interval);
    }
  }, 100);
}

// Краш ракеты
function crashRocket() {
  if (rocketGame.status !== 'flying') return;
  
  rocketGame.status = 'crashed';
  rocketGame.multiplier = rocketGame.crashPoint;
  
  console.log(`💥 Rocket crashed at ${rocketGame.crashPoint.toFixed(2)}x`);
  
  // Сохраняем игру в базу данных
  const gameRecord = rocketGames.insert({
    crashPoint: rocketGame.crashPoint,
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
            updateAdvancedRTPStats('demoBank', player.betAmount, winAmount);
          } else {
            users.update({
              ...user,
              main_balance: user.main_balance + winAmount
            });
            updateCasinoBank(-winAmount);
            updateAdvancedRTPStats('realBank', player.betAmount, winAmount);
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
          // Игрок проиграл - ставка остается в банке казино
          if (player.demoMode) {
            updateAdvancedRTPStats('demoBank', player.betAmount, 0);
          } else {
            updateAdvancedRTPStats('realBank', player.betAmount, 0);
          }

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

// Сброс сессионной статистики каждые 2 часа
cron.schedule('0 */2 * * *', () => {
    console.log('Сброс сессионной статистики RTP');
    advancedRTPSystem.realBank.sessionDeposits = 0;
    advancedRTPSystem.realBank.sessionPayouts = 0;
    advancedRTPSystem.demoBank.sessionDeposits = 0;
    advancedRTPSystem.demoBank.sessionPayouts = 0;
});

// Остальные API маршруты остаются прежними...
// [Здесь идет весь остальной код с API маршрутами без изменений]

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
            total_rocket_games: totalRocketGames,
            // Добавляем статистику нового алгоритма
            rtp_stats: {
                real_bank: advancedRTPSystem.realBank,
                demo_bank: advancedRTPSystem.demoBank
            },
            pattern_stats: advancedAntiPatternSystem
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
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        if (demoMode) {
            return res.status(400).json({ error: 'Demo balance withdrawals not allowed' });
        }

        const transfer = await cryptoPayRequest('transfer', {
            user_id: telegramId,
            asset: 'TON',
            amount: amount.toString(),
            spend_id: `withdrawal_${telegramId}_${Date.now()}`
        }, false);

        if (transfer.ok && transfer.result) {
            users.update({
                ...user,
                main_balance: user.main_balance - amount
            });

            transactions.insert({
                user_id: user.$loki,
                amount: -amount,
                type: 'withdrawal',
                status: 'completed',
                hash: transfer.result.hash,
                demo_mode: false,
                created_at: new Date()
            });

            res.json({
                success: true,
                message: 'Withdrawal successful',
                hash: transfer.result.hash,
                new_balance: user.main_balance - amount
            });
        } else {
            res.status(500).json({ error: 'Withdrawal failed' });
        }
    } catch (error) {
        console.error('Create withdrawal error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Получить пользователя или создать нового
app.post('/api/user', async (req, res) => {
    const { telegramId, demoMode } = req.body;

    try {
        let user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            user = users.insert({
                telegram_id: parseInt(telegramId),
                main_balance: 0,
                demo_balance: 1000,
                created_at: new Date(),
                demo_mode: demoMode || false,
                is_admin: false
            });
        }

        res.json({
            success: true,
            user: {
                telegram_id: user.telegram_id,
                main_balance: user.main_balance,
                demo_balance: user.demo_balance,
                demo_mode: user.demo_mode,
                is_admin: user.is_admin || false
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Переключить режим пользователя
app.post('/api/user/toggle-mode', async (req, res) => {
    const { telegramId } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
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
        console.error('Toggle mode error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Сделать ставку в игре Mines
app.post('/api/mines/bet', async (req, res) => {
    const { telegramId, betAmount, minesCount, demoMode } = req.body;

    try {
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const balance = demoMode ? user.demo_balance : user.main_balance;
        
        if (balance < betAmount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Списываем ставку
        if (demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance - betAmount
            });
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance - betAmount
            });
            updateCasinoBank(betAmount);
        }

        // Генерируем новую игру
        const gameData = generateMinesGame(minesCount);
        gameData.betAmount = betAmount;

        // Сохраняем игру
        const game = minesGames.insert({
            user_id: user.$loki,
            bet_amount: betAmount,
            mines_count: minesCount,
            mines_positions: gameData.mines,
            revealed_cells: [],
            game_over: false,
            win: false,
            current_multiplier: 1,
            demo_mode: demoMode,
            created_at: new Date()
        });

        // Записываем транзакцию ставки
        transactions.insert({
            user_id: user.$loki,
            amount: -betAmount,
            type: 'mines_bet',
            status: 'completed',
            demo_mode: demoMode,
            game_id: game.$loki,
            created_at: new Date()
        });

        res.json({
            success: true,
            game_id: game.$loki,
            game: gameData,
            new_balance: demoMode ? user.demo_balance - betAmount : user.main_balance - betAmount
        });
    } catch (error) {
        console.error('Mines bet error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Открыть ячейку в игре Mines
app.post('/api/mines/reveal', async (req, res) => {
    const { gameId, cellIndex, telegramId } = req.body;

    try {
        const game = minesGames.get(parseInt(gameId));
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!game || !user || game.user_id !== user.$loki) {
            return res.status(404).json({ error: 'Game not found' });
        }

        if (game.game_over) {
            return res.status(400).json({ error: 'Game already finished' });
        }

        if (game.revealed_cells.includes(cellIndex)) {
            return res.status(400).json({ error: 'Cell already revealed' });
        }

        // Проверяем, есть ли мина
        const hitMine = game.mines_positions.includes(cellIndex);
        
        if (hitMine) {
            // Игрок попал на мину - игра окончена
            minesGames.update({
                ...game,
                revealed_cells: [...game.revealed_cells, cellIndex],
                game_over: true,
                win: false,
                updated_at: new Date()
            });

            res.json({
                success: true,
                hit_mine: true,
                game_over: true,
                win: false,
                revealed_cell: cellIndex,
                mines_positions: game.mines_positions,
                current_multiplier: 1
            });
        } else {
            // Безопасная ячейка
            const newRevealedCells = [...game.revealed_cells, cellIndex];
            const revealedCount = newRevealedCells.length;
            const currentMultiplier = calculateMultiplier(revealedCount, game.mines_count);
            
            minesGames.update({
                ...game,
                revealed_cells: newRevealedCells,
                current_multiplier: currentMultiplier,
                updated_at: new Date()
            });

            res.json({
                success: true,
                hit_mine: false,
                game_over: false,
                win: false,
                revealed_cell: cellIndex,
                current_multiplier: currentMultiplier,
                revealed_count: revealedCount
            });
        }
    } catch (error) {
        console.error('Mines reveal error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Забрать выигрыш в игре Mines
app.post('/api/mines/cashout', async (req, res) => {
    const { gameId, telegramId } = req.body;

    try {
        const game = minesGames.get(parseInt(gameId));
        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!game || !user || game.user_id !== user.$loki) {
            return res.status(404).json({ error: 'Game not found' });
        }

        if (game.game_over) {
            return res.status(400).json({ error: 'Game already finished' });
        }

        if (game.revealed_cells.length === 0) {
            return res.status(400).json({ error: 'No cells revealed' });
        }

        // Рассчитываем выигрыш
        const winAmount = game.bet_amount * game.current_multiplier;
        
        // Выплачиваем выигрыш
        if (game.demo_mode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance + winAmount
            });
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance + winAmount
            });
            updateCasinoBank(-winAmount);
        }

        // Завершаем игру
        minesGames.update({
            ...game,
            game_over: true,
            win: true,
            final_multiplier: game.current_multiplier,
            win_amount: winAmount,
            updated_at: new Date()
        });

        // Записываем транзакцию выигрыша
        transactions.insert({
            user_id: user.$loki,
            amount: winAmount,
            type: 'mines_win',
            status: 'completed',
            demo_mode: game.demo_mode,
            game_id: game.$loki,
            created_at: new Date()
        });

        res.json({
            success: true,
            win_amount: winAmount,
            final_multiplier: game.current_multiplier,
            new_balance: game.demo_mode ? 
                user.demo_balance + winAmount : 
                user.main_balance + winAmount
        });
    } catch (error) {
        console.error('Mines cashout error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Сделать ставку в ракетке
app.post('/api/rocket/bet', async (req, res) => {
    const { telegramId, betAmount, demoMode } = req.body;

    try {
        if (rocketGame.status !== 'waiting' && rocketGame.status !== 'counting') {
            return res.status(400).json({ error: 'Betting closed' });
        }

        const user = users.findOne({ telegram_id: parseInt(telegramId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Проверяем, не делал ли уже ставку
        const existingBet = rocketGame.players.find(p => p.userId === telegramId.toString());
        if (existingBet) {
            return res.status(400).json({ error: 'Bet already placed' });
        }

        const balance = demoMode ? user.demo_balance : user.main_balance;
        
        if (balance < betAmount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Списываем ставку
        if (demoMode) {
            users.update({
                ...user,
                demo_balance: user.demo_balance - betAmount
            });
        } else {
            users.update({
                ...user,
                main_balance: user.main_balance - betAmount
            });
            updateCasinoBank(betAmount);
        }

        // Добавляем игрока
        rocketGame.players.push({
            userId: telegramId.toString(),
            betAmount: betAmount,
            cashedOut: false,
            isBot: false,
            demoMode: demoMode
        });

        // Записываем транзакцию ставки
        transactions.insert({
            user_id: user.$loki,
            amount: -betAmount,
            type: 'rocket_bet',
            status: 'completed',
            demo_mode: demoMode,
            created_at: new Date()
        });

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

// API: Кешаут в ракетке
app.post('/api/rocket/cashout', async (req, res) => {
    const { telegramId } = req.body;

    try {
        if (rocketGame.status !== 'flying') {
            return res.status(400).json({ error: 'Cannot cashout now' });
        }

        const player = rocketGame.players.find(p => p.userId === telegramId.toString());
        
        if (!player || player.cashedOut) {
            return res.status(400).json({ error: 'No active bet found' });
        }

        // Кешаутим игрока
        player.cashedOut = true;
        player.cashoutMultiplier = rocketGame.multiplier;
        player.winAmount = player.betAmount * rocketGame.multiplier;

        broadcastRocketUpdate();

        res.json({
            success: true,
            cashout_multiplier: rocketGame.multiplier,
            win_amount: player.winAmount
        });
    } catch (error) {
        console.error('Rocket cashout error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Получить текущее состояние ракетки
app.get('/api/rocket/state', (req, res) => {
    res.json({
        success: true,
        game: rocketGame
    });
});

// Инициализация базы данных и запуск первой игры
initDatabase().then(() => {
    console.log('🚀 Advanced Rocket Algorithm initialized');
    console.log('📊 Enhanced RTP System activated');
    console.log('🛡️ Advanced Anti-Pattern Protection enabled');
    console.log('🎯 Small bet penalties active');
    
    startRocketGame();
});