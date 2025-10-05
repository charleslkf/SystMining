document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');

    const walletStatusEl = document.getElementById('wallet-status');
    const walletAddressEl = document.getElementById('wallet-address');
    const nodeTierEl = document.getElementById('node-tier');
    const minedSystEl = document.getElementById('mined-syst');
    const energyBarEl = document.getElementById('energy-bar');
    const claimRewardsBtn = document.getElementById('claim-rewards-btn');
    const connectWalletBtn = document.getElementById('connect-wallet-btn');
    const welcomeModal = document.getElementById('welcome-modal');
    const notificationEl = document.getElementById('notification');

    // --- Game Configuration ---
    const TILE_SIZE = 16;
    const GRID_WIDTH = 50; // In tiles
    const GRID_WIDTH_IN_TILES = Math.floor(GRID_WIDTH / 2) * 2; // Ensure it's even
    const GRID_HEIGHT = 1000; // A large number for "endless" feel
    const CLICK_COST = 1;
    const CLICKS_PER_DIG = 10;
    const MAX_ENERGY = 100;
    const REWARD_CHANCE = 0.5; // 50% chance to find SYST after a dig

    const tierConfig = {
        0: { name: "No Node", reward: 0 },
        1: { name: "Tier 1 Node", reward: 0.1 },
        2: { name: "Tier 2 Node", reward: 0.5 },
        3: { name: "Tier 3 Node", reward: 2 },
        4: { name: "Tier 4 Node", reward: 5 },
        5: { name: "Tier 5 Node", reward: 10 },
    };

    // --- Game State ---
    let gameState = {
        connected: false,
        walletAddress: null,
        nodeTier: 0,
        miningEnergy: MAX_ENERGY,
        minedSyst: 0,
        minerPos: { x: 0, y: 0, direction: 1 }, // 1 for right, -1 for left
        minedTiles: {}, // Using an object as a set for efficient lookups
        clickCount: 0,
        isClaiming: false,
    };

    // --- Sound Engine ---
    const sounds = {
        mine: new Tone.Synth({ oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 } }).toDestination(),
        reward: new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.2, sustain: 0, release: 0.2 } }).toDestination(),
        lift: new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.1, decay: 0.5, sustain: 0.1, release: 0.5 } }).toDestination(),
        click: new Tone.MembraneSynth({ octaves: 4, pitchDecay: 0.1, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).toDestination(),
    };

    // --- Visual Effects ---
    let clickEffects = [];

    // --- Camera & Render State ---
    let camera = {
        x: 0,
        y: 0,
    };
    let lastFrameTime = 0;

    // --- Main Game Functions ---

    /**
     * Initializes the game, sets up the canvas, and starts the game loop.
     */
    function init() {
        setupCanvas();
        window.addEventListener('resize', setupCanvas);

        if (window.ethereum) {
            window.ethereum.on('accountsChanged', () => {
                showNotification("Account changed. Reloading...", 2000);
                setTimeout(() => window.location.reload(), 2000);
            });
        }

        // Center camera on miner initially
        centerCameraOnMiner();

        // Start the game loop
        gameLoop(0);

        console.log("Game Initialized");
        updateUI();
    }

    function setupCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
    }

    function gameLoop(timestamp) {
        const deltaTime = timestamp - lastFrameTime;
        lastFrameTime = timestamp;

        update(deltaTime);
        draw();

        requestAnimationFrame(gameLoop);
    }

    function update(deltaTime) {
        // Update click effects
        for (let i = clickEffects.length - 1; i >= 0; i--) {
            const effect = clickEffects[i];
            effect.life -= deltaTime;
            effect.radius += deltaTime * 0.2; // expand speed
            if (effect.life <= 0) {
                clickEffects.splice(i, 1);
            }
        }

        if (gameState.isClaiming) return; // Pause game updates during claim animation

        centerCameraOnMiner();
    }

    function createClickEffect(x, y) {
        clickEffects.push({ x, y, radius: 0, life: 300 }); // 300ms life
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Translate context to camera position
        ctx.save();
        ctx.translate(-camera.x, -camera.y);

        drawGrid();
        drawMiner();
        drawClickEffects();

        ctx.restore();
    }

    function drawClickEffects() {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        for (const effect of clickEffects) {
            ctx.beginPath();
            ctx.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
            ctx.globalAlpha = effect.life / 300;
            ctx.stroke();
        }
        ctx.globalAlpha = 1; // Reset alpha
        ctx.lineWidth = 1;
    }

    function drawGrid() {
        const startCol = Math.floor(camera.x / TILE_SIZE);
        const endCol = Math.ceil((camera.x + canvas.clientWidth) / TILE_SIZE);
        const startRow = Math.floor(camera.y / TILE_SIZE);
        const endRow = Math.ceil((camera.y + canvas.clientHeight) / TILE_SIZE);

        ctx.strokeStyle = '#304a69'; // Dark blue lines
        for (let row = startRow; row < endRow; row++) {
            for (let col = startCol; col < endCol; col++) {
                if (gameState.minedTiles[`${col},${row}`]) continue;

                ctx.fillStyle = '#4a4a4a'; // Rock color
                ctx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                ctx.strokeRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    function drawMiner() {
        const minerScreenX = gameState.minerPos.x * TILE_SIZE;
        const minerScreenY = gameState.minerPos.y * TILE_SIZE;

        // Simple 2x2 tile rectangle for now
        ctx.fillStyle = '#f92aad'; // Fuchsia color
        ctx.fillRect(minerScreenX, minerScreenY, TILE_SIZE * 2, TILE_SIZE * 2);
    }

    function centerCameraOnMiner() {
        const minerCenterX = gameState.minerPos.x * TILE_SIZE + TILE_SIZE;
        const minerCenterY = gameState.minerPos.y * TILE_SIZE + TILE_SIZE;

        camera.x = minerCenterX - canvas.clientWidth / 2;
        camera.y = minerCenterY - canvas.clientHeight / 2;
    }

    /**
     * Connects to the user's EVM wallet, fetches their address, and simulates fetching their NFT tier.
     */
    async function connectWallet() {
        if (typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                const address = accounts[0];
                gameState.walletAddress = address;
                gameState.connected = true;

                // Simulate getNodeTier() call
                // This uses the wallet address to create a "sticky" random tier.
                const addressSlice = parseInt(address.slice(-4), 16);
                gameState.nodeTier = (addressSlice % 5) + 1; // Tier 1-5

                showNotification(`Wallet ${address.substring(0, 6)}... connected!`);

                loadProgress(); // Load progress for this specific wallet
                updateUI();

            } catch (error) {
                console.error("User rejected connection:", error);
                showNotification("Wallet connection was rejected.", 3000);
            }
        } else {
            showNotification("Please install a wallet like MetaMask!", 3000);
        }
    }

    /**
     * Handles the core mining action when the user clicks on the canvas.
     * It consumes energy, handles the dig cycle, moves the miner, and checks for rewards.
     */
    function mine() {
        if (gameState.isClaiming || gameState.miningEnergy <= 0) {
            if (gameState.miningEnergy <= 0) showNotification("Energy depleted. Claim rewards to recharge.");
            return;
        }

        // 1. Consume energy and increment click count
        gameState.miningEnergy -= CLICK_COST;
        gameState.clickCount++;
        sounds.mine.triggerAttackRelease('C2', '8n');

        // 2. Check if a dig cycle is complete
        if (gameState.clickCount >= CLICKS_PER_DIG) {
            gameState.clickCount = 0;

            // 3. Break the two rock tiles in front of the miner
            const { x, y } = gameState.minerPos;
            gameState.minedTiles[`${x},${y}`] = true;
            gameState.minedTiles[`${x + 1},${y}`] = true;

            // 4. Move the miner forward
            gameState.minerPos.x += gameState.minerPos.direction;

            // 5. Implement snake-like movement logic
            const nextX = gameState.minerPos.x;
            const direction = gameState.minerPos.direction;

            if (direction === 1 && nextX >= GRID_WIDTH_IN_TILES - 1) {
                // Hit the right wall, move down and reverse
                gameState.minerPos.y++;
                gameState.minerPos.direction = -1;
            } else if (direction === -1 && nextX <= 0) {
                // Hit the left wall, move down and reverse
                gameState.minerPos.y++;
                gameState.minerPos.direction = 1;
            }

            // 6. Check for rewards
            if (Math.random() < REWARD_CHANCE) {
                const rewardAmount = tierConfig[gameState.nodeTier]?.reward || 0;
                if (rewardAmount > 0) {
                    gameState.minedSyst += rewardAmount;
                    sounds.reward.triggerAttackRelease('G4', '8n');
                    showNotification(`+${rewardAmount.toFixed(4)} SYST Found!`);
                }
            }
        }

        updateUI();
        saveProgress();
    }

    /**
     * Helper function for linear interpolation.
     */
    function lerp(start, end, t) {
        return start * (1 - t) + end * t;
    }

    /**
     * Animates the miner's position from its current spot to a target over a set duration.
     */
    async function animateMinerTo(targetX, targetY, duration = 1000) {
        const startX = gameState.minerPos.x;
        const startY = gameState.minerPos.y;
        let startTime = null;

        return new Promise(resolve => {
            function animationStep(timestamp) {
                if (!startTime) startTime = timestamp;
                const progress = Math.min((timestamp - startTime) / duration, 1);

                gameState.minerPos.x = lerp(startX, targetX, progress);
                gameState.minerPos.y = lerp(startY, targetY, progress);

                if (progress < 1) {
                    requestAnimationFrame(animationStep);
                } else {
                    gameState.minerPos.x = targetX;
                    gameState.minerPos.y = targetY;
                    resolve();
                }
            }
            requestAnimationFrame(animationStep);
        });
    }

    /**
     * Initiates the animated sequence for claiming rewards.
     * The miner travels to the surface, SYST is "banked" (reset), energy is recharged,
     * and the miner returns to their position.
     */
    async function claimRewards() {
        if (gameState.isClaiming) return;

        gameState.isClaiming = true;
        claimRewardsBtn.disabled = true;
        sounds.lift.triggerAttack();

        const originalPos = { ...gameState.minerPos };

        // 1. Animate to lift (left side of the mine)
        await animateMinerTo(0, originalPos.y, 1500);

        // 2. Animate lift going up (miner disappears off-screen)
        await animateMinerTo(0, -10, 2000);

        // 3. "Claim" action at the surface
        showNotification("Rewards Claimed!", 2000);
        gameState.minedSyst = 0;
        gameState.miningEnergy = MAX_ENERGY;
        updateUI();

        // Short delay at surface
        await new Promise(res => setTimeout(res, 1000));

        sounds.lift.triggerRelease();
        sounds.lift.triggerAttack();

        // 4. Animate lift going down (miner reappears)
        await animateMinerTo(0, originalPos.y, 2000);

        // 5. Animate back to original position
        await animateMinerTo(originalPos.x, originalPos.y, 1500);

        gameState.minerPos = originalPos; // Snap to final position

        sounds.lift.triggerRelease();
        gameState.isClaiming = false;
        claimRewardsBtn.disabled = false;
        saveProgress();
    }

    /**
     * Updates all visible UI elements with the latest game state.
     */
    function updateUI() {
        // Update all UI elements based on gameState
        minedSystEl.textContent = gameState.minedSyst.toFixed(4);
        energyBarEl.textContent = `${gameState.miningEnergy}/${MAX_ENERGY}`;

        if (gameState.connected) {
            walletStatusEl.textContent = 'Connected';
            walletAddressEl.textContent = `${gameState.walletAddress.substring(0, 6)}...${gameState.walletAddress.substring(gameState.walletAddress.length - 4)}`;
            nodeTierEl.textContent = tierConfig[gameState.nodeTier].name;
            welcomeModal.classList.add('hidden');
        } else {
            walletStatusEl.textContent = 'Disconnected';
            walletAddressEl.textContent = '';
            nodeTierEl.textContent = '';
            welcomeModal.classList.remove('hidden');
        }
    }

    /**
     * Displays a temporary notification message at the top of the screen.
     */
    function showNotification(message, duration = 3000) {
        notificationEl.textContent = message;
        notificationEl.classList.remove('hidden');
        notificationEl.style.opacity = 1;

        setTimeout(() => {
            notificationEl.style.opacity = 0;
            setTimeout(() => notificationEl.classList.add('hidden'), 500);
        }, duration);
    }

    /**
     * Loads the player's progress from localStorage using the wallet address as a key.
     */
    function loadProgress() {
        if (!gameState.walletAddress) return;
        const savedStateJSON = localStorage.getItem(`syst_miner_save_${gameState.walletAddress}`);

        if (savedStateJSON) {
            try {
                const savedState = JSON.parse(savedStateJSON);
                // We only restore specific parts of the state to avoid conflicts
                gameState.minerPos = savedState.minerPos || { x: 0, y: 0, direction: 1 };
                gameState.minedTiles = savedState.minedTiles || {};
                gameState.minedSyst = savedState.minedSyst || 0;

                showNotification("Progress Loaded!");
                updateUI();
                centerCameraOnMiner(); // Ensure camera is correct after loading
            } catch (e) {
                console.error("Could not parse saved state:", e);
                localStorage.removeItem(`syst_miner_save_${gameState.walletAddress}`);
            }
        }
    }

    /**
     * Saves the player's progress to localStorage using the wallet address as a key.
     */
    function saveProgress() {
        if (!gameState.walletAddress) return;

        const stateToSave = {
            minerPos: gameState.minerPos,
            minedTiles: gameState.minedTiles,
            minedSyst: gameState.minedSyst,
        };

        localStorage.setItem(`syst_miner_save_${gameState.walletAddress}`, JSON.stringify(stateToSave));
    }

    // --- Event Listeners ---
    connectWalletBtn.addEventListener('click', () => {
        sounds.click.triggerAttackRelease('C4', '8n');
        connectWallet();
    });

    claimRewardsBtn.addEventListener('click', () => {
        sounds.click.triggerAttackRelease('C4', '8n');
        claimRewards();
    });

    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left + camera.x;
        const y = e.clientY - rect.top + camera.y;
        createClickEffect(x, y);
        mine();
    });

    // --- Game Start ---
    init();
});