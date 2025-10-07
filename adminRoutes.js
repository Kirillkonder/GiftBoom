// adminRoutes.js - ПОЛНОСТЬЮ ЗАМЕНИ СОДЕРЖИМОЕ
const express = require('express');
const router = express.Router();
const { User, Transaction, CasinoBank, CasinoDemoBank, MinesGame, RocketGame, RocketBet, PromoCode, AdminLog } = require('./database');

// Функция логирования админских действий
async function logAdminAction(action, telegramId, details = {}) {
  await AdminLog.create({
    action: action,
    telegram_id: telegramId,
    details: details
  });
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

module.exports = function(cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, syncCasinoBalance) {
  
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
      await logAdminAction('admin_login', telegramId);
      res.json({ success: true, isAdmin: true });
    } else {
      res.json({ success: false, isAdmin: false });
    }
  });

  // API: Получить данные админки
  router.get('/admin/dashboard/:telegramId', adminMiddleware, async (req, res) => {
    try {
      const bank = await CasinoBank.findOne();
      const demoBank = await CasinoDemoBank.findOne();
      const totalUsers = await User.count();
      const totalTransactions = await Transaction.count();
      const totalMinesGames = await MinesGame.count();
      const totalRocketGames = await RocketGame.count();

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
      const bank = await CasinoBank.findOne();
      
      if (parseFloat(bank.total_balance) < parseFloat(amount)) {
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
        await updateCasinoBank(-parseFloat(amount));
        
        await logAdminAction('withdraw_profit', telegramId, { amount: amount });
        
        res.json({
          success: true,
          message: 'Profit withdrawn successfully',
          hash: transfer.result.hash,
          new_balance: parseFloat(bank.total_balance) - parseFloat(amount)
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
      const targetUser = await User.findByPk(parseInt(targetTelegramId));
      
      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      await User.update({
        demo_balance: parseFloat(targetUser.demo_balance) + parseFloat(amount)
      }, { where: { telegram_id: targetUser.telegram_id } });

      await logAdminAction('add_demo_balance', telegramId, { 
        target_user: targetTelegramId, 
        amount: amount 
      });

      res.json({
        success: true,
        message: `Added ${amount} demo TON to user ${targetTelegramId}`,
        new_balance: parseFloat(targetUser.demo_balance) + parseFloat(amount)
      });
    } catch (error) {
      console.error('Add demo balance error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // API: Получить историю игр Mines
  router.get('/admin/mines-games/:telegramId', adminMiddleware, async (req, res) => {
    try {
      const games = await MinesGame.findAll({
        order: [['created_at', 'DESC']],
        limit: 100,
        include: [{
          model: User,
          attributes: ['telegram_id', 'demo_mode']
        }]
      });

      res.json(games);
    } catch (error) {
      console.error('Get mines games error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // API: Получить историю игр Rocket
  router.get('/admin/rocket-games/:telegramId', adminMiddleware, async (req, res) => {
    try {
      const games = await RocketGame.findAll({
        order: [['start_time', 'DESC']],
        limit: 100
      });

      res.json(games);
    } catch (error) {
      console.error('Get rocket games error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // API: Получить историю ставок Rocket
  router.get('/admin/rocket-bets/:telegramId', adminMiddleware, async (req, res) => {
    try {
      const bets = await RocketBet.findAll({
        order: [['created_at', 'DESC']],
        limit: 100,
        include: [
          {
            model: User,
            attributes: ['telegram_id', 'demo_mode']
          },
          {
            model: RocketGame
          }
        ]
      });

      res.json(bets);
    } catch (error) {
      console.error('Get rocket bets error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // API: Получить всех пользователей
  router.get('/admin/users/:telegramId', adminMiddleware, async (req, res) => {
    try {
      const allUsers = await User.findAll({
        order: [['created_at', 'DESC']]
      });

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
      const bank = await CasinoBank.findOne();
      
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
      const allPromoCodes = await PromoCode.findAll({
        order: [['created_at', 'DESC']]
      });

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
      const existingPromo = await PromoCode.findOne({ where: { code: code.toUpperCase() } });
      if (existingPromo) {
        return res.status(400).json({ error: 'Промокод уже существует' });
      }

      const newPromo = await PromoCode.create({
        code: code.toUpperCase(),
        bonus_percent: parseInt(bonusPercent),
        is_public: Boolean(isPublic),
        description: description || `Промокод +${bonusPercent}% к депозиту`,
        used_count: 0,
        max_uses: maxUses ? parseInt(maxUses) : null,
        created_by: parseInt(telegramId),
        owner_telegram_id: ownerTelegramId ? parseInt(ownerTelegramId) : null,
        is_active: true
      });

      await logAdminAction('create_promocode', telegramId, { 
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
      const promo = await PromoCode.findOne({ where: { code: promoCode.toUpperCase() } });
      if (!promo) {
        return res.status(404).json({ error: 'Промокод не найден' });
      }

      // Проверяем права доступа к статистике
      if (promo.owner_telegram_id && parseInt(telegramId) !== promo.owner_telegram_id && !allowedAdmins.includes(parseInt(telegramId))) {
        return res.status(403).json({ error: 'Нет доступа к статистике этого промокода' });
      }

      // Находим все транзакции с этим промокодом
      const promoTransactions = await Transaction.findAll({ 
        where: { 
          promo_code: promoCode.toUpperCase(),
          status: 'completed',
          type: 'deposit'
        }
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
        
        depositStats.total_deposits += parseFloat(originalAmount);
        depositStats.total_bonus_paid += parseFloat(bonusAmount);
        
        // Расчет заработка владельца (например, 10% от бонуса)
        const ownerEarnings = parseFloat(bonusAmount) * 0.1; // 10% от бонуса
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
      const promo = await PromoCode.findOne({ where: { code: code.toUpperCase() } });
      if (!promo) {
        return res.status(404).json({ error: 'Промокод не найден' });
      }

      await PromoCode.destroy({ where: { id: promo.id } });

      await logAdminAction('delete_promocode', telegramId, { 
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
      const promo = await PromoCode.findOne({ where: { code: code.toUpperCase() } });
      if (!promo) {
        return res.status(404).json({ error: 'Промокод не найден' });
      }

      await PromoCode.update({
        is_active: !promo.is_active
      }, { where: { id: promo.id } });

      await logAdminAction('toggle_promocode', telegramId, { 
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

  // API: Добавить виртуальный баланс
  router.post('/admin/add-virtual-balance', adminMiddleware, async (req, res) => {
    const { telegramId, targetTelegramId, amount } = req.body;

    try {
      const targetUser = await User.findByPk(parseInt(targetTelegramId));
      
      if (!targetUser) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }

      // Начисляем виртуальный баланс (основной баланс, но без реального пополнения)
      const newBalance = parseFloat(targetUser.main_balance) + parseFloat(amount);
      
      await User.update({
        main_balance: newBalance
      }, { where: { telegram_id: targetUser.telegram_id } });

      // Создаем транзакцию для отслеживания
      await Transaction.create({
        user_id: targetUser.telegram_id,
        amount: parseFloat(amount),
        type: 'virtual_bonus',
        status: 'completed',
        demo_mode: false,
        details: {
          added_by_admin: telegramId,
          note: 'Виртуальный бонус от администратора',
          is_virtual: true
        }
      });

      await logAdminAction('add_virtual_balance', telegramId, { 
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

  // API: Получить статистику по промокодам пользователя
  router.get('/admin/user-promocodes/:telegramId', adminMiddleware, async (req, res) => {
    const { telegramId } = req.params;

    try {
      const userPromoCodes = await PromoCode.findAll({ 
        where: { 
          owner_telegram_id: parseInt(telegramId) 
        }
      });

      const promoCodesWithStats = await Promise.all(
        userPromoCodes.map(async (promo) => {
          const promoTransactions = await Transaction.findAll({ 
            where: { 
              promo_code: promo.code,
              status: 'completed',
              type: 'deposit'
            }
          });

          const stats = {
            total_uses: promo.used_count || 0,
            total_deposits: 0,
            streamer_earnings: 0
          };

          promoTransactions.forEach(transaction => {
            const originalAmount = transaction.original_amount || 0;
            
            stats.total_deposits += parseFloat(originalAmount);
            stats.streamer_earnings += parseFloat(originalAmount) * 0.1;
          });

          return {
            ...promo.toJSON(),
            stats: stats
          };
        })
      );

      const totalStats = {
        total_promocodes: promoCodesWithStats.length,
        total_uses_all: promoCodesWithStats.reduce((sum, promo) => sum + promo.stats.total_uses, 0),
        total_deposits_all: promoCodesWithStats.reduce((sum, promo) => sum + promo.stats.total_deposits, 0),
        total_streamer_earnings_all: promoCodesWithStats.reduce((sum, promo) => sum + promo.stats.streamer_earnings, 0)
      };

      res.json({
        success: true,
        promoCodes: promoCodesWithStats,
        totalStats: totalStats
      });
    } catch (error) {
      console.error('Get user promocodes error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};