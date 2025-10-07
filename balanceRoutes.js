// balanceRoutes.js - ПОЛНОСТЬЮ ЗАМЕНИ СОДЕРЖИМОЕ
const express = require('express');
const router = express.Router();
const { User, Transaction, PromoCode } = require('./database');

module.exports = function(db, cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, updateRTPStats) {

  // 🔥 ИСПРАВЛЕННАЯ функция расчета промокода (БЕЗ инкремента used_count)
  async function calculatePromoCode(telegramId, promoCode, depositAmount) {
    console.log(`🔍 Поиск промокода: ${promoCode} для пользователя ${telegramId}`);
    
    const promo = await PromoCode.findOne({ 
      where: { 
        code: promoCode.toUpperCase(),
        is_active: true 
      }
    });
    
    if (!promo) {
      console.log(`❌ Промокод ${promoCode} не найден или неактивен`);
      return { success: false, error: 'Промокод не найден или неактивен' };
    }

    console.log(`📊 Найден промокод: ${promo.code}, бонус: ${promo.bonus_percent}%, использований: ${promo.used_count || 0}/${promo.max_uses || 'безлимит'}`);

    // Проверяем лимит использований
    if (promo.max_uses && (promo.used_count || 0) >= promo.max_uses) {
      console.log(`❌ Лимит использований промокода исчерпан: ${promo.used_count}/${promo.max_uses}`);
      return { success: false, error: 'Лимит использований промокода исчерпан' };
    }

    // Находим пользователя
    const user = await User.findByPk(parseInt(telegramId));
    if (!user) {
      return { success: false, error: 'Пользователь не найден' };
    }

    // Проверяем, не использовал ли уже пользователь этот промокод в завершенных транзакциях
    const userUsedPromo = await Transaction.findOne({
      where: {
        user_id: user.telegram_id,
        promo_code: promo.code,
        status: 'completed'
      }
    });

    if (userUsedPromo) {
      console.log(`❌ Пользователь ${telegramId} уже использовал промокод ${promo.code}`);
      return { success: false, error: 'Вы уже использовали этот промокод' };
    }

    // Рассчитываем бонус
    const bonusAmount = Number(depositAmount) * (promo.bonus_percent / 100);
    const totalAmount = Number(depositAmount) + bonusAmount;
    
    console.log(`🎁 Промокод ${promo.code}:`);
    console.log(`   💰 Депозит: ${depositAmount} TON`);
    console.log(`   🎁 Бонус: +${bonusAmount.toFixed(2)} TON (${promo.bonus_percent}%)`);
    console.log(`   💎 Итого: ${totalAmount.toFixed(2)} TON`);
    
    return {
      success: true,
      bonusAmount: bonusAmount,
      bonusPercent: promo.bonus_percent,
      totalAmount: totalAmount,
      promo: {
        code: promo.code,
        bonus_percent: promo.bonus_percent,
        description: promo.description,
        used_count: promo.used_count || 0,
        max_uses: promo.max_uses,
        is_public: promo.is_public
      }
    };
  }

  // API: Создать инвойс для депозита
  router.post('/create-invoice', async (req, res) => {
    const { telegramId, amount, demoMode, promoCode } = req.body;

    console.log(`💰 Создание инвойса: пользователь ${telegramId}, сумма ${amount}, демо: ${demoMode}, промокод: ${promoCode}`);

    try {
      const user = await User.findByPk(parseInt(telegramId));
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const amt = Number(amount);
      if (!amt || amt < 0.3) {
        return res.status(400).json({ error: 'Минимальный депозит: 0.3 TON' });
      }

      let finalAmount = amt;
      let bonusAmount = 0;
      let appliedPromoCode = null;
      let promoResult = null;

      // 🔥 ПРИМЕНЯЕМ ПРОМОКОД (только расчет, used_count не трогаем)
      if (promoCode && !demoMode) {
        console.log(`🎁 Применение промокода: ${promoCode}`);
        promoResult = await calculatePromoCode(telegramId, promoCode, amt);
        if (promoResult.success) {
          finalAmount = promoResult.totalAmount;
          bonusAmount = promoResult.bonusAmount;
          appliedPromoCode = promoCode.toUpperCase();
          console.log(`✅ Промокод применен: +${bonusAmount.toFixed(2)} TON (${promoResult.bonusPercent}%)`);
        } else {
          console.log(`❌ Ошибка промокода: ${promoResult.error}`);
          return res.status(400).json({ error: promoResult.error });
        }
      } else if (promoCode && demoMode) {
        console.log(`ℹ️ Промокоды не применяются в демо-режиме`);
      }

      const invoice = await cryptoPayRequest('createInvoice', {
        asset: 'TON',
        amount: amt.toString(),
        description: `Deposit for user ${telegramId}`,
        hidden_message: `Deposit ${amt} TON${bonusAmount > 0 ? ` + ${bonusAmount.toFixed(2)} TON bonus (${appliedPromoCode})` : ''}`,
        payload: JSON.stringify({
          telegram_id: telegramId,
          demo_mode: demoMode,
          amount: amt,
          final_amount: finalAmount,
          bonus_amount: bonusAmount,
          promo_code: appliedPromoCode
        }),
        paid_btn_name: 'callback',
        paid_btn_url: 'https://t.me/your_bot',
        allow_comments: false
      }, demoMode);

      if (invoice.ok && invoice.result) {
        // Сохраняем транзакцию как pending
        await Transaction.create({
          user_id: user.telegram_id,
          amount: finalAmount,
          original_amount: amt,
          bonus_amount: bonusAmount,
          type: 'deposit',
          status: 'pending',
          invoice_id: invoice.result.invoice_id,
          demo_mode: demoMode,
          promo_code: appliedPromoCode
        });
        
        console.log(`✅ Инвойс создан: ${invoice.result.invoice_id}`);
        
        res.json({
          success: true,
          invoice_url: invoice.result.pay_url,
          invoice_id: invoice.result.invoice_id,
          bonus_applied: bonusAmount > 0,
          bonus_amount: bonusAmount,
          bonus_percent: promoResult ? promoResult.bonusPercent : 0,
          final_amount: finalAmount,
          promo_code: appliedPromoCode
        });
      } else {
        console.log(`❌ Ошибка создания инвойса:`, invoice);
        res.status(500).json({ error: 'Failed to create invoice' });
      }
    } catch (error) {
      console.error('Create invoice error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // API: Проверить статус инвойса (🔥 ЗДЕСЬ увеличиваем used_count при оплате)
  router.post('/check-invoice', async (req, res) => {
    const { invoiceId, demoMode } = req.body;

    try {
      const invoice = await cryptoPayRequest('getInvoices', {
        invoice_ids: invoiceId
      }, demoMode);

      if (invoice.ok && invoice.result.items.length > 0) {
        const invoiceData = invoice.result.items[0];
        
        if (invoiceData.status === 'paid') {
          const transaction = await Transaction.findOne({ where: { invoice_id: invoiceId } });
          
          if (transaction && transaction.status === 'pending') {
            const user = await User.findByPk(transaction.user_id);
            const depositAmount = transaction.amount || 0;
            
            if (demoMode) {
              await User.update({
                demo_balance: parseFloat(user.demo_balance) + parseFloat(depositAmount),
                total_deposits: parseFloat(user.total_deposits || 0) + parseFloat(depositAmount)
              }, { where: { telegram_id: user.telegram_id } });
            } else {
              await User.update({
                main_balance: parseFloat(user.main_balance) + parseFloat(depositAmount),
                total_deposits: parseFloat(user.total_deposits || 0) + parseFloat(depositAmount)
              }, { where: { telegram_id: user.telegram_id } });
            }

            // Обновляем статус транзакции
            await Transaction.update({
              status: 'completed',
              updated_at: new Date()
            }, { where: { id: transaction.id } });

            // 🔥 ОБНОВЛЯЕМ RTP СТАТИСТИКУ
            if (!demoMode) {
              updateRTPStats('realBank', depositAmount, 0);
            }

            // 🔥 ИНКРЕМЕНТ ПРОМОКОДА ТОЛЬКО ПРИ УСПЕШНОЙ ОПЛАТЕ
            if (!demoMode && transaction.promo_code) {
              const promo = await PromoCode.findOne({ where: { code: transaction.promo_code } });
              
              if (promo) {
                const newUsedCount = (promo.used_count || 0) + 1;
                await PromoCode.update({
                  used_count: newUsedCount
                }, { where: { id: promo.id } });
                console.log(`🎁 Промокод ${promo.code} использован! Счетчик: ${newUsedCount}/${promo.max_uses || '∞'}`);
              }
            }

            res.json({ 
              success: true, 
              status: 'paid',
              amount: depositAmount,
              bonus_amount: transaction.bonus_amount || 0,
              promo_code: transaction.promo_code
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
  router.post('/create-withdrawal', async (req, res) => {
    const { telegramId, amount, address, demoMode } = req.body;

    try {
      const user = await User.findByPk(parseInt(telegramId));
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const balance = demoMode ? user.demo_balance : user.main_balance;
      
      if (parseFloat(balance) < parseFloat(amount)) {
        return res.status(400).json({ error: 'Недостаточно средств' });
      }

      // Проверка отыгрыша x3
      const totalDeposits = user.total_deposits || 0;
      const requiredWager = totalDeposits * 3;
      
      const userTransactions = await Transaction.findAll({ 
        where: { 
          user_id: user.telegram_id, 
          demo_mode: demoMode,
          status: 'completed'
        }
      });
      
      const totalWagered = userTransactions
        .filter(t => t.type.includes('loss') || t.type.includes('bet'))
        .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount)), 0);

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
        await User.update({
          demo_balance: parseFloat(user.demo_balance) - parseFloat(amount)
        }, { where: { telegram_id: user.telegram_id } });

        await Transaction.create({
          user_id: user.telegram_id,
          amount: -parseFloat(amount),
          type: 'withdrawal',
          status: 'completed',
          demo_mode: true,
          address: address
        });

        res.json({
          success: true,
          message: 'Withdrawal completed (demo mode)',
          new_balance: parseFloat(user.demo_balance) - parseFloat(amount)
        });
      } else {
        const transfer = await cryptoPayRequest('transfer', {
          user_id: telegramId,
          asset: 'TON',
          amount: amount.toString(),
          spend_id: `withdrawal_${Date.now()}_${telegramId}`
        }, false);

        if (transfer.ok && transfer.result) {
          await User.update({
            main_balance: parseFloat(user.main_balance) - parseFloat(amount)
          }, { where: { telegram_id: user.telegram_id } });
          
          await updateCasinoBank(-parseFloat(amount));

          await Transaction.create({
            user_id: user.telegram_id,
            amount: -parseFloat(amount),
            type: 'withdrawal',
            status: 'completed',
            demo_mode: false,
            address: address,
            hash: transfer.result.hash
          });

          res.json({
            success: true,
            message: 'Withdrawal completed',
            hash: transfer.result.hash,
            new_balance: parseFloat(user.main_balance) - parseFloat(amount)
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
  router.get('/transactions/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);

    try {
      const user = await User.findByPk(telegramId);
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const userTransactions = await Transaction.findAll({ 
        where: { user_id: user.telegram_id },
        order: [['created_at', 'DESC']],
        limit: 50
      });

      res.json(userTransactions);
    } catch (error) {
      console.error('Get transactions error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // API: Получить баланс пользователя
  router.get('/user/balance/:telegramId', async (req, res) => {
    const telegramId = parseInt(req.params.telegramId);
    const isAdminUser = telegramId === 842428912 || telegramId === 1135073023;

    try {
      let user = await User.findByPk(telegramId);
      
      if (!user) {
        user = await User.create({
          telegram_id: telegramId,
          main_balance: 0,
          demo_balance: isAdminUser ? 50 : 0,
          total_deposits: 0,
          demo_mode: false,
          is_admin: telegramId === parseInt(process.env.OWNER_TELEGRAM_ID) || telegramId === 1135073023
        });

        return res.json({
          telegram_id: user.telegram_id,
          main_balance: user.main_balance,
          demo_balance: user.demo_balance,
          demo_mode: user.demo_mode,
          is_admin: user.is_admin,
          total_deposits: 0
        });
      }

      res.json({
        telegram_id: user.telegram_id,
        main_balance: user.main_balance || 0,
        demo_balance: user.demo_balance || 0,
        demo_mode: user.demo_mode || false,
        is_admin: user.is_admin || false,
        total_deposits: user.total_deposits || 0
      });
    } catch (error) {
      console.error('Get balance error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // API: Переключить демо-режим
  router.post('/user/toggle-demo-mode', async (req, res) => {
    const { telegramId } = req.body;

    try {
      const user = await User.findByPk(parseInt(telegramId));
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const newDemoMode = !user.demo_mode;
      
      await User.update({
        demo_mode: newDemoMode
      }, { where: { telegram_id: user.telegram_id } });

      res.json({
        success: true,
        demo_mode: newDemoMode
      });
    } catch (error) {
      console.error('Toggle demo mode error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};