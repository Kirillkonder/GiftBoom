const express = require('express');
const router = express.Router();

// Функция логирования админских действий
function logAdminAction(action, telegramId, details = {}) {
  // Эта функция должна быть импортирована или определена здесь
}

// Middleware для проверки прав администратора
function checkAdminAccess(allowedAdmins) {
  return (req, res, next) => {
    const telegramId = parseInt(req.params.telegramId || req.body.telegramId);
    
    if (!allowedAdmins.includes(telegramId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}

module.exports = function(db, users, transactions, casinoBank, casinoDemoBank, adminLogs, minesGames, rocketGames, rocketBets, cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, syncCasinoBalance) {
  
  // Список разрешенных администраторов
  const allowedAdmins = [
    parseInt(process.env.OWNER_TELEGRAM_ID) || 842428912,
    1135073023 // второй администратор
  ];

  const adminMiddleware = checkAdminAccess(allowedAdmins);

  // API: Аутентификация админа
  router.post('/admin/login', async (req, res) => {
    const { telegramId, password } = req.body;
    
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
  router.get('/admin/dashboard/:telegramId', adminMiddleware, async (req, res) => {
    try {
      const bank = casinoBank.findOne({});
      const demoBank = casinoDemoBank.findOne({});
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
router.post('/admin/withdraw-profit', adminMiddleware, async (req, res) => {
    const { telegramId, amount } = req.body;

    try {
        const bank = casinoBank.findOne({});
        
        if (bank.total_balance < amount) {
            return res.status(400).json({ error: 'Недостаточно средств в банке казино' });
        }

        // МИНИМАЛЬНЫЙ ВЫВОД БАНКА: 0.1 TON
        if (amount < 0.1) {
            return res.status(400).json({ error: 'Минимальная сумма вывода из банка: 0.1 TON' });
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


  // API: Добавить демо баланс пользователю
  router.post('/admin/add-demo-balance', adminMiddleware, async (req, res) => {
    const { telegramId, targetTelegramId, amount } = req.body;

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
  router.get('/admin/mines-games/:telegramId', adminMiddleware, async (req, res) => {
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
  router.get('/admin/rocket-games/:telegramId', adminMiddleware, async (req, res) => {
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
  router.get('/admin/rocket-bets/:telegramId', adminMiddleware, async (req, res) => {
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
  router.get('/admin/users/:telegramId', adminMiddleware, async (req, res) => {
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

  // API: Синхронизировать баланс с Crypto Bot
  router.post('/admin/sync-balance', adminMiddleware, async (req, res) => {
    try {
      await syncCasinoBalance();
      const bank = casinoBank.findOne({});
      
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

  return router;
};