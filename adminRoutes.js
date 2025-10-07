const express = require('express');
const router = express.Router();

module.exports = function(db, dbFunctions) {
    const {
        findUserByTelegramId, createUser, updateUserBalance,
        createTransaction, getUserTransactions,
        getCasinoBank, getCasinoDemoBank, updateCasinoBank, updateCasinoDemoBank,
        logAdminAction, getAdminLogs,
        createMinesGame, getMinesGame, updateMinesGame,
        createRocketGame, createRocketBet,
        findPromoCode, getAllPromoCodes, createPromoCode, deletePromoCode, togglePromoCodeActive,
        syncCasinoBalance
    } = dbFunctions;

    // API: Получить статистику казино
    router.get('/admin/stats', async (req, res) => {
        try {
            const realBank = await getCasinoBank();
            const demoBank = await getCasinoDemoBank();

            // Получаем общее количество пользователей
            db.get("SELECT COUNT(*) as total_users FROM users", (err, userCount) => {
                if (err) {
                    console.error('Error getting user count:', err);
                    return res.status(500).json({ error: 'Database error' });
                }

                // Получаем общую сумму депозитов
                db.get("SELECT SUM(amount) as total_deposits FROM transactions WHERE type = 'deposit' AND status = 'completed' AND demo_mode = false", (err, deposits) => {
                    if (err) {
                        console.error('Error getting deposits:', err);
                        return res.status(500).json({ error: 'Database error' });
                    }

                    // Получаем последние логи
                    getAdminLogs(50).then(logs => {
                        res.json({
                            success: true,
                            real_bank: realBank ? realBank.total_balance : 0,
                            demo_bank: demoBank ? demoBank.total_balance : 0,
                            total_users: userCount.total_users,
                            total_deposits: deposits.total_deposits || 0,
                            logs: logs
                        });
                    });
                });
            });
        } catch (error) {
            console.error('Get admin stats error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Изменить баланс пользователя
    router.post('/admin/update-balance', async (req, res) => {
        const { telegramId, amount, balanceType, reason } = req.body;
        const adminTelegramId = req.body.adminTelegramId;

        try {
            const user = await findUserByTelegramId(parseInt(telegramId));
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const newMainBalance = balanceType === 'main' ? user.main_balance + amount : user.main_balance;
            const newDemoBalance = balanceType === 'demo' ? user.demo_balance + amount : user.demo_balance;

            await updateUserBalance(user.telegram_id, newMainBalance, newDemoBalance);

            // Логируем действие
            await logAdminAction('update_balance', adminTelegramId, {
                target_user: telegramId,
                amount: amount,
                balance_type: balanceType,
                reason: reason,
                new_main_balance: newMainBalance,
                new_demo_balance: newDemoBalance
            });

            res.json({ 
                success: true,
                new_main_balance: newMainBalance,
                new_demo_balance: newDemoBalance
            });
        } catch (error) {
            console.error('Update balance error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Синхронизировать баланс казино
    router.post('/admin/sync-bank', async (req, res) => {
        const adminTelegramId = req.body.adminTelegramId;

        try {
            await syncCasinoBalance();
            
            // Логируем действие
            await logAdminAction('sync_bank', adminTelegramId, {
                action: 'manual_sync'
            });

            const realBank = await getCasinoBank();
            const demoBank = await getCasinoDemoBank();

            res.json({ 
                success: true,
                real_bank: realBank ? realBank.total_balance : 0,
                demo_bank: demoBank ? demoBank.total_balance : 0
            });
        } catch (error) {
            console.error('Sync bank error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Управление промокодами
    router.get('/admin/promo-codes', async (req, res) => {
        try {
            const promoCodes = await getAllPromoCodes();
            res.json({ success: true, promoCodes });
        } catch (error) {
            console.error('Get promo codes error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/admin/create-promo', async (req, res) => {
        const { code, bonus_percent, is_public, description, max_uses, created_by, owner_telegram_id } = req.body;

        try {
            const existingPromo = await findPromoCode(code);
            if (existingPromo) {
                return res.status(400).json({ error: 'Промокод уже существует' });
            }

            await createPromoCode({
                code,
                bonus_percent,
                is_public,
                description,
                max_uses,
                created_by,
                owner_telegram_id
            });

            // Логируем действие
            await logAdminAction('create_promo', created_by, {
                code: code,
                bonus_percent: bonus_percent,
                is_public: is_public,
                description: description
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Create promo error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/admin/delete-promo', async (req, res) => {
        const { code, adminTelegramId } = req.body;

        try {
            await deletePromoCode(code);

            // Логируем действие
            await logAdminAction('delete_promo', adminTelegramId, {
                code: code
            });

            res.json({ success: true });
        } catch (error) {
            console.error('Delete promo error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    router.post('/admin/toggle-promo', async (req, res) => {
        const { code, adminTelegramId } = req.body;

        try {
            const isActive = await togglePromoCodeActive(code);

            // Логируем действие
            await logAdminAction('toggle_promo', adminTelegramId, {
                code: code,
                new_status: isActive ? 'active' : 'inactive'
            });

            res.json({ success: true, is_active: isActive });
        } catch (error) {
            console.error('Toggle promo error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Получить информацию о пользователе
    router.get('/admin/user/:telegramId', async (req, res) => {
        const telegramId = parseInt(req.params.telegramId);

        try {
            const user = await findUserByTelegramId(telegramId);
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const transactions = await getUserTransactions(user.id, 100);

            res.json({
                success: true,
                user: user,
                transactions: transactions
            });
        } catch (error) {
            console.error('Get user info error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};