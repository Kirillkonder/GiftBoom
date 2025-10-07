// database.js
const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

// Модель пользователей
const User = sequelize.define('User', {
  telegram_id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    unique: true
  },
  main_balance: {
    type: DataTypes.DECIMAL(15, 6),
    defaultValue: 0
  },
  demo_balance: {
    type: DataTypes.DECIMAL(15, 6),
    defaultValue: 0
  },
  total_deposits: {
    type: DataTypes.DECIMAL(15, 6),
    defaultValue: 0
  },
  demo_mode: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_admin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'users',
  timestamps: false
});

// Модель транзакций
const Transaction = sequelize.define('Transaction', {
  amount: {
    type: DataTypes.DECIMAL(15, 6)
  },
  original_amount: {
    type: DataTypes.DECIMAL(15, 6)
  },
  bonus_amount: {
    type: DataTypes.DECIMAL(15, 6),
    defaultValue: 0
  },
  type: {
    type: DataTypes.STRING
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pending'
  },
  invoice_id: {
    type: DataTypes.STRING
  },
  demo_mode: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  promo_code: {
    type: DataTypes.STRING
  },
  details: {
    type: DataTypes.JSONB
  },
  address: {
    type: DataTypes.STRING
  },
  hash: {
    type: DataTypes.STRING
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'transactions',
  timestamps: false
});

// Модель банка казино
const CasinoBank = sequelize.define('CasinoBank', {
  total_balance: {
    type: DataTypes.DECIMAL(15, 6),
    defaultValue: 0
  },
  owner_telegram_id: {
    type: DataTypes.BIGINT
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'casino_bank',
  timestamps: false
});

// Модель демо банка
const CasinoDemoBank = sequelize.define('CasinoDemoBank', {
  total_balance: {
    type: DataTypes.DECIMAL(15, 6),
    defaultValue: 500
  },
  owner_telegram_id: {
    type: DataTypes.BIGINT
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'casino_demo_bank',
  timestamps: false
});

// Модель игр Mines
const MinesGame = sequelize.define('MinesGame', {
  bet_amount: {
    type: DataTypes.DECIMAL(15, 6)
  },
  mines_count: {
    type: DataTypes.INTEGER
  },
  actual_mines_count: {
    type: DataTypes.INTEGER
  },
  mines: {
    type: DataTypes.JSONB
  },
  revealed_cells: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  game_over: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  win: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  current_multiplier: {
    type: DataTypes.DECIMAL(10, 4),
    defaultValue: 1.0
  },
  win_amount: {
    type: DataTypes.DECIMAL(15, 6),
    defaultValue: 0
  },
  demo_mode: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'mines_games',
  timestamps: false
});

// Модель игр Rocket
const RocketGame = sequelize.define('RocketGame', {
  crashPoint: {
    type: DataTypes.DECIMAL(10, 4),
    field: 'crash_point'
  },
  maxMultiplier: {
    type: DataTypes.DECIMAL(10, 4),
    field: 'max_multiplier'
  },
  startTime: {
    type: DataTypes.DATE,
    field: 'start_time'
  },
  endTime: {
    type: DataTypes.DATE,
    field: 'end_time'
  },
  playerCount: {
    type: DataTypes.INTEGER,
    field: 'player_count'
  },
  botCount: {
    type: DataTypes.INTEGER,
    field: 'bot_count'
  },
  totalBets: {
    type: DataTypes.DECIMAL(15, 6),
    field: 'total_bets'
  },
  totalPayouts: {
    type: DataTypes.DECIMAL(15, 6),
    field: 'total_payouts'
  },
  botWins: {
    type: DataTypes.INTEGER,
    field: 'bot_wins'
  },
  botLosses: {
    type: DataTypes.INTEGER,
    field: 'bot_losses'
  }
}, {
  tableName: 'rocket_games',
  timestamps: false
});

// Модель ставок Rocket
const RocketBet = sequelize.define('RocketBet', {
  bet_amount: {
    type: DataTypes.DECIMAL(15, 6)
  },
  cashout_multiplier: {
    type: DataTypes.DECIMAL(10, 4)
  },
  win_amount: {
    type: DataTypes.DECIMAL(15, 6)
  },
  demo_mode: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'rocket_bets',
  timestamps: false
});

// Модель игр Plinko
const PlinkoGame = sequelize.define('PlinkoGame', {
  bet_amount: {
    type: DataTypes.DECIMAL(15, 6)
  },
  rows: {
    type: DataTypes.INTEGER,
    defaultValue: 8
  },
  difficulty_mode: {
    type: DataTypes.STRING,
    defaultValue: 'easy'
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'playing'
  },
  multiplier: {
    type: DataTypes.DECIMAL(10, 4)
  },
  win_amount: {
    type: DataTypes.DECIMAL(15, 6)
  },
  final_slot: {
    type: DataTypes.INTEGER
  },
  demo_mode: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  completed_at: {
    type: DataTypes.DATE
  }
}, {
  tableName: 'plinko_games',
  timestamps: false
});

// Модель промокодов
const PromoCode = sequelize.define('PromoCode', {
  code: {
    type: DataTypes.STRING,
    unique: true
  },
  bonus_percent: {
    type: DataTypes.INTEGER
  },
  is_public: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  description: {
    type: DataTypes.TEXT
  },
  used_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  max_uses: {
    type: DataTypes.INTEGER
  },
  created_by: {
    type: DataTypes.BIGINT
  },
  owner_telegram_id: {
    type: DataTypes.BIGINT
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'promo_codes',
  timestamps: false
});

// Модель админ логов
const AdminLog = sequelize.define('AdminLog', {
  action: {
    type: DataTypes.STRING
  },
  telegram_id: {
    type: DataTypes.BIGINT
  },
  details: {
    type: DataTypes.JSONB
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'admin_logs',
  timestamps: false
});

// Определяем связи
User.hasMany(Transaction, { foreignKey: 'user_id' });
Transaction.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(MinesGame, { foreignKey: 'user_id' });
MinesGame.belongsTo(User, { foreignKey: 'user_id' });

User.hasMany(RocketBet, { foreignKey: 'user_id' });
RocketBet.belongsTo(User, { foreignKey: 'user_id' });

RocketGame.hasMany(RocketBet, { foreignKey: 'game_id' });
RocketBet.belongsTo(RocketGame, { foreignKey: 'game_id' });

User.hasMany(PlinkoGame, { foreignKey: 'user_id' });
PlinkoGame.belongsTo(User, { foreignKey: 'user_id' });

module.exports = {
  sequelize,
  User,
  Transaction,
  CasinoBank,
  CasinoDemoBank,
  MinesGame,
  RocketGame,
  RocketBet,
  PlinkoGame,
  PromoCode,
  AdminLog
};