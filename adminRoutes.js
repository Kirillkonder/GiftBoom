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

module.exports = function(db, users, transactions, casinoBank, 
  casinoDemoBank, adminLogs, minesGames, rocketGames, rocketBets, cryptoPayRequest, updateCasinoBank, 
  updateCasinoDemoBank, syncCasinoBalance, promoCodes) {
  
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


  // API: Получить все промокоды
router.get('/admin/promocodes/:telegramId', adminMiddleware, async (req, res) => {
    try {
        const allPromoCodes = promoCodes.chain()
            .simplesort('created_at', true)
            .data();

        res.json({
            success: true,
            promoCodes: allPromoCodes
        });
    } catch (error) {
        console.error('Get promocodes error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Создать новый промокод
router.post('/admin/promocodes/create', adminMiddleware, async (req, res) => {
    const { telegramId, code, bonusPercent, isPublic, description, maxUses, ownerTelegramId } = req.body;

    try {
        // Проверяем, не существует ли уже такой промокод
        const existingPromo = promoCodes.findOne({ code: code.toUpperCase() });
        if (existingPromo) {
            return res.status(400).json({ error: 'Промокод уже существует' });
        }

        const newPromo = promoCodes.insert({
            code: code.toUpperCase(),
            bonus_percent: parseInt(bonusPercent),
            is_public: Boolean(isPublic),
            description: description || `Промокод +${bonusPercent}% к депозиту`,
            used_count: 0,
            max_uses: maxUses ? parseInt(maxUses) : null,
            created_by: parseInt(telegramId),
            owner_telegram_id: ownerTelegramId ? parseInt(ownerTelegramId) : null, // 🔥 НОВОЕ ПОЛЕ
            created_at: new Date(),
            is_active: true
        });

        logAdminAction('create_promocode', telegramId, { 
            code: code.toUpperCase(),
            bonus_percent: bonusPercent,
            owner_telegram_id: ownerTelegramId
        });

        res.json({
            success: true,
            promoCode: newPromo,
            message: `Промокод ${code.toUpperCase()} создан успешно!`
        });
    } catch (error) {
        console.error('Create promocode error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// 🔥 НОВЫЙ API: Получить статистику по промокоду
router.get('/admin/promocodes/stats/:telegramId/:promoCode', adminMiddleware, async (req, res) => {
    const { telegramId, promoCode } = req.params;

    try {
        const promo = promoCodes.findOne({ code: promoCode.toUpperCase() });
        if (!promo) {
            return res.status(404).json({ error: 'Промокод не найден' });
        }

        // Проверяем права доступа к статистике
        if (promo.owner_telegram_id && parseInt(telegramId) !== promo.owner_telegram_id && !allowedAdmins.includes(parseInt(telegramId))) {
            return res.status(403).json({ error: 'Нет доступа к статистике этого промокода' });
        }

        // Находим все транзакции с этим промокодом
        const promoTransactions = transactions.find({ 
            promo_code: promoCode.toUpperCase(),
            status: 'completed',
            type: 'deposit'
        });

        // Статистика по депозитам
        const depositStats = {
            total_uses: promo.used_count || 0,
            total_deposits: 0,
            total_bonus_paid: 0,
            user_earnings: 0,
            transactions: []
        };

        // Собираем детальную статистику
        promoTransactions.forEach(transaction => {
            const originalAmount = transaction.original_amount || transaction.amount;
            const bonusAmount = transaction.bonus_amount || 0;
            
            depositStats.total_deposits += originalAmount;
            depositStats.total_bonus_paid += bonusAmount;
            
            // Расчет заработка владельца (например, 10% от бонуса)
            const ownerEarnings = bonusAmount * 0.1; // 10% от бонуса
            depositStats.user_earnings += ownerEarnings;

            depositStats.transactions.push({
                user_id: transaction.user_id,
                original_amount: originalAmount,
                bonus_amount: bonusAmount,
                final_amount: transaction.amount,
                owner_earnings: ownerEarnings,
                created_at: transaction.created_at
            });
        });

        res.json({
            success: true,
            promo_code: promo.code,
            stats: depositStats,
            promo_info: {
                bonus_percent: promo.bonus_percent,
                owner_telegram_id: promo.owner_telegram_id,
                is_public: promo.is_public,
                created_at: promo.created_at
            }
        });
    } catch (error) {
        console.error('Get promo stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Удалить промокод
router.post('/admin/promocodes/delete', adminMiddleware, async (req, res) => {
    const { telegramId, code } = req.body;

    try {
        const promo = promoCodes.findOne({ code: code.toUpperCase() });
        if (!promo) {
            return res.status(404).json({ error: 'Промокод не найден' });
        }

        promoCodes.remove(promo);

        logAdminAction('delete_promocode', telegramId, { 
            code: code.toUpperCase()
        });

        res.json({
            success: true,
            message: `Промокод ${code.toUpperCase()} удален`
        });
    } catch (error) {
        console.error('Delete promocode error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Активировать/деактивировать промокод
router.post('/admin/promocodes/toggle', adminMiddleware, async (req, res) => {
    const { telegramId, code } = req.body;

    try {
        const promo = promoCodes.findOne({ code: code.toUpperCase() });
        if (!promo) {
            return res.status(404).json({ error: 'Промокод не найден' });
        }

        promoCodes.update({
            ...promo,
            is_active: !promo.is_active
        });

        logAdminAction('toggle_promocode', telegramId, { 
            code: code.toUpperCase(),
            new_status: !promo.is_active
        });

        res.json({
            success: true,
            is_active: !promo.is_active,
            message: `Промокод ${code.toUpperCase()} ${!promo.is_active ? 'активирован' : 'деактивирован'}`
        });
    } catch (error) {
        console.error('Toggle promocode error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/admin/add-virtual-balance', adminMiddleware, async (req, res) => {
    const { telegramId, targetTelegramId, amount } = req.body;

    try {
        const targetUser = users.findOne({ telegram_id: parseInt(targetTelegramId) });
        
        if (!targetUser) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        // Начисляем виртуальный баланс (основной баланс, но без реального пополнения)
        const newBalance = targetUser.main_balance + parseFloat(amount);
        
        users.update({
            ...targetUser,
            main_balance: newBalance
        });

        // Создаем транзакцию для отслеживания
        transactions.insert({
            user_id: targetUser.$loki,
            amount: parseFloat(amount),
            type: 'virtual_bonus',
            status: 'completed',
            demo_mode: false,
            details: {
                added_by_admin: telegramId,
                note: 'Виртуальный бонус от администратора',
                is_virtual: true
            },
            created_at: new Date()
        });

        logAdminAction('add_virtual_balance', telegramId, { 
            target_user: targetTelegramId, 
            amount: amount,
            new_balance: newBalance
        });

        res.json({
            success: true,
            message: `Добавлено ${amount} виртуальных TON пользователю ${targetTelegramId}`,
            new_balance: newBalance,
            previous_balance: targetUser.main_balance
        });
    } catch (error) {
        console.error('Add virtual balance error:', error);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});
router.get('/admin/user-promocodes/:telegramId', adminMiddleware, async (req, res) => {
    const { telegramId } = req.params;

    try {
        // Находим все промокоды, где пользователь является владельцем
        const userPromoCodes = promoCodes.find({ 
            owner_telegram_id: parseInt(telegramId) 
        });

        // Собираем статистику для каждого промокода
        const promoCodesWithStats = userPromoCodes.map(promo => {
            // Находим транзакции с этим промокодом
            const promoTransactions = transactions.find({ 
                promo_code: promo.code,
                status: 'completed',
                type: 'deposit'
            });

            const stats = {
                total_uses: promo.used_count || 0,
                total_deposits: 0,
                total_bonus_paid: 0,
                user_earnings: 0,
                total_deposits_without_bonus: 0, // 🔥 НОВОЕ: Общая сумма депозитов без бонуса
                streamer_earnings_10_percent: 0 // 🔥 НОВОЕ: 10% заработок стримера
            };

            promoTransactions.forEach(transaction => {
                const originalAmount = transaction.original_amount || 0;
                const bonusAmount = transaction.bonus_amount || 0;
                const finalAmount = transaction.amount || 0;
                
                // 🔥 РАСЧЕТ ОБЩЕЙ СУММЫ ДЕПОЗИТОВ (без бонуса)
                stats.total_deposits_without_bonus += originalAmount;
                
                stats.total_deposits += finalAmount;
                stats.total_bonus_paid += bonusAmount;
                
                // 🔥 РАСЧЕТ ЗАРАБОТКА СТРИМЕРА (10% от суммы депозитов без бонуса)
                const streamerEarnings = originalAmount * 0.1;
                stats.streamer_earnings_10_percent += streamerEarnings;
                
                // Старый расчет (10% от бонуса) - оставляем для совместимости
                const ownerEarnings = bonusAmount * 0.1;
                stats.user_earnings += ownerEarnings;
            });

            return {
                ...promo,
                stats: stats
            };
        });

        // 🔥 ОБЩАЯ СТАТИСТИКА ПО ВСЕМ ПРОМОКОДАМ
        const totalStats = {
            total_promocodes: promoCodesWithStats.length,
            total_uses_all: promoCodesWithStats.reduce((sum, promo) => sum + promo.stats.total_uses, 0),
            total_deposits_all: promoCodesWithStats.reduce((sum, promo) => sum + promo.stats.total_deposits_without_bonus, 0),
            total_streamer_earnings_all: promoCodesWithStats.reduce((sum, promo) => sum + promo.stats.streamer_earnings_10_percent, 0)
        };

        res.json({
            success: true,
            promoCodes: promoCodesWithStats,
            totalStats: totalStats // 🔥 ДОБАВЛЕНО: Общая статистика
        });
    } catch (error) {
        console.error('Get user promocodes error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

  return router;
};