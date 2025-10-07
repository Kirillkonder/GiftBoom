const express = require('express');
const router = express.Router();

module.exports = function(db, dbFunctions) {
    const {
        findUserByTelegramId, createUser, updateUserBalance,
        createTransaction, findTransactionByInvoiceId, updateTransactionStatus,
        getCasinoBank, updateCasinoBank, updateCasinoDemoBank,
        updateRTPStats
    } = dbFunctions;

    // Webhook для CryptoBot
    router.post('/webhook', async (req, res) => {
        console.log('🔔 CryptoBot Webhook received:', req.body);
        
        const { update_id, update_type, payload } = req.body;
        
        if (update_type === 'invoice_paid') {
            const { invoice_id, amount, paid_btn_name, paid_btn_url, payload: invoicePayload } = payload;
            
            try {
                const parsedPayload = JSON.parse(invoicePayload);
                const { telegram_id, demo_mode, amount: originalAmount, final_amount, bonus_amount, promo_code } = parsedPayload;
                
                console.log(`💰 Invoice paid: ${invoice_id}, User: ${telegram_id}, Amount: ${amount}`);
                
                // Находим транзакцию
                const transaction = await findTransactionByInvoiceId(invoice_id);
                
                if (transaction && transaction.status === 'pending') {
                    const user = await findUserByTelegramId(parseInt(telegram_id));
                    
                    if (demo_mode) {
                        await updateUserBalance(user.telegram_id, user.main_balance, user.demo_balance + final_amount, user.total_deposits + originalAmount);
                    } else {
                        await updateUserBalance(user.telegram_id, user.main_balance + final_amount, user.demo_balance, user.total_deposits + originalAmount);
                    }

                    // Обновляем статус транзакции
                    await updateTransactionStatus(transaction.id, 'completed');

                    // Обновляем банк казино
                    if (demo_mode) {
                        await updateCasinoDemoBank(originalAmount);
                    } else {
                        await updateCasinoBank(originalAmount);
                        updateRTPStats('realBank', originalAmount, 0);
                    }

                    console.log(`✅ Deposit completed for user ${telegram_id}: ${final_amount} TON`);
                }
            } catch (error) {
                console.error('Webhook processing error:', error);
            }
        }
        
        res.json({ success: true });
    });

    return router;
};