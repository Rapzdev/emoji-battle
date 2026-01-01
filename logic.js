import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, get, set, update, onValue, remove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

const firebaseConfig = {
    apiKey: "AIzaSyB2hhJVmkbwfrVbm_XHJTeQPjmBXvjATz8",
    authDomain: "emojibattle-89193.firebaseapp.com",
    databaseURL: "https://emojibattle-89193-default-rtdb.firebaseio.com",
    projectId: "emojibattle-89193",
    storageBucket: "emojibattle-89193.firebasestorage.app",
    messagingSenderId: "497611186456",
    appId: "1:497611186456:web:4b0d2b9abb11674dad7e6d",
    measurementId: "G-573Q1XDCTD"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const currentUser = localStorage.getItem('currentUser');
if (!currentUser) {
    window.location.href = 'index.html';
}

// Game State
let gameState = {
    phase: 'lobby', // lobby, selection, battle, result
    currentBattleId: null,
    selectedEmojis: [],
    myEmojis: [],
    opponentEmojis: [],
    myTurn: false,
    waitingForAction: false,
    battleData: null
};

// Elements
const lobbySection = document.getElementById('lobbySection');
const selectionSection = document.getElementById('selectionSection');
const battleSection = document.getElementById('battleSection');
const availablePlayers = document.getElementById('availablePlayers');
const emojiSelection = document.getElementById('emojiSelection');
const selectedEmojis = document.getElementById('selectedEmojis');
const selectedCount = document.getElementById('selectedCount');
const confirmSelectionBtn = document.getElementById('confirmSelectionBtn');
const inviteModal = document.getElementById('inviteModal');
const waitingModal = document.getElementById('waitingModal');
const resultModal = document.getElementById('resultModal');
const backBtn = document.getElementById('backBtn');

// Initialize
init();

async function init() {
    await updateOnlineStatus(true);
    loadAvailablePlayers();
    listenForInvites();
    setupEventListeners();
}

function setupEventListeners() {
    backBtn.addEventListener('click', async () => {
        await updateOnlineStatus(false);
        window.location.href = 'clickcoin.html';
    });

    document.getElementById('acceptInviteBtn').addEventListener('click', acceptInvite);
    document.getElementById('declineInviteBtn').addEventListener('click', declineInvite);
    document.getElementById('backToLobbyBtn').addEventListener('click', backToLobby);
    confirmSelectionBtn.addEventListener('click', confirmSelection);

    window.addEventListener('beforeunload', () => {
        updateOnlineStatus(false);
    });
}

async function updateOnlineStatus(online) {
    const userRef = ref(db, 'users/' + currentUser);
    await update(userRef, { online: online });
}

function loadAvailablePlayers() {
    const usersRef = ref(db, 'users');
    onValue(usersRef, (snapshot) => {
        if (snapshot.exists()) {
            const users = snapshot.val();
            renderAvailablePlayers(users);
        }
    });
}

function renderAvailablePlayers(users) {
    availablePlayers.innerHTML = '';
    
    const playersList = Object.entries(users).filter(([username, data]) => 
        username !== currentUser && data.emojis && data.emojis.length >= 3
    );

    if (playersList.length === 0) {
        availablePlayers.innerHTML = '<p style="text-align: center; color: #ccc; padding: 40px;">Tiada pemain tersedia dengan emoji mencukupi.</p>';
        return;
    }

    playersList.forEach(([username, data]) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        
        item.innerHTML = `
            <div>
                <span class="player-info-text">${username}</span>
                ${data.online ? '<span class="online-badge">🟢 ONLINE</span>' : ''}
            </div>
            <button class="invite-btn" onclick="sendInvite('${username}')" ${!data.online ? 'disabled' : ''}>
                ⚔️ Jemput
            </button>
        `;
        
        availablePlayers.appendChild(item);
    });
}

window.sendInvite = async function(targetUser) {
    const inviteId = Date.now() + '_' + currentUser;
    const inviteRef = ref(db, 'invites/' + targetUser + '/' + inviteId);
    
    await set(inviteRef, {
        from: currentUser,
        to: targetUser,
        status: 'pending',
        timestamp: Date.now()
    });

    showWaitingModal('Menunggu ' + targetUser + ' menerima jemputan...');
    
    // Listen for response
    onValue(inviteRef, async (snapshot) => {
        if (snapshot.exists()) {
            const invite = snapshot.val();
            if (invite.status === 'accepted') {
                hideWaitingModal();
                await startBattle(invite.battleId);
                await remove(inviteRef);
            } else if (invite.status === 'declined') {
                hideWaitingModal();
                alert('❌ ' + targetUser + ' menolak jemputan.');
                await remove(inviteRef);
            }
        }
    });
};

function listenForInvites() {
    const invitesRef = ref(db, 'invites/' + currentUser);
    onValue(invitesRef, (snapshot) => {
        if (snapshot.exists()) {
            const invites = snapshot.val();
            const pendingInvites = Object.entries(invites).filter(([id, data]) => data.status === 'pending');
            
            if (pendingInvites.length > 0) {
                const [inviteId, inviteData] = pendingInvites[0];
                showInviteModal(inviteId, inviteData);
            }
        }
    });
}

function showInviteModal(inviteId, inviteData) {
    document.getElementById('inviteText').textContent = 
        `${inviteData.from} mengajak anda bertarung!`;
    
    inviteModal.classList.add('active');
    
    window.currentInviteId = inviteId;
    window.currentInviteData = inviteData;
}

async function acceptInvite() {
    inviteModal.classList.remove('active');
    
    const battleId = 'battle_' + Date.now();
    const inviteRef = ref(db, 'invites/' + currentUser + '/' + window.currentInviteId);
    
    await update(inviteRef, {
        status: 'accepted',
        battleId: battleId
    });

    await startBattle(battleId);
}

async function declineInvite() {
    inviteModal.classList.remove('active');
    
    const inviteRef = ref(db, 'invites/' + currentUser + '/' + window.currentInviteId);
    await update(inviteRef, { status: 'declined' });
    
    setTimeout(() => remove(inviteRef), 1000);
}

async function startBattle(battleId) {
    gameState.currentBattleId = battleId;
    gameState.phase = 'selection';
    
    showSection('selectionSection');
    await loadUserEmojis();
}

async function loadUserEmojis() {
    const userRef = ref(db, 'users/' + currentUser);
    const snapshot = await get(userRef);
    
    if (snapshot.exists()) {
        const userData = snapshot.val();
        renderEmojiSelection(userData.emojis || []);
    }
}

function renderEmojiSelection(emojis) {
    emojiSelection.innerHTML = '';
    
    emojis.forEach((emoji, index) => {
        const card = document.createElement('div');
        card.className = 'emoji-select-card';
        card.onclick = () => toggleEmojiSelection(index, emoji);
        
        const roleColors = {
            lifesteal: 'background: linear-gradient(135deg, #ff6b6b, #ee5a6f);',
            tank: 'background: linear-gradient(135deg, #4ecdc4, #44a08d);',
            mage: 'background: linear-gradient(135deg, #a8edea, #fed6e3); color: #333;',
            assassin: 'background: linear-gradient(135deg, #8e44ad, #3498db);',
            support: 'background: linear-gradient(135deg, #f093fb, #f5576c);'
        };
        
        card.innerHTML = `
            <span class="emoji-icon-large">${emoji.emoji}</span>
            <div class="emoji-role-badge" style="${roleColors[emoji.role]}">${emoji.role.toUpperCase()}</div>
            <div style="margin-top: 8px; font-size: 0.85em;">
                <div>❤️ ${emoji.hp}</div>
                <div>⚔️ ${emoji.damage}</div>
            </div>
        `;
        
        emojiSelection.appendChild(card);
    });
}

function toggleEmojiSelection(index, emoji) {
    const cards = document.querySelectorAll('.emoji-select-card');
    const card = cards[index];
    
    if (card.classList.contains('selected')) {
        card.classList.remove('selected');
        gameState.selectedEmojis = gameState.selectedEmojis.filter(e => e.emoji !== emoji.emoji);
    } else {
        if (gameState.selectedEmojis.length >= 3) {
            alert('❌ Maksimum 3 emoji sahaja!');
            return;
        }
        card.classList.add('selected');
        gameState.selectedEmojis.push({...emoji});
    }
    
    updateSelectedDisplay();
}

function updateSelectedDisplay() {
    selectedCount.textContent = gameState.selectedEmojis.length;
    
    if (gameState.selectedEmojis.length === 0) {
        selectedEmojis.innerHTML = '<div style="color: #ccc;">Belum ada emoji dipilih...</div>';
        confirmSelectionBtn.disabled = true;
    } else {
        selectedEmojis.innerHTML = gameState.selectedEmojis.map(e => 
            `<div class="selected-emoji">${e.emoji}</div>`
        ).join('');
        confirmSelectionBtn.disabled = gameState.selectedEmojis.length !== 3;
    }
}

async function confirmSelection() {
    if (gameState.selectedEmojis.length !== 3) return;
    
    const battleRef = ref(db, 'battles/' + gameState.currentBattleId);
    const snapshot = await get(battleRef);
    
    if (!snapshot.exists()) {
        // First player to select
        await set(battleRef, {
            [currentUser]: {
                emojis: gameState.selectedEmojis,
                ready: true
            },
            status: 'waiting',
            createdAt: Date.now()
        });
        
        showWaitingModal('Menunggu lawan memilih emoji...');
        
        // Wait for opponent
        onValue(battleRef, async (snap) => {
            if (snap.exists()) {
                const data = snap.val();
                const players = Object.keys(data).filter(k => k !== 'status' && k !== 'createdAt' && k !== 'currentTurn' && k !== 'round');
                
                if (players.length === 2 && data.status === 'waiting') {
                    const allReady = players.every(p => data[p].ready);
                    if (allReady) {
                        hideWaitingModal();
                        await initializeBattle(data, players);
                    }
                }
            }
        });
    } else {
        // Second player
        const data = snapshot.val();
        await update(battleRef, {
            [currentUser]: {
                emojis: gameState.selectedEmojis,
                ready: true
            },
            status: 'active',
            currentTurn: Math.random() > 0.5 ? currentUser : Object.keys(data)[0],
            round: 1
        });
        
        hideWaitingModal();
    }
}

async function initializeBattle(data, players) {
    gameState.phase = 'battle';
    showSection('battleSection');
    
    const opponent = players.find(p => p !== currentUser);
    gameState.myEmojis = data[currentUser].emojis.map(e => ({...e, currentHp: e.hp}));
    gameState.opponentEmojis = data[opponent].emojis.map(e => ({...e, currentHp: e.hp}));
    
    document.getElementById('player1Name').textContent = currentUser;
    document.getElementById('player2Name').textContent = opponent;
    
    renderBattleField();
    
    // Listen for battle updates
    const battleRef = ref(db, 'battles/' + gameState.currentBattleId);
    onValue(battleRef, (snapshot) => {
        if (snapshot.exists()) {
            gameState.battleData = snapshot.val();
            handleBattleUpdate();
        }
    });
}

function renderBattleField() {
    const yourEmojis = document.getElementById('yourEmojis');
    const opponentEmojis = document.getElementById('opponentEmojis');
    
    yourEmojis.innerHTML = gameState.myEmojis.map((e, i) => {
        const hpPercent = (e.currentHp / e.hp) * 100;
        const hpClass = hpPercent > 66 ? 'high' : hpPercent > 33 ? 'medium' : '';
        const isDead = e.currentHp <= 0;
        
        return `
            <div class="emoji-battle-card ${isDead ? 'dead' : ''}" data-index="${i}">
                <div class="emoji-battle-icon">${e.emoji}</div>
                <div class="emoji-battle-stats">
                    <div><strong>${e.role.toUpperCase()}</strong></div>
                    <div>⚔️ ${e.damage} | ❤️ ${Math.max(0, e.currentHp)}/${e.hp}</div>
                    <div class="hp-bar">
                        <div class="hp-fill ${hpClass}" style="width: ${Math.max(0, hpPercent)}%"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    opponentEmojis.innerHTML = gameState.opponentEmojis.map((e, i) => {
        const hpPercent = (e.currentHp / e.hp) * 100;
        const hpClass = hpPercent > 66 ? 'high' : hpPercent > 33 ? 'medium' : '';
        const isDead = e.currentHp <= 0;
        
        return `
            <div class="emoji-battle-card ${isDead ? 'dead' : ''}" data-index="${i}">
                <div class="emoji-battle-icon">${e.emoji}</div>
                <div class="emoji-battle-stats">
                    <div><strong>${e.role.toUpperCase()}</strong></div>
                    <div>⚔️ ${e.damage} | ❤️ ${Math.max(0, e.currentHp)}/${e.hp}</div>
                    <div class="hp-bar">
                        <div class="hp-fill ${hpClass}" style="width: ${Math.max(0, hpPercent)}%"></div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function handleBattleUpdate() {
    const data = gameState.battleData;
    
    if (data.status === 'finished') {
        showResult(data.winner);
        return;
    }
    
    const isMyTurn = data.currentTurn === currentUser;
    document.getElementById('turnIndicator').textContent = 
        isMyTurn ? '🎯 GILIRAN ANDA!' : '⏳ Menunggu lawan...';
    
    if (isMyTurn && !gameState.waitingForAction) {
        if (!data.rpsResult) {
            showRPSChoice();
        } else if (data.rpsResult.winner === currentUser && !data.attackChoice) {
            showAttackChoice();
        } else if (data.rpsResult.winner !== currentUser && !data.defendChoice) {
            showDefendChoice();
        }
    }
    
    // Update emoji states
    if (data[currentUser]) {
        gameState.myEmojis = data[currentUser].emojis.map(e => ({...e, currentHp: e.currentHp}));
    }
    const opponent = Object.keys(data).find(k => k !== currentUser && k !== 'status' && k !== 'createdAt' && k !== 'currentTurn' && k !== 'round' && k !== 'rpsResult' && k !== 'attackChoice' && k !== 'defendChoice');
    if (opponent && data[opponent]) {
        gameState.opponentEmojis = data[opponent].emojis.map(e => ({...e, currentHp: e.currentHp}));
    }
    
    renderBattleField();
}

function showRPSChoice() {
    const actionSection = document.getElementById('actionSection');
    actionSection.innerHTML = `
        <h3>✊✋✌️ GUNTING BATU KERTAS</h3>
        <div class="rps-choices">
            <button class="rps-btn" onclick="makeRPSChoice('rock')">✊</button>
            <button class="rps-btn" onclick="makeRPSChoice('paper')">✋</button>
            <button class="rps-btn" onclick="makeRPSChoice('scissors')">✌️</button>
        </div>
    `;
}

window.makeRPSChoice = async function(choice) {
    gameState.waitingForAction = true;
    
    const battleRef = ref(db, 'battles/' + gameState.currentBattleId);
    const snapshot = await get(battleRef);
    const data = snapshot.val();
    
    if (!data.rpsChoices) {
        await update(battleRef, {
            rpsChoices: { [currentUser]: choice }
        });
        
        addLog('Anda memilih ' + choice, 'info');
        document.getElementById('actionSection').innerHTML = '<div class="waiting-indicator"><div class="spinner"></div>Menunggu lawan memilih...</div>';
    } else {
        const opponent = Object.keys(data).find(k => k !== currentUser && k !== 'status' && k !== 'createdAt' && k !== 'currentTurn' && k !== 'round' && k !== 'rpsChoices' && k !== 'rpsResult' && k !== 'attackChoice' && k !== 'defendChoice');
        const opponentChoice = data.rpsChoices[opponent];
        
        const result = determineRPSWinner(choice, opponentChoice);
        
        await update(battleRef, {
            rpsChoices: { [currentUser]: choice, [opponent]: opponentChoice },
            rpsResult: result
        });
        
        addLog(`Hasil: ${currentUser} (${choice}) vs ${opponent} (${opponentChoice}) - Pemenang: ${result.winner}`, result.winner === currentUser ? 'win' : 'lose');
        
        gameState.waitingForAction = false;
    }
};

function determineRPSWinner(choice1, choice2) {
    const players = Object.keys(gameState.battleData).filter(k => k !== 'status' && k !== 'createdAt' && k !== 'currentTurn' && k !== 'round' && k !== 'rpsChoices' && k !== 'rpsResult' && k !== 'attackChoice' && k !== 'defendChoice');
    const opponent = players.find(p => p !== currentUser);
    
    if (choice1 === choice2) {
        return { result: 'draw', winner: null };
    }
    
    const wins = {
        rock: 'scissors',
        paper: 'rock',
        scissors: 'paper'
    };
    
    return {
        result: wins[choice1] === choice2 ? 'player1' : 'player2',
        winner: wins[choice1] === choice2 ? currentUser : opponent
    };
}

function showAttackChoice() {
    const aliveEmojis = gameState.myEmojis.filter(e => e.currentHp > 0);
    
    const actionSection = document.getElementById('actionSection');
    actionSection.innerHTML = `
        <h3>⚔️ PILIH EMOJI UNTUK MENYERANG</h3>
        <div class="rps-choices">
            ${aliveEmojis.map((e, i) => `
                <button class="rps-btn" onclick="selectAttacker(${gameState.myEmojis.indexOf(e)})" style="font-size: 2em;">
                    ${e.emoji}<br><small style="font-size: 0.5em;">💥 ${e.damage}</small>
                </button>
            `).join('')}
        </div>
    `;
}

window.selectAttacker = async function(index) {
    gameState.waitingForAction = true;
    
    const battleRef = ref(db, 'battles/' + gameState.currentBattleId);
    await update(battleRef, {
        attackChoice: { player: currentUser, emojiIndex: index }
    });
    
    addLog(`Anda memilih ${gameState.myEmojis[index].emoji} untuk menyerang`, 'info');
    document.getElementById('actionSection').innerHTML = '<div class="waiting-indicator"><div class="spinner"></div>Menunggu lawan memilih pertahanan...</div>';
    gameState.waitingForAction = false;
};

function showDefendChoice() {
    const aliveEmojis = gameState.myEmojis.filter(e => e.currentHp > 0);
    
    const actionSection = document.getElementById('actionSection');
    actionSection.innerHTML = `
        <h3>🛡️ PILIH EMOJI UNTUK BERTAHAN</h3>
        <div class="rps-choices">
            ${aliveEmojis.map((e, i) => `
                <button class="rps-btn" onclick="selectDefender(${gameState.myEmojis.indexOf(e)})" style="font-size: 2em;">
                    ${e.emoji}<br><small style="font-size: 0.5em;">❤️ ${e.currentHp}</small>
                </button>
            `).join('')}
        </div>
    `;
}

window.selectDefender = async function(index) {
    gameState.waitingForAction = true;
    
    const battleRef = ref(db, 'battles/' + gameState.currentBattleId);
    const snapshot = await get(battleRef);
    const data = snapshot.val();
    
    await update(battleRef, {
        defendChoice: { player: currentUser, emojiIndex: index }
    });
    
    // Process attack
    await processAttack(data, index);
};

async function processAttack(data, defenderIndex) {
    const battleRef = ref(db, 'battles/' + gameState.currentBattleId);
    const attacker = data.rpsResult.winner;
    const defender = Object.keys(data).find(k => k !== attacker && k !== 'status' && k !== 'createdAt' && k !== 'currentTurn' && k !== 'round' && k !== 'rpsChoices' && k !== 'rpsResult' && k !== 'attackChoice' && k !== 'defendChoice');
    
    const attackerEmoji = data[attacker].emojis[data.attackChoice.emojiIndex];
    const defenderEmoji = data[defender].emojis[defenderIndex];
    
    let damage = attackerEmoji.damage;
    let healing = 0;
    
    // Lifesteal ability
    if (attackerEmoji.role === 'lifesteal') {
        healing = Math.floor(damage * 0.3);
        const newHp = Math.min(attackerEmoji.hp, attackerEmoji.currentHp + healing);
        data[attacker].emojis[data.attackChoice.emojiIndex].currentHp = newHp;
    }
    
    // Apply damage
    const newHp = Math.max(0, defenderEmoji.currentHp - damage);
    data[defender].emojis[defenderIndex].currentHp = newHp;
    
    addLog(`${attackerEmoji.emoji} menyerang ${defenderEmoji.emoji} dengan ${damage} damage!`, attacker === currentUser ? 'win' : 'lose');
    
    if (healing > 0) {
        addLog(`${attackerEmoji.emoji} menyembuh ${healing} HP!`, 'win');
    }
    
    if (newHp <= 0) {
        addLog(`${defenderEmoji.emoji} telah kalah!`, defender === currentUser ? 'lose' : 'win');
    }
    
    // Check win condition
    const attackerAlive = data[attacker].emojis.filter(e => e.currentHp > 0).length;
    const defenderAlive = data[defender].emojis.filter(e => e.currentHp > 0).length;
    
    if (attackerAlive === 0 || defenderAlive === 0) {
        await update(battleRef, {
            [attacker]: data[attacker],
            [defender]: data[defender],
            status: 'finished',
            winner: attackerAlive > 0 ? attacker : defender,
            rpsChoices: null,
            rpsResult: null,
            attackChoice: null,
            defendChoice: null
        });
    } else {
        // Continue battle
        const nextTurn = attacker === currentUser ? defender : attacker;
        await update(battleRef, {
            [attacker]: data[attacker],
            [defender]: data[defender],
            currentTurn: nextTurn,
            round: (data.round || 1) + 1,
            rpsChoices: null,
            rpsResult: null,
            attackChoice: null,
            defendChoice: null
        });
    }
    
    gameState.waitingForAction = false;
    document.getElementById('actionSection').innerHTML = '';
}

function addLog(message, type = 'info') {
    const battleLog = document.getElementById('battleLog');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    battleLog.insertBefore(entry, battleLog.firstChild);
}

function showResult(winner) {
    const isWinner = winner === currentUser;
    
    document.getElementById('resultTitle').textContent = isWinner ? '🎉 KEMENANGAN!' : '💀 KEKALAHAN!';
    document.getElementById('resultText').textContent = isWinner 
        ? 'Tahniah! Anda menang pertempuran!' 
        : 'Anda kalah. Cuba lagi!';
    
    resultModal.classList.add('active');
}

async function backToLobby() {
    resultModal.classList.remove('active');
    
    if (gameState.currentBattleId) {
        const battleRef = ref(db, 'battles/' + gameState.currentBattleId);
        await remove(battleRef);
    }
    
    gameState = {
        phase: 'lobby',
        currentBattleId: null,
        selectedEmojis: [],
        myEmojis: [],
        opponentEmojis: [],
        myTurn: false,
        waitingForAction: false,
        battleData: null
    };
    
    showSection('lobbySection');
}

function showSection(sectionId) {
    document.querySelectorAll('.game-section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
}

function showWaitingModal(text) {
    document.getElementById('waitingText').textContent = text;
    waitingModal.classList.add('active');
}

function hideWaitingModal() {
    waitingModal.classList.remove('active');
}
