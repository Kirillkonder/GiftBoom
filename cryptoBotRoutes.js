// cryptoBotRoutes.js
const express = require('express');
const router = express.Router();

module.exports = function(db, users, transactions, cryptoPayRequest, updateCasinoBank, updateCasinoDemoBank, updateRTPStats) {

    // API: Создать инвойс для пополнения (режим/демо)
    router.post('/create-invoice', async (req, res) => {
        const { telegramId, amount, demoMode } = req.body;

        try {
            const user = users.findOne({ telegram_id: parseInt(telegramId) });
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // Создаем инвойс в Crypto Pay
            const invoice = await cryptoPayRequest('createInvoice', {
                asset: 'TON',
                amount: amount,
                description: `Deposit for user ${telegramId}`,
                hidden_message: 'Thank you for your deposit!',
                payload: JSON.stringify({
                    telegram_id: telegramId,
                    demo_mode: demoMode
                }),
                paid_btn_name: 'openBot',
                paid_btn_url: 'https://t.me/your_bot'
            }, demoMode);

            if (!invoice.ok) {
                return res.status(500).json({ error: invoice.error });
            }

            // Сохраняем транзакцию как pending
            const transaction = transactions.insert({
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

        } catch (error) {
            console.error('Create invoice error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Вывод средств через Crypto Bot
    router.post('/withdraw', async (req, res) => {
        const { telegramId, amount, walletAddress, demoMode } = req.body;

        try {
            const user = users.findOne({ telegram_id: parseInt(telegramId) });
            
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const balance = demoMode ? user.demo_balance : user.main_balance;
            
            if (balance < amount) {
                return res.status(400).json({ error: 'Недостаточно средств' });
            }

            if (amount < 1) {
                return res.status(400).json({ error: 'Минимальная сумма вывода: 1 TON' });
            }

            // Для демо-режима - просто имитируем вывод
            if (demoMode) {
                users.update({
                    ...user,
                    demo_balance: user.demo_balance - amount
                });

                transactions.insert({
                    user_id: user.$loki,
                    amount: -amount,
                    type: 'withdraw',
                    status: 'completed',
                    demo_mode: true,
                    details: {
                        wallet_address: walletAddress,
                        simulated: true
                    },
                    created_at: new Date()
                });

                return res.json({
                    success: true,
                    message: 'Демо-вывод выполнен',
                    new_balance: user.demo_balance - amount
                });
            }

            // Реальный вывод через Crypto Bot
            const withdraw = await cryptoPayRequest('transfer', {
                user_id: telegramId,
                asset: 'TON',
                amount: amount,
                spend_id: `withdraw_${telegramId}_${Date.now()}`
            }, false);

            if (!withdraw.ok) {
                return res.status(500).json({ error: withdraw.error });
            }

            // Обновляем баланс пользователя
            users.update({
                ...user,
                main_balance: user.main_balance - amount
            });

            // Обновляем банк казино (вывод средств)
            updateCasinoBank(-amount);

            // Сохраняем транзакцию
            transactions.insert({
                user_id: user.$loki,
                amount: -amount,
                type: 'withdraw',
                status: 'completed',
                demo_mode: false,
                details: {
                    wallet_address: walletAddress,
                    transfer_id: withdraw.result.transfer_id
                },
                created_at: new Date()
            });

            res.json({
                success: true,
                transfer_id: withdraw.result.transfer_id,
                new_balance: user.main_balance - amount
            });

        } catch (error) {
            console.error('Withdraw error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Проверить статус инвойса
    router.get('/invoice-status/:invoiceId', async (req, res) => {
        const { invoiceId } = req.params;
        const { demoMode } = req.query;

        try {
            const invoice = await cryptoPayRequest('getInvoices', { 
                invoice_ids: invoiceId 
            }, demoMode === 'true');

            if (!invoice.ok) {
                return res.status(500).json({ error: invoice.error });
            }

            if (invoice.result.items.length === 0) {
                return res.status(404).json({ error: 'Invoice not found' });
            }

            const invoiceData = invoice.result.items[0];

            // Если инвойс оплачен, обновляем статус в базе
            if (invoiceData.status === 'paid') {
                const transaction = transactions.findOne({ invoice_id: invoiceId });
                
                if (transaction && transaction.status === 'pending') {
                    const user = users.get(transaction.user_id);
                    
                    if (transaction.demo_mode) {
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
                    }

                    transactions.update({
                        ...transaction,
                        status: 'completed',
                        updated_at: new Date()
                    });
                }
            }

            res.json({
                success: true,
                status: invoiceData.status,
                invoice: invoiceData
            });

        } catch (error) {
            console.error('Invoice status error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    // API: Получить баланс Crypto Bot
    router.get('/crypto-balance', async (req, res) => {
        const { demoMode } = req.query;

        try {
            const response = await cryptoPayRequest('getBalance', {}, demoMode === 'true');

            if (!response.ok) {
                return res.status(500).json({ error: response.error });
            }

            const tonBalance = response.result.find(asset => asset.currency_code === 'TON');

            res.json({
                success: true,
                balance: tonBalance || null,
                all_assets: response.result
            });

        } catch (error) {
            console.error('Crypto balance error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    });

    return router;
};