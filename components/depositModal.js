// Функции для управления модальными окнами
function openDepositModal() {
    document.getElementById('deposit-modal').style.display = 'block';
}

function closeDepositModal() {
    document.getElementById('deposit-modal').style.display = 'none';
    document.getElementById('deposit-amount').value = '';
}

function openWithdrawModal() {
    document.getElementById('withdraw-modal').style.display = 'block';
}

function closeWithdrawModal() {
    document.getElementById('withdraw-modal').style.display = 'none';
    document.getElementById('withdraw-amount').value = '';
    document.getElementById('withdraw-address').value = '';
}

function openAdminPanel() {
    app.openAdminPanel();
}

function closeAdminPanel() {
    app.closeAdminPanel();
}

// Закрытие модальных окон при клике вне их
window.onclick = function(event) {
    const depositModal = document.getElementById('deposit-modal');
    const withdrawModal = document.getElementById('withdraw-modal');
    const adminModal = document.getElementById('admin-modal');
    
    // Игровые модальные окна
    const minesModal = document.getElementById('game-mines-modal');
    const coinModal = document.getElementById('game-coin-modal'); // Изменено с contracts на coin
    const casesModal = document.getElementById('game-plinko-modal');
    const rocketModal = document.getElementById('game-rocket-modal');
    
    if (event.target === depositModal) {
        closeDepositModal();
    }
    if (event.target === withdrawModal) {
        closeWithdrawModal();
    }
    if (event.target === adminModal) {
        closeAdminPanel();
    }
    if (event.target === minesModal) {
        closeGameModal('mines');
    }
    if (event.target === coinModal) { // Изменено с contracts на coin
        closeGameModal('coin'); // Изменено с contracts на coin
    }
    if (event.target === casesModal) {
        closeGameModal('plinko');
    }
    if (event.target === rocketModal) {
        closeGameModal('rocket');
    }
}