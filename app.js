// 1. FIREBASE APP
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";

// 2. FIREBASE AUTH
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// 3. FIREBASE FIRESTORE (Notice the new cache imports are right here!)
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, setDoc, getDoc, collection, arrayUnion, arrayRemove, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, getDocs, where, increment, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// 4. FIREBASE MESSAGING (NEW: Copy & paste this line right here)
import { getMessaging, getToken, onMessage, isSupported} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging.js";

// Load a clean notification ping sound
const dmSound = new Audio("universfield-new-notification-051-494246.mp3");




const firebaseConfig = {
    apiKey: "AIzaSyAyGn9KXMA8yVxIYTjI1kaqq0SQs5rIiYM", 
    authDomain: "efootball-web.firebaseapp.com", 
    projectId: "efootball-web", 
    storageBucket: "efootball-web.firebasestorage.app", 
    messagingSenderId: "758841862190", 
    appId: "1:758841862190:web:4eac889193c04c261ed7bf"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Initialize Firestore with offline caching enabled (Replaces getFirestore)
const db = initializeFirestore(app, {
    localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
    })
});
const ADMIN_EMAIL = "efootballleague369@gmail.com";

// 🌍 GLOBAL CACHE FOR MENTIONS
window.cachedLeagueUsers = [];

window.loadUsersForMentions = async function() {
    try {
        const snap = await getDocs(collection(db, "users"));
        window.cachedLeagueUsers = snap.docs.map(doc => ({
            id: doc.id,
            name: doc.data().firstName || "Manager"
        }));
    } catch (e) {
        console.error("Failed to load users for mentions", e);
    }
};

// ==========================================
// 🚀 PWA SERVICE WORKER REGISTRATION
// ==========================================
// Register this immediately on page load so Chrome allows app installation
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
            .then((registration) => {
                console.log('PWA Service Worker registered successfully.');
            })
            .catch((error) => {
                console.error('PWA Service Worker registration failed:', error);
            });
    });
}


// 📚 PAGINATION TRACKERS
let currentTacticsLimit = 5; // Start by loading only the 5 most recent posts
let tacticsUnsubscribe = null; 
let currentUser = null; 
let userProfileData = null; 
let playersData = []; 
let matchesData = []; 
let usersData = [];
let scorersData = [];
let predictionsData = {}; 
let streamsData = [];
let activeScheduleMatchId = null; 
let globalChatUnsub = null;
let dmUnsub = null;
let competitions = [];
let vaultData = [];
const UCL_LEAGUE_ID = "UCL_GLOBAL"; // Focused single UCL engine

function notify(msg) {
    const c = document.getElementById('notificationArea');
    const t = document.createElement('div'); 
    t.className = 'toast'; 
    t.textContent = msg;
    c.appendChild(t); 
    setTimeout(() => t.remove(), 4000);
}

function logActivity(text) {
    addDoc(collection(db, "activity_feed"), { text, timestamp: Date.now() });
}

async function awardBadge(uid, badgeId, badgeName, icon) {
    const badgeRef = doc(db, "users", uid, "badges", badgeId);
    const snap = await getDoc(badgeRef);
    
    if (!snap.exists()) {
        // 1. Save the badge to the database
        await setDoc(badgeRef, { name: badgeName, icon: icon, timestamp: Date.now() });
        
        // 2. Notify the user locally
        if (currentUser && currentUser.uid === uid) {
            notify(`🏆 Badge Unlocked: ${badgeName}!`);
        }
        
        // 3. 📢 BROADCAST TO THE WHOLE LEAGUE
        addDoc(collection(db, "live_events"), {
            icon: "🏆",
            message: `A manager just unlocked the ${badgeName} badge!`, 
            color: "#fbbf24", // Gold color
            timestamp: serverTimestamp()
        });
    }
}

// ==========================================
// 🔔 PUSH NOTIFICATION HELPER
// ==========================================
const VAPID_KEY = "BAifMO3yenU4ln9u_MDgRB5RyKXE4g5lqTkH_1VlcPJkMJTv1Gl1HJwYCtrVcX9Dskrt4U-E2MuaOjANVMs4HVA";

async function enablePushNotifications(userId) {
    if (!('Notification' in window)) {
        return alert("This browser does not support push notifications.");
    }
    
    try {
        const permission = await Notification.requestPermission();
        
        if (permission === 'granted') {
            const messaging = getMessaging();
            
            // Register background listener from root
            const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
            
            // Retrieve FCM device token
            const token = await getToken(messaging, {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: registration
            });
            
            if (token && userId) {
                // Save token inside user profile
                await updateDoc(doc(db, "users", userId), {
                    fcmTokens: arrayUnion(token)
                });
                
                if (typeof notify === 'function') notify("🔔 Notifications Enabled!");
                else alert("🔔 Notifications Enabled!");
            }
        } else {
            alert("Permission denied. Enable it in your browser settings.");
        }
    } catch (err) {
        console.error("Error setting up notifications:", err);
    }
}

document.getElementById('enableNotifsBtn').onclick = () => {
    // Make sure you pass the current user's ID into the function!
    if (currentUser && currentUser.uid) {
        enablePushNotifications(currentUser.uid);
    }
};

// ==========================================
// 🔔 FOREGROUND LISTENER (TRAY ONLY)
// ==========================================
try {
    isSupported().then((supported) => {
        if (supported) {
            const messagingInstance = getMessaging();
            
            onMessage(messagingInstance, (payload) => {
                console.log("🔔 Payload received in foreground:", payload);
                const title = payload.data?.title || "⚽ Match Alert!";
                const message = payload.data?.body || "You have a new match!";
                
                // Show in-app toast instead of an intrusive alert box
                if (typeof showActivityToast === 'function') {
                    showActivityToast('🔔', `${title}: ${message}`, '#38bdf8');
                }

                // Send it to the Android Notification Tray and make it vibrate
                if (Notification.permission === "granted") {
                    navigator.serviceWorker.ready.then((registration) => {
                        registration.showNotification(title, {
                            body: message,
                            icon: "https://cdn-icons-png.flaticon.com/512/5323/5323443.png",
                            badge: "https://cdn-icons-png.flaticon.com/512/5323/5323443.png",
                            vibrate: [300, 100, 300, 100, 300] // Aggressive match vibration
                        });
                    });
                }
                
                // 🛑 We removed renderSidebarNotification() here because your onSnapshot listener 
                // in startNotificationHistory() already handles rendering the database updates instantly!
            });
        }
    });
} catch (error) {
    console.log("⚠️ Could not load notifications:", error.message);
}


// ==========================================
// 📲 SIDEBAR HISTORY RENDER (WITH DELETE & BADGE UPDATE)
// ==========================================
window.renderSidebarNotification = function(title, message) {
    // 👇 MATCHES YOUR EXACT HTML ID NOW
    const sidebarContainer = document.getElementById("sidebarNotiList"); 
    
    if (sidebarContainer) {
        const alertElement = document.createElement("div");
        alertElement.className = "sidebar-alert-item unread"; 
        
        alertElement.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%; border-bottom: 1px solid #334155; padding-bottom: 10px; margin-bottom: 10px;">
                <div style="display: flex; gap: 10px;">
                    <div class="alert-icon" style="font-size: 1.2rem;">⚽</div>
                    <div class="alert-content">
                        <h4 style="margin: 0; font-size: 14px; color: var(--primary-yellow);">${title}</h4>
                        <p style="margin: 4px 0; font-size: 12px; color: #cbd5e1;">${message}</p>
                        <span class="alert-time" style="font-size: 10px; color: #64748b;">Just now</span>
                    </div>
                </div>
                <!-- 🗑️ The Delete Button -->
                <button onclick="this.closest('.sidebar-alert-item').remove()" 
                        style="background: none; border: none; color: #ef4444; font-size: 16px; cursor: pointer; padding: 0 5px;" 
                        title="Delete Alert">
                    ✖
                </button>
            </div>
        `;
        
        sidebarContainer.prepend(alertElement);

        // 👇 BONUS: Update your unread badge counter dynamically!
        const badge1 = document.getElementById("sidebarNotiBadge");
        const badge2 = document.getElementById("sidebarNotificationBadge");
        const markReadBtn = document.getElementById("markAllReadBtn");

        if (badge1) {
            badge1.style.display = "inline-block";
            badge1.innerText = parseInt(badge1.innerText || 0) + 1;
        }
        if (badge2) {
            badge2.style.display = "inline-block";
            badge2.innerText = parseInt(badge2.innerText || 0) + 1;
        }
        if (markReadBtn) {
            markReadBtn.style.display = "block";
        }
    }
};





// ==========================================
// 📢 BROADCAST & SIDEBAR ALERTS
// ==========================================
window.sendStageBroadcast = async function(stageName) {
    try {
        fetch("https://eLEAGUE--cb9fd17a8c0a11f1854b1607ee4eb77e.web.val.run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage: stageName }) 
        })
        .then(res => console.log(`📢 Triggered Val Town broadcast for: ${stageName}`))
        .catch(err => console.error("Broadcast webhook failed:", err));
    } catch (error) {
        console.error("Error triggering broadcast:", error);
    }
};

window.createGlobalSidebarAlert = async function(stageName) {
    try {
        const alertRef = doc(collection(db, "dm_alerts")); 
        await setDoc(alertRef, {
            receiverId: "all", 
            title: "📢 NEW MATCHES GENERATED!",
            message: `The fixtures for ${stageName} are now live! Check the schedule.`,
            timestamp: Date.now(),
            read: false, // 👇 CHANGED THIS: Now perfectly matches your listener!
            type: "system_broadcast"
        });
        console.log("✅ Global sidebar alert saved!");
    } catch (error) {
        console.error("❌ Failed to save sidebar alert:", error);
    }
};





// WELCOME, PASSWORD TOGGLE & ONBOARDING 
document.addEventListener("DOMContentLoaded", () => {
    // Correct Fade logic: ensure display none to not block clicks
    setTimeout(() => { 
        const ws = document.getElementById('welcomeScreen');
        if(ws) {
            ws.style.opacity = '0'; 
            setTimeout(() => {
                ws.classList.add('hidden');
                ws.style.display = 'none'; 
                if(currentUser && !localStorage.getItem('tourCompleted')) startTour();
            }, 1000); 
        }
    }, 2000); 

    const loginToggle = document.getElementById('toggleLoginPass');
    if(loginToggle) loginToggle.addEventListener('change', (e) => {
        document.getElementById('loginPassword').type = e.target.checked ? 'text' : 'password';
    });

    const regToggle = document.getElementById('toggleRegPass');
    if(regToggle) regToggle.addEventListener('change', (e) => {
        document.getElementById('regPassword').type = e.target.checked ? 'text' : 'password';
    });

    const btnTourNext = document.getElementById('btnTourNext');
    if(btnTourNext) btnTourNext.addEventListener('click', () => {
        if(currentTourStep < tourSteps.length - 1) { currentTourStep++; renderTourStep(); } 
        else endTour();
    });

    const btnTourSkip = document.getElementById('btnTourSkip');
    if(btnTourSkip) btnTourSkip.addEventListener('click', endTour);
});

// SWITCH AUTH VIEWS
document.getElementById('showRegister').onclick = () => {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
    document.getElementById('authTitle').innerText = "Register";
};
document.getElementById('showLogin').onclick = () => {
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('authTitle').innerText = "Login";
};

// --- FORGOT PASSWORD LOGIC ---

// 1. Show the Reset Form
document.getElementById('showResetPass').onclick = () => {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('resetPassForm').classList.remove('hidden');
    document.getElementById('authTitle').innerText = "Reset Password";
};

// 2. Go back to Login Form
document.getElementById('showLoginFromReset').onclick = () => {
    document.getElementById('resetPassForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('authTitle').innerText = "Login";
};

// 3. Handle the Reset Email Submission
document.getElementById('resetPassForm').onsubmit = async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('resetEmail').value.trim();
    
    if (!emailInput) return notify("Please enter your email.");
    
    try {
        await sendPasswordResetEmail(auth, emailInput);
        notify("✅ Reset link sent! Check your inbox (and spam folder).");
        
        // Clear the input and send them back to the login screen
        document.getElementById('resetEmail').value = '';
        document.getElementById('showLoginFromReset').click();
    } catch (err) {
        // Firebase handles errors if the email isn't formatted right
        notify(`Error: ${err.message}`);
    }
};


// NAVIGATION & TABS
document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const target = item.dataset.target;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
        item.classList.add('active'); 
        document.getElementById(target).classList.remove('hidden');
        
        if (target === 'viewChat') {
            // Clear Blue Dot when chat opened
            document.getElementById('chatBlueDot').classList.add('hidden');
            localStorage.setItem('lastReadChatTs', Date.now());
        }

        // 🌟 THE FIX: Update leaderboards when the stats tab is clicked!
        // NOTE: Make sure 'viewLeaders' matches the exact ID of your stats view in your HTML.
        if (target === 'viewLeaders') {
            updateLeaderboards();
        }
    });
});


document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const parent = e.target.parentElement; 
        parent.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active')); 
        e.target.classList.add('active');
        if (e.target.dataset.tab) { 
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            document.getElementById(e.target.dataset.tab).classList.remove('hidden'); 
        }
        if (e.target.dataset.filter) renderFixtures(e.target.dataset.filter);
        if (e.target.dataset.chat) { 
            document.getElementById('globalChatArea').classList.add('hidden'); 
            document.getElementById('dmChatArea').classList.add('hidden'); 
            document.getElementById(e.target.dataset.chat === 'global' ? 'globalChatArea' : 'dmChatArea').classList.remove('hidden'); 
        }
  
    });
});

// SIDEBAR
document.getElementById('menuToggleBtn').onclick = () => { 
    document.getElementById('sidebarMenu').classList.add('open'); 
    document.getElementById('sidebarOverlay').classList.remove('hidden'); 
};
function closeSidebar() { 
    document.getElementById('sidebarMenu').classList.remove('open'); 
    document.getElementById('sidebarOverlay').classList.add('hidden'); 
}
document.getElementById('closeSidebarBtn').onclick = closeSidebar;
document.getElementById('sidebarOverlay').onclick = closeSidebar;
document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
        if (item.dataset.target) {
            document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.getElementById(item.dataset.target).classList.remove('hidden');
            closeSidebar();
        }
    });
});

// AUTH LOGIC & ONLINE STAT
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        document.getElementById('authContainer').classList.add('hidden'); 
        document.getElementById('mainApp').classList.remove('hidden');
        
        const isAdmin = user.email === ADMIN_EMAIL;
        if (isAdmin) document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));

        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
            userProfileData = snap.data();
            document.getElementById('utName').textContent = `${userProfileData.firstName} ${userProfileData.lastName}`;
            document.getElementById('utCountry').textContent = userProfileData.country;
            const avatarImg = document.getElementById('utAvatar');
            if(avatarImg) avatarImg.src = userProfileData.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=default";
            loadBadges(user.uid);
            
            // 🔔 NEW: Turn on the real-time notification radar for EVERY user!
            if (typeof window.listenToNotifications === 'function') {
                window.listenToNotifications();
                console.log("🎧 Notification listener activated for user!");
            }
        

            
                                  // Set Online Status in DB
            updateDoc(doc(db, "users", user.uid), { isOnline: true, lastSeen: serverTimestamp() });
            
            // ==========================================
            // 👻 ANTI-GHOST PRESENCE SYSTEM
            // ==========================================
            const userRef = doc(db, "users", currentUser.uid);

            // 1. Trigger when they minimize the browser, switch tabs, or lock their phone
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "hidden") {
                    // They just hid the app! Mark offline before the connection drops.
                    updateDoc(userRef, { isOnline: false }).catch(err => console.error(err));
                } else if (document.visibilityState === "visible") {
                    // They came back to the app!
                    updateDoc(userRef, { isOnline: true }).catch(err => console.error(err));
                }
            });

            // 2. Trigger when they completely close the tab or swipe the app away
            window.addEventListener("beforeunload", () => {
                updateDoc(userRef, { isOnline: false });
            });

            // 3. Trigger if they actually reconnect to the internet while the app is open
            window.addEventListener("online", () => {
                updateDoc(userRef, { isOnline: true });
            });

            
            // ==========================================
            // 🎯 PERSONAL ALERTS LISTENER (Profile Views & DMs)
            // ==========================================
            // Only listen for alerts meant for THIS logged-in user
                        const personalAlertsQuery = query(
                collection(db, "dm_alerts"), 
                where("receiverId", "==", currentUser.uid), 
                where("status", "==", "unread"),
                where("type", "==", "scout"), // 👈 ADDED THIS
                where("timestamp", ">=", Date.now()) 
            );

            onSnapshot(personalAlertsQuery, (snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === "added") {
                        const alertData = change.doc.data();
                        const alertId = change.doc.id;
                        
                        if (window.showActivityToast) {
                            window.showActivityToast("👀", alertData.message, "#8b5cf6"); 
                        }

                        // Mark it read so it doesn't loop
                        updateDoc(doc(db, "dm_alerts", alertId), { status: "read" }).catch(err => console.error(err));
                    }
                });
            }, (error) => {
                console.error("🚨 PERSONAL ALERTS ERROR:", error.message);
            });

            console.log("Admin Status:", isAdmin);
            console.log("Has Pinged Before:", sessionStorage.getItem("loggedInPing"));



            // ALERT ADMIN ON LOGIN & BROADCAST TO LEAGUE
            if (!isAdmin && !sessionStorage.getItem("loggedInPing")) {
                console.log("Attempting to broadcast login to database...");
                
                sessionStorage.setItem("loggedInPing", "true");
                
                // 1. The original Admin Alert
                addDoc(collection(db, "admin_alerts"), { 
                    message: `⚽ Manager ${userProfileData.firstName} just logged in!`,
                    timestamp: serverTimestamp()
                }).then(() => console.log("Admin alert saved!"));

                // 2. 📢 NEW: BROADCAST TO EVERYONE (The Activity Toast)
                addDoc(collection(db, "live_events"), {
                    icon: "🟢",
                    message: `Manager ${userProfileData.firstName} just came online`,
                    color: "#10b981", // Green color
                    timestamp: serverTimestamp()
                }).then(() => console.log("Live event broadcasted successfully!"));
            } else {
                console.log("Broadcast skipped. User is either Admin or already pinged.");
            }

        }
        
        
        if (isAdmin) listenForAdminAlerts();
        loadDatabase(); 
        
        const ws = document.getElementById('welcomeScreen');
        if(!localStorage.getItem('tourCompleted') && ws && ws.style.display === 'none') startTour();

    } else {
        currentUser = null; 
        document.getElementById('mainApp').classList.add('hidden'); 
        document.getElementById('authContainer').classList.remove('hidden');
        if(globalChatUnsub) globalChatUnsub();
        if(dmUnsub) dmUnsub();
    }
});





// Set Offline on Logout/Close
document.getElementById('logoutBtn').onclick = async () => {
    if(currentUser) await updateDoc(doc(db, "users", currentUser.uid), { isOnline: false });
    sessionStorage.removeItem("loggedInPing");
    signOut(auth);
};

window.addEventListener('beforeunload', () => {
    if(currentUser) updateDoc(doc(db, "users", currentUser.uid), { isOnline: false, lastSeen: Date.now() });
});

function listenForAdminAlerts() {
    onSnapshot(query(collection(db, "admin_alerts"), where("timestamp", ">=", new Date())), snap => {
        snap.docChanges().forEach(change => {
            if (change.type === "added") notify(`🚨 LOGIN: ${change.doc.data().message}`);
        });
    });
}

// FIXED REGISTER & AVATAR
document.getElementById('registerForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
        const email = document.getElementById('regEmail').value;
        const pass = document.getElementById('regPassword').value;
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        
        await setDoc(doc(db, "users", cred.user.uid), { 
            firstName: document.getElementById('regFirstName').value, 
            lastName: document.getElementById('regLastName').value,
            country: document.getElementById('regCountry').value, 
            email: email,
            avatar: document.getElementById('profileDisplayAvatar').src,
            predictionsCorrect: 0,
            isOnline: true,
            createdAt: serverTimestamp()
        }); 
        awardBadge(cred.user.uid, 'founder', 'Founding Member', '⭐');
        notify("Registered successfully!");
    } catch (err) { notify(`Error: ${err.message}`); }
};

document.getElementById('loginForm').onsubmit = async (e) => { 
    e.preventDefault(); 
    try { await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value, document.getElementById('loginPassword').value); } 
    catch (err) { notify("Login Failed: Check credentials."); } 
};

// AVATAR UPLOAD LOGIC
document.getElementById('btnOpenAvatarModal').onclick = () => document.getElementById('avatarModal').classList.remove('hidden');
document.getElementById('btnCloseAvatarModal').onclick = () => document.getElementById('avatarModal').classList.add('hidden');
const PRESET_SEEDS = ["Jack", "Lily", "Buddy", "Leo", "Mia", "Max", "Zoe", "Oliver", "Default"];
const avatarGrid = document.getElementById('avatarGridContainer');
PRESET_SEEDS.forEach(seed => {
    const url = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
    const img = document.createElement('img'); img.src = url; img.style = "width:100%; border-radius:50%; cursor:pointer;";
    img.onclick = () => { document.getElementById('profileDisplayAvatar').src = url; document.getElementById('avatarModal').classList.add('hidden'); };
    avatarGrid.appendChild(img);
});
document.getElementById('customImageUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) return document.getElementById('uploadStatusText').textContent = "File must be under 1MB";
    const reader = new FileReader();
    reader.onload = (event) => {
        document.getElementById('profileDisplayAvatar').src = event.target.result;
        document.getElementById('avatarModal').classList.add('hidden');
    };
    reader.readAsDataURL(file);
});

// ==========================================
// 🗄️ DATABASE LISTENERS (OPTIMIZED WITH DEBOUNCE)
// ==========================================

// 1. Create empty timers outside the function
let playersRenderTimer;
let matchesRenderTimer;
let predictionsRenderTimer;
let usersRenderTimer;

function loadDatabase() {
    
    // --- LEAGUE PLAYERS ---
    onSnapshot(collection(db, "league_players"), snap => { 
        playersData = snap.docs.map(d => ({ id: d.id, ...d.data() })); 
        
        // Clear the previous timer and set a new one
        clearTimeout(playersRenderTimer);
        playersRenderTimer = setTimeout(() => {
            renderStandings();
            updateProfileUT(); 
            updateLeaderboards();
        }, 200); // Wait 200ms before drawing the UI
    });
    
    
// ==========================================
// 📊 REAL-TIME LEAGUE MATCHES LISTENER
// ==========================================
onSnapshot(collection(db, "league_matches"), snap => {
    matchesData = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.timestamp - a.timestamp);
    
    clearTimeout(matchesRenderTimer);
    matchesRenderTimer = setTimeout(() => {
        renderFixtures();
        checkWinner();
        updateProfileUT();
        
        // UI STATE FIX: Keep the current fixture tab open
        setTimeout(() => {
            const activeFixtureTab = document.querySelector('#viewFixtures .tab-btn.active');
            if (activeFixtureTab) {
                activeFixtureTab.click();
            }
        }, 50);
    }, 200);
});



    // --- PREDICTIONS ---
    onSnapshot(collection(db, "predictions_tally"), snap => {
        snap.docs.forEach(d => predictionsData[d.id] = d.data());
        
        clearTimeout(predictionsRenderTimer);
        predictionsRenderTimer = setTimeout(() => {
            renderFixtures(); 
        }, 200);
    });

    // --- USERS ---
    onSnapshot(collection(db, "users"), snap => {
        usersData = snap.docs.map(d => ({id: d.id, ...d.data()})); 
        
        clearTimeout(usersRenderTimer);
        usersRenderTimer = setTimeout(() => {
            const onlineCount = usersData.filter(u => u.isOnline).length;
            const onlineEl = document.getElementById('onlineUsersCount');
            if(onlineEl) onlineEl.textContent = onlineCount;

            const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL;
            if (isAdmin) renderAdminUsers();
            populateDmSelector();
            
            const tb = document.getElementById('predictorsBody'); 
            if(tb) {
                tb.innerHTML = '';
                usersData.filter(u => u.predictionsCorrect > 0)
                         .sort((a,b) => b.predictionsCorrect - a.predictionsCorrect)
                         .forEach((u, i) => {
                             tb.innerHTML += `<tr><td>${i+1}</td><td><strong>${u.firstName}</strong></td><td style="color:#22c55e;font-weight:bold;">${u.predictionsCorrect} ✅</td></tr>`;
                         });
            }
        }, 200);
    });

// ==========================================
// 🍞 LIVE EVENTS LISTENER (GLOBAL)
// ==========================================
const eventsQuery = query(collection(db, "live_events"), orderBy("timestamp", "desc"), limit(1));

let seenEvents = new Set();
let isFirstSnapshot = true;

onSnapshot(eventsQuery, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
            const event = change.doc.data();
            
            // 1. On the very first load, just memorize the old events, don't show them
            if (isFirstSnapshot) {
                seenEvents.add(change.doc.id);
            } 
            // 2. If it's a NEW event we haven't seen yet, trigger the toast!
            else if (!seenEvents.has(change.doc.id)) {
                seenEvents.add(change.doc.id);
                console.log("👀 NEW LIVE EVENT DETECTED!", event);
                
                // Add a tiny delay to ensure HTML is ready
                setTimeout(() => {
                    if (window.showActivityToast) {
                        window.showActivityToast(event.icon, event.message, event.color);
                    } else {
                        console.error("🚨 showActivityToast function is missing from the page!");
                    }
                }, 500);
            }
        }
    });
    
    // After the first check, turn off the 'first snapshot' blocker
    isFirstSnapshot = false;
    
}, (error) => {
    console.error("🚨 TOAST LISTENER ERROR:", error.message);
});



    onSnapshot(query(collection(db, "activity_feed")), snap => {
        const c = document.getElementById('activityFeedList'); if(c) c.innerHTML = '';
        snap.docs.map(d => d.data()).sort((a,b) => b.timestamp - a.timestamp).slice(0, 20).forEach(m => {
            if(c) c.innerHTML += `<div class="activity-item">🕒 ${m.text}</div>`;
        });
    });
    
// --- IMMORTAL VAULT (HALL OF FAME) ---
onSnapshot(collection(db, "hall_of_fame"), snap => { 
    // THE FIX: We grab the 'id' so we can link their cups to their profile card!
    vaultData = snap.docs.map(d => ({ id: d.id, ...d.data() })); 
    
    if (typeof updateLeaderboards === "function") {
        updateLeaderboards();
    }
});



    
    // NEW HOT MATCH LISTENER
onSnapshot(doc(db, "system_settings", "live_overlay"), snap => {
    if(snap.exists()) {
        window.currentHotMatchText = snap.data().hotMatchText;
        renderStreamsUI(); 
    }
});


    onSnapshot(collection(db, "streams"), snap => {
        streamsData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderStreamsUI();
    });

    listenToGlobalChat();
    loadScorers();
    loadPredictionLeaderboard();
   
   listenForGlobalDMs(); 
   // 👇 ADD YOUR NEW LISTENER HERE 👇
listenToScreenshots();
listenToPremiumAnnouncements();
startNotificationHistory();

}

// 1-ON-1 DM SYSTEM
function populateDmSelector() {
    const sel = document.getElementById('dmUserSelect');
    if(!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- Select Manager to DM --</option>';
    usersData.forEach(u => {
        if(currentUser && u.id !== currentUser.uid) {
            sel.innerHTML += `<option value="${u.id}">${u.firstName} ${u.lastName || ''}</option>`;
        }
    });
    sel.value = currentVal;
}

document.getElementById('dmUserSelect').addEventListener('change', (e) => {
    if(e.target.value) loadDmMessages(e.target.value);
});

function loadDmMessages(targetUid) {
    if(dmUnsub) dmUnsub();
    const chatId = currentUser.uid < targetUid ? currentUser.uid + '_' + targetUid : targetUid + '_' + currentUser.uid;
    
    dmUnsub = onSnapshot(query(collection(db, "direct_messages", chatId, "messages")), (snap) => {
        const c = document.getElementById('dmMessages');
        if(!c) return;
        c.innerHTML = '';
        snap.docs.map(d => d.data()).sort((a,b) => a.timestamp - b.timestamp).forEach(m => {
            const isMe = m.uid === currentUser.uid;
            c.innerHTML += `<div class="msg-bubble ${isMe ? 'mine' : 'other'}"><div style="font-size:0.8rem;opacity:0.7">${m.name}</div>${m.text}</div>`;
        });
        c.scrollTop = c.scrollHeight;
    }, (error) => {
        // 🚨 NEW: THIS TRAPS THE ERROR SO IT DOESN'T CRASH THE REST OF THE APP
        console.error("🚨 DM LISTENER ERROR:", error.message);
    });
} 


document.getElementById('sendDmBtn').onclick = async () => {
    const inp = document.getElementById('dmInput');
    const targetUid = document.getElementById('dmUserSelect').value;
    // Add this line just to see it in your console!
console.log("Sending a message and notification to User ID:", targetUid);
    if (!inp.value.trim() || !targetUid) return notify("Select user and type message!");
    
    const chatId = currentUser.uid < targetUid ? currentUser.uid + '_' + targetUid : targetUid + '_' + currentUser.uid;
    
    // 1. Send the actual message
    await addDoc(collection(db, "direct_messages", chatId, "messages"), {
        uid: currentUser.uid, 
        name: userProfileData?.firstName, 
        text: inp.value.trim(), 
        timestamp: Date.now()
    });

        // 2. Send the ping to the RECEIVER
    await addDoc(collection(db, "dm_alerts"), {
        receiverId: targetUid, 
        senderName: userProfileData?.firstName || "A Manager",
        timestamp: Date.now(),
        status: "unread",
        type: "dm" // 👈 ADDED THIS
    });



    inp.value = '';
};

/* ==========================================
   📩 DM TOAST NOTIFICATION & LISTENER
   ========================================== */
function alertNewDM(senderName) {
    const chatDot = document.getElementById('chatBlueDot');
    if (chatDot) chatDot.classList.remove('hidden');

    let toast = document.getElementById('dmToast');
    
    // If it doesn't exist, create it
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'dmToast';
        toast.className = 'dm-toast';
        document.body.appendChild(toast);
    }
    
    // Update the content
    toast.innerHTML = `
        <div class="toast-content" style="display:flex; align-items:center; gap:15px; font-family:'Rajdhani', sans-serif;">
            <span style="color:#fbbf24; font-size:1.8rem;">📩</span>
            <div>
                <strong style="display:block; font-size: 1.1rem; letter-spacing: 1px;">NEW DIRECT MESSAGE</strong>
                <span style="font-size: 0.9rem; opacity: 0.8; color: #cbd5e1;">From: ${senderName}</span>
            </div>
        </div>
    `;
    
    // FORCE BROWSER REFLOW
    void toast.offsetWidth; 
    
    // 🔊 PLAY THE SOUND HERE
    dmSound.play().catch(err => {
        console.log("Browser blocked the notification sound:", err);
    });
    
    // Slide it in
    toast.classList.add('show-toast');
    
    // Auto-hide after 8 seconds
    setTimeout(() => {
        toast.classList.remove('show-toast');
    }, 8000); 
}



function listenForGlobalDMs() {
    if (!currentUser) {
        console.log("❌ No user logged in. Stopping DM listener.");
        return;
    }

    console.log("✅ Starting DM listener for user ID:", currentUser.uid);

    // 🌟 ADDED: where("type", "==", "dm") so it ignores scout alerts
    const q = query(
        collection(db, "dm_alerts"), 
        where("receiverId", "==", currentUser.uid),
        where("status", "==", "unread"),
        where("type", "==", "dm") 
    );

    onSnapshot(q, (snap) => {
        snap.docChanges().forEach((change) => {
            if (change.type === "added") {
                const alertData = change.doc.data();
                const alertId = change.doc.id;
                
                // Inside listenForGlobalDMs() when a new alert is detected...
console.log("🚨 BRAND NEW UNREAD DM DETECTED!", alertData);



                
                alertNewDM(alertData.senderName || "A Manager");
                
                const alertDocRef = doc(db, "dm_alerts", alertId);
                updateDoc(alertDocRef, {
                    status: "read"
                }).catch(error => {
                    console.error("Error marking alert as read:", error);
                });
            }
        });
    }, (error) => {
        console.error("🔥 FIREBASE LISTENER ERROR:", error);
    });
}





// Global Chat & Blue Dot
function listenToGlobalChat() {
    if (globalChatUnsub) globalChatUnsub();
    globalChatUnsub = onSnapshot(query(collection(db, "global_chat")), snap => {
        const c = document.getElementById('chatMessages');
        if (c) c.innerHTML = '';
        let latestTs = 0;
        
        snap.docs.map(d => {
            const data = d.data();
            
            // 🛡️ THE BULLETPROOF TIMESTAMPER
            let safeTime = Date.now(); // Default fallback for uploading messages
            if (data.timestamp) {
                if (typeof data.timestamp.toMillis === 'function') {
                    safeTime = data.timestamp.toMillis(); // Catches Firebase Voice Notes
                } else if (typeof data.timestamp === 'number') {
                    safeTime = data.timestamp; // Catches regular Text Messages
                } else if (typeof data.timestamp === 'string') {
                    safeTime = new Date(data.timestamp).getTime(); // Catches string dates
                }
            }
            data.timeForSort = safeTime;
            return data;
        })
        .sort((a, b) => a.timeForSort - b.timeForSort) 
        .forEach(m => {
            const isMe = currentUser && m.uid === currentUser.uid;
            
            let messageContent = "";
            if (m.audioData) {
                // 🎵 Clean class added for our premium CSS
                messageContent = `<audio class="premium-audio-player" controls src="${m.audioData}"></audio>`;
            } else {
                messageContent = m.text || "";
            }
            
            if (c) {
                c.innerHTML += `<div class="msg-bubble ${isMe ? 'mine' : 'other'}">
                                    <div style="font-size:0.8rem;opacity:0.7">${m.name}</div>
                                    ${messageContent}
                                </div>`;
            }
            
            if (m.timeForSort > latestTs) latestTs = m.timeForSort;
        });
        
        if (c) c.scrollTop = c.scrollHeight;
        
        const lastRead = parseInt(localStorage.getItem('lastReadChatTs') || 0);
        if (latestTs > lastRead && document.getElementById('viewChat').classList.contains('hidden')) {
            document.getElementById('chatBlueDot').classList.remove('hidden');
        }
    });
}


// TOP SCORER ADMIN CONTROLS
function loadScorers() {
    onSnapshot(collection(db, "individual_scorers"), snap => {
        scorersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        updateLeaderboards(); // 🌟 ADDED HERE: Auto-updates when admin clicks +/- on a scorer!
        const tb = document.getElementById('scorersBody'); if(!tb) return;
        tb.innerHTML = '';
        const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL;
        
        scorersData.sort((a,b) => b.goals - a.goals).forEach((s, i) => {
            let adminBtn = isAdmin ? `<button onclick="updateGoal('${s.id}', 1)" class="small-btn" style="padding:2px 6px; margin-left:5px;">+</button> <button onclick="updateGoal('${s.id}', -1)" class="small-btn danger" style="padding:2px 6px;">-</button>` : '';
            tb.innerHTML += `<tr><td>${i+1}</td><td><strong>${s.playerName}</strong></td><td>${s.teamName}</td><td style="color:var(--primary-yellow);font-weight:bold;">${s.goals} ${adminBtn}</td></tr>`;
        });
    });
}

window.updateGoal = async (id, amount) => {
    await updateDoc(doc(db, "individual_scorers", id), { goals: increment(amount) });
    notify("Scorer updated!");
};

// MULTI-STREAM LOGIC (1 Main, 4 Sub IFrames)
document.getElementById('btnSubmitMyStream').onclick = async () => {
    const twitchUser = prompt("Enter your Twitch username:");
    if(!twitchUser) return;
    
    if (currentUser && currentUser.email === ADMIN_EMAIL) {
        await addDoc(collection(db, "streams"), { uid: currentUser.uid, twitchUser, status: 'approved', timestamp: Date.now() });
        notify("Admin Stream Approved!");
    } else {
        await addDoc(collection(db, "streams"), { uid: currentUser.uid, twitchUser, status: 'pending', timestamp: Date.now() });
        notify("Submitted for admin approval.");
    }
};

document.getElementById('btnToggleApproveStreams').onclick = () => {
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden')); 
    document.getElementById('viewAdmin').classList.remove('hidden'); 
    document.getElementById('approveStreamBox').classList.toggle('hidden');
    closeSidebar();
};

function renderStreamsUI() {
    const pendingList = document.getElementById('pendingStreamsList');
    if(pendingList) {
        pendingList.innerHTML = '';
        streamsData.filter(s => s.status === 'pending').forEach(s => {
            pendingList.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; padding:10px; background:#0f172a;">
                <span>${s.twitchUser}</span>
                <button class="small-btn" onclick="approveStream('${s.id}', '${s.twitchUser}')">Approve</button>
            </div>`;
        });
    }

    const currentDomain = window.location.hostname || "localhost";

    if (window.Twitch && window.Twitch.Embed) {
        const approved = streamsData.filter(s => s.status === 'approved');
        const containers = ['twitch-embed-main', 'twitch-embed-1', 'twitch-embed-2', 'twitch-embed-3', 'twitch-embed-4'];
        
        containers.forEach(id => {
            const el = document.getElementById(id);
            if(el) el.innerHTML = '';
        });

        approved.slice(0, 5).forEach((s, idx) => {
            const containerId = containers[idx];
            const el = document.getElementById(containerId);
            
            if(el) {
                // Ensure container can hold absolute positioned overlays
                el.style.position = 'relative'; 

                new window.Twitch.Embed(containerId, { 
                    width: "100%", 
                    height: "100%", 
                    channel: s.twitchUser, 
                    layout: "video", 
                    autoplay: idx === 0, 
                    muted: idx !== 0,    
                    parent: [currentDomain] 
                });

                // --- NEW: Stream Overlay Header ---
                const overlay = document.createElement('div');
                overlay.style.position = 'absolute';
                overlay.style.top = '0';
                overlay.style.left = '0';
                overlay.style.width = '100%';
                overlay.style.background = 'rgba(0, 0, 0, 0.7)';
                overlay.style.padding = '8px 10px';
                overlay.style.display = 'flex';
                overlay.style.justifyContent = 'space-between';
                overlay.style.alignItems = 'center';
                overlay.style.zIndex = '10'; // Keeps it on top of the iframe
                // Pointer events allows clicking the video behind the bar, except for the text/buttons
                overlay.style.pointerEvents = 'none'; 
                
// Inside your loop in renderStreamsUI() where 's' is the current stream object:

// Read the text directly from this specific stream's data object instead of the window global
let matchTextDisplay = s.hotMatchText ? ` <span style="color:#fff; margin-left: 8px;">| ⚽ ${s.hotMatchText}</span>` : '';

let overlayContent = `<span style="color:var(--primary-yellow); font-weight:bold; pointer-events:auto; font-size:14px;">📺 ${s.twitchUser}${matchTextDisplay}</span>`;

// Show remove button ONLY to the admin
if (currentUser && currentUser.email === ADMIN_EMAIL) {
    overlayContent += `<button onclick="removeStream('${s.id}')" style="pointer-events:auto; background:#ef4444; color:#fff; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">Remove</button>`;
}


                
                overlay.innerHTML = overlayContent;
                
                // Add a slight delay to ensure Twitch iframe is mounted before appending overlay
                setTimeout(() => {
                    el.appendChild(overlay);
                }, 500);
                
                

                // Fullscreen Failsafe
                setTimeout(() => {
                    const iframe = document.querySelector(`#${containerId} iframe`);
                    if(iframe) {
                        iframe.setAttribute('allowfullscreen', 'true');
                        iframe.setAttribute('allow', 'fullscreen'); 
                    }
                }, 2000);
            }
        });
        
        if(approved.length > 0) {
            const streamerNameEl = document.getElementById('currentStreamerName');
            if (streamerNameEl) streamerNameEl.innerHTML = `<i class="fas fa-tv"></i> watching ${approved[0].twitchUser}`;
        }
    }
}
window.removeStream = async (id) => {
    if (confirm("Are you sure you want to remove this stream?")) {
        try {
            await deleteDoc(doc(db, "streams", id));
            notify("Stream removed successfully.");
        } catch (error) {
            console.error("Error removing stream: ", error);
            notify("Error removing stream.");
        }
    }
};


window.approveStream = async (id, twitchUser) => {
    await updateDoc(doc(db, "streams", id), { status: 'approved' });
    logActivity(`🎥 New Stream Added: ${twitchUser}`);
    notify("Approved!");
};

document.querySelectorAll('.react-btn').forEach(btn => {
    btn.onclick = () => {
        const emoji = btn.innerText;
        const fname = userProfileData?.firstName || 'Manager';
        addDoc(collection(db, "global_chat"), { uid: currentUser.uid, name: fname, text: ` reacted ${emoji} on LIVE streams!`, timestamp: Date.now() });
        notify(`${emoji} sent to chat!`);
        awardBadge(currentUser.uid, 'supporter', 'Active Supporter', '🔥');
    };
});


// ADMIN TOOLS (UCL Specific) & USER DOTS
function renderAdminUsers() {
    const list = document.getElementById('adminUsersList'); if(list) list.innerHTML = ''; 
    const userSelect = document.getElementById('newTeamUserSelect'); if(userSelect) userSelect.innerHTML = '<option value="">-- Select Manager --</option>'; 
    
    usersData.forEach(u => {
        const hasTeam = playersData.some(p => p.userId === u.id); 
        const dotClass = hasTeam ? 'green-dot' : 'red-dot';
        const title = hasTeam ? 'Team Assigned' : 'Unassigned';
        
        if(list) list.innerHTML += `<tr style="display:flex; justify-content:space-between; width:100%; padding:10px; border-bottom:1px solid #334155;">
            <td><span class="${dotClass}" title="${title}"></span> ${u.firstName} ${u.lastName || ''}</td>
        </tr>`;
        if(userSelect) userSelect.innerHTML += `<option value="${u.id}">${u.firstName} ${u.lastName || ''}</option>`; 
    });
}

document.getElementById('btnInitUCL').onclick = async () => {
    if(!confirm("Initialize the single UCL 36-Team Engine?")) return;
    await setDoc(doc(db, "competitions", UCL_LEAGUE_ID), { name: "UEFA Champions League", type: "UCL_GLOBAL", limit: 36 });
    notify("UCL Engine Initialized"); closeSidebar();
};

document.getElementById('btnToggleAddTeam').onclick = () => { 
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden')); 
    document.getElementById('viewAdmin').classList.remove('hidden'); 
    document.getElementById('addTeamFormBox').classList.toggle('hidden'); 
    closeSidebar();
};


// Open Hot Match menu and load current active streams into the dropdown
document.getElementById('btnToggleHotMatch').onclick = () => { 
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden')); 
    document.getElementById('viewAdmin').classList.remove('hidden'); 
    
    const formBox = document.getElementById('hotMatchFormBox');
    formBox.classList.toggle('hidden'); 
    
    // Populate the dropdown with active stream frames using YOUR 'streamsData' array
    if (!formBox.classList.contains('hidden')) {
        const dropdown = document.getElementById('adminHotMatchTarget');
        dropdown.innerHTML = ''; 
        
        // Filter out pending streams so only live/approved streams show in the dropdown
        const activeStreams = streamsData.filter(s => s.status === 'approved');
        
        if (activeStreams.length > 0) {
            activeStreams.forEach(s => {
                dropdown.innerHTML += `<option value="${s.id}">${s.twitchUser}'s Frame</option>`;
            });
        } else {
            dropdown.innerHTML = `<option value="">No active streams found</option>`;
        }
    }
    closeSidebar();
};


// Save the match title to the SPECIFIC stream document
document.getElementById('sendHotMatchBtn').onclick = async () => {
    const streamId = document.getElementById('adminHotMatchTarget').value;
    const text = document.getElementById('adminHotMatchInput').value.trim(); 
    
    if (!streamId) {
        notify("No stream selected!");
        return;
    }

    // Save directly to the specific stream document instead of global settings
    await updateDoc(doc(db, "streams", streamId), { 
        hotMatchText: text 
    }); 
    
    notify("Frame Overlay Updated!"); 
    document.getElementById('adminHotMatchInput').value = '';
    document.getElementById('hotMatchFormBox').classList.add('hidden');
};



// ==========================================
// ➕ ADD NEW TEAM (ULTIMATE BULLETPROOF EDITION)
// ==========================================
const saveTeamBtn = document.getElementById('saveTeamBtn');

// 🛡️ Armor 1: Prevent fatal crash if button isn't in the DOM yet
if (saveTeamBtn) {
    saveTeamBtn.onclick = async function(event) {
        // 🛡️ Armor 2: Stop page refresh if button is inside a <form>
        if (event) event.preventDefault();

        // 🛡️ Armor 3: Safely grab elements
        const nameEl = document.getElementById('newTeamName');
        const userSelectEl = document.getElementById('newTeamUserSelect');
        const badgeInput = document.getElementById('newTeamBadge');

        if (!nameEl || !userSelectEl) {
            return console.error("🚨 Missing DOM elements: 'newTeamName' or 'newTeamUserSelect' not found.");
        }

        const name = nameEl.value.trim(); 
        const userId = userSelectEl.value.trim();
        const teamBadgeUrl = (badgeInput && badgeInput.value.trim() !== "") 
            ? badgeInput.value.trim() 
            : "https://cdn-icons-png.flaticon.com/512/5323/5323443.png";
        
        if (!name || !userId) {
            return typeof notify === 'function' ? notify("Name & User required!") : alert("Name & User required!");
        }
        
        // 🛡️ Armor 4: Null-safe arrays and unified string checking
        const players = Array.isArray(playersData) ? playersData : [];
        const cleanName = name.toLowerCase();
        
        if (players.some(p => String(p.teamName || p.name || "").toLowerCase().trim() === cleanName)) {
            return alert("🚨 Error: Team name is already taken!");
        }
        
        if (players.some(p => String(p.userId || p.uid || p.id) === userId)) {
            return alert("🚨 Error: Manager already has a team assigned!");
        }
        
        if (players.length >= 36) return alert("🚨 UCL is full! (Limit 36)");
        
        // 🛡️ Armor 5: UI Lock to prevent double-writes
        const origText = this.innerText;
        this.disabled = true;
        this.innerText = "Saving...";
        
        try {
            // 🛡️ Armor 6: Failsafe for missing Firebase imports
            if (typeof addDoc === 'undefined' || typeof collection === 'undefined' || typeof db === 'undefined') {
                throw new Error("Firebase SDK is not loaded or missing.");
            }

            const leagueId = (typeof UCL_LEAGUE_ID !== 'undefined') ? UCL_LEAGUE_ID : "UCL_DEFAULT";

            // 🌟 Save to Firestore (Dual-Key mapping prevents Standings/Swiss engine crashes)
            await addDoc(collection(db, "league_players"), { 
                name: name,           
                teamName: name,       
                teamBadge: teamBadgeUrl, 
                leagueId: leagueId, 
                userId: userId, 
                mp: 0, played: 0,
                w: 0, wins: 0,
                d: 0, draws: 0,
                l: 0, losses: 0,
                gf: 0, ga: 0, gd: 0, 
                pts: 0, points: 0,            
                buchholz: 0,
                createdAt: Date.now()
            });
            
            // Clear UI successfully
            nameEl.value = ''; 
            userSelectEl.value = '';
            if (badgeInput) badgeInput.value = '';
            
            const formBox = document.getElementById('addTeamFormBox');
            if (formBox) formBox.classList.add('hidden'); 
            
            if (typeof logActivity === 'function') logActivity(`🛡️ ${name} entered the Champions League!`);
            if (typeof notify === 'function') notify("Team successfully assigned!");

        } catch (err) {
            console.error("🚨 Database Write Failed:", err);
            alert(`Database Error: ${err.message || "Failed to add team."}`);
        } finally {
            // 🛡️ Armor 7: Always unlock UI even if it fails
            this.disabled = false;
            this.innerText = origText;
        }
    };
} else {
    console.warn("🚨 'saveTeamBtn' not found in DOM.");
}





document.getElementById('sidebarDeleteTeamBtn').onclick = async () => { 
    const name = prompt("Enter Exact Team Name:"); 
    if (!name) return; 
    const team = playersData.find(p => p.name.toLowerCase() === name.toLowerCase()); 
    
    if (team && confirm(`Delete ${team.name} AND all of their matches?`)) { 
        // 1. Delete the Team
        await deleteDoc(doc(db, "league_players", team.id)); 
        
        // 2. Hunt down and delete all ghost matches
        const matchesSnap = await getDocs(query(collection(db, "league_matches")));
        matchesSnap.forEach(async (d) => {
            let m = d.data();
            if (m.teamA === team.name || m.teamB === team.name || m.teamA === team.teamName || m.teamB === team.teamName) {
                await deleteDoc(d.ref);
            }
        });
        
        notify("Team and matches completely scrubbed."); 
        closeSidebar(); 
    } 
};


document.getElementById('sidebarSystemResetBtn').onclick = async () => { 
    if (!confirm("DANGER: This deletes ALL matches, chats, announcements, and stream history. Continue?")) return; 
    try { 
        const cols = ["league_matches", "global_chat", "announcements", "streams", "activity_feed", "predictions_tally"]; 
        for (let c of cols) { 
            const snap = await getDocs(query(collection(db, c))); 
            snap.forEach(async (d) => await deleteDoc(d.ref)); 
        } 
        notify("Full Reset."); closeSidebar(); 
    } catch(e) { notify("clearing data."); } 
};

/* =========================================
   📢 LIVE ANNOUNCEMENTS LISTENER
   ========================================= */
let announceUnsub = null;

function listenToAnnouncements() {
    // Stop any old listeners to prevent duplicates
    if (announceUnsub) announceUnsub();
    
    // Listen to the "announcements" collection in Firestore
    announceUnsub = onSnapshot(query(collection(db, "announcements")), snap => {
        const feedBox = document.getElementById('announcementsFeed');
        if (!feedBox) return; // Safely exit if they aren't on a page with this box
        
        feedBox.innerHTML = ''; // Clear out the old ones
        
        // Grab all announcements, sort them so the NEWEST is at the top
        const allUpdates = snap.docs.map(doc => doc.data())
                                    .sort((a, b) => b.timestamp - a.timestamp);
        
        if (allUpdates.length === 0) {
            feedBox.innerHTML = `<div style="color: #94a3b8; font-size: 0.9rem;">No recent announcements.</div>`;
            return;
        }

        // Draw each announcement as a premium card
        allUpdates.forEach(update => {
            feedBox.innerHTML += `
                <div style="background: linear-gradient(to right, #1e293b, #0f172a); border-left: 4px solid #fbbf24; padding: 12px 16px; margin-bottom: 10px; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                    <div style="font-size: 0.75rem; color: #fbbf24; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                        📢 Official Update
                    </div>
                    <div style="color: #f8fafc; font-size: 0.95rem; line-height: 1.4;">
                        ${update.text}
                    </div>
                </div>
            `;
        });
    });
}


// ==========================================
// 📊 STANDINGS & BUCHHOLZ (BULLETPROOF EDITION)
// ==========================================
function calculateBuchholz(teamName) {
    // 🛡️ Safe exit if missing data
    if (!teamName || typeof matchesData === 'undefined' || typeof playersData === 'undefined') return 0;
    
    let opponentPoints = 0;
    
    // 🛡️ Clean string matching to prevent casing/spacing bugs
    const targetTeam = String(teamName).toLowerCase().trim();
    
    const pastMatches = matchesData.filter(m => {
        if (m.status !== 'completed') return false;
        const tA = String(m.teamA).toLowerCase().trim();
        const tB = String(m.teamB).toLowerCase().trim();
        return tA === targetTeam || tB === targetTeam;
    });
    
    pastMatches.forEach(m => {
        const tA = String(m.teamA).toLowerCase().trim();
        const tB = String(m.teamB).toLowerCase().trim();
        
        const opName = (tA === targetTeam) ? tB : tA;
        
        const opTeam = playersData.find(t => String(t.teamName).toLowerCase().trim() === opName);
        
        // 🛡️ BULLETPROOF: Check both 'pts' and 'points'
        if (opTeam) {
            opponentPoints += (opTeam.pts || opTeam.points || 0);
        }
    });
    
    return opponentPoints;
}

function renderStandings() {
    const tb = document.getElementById('standingsBody'); 
    if(!tb) return;
    
    // 🛡️ Safe exit if playersData hasn't loaded yet
    if (typeof playersData === 'undefined') return; 
    
    tb.innerHTML = ''; 
    let f = [...playersData];
    
    // Pass .teamName into the calculator
    f.forEach(p => p.buchholz = calculateBuchholz(p.teamName));
    
    // 🛡️ BULLETPROOF SORTING: Fallbacks for points, buchholz, gd, and gf
    f.sort((a,b) => 
        ((b.pts || b.points || 0) - (a.pts || a.points || 0)) || 
        ((b.buchholz || 0) - (a.buchholz || 0)) || 
        ((b.gd || 0) - (a.gd || 0)) || 
        ((b.gf || 0) - (a.gf || 0))
    ).forEach((p,i) => { 
        let rowClass = "";
        
        // Standard UCL Format Rules
        if (i < 8) rowClass = "ucl-direct";
        else if (i < 24) rowClass = "ucl-playoff";
        else rowClass = "ucl-elim";

        const badgeImg = p.teamBadge || "https://cdn-icons-png.flaticon.com/512/5323/5323443.png";

        // 🛡️ BULLETPROOF ID: Ensure we have a valid ID to open the manager card
        const targetId = p.id || p.uid || p.userId || "";

        tb.innerHTML += `<tr class="${rowClass}" onclick="if('${targetId}') window.openManagerCard('${targetId}')" style="cursor: pointer; transition: 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
        
            <td>${i+1}</td>
            <td style="display: flex; align-items: center; gap: 12px;">
                <img src="${badgeImg}" alt="badge" style="width: 32px; height: 32px; object-fit: contain;"> 
                <strong style="font-size: 1.05rem;">${p.teamName || "Unknown Team"}</strong>
            </td>
            <td>${p.mp || p.played || 0}</td>
            <td>${p.w || p.wins || 0}</td>
            <td>${p.d || p.draws || 0}</td>
            <td>${p.l || p.losses || 0}</td>
            <td>${p.buchholz || 0}</td>
            <td>${p.gd || 0}</td>
            <td style="color:var(--primary-yellow);font-weight:bold;">${p.pts || p.points || 0}</td>
        </tr>`; 
    });
}


// ==========================================
// 🛡️ GENERATOR SAFETY LOCK
// ==========================================
function safeGenerate(stageName, generateFunction) {
    const hasFinalSwissRound = matchesData.some(m => m.stage === 'Swiss Round 8');
    
    if (!hasFinalSwissRound) {
        alert("⚠️ Action Denied: You must generate all 8 rounds of the Swiss matches first!");
        return;
    }
    
    const alreadyGenerated = matchesData.some(m => m.stage === stageName);
    
    if (alreadyGenerated) {
        alert(`⚠️ Matches already generated for ${stageName}!`);
        return;
    }
    
    if (confirm(`Are you sure you want to generate the ${stageName}?\n\nClick OK for Yes, Cancel for No.`)) {
        generateFunction();
    }
}





// ==========================================================
// ⚙️ 1. UCL SWISS ROUND GENERATOR (DFS BACKTRACKING)
// ==========================================================
document.getElementById('btnGenUCLSwiss').onclick = async () => {
    const pendingMatches = matchesData.filter(m => m.type === 'league' && m.status === 'pending');
    if (pendingMatches.length > 0) return alert("Finish pending Swiss matches first!");

    let originalTeams = [...playersData];
    if (originalTeams.length < 12) return alert("Need more teams for Swiss!");
    if (originalTeams.length % 2 !== 0) return alert("You need an even number of teams!");
    
    // Calculate Buchholz once before sorting
    originalTeams.forEach(t => t.buchholz = calculateBuchholz(t.teamName));
    
    const roundNumber = Math.floor(matchesData.filter(m => m.type === 'league').length / (originalTeams.length / 2)) + 1;
    if (roundNumber > 8) return alert("Swiss phase complete!");
    if (!confirm(`Generate True Swiss Round ${roundNumber}?`)) return;

    // 🛡️ BULLETPROOF SORTING: Checks both points and pts
    let teams = [...originalTeams].sort((a,b) => 
        ((b.points || b.pts || 0) - (a.points || a.pts || 0)) || 
        ((b.buchholz || 0) - (a.buchholz || 0)) || 
        ((b.gd || 0) - (a.gd || 0))
    );

    // Hyper-fast lookup table for past matches
    const playedSet = new Set();
    matchesData.forEach(m => {
        if (m.type === 'league') {
            playedSet.add(`${m.teamA}|${m.teamB}`);
            playedSet.add(`${m.teamB}|${m.teamA}`);
        }
    });

    const hasPlayed = (team1, team2) => playedSet.has(`${team1}|${team2}`);

    // Backtracking Algorithm
    let opsCounter = 0;
    
    function findPairings(unpairedTeams) {
        opsCounter++;
        if (opsCounter > 10000) return null; // 🛡️ Capped at 10k to prevent browser freezing

        if (unpairedTeams.length === 0) return []; 

        let teamA = unpairedTeams[0];

        for (let i = 1; i < unpairedTeams.length; i++) {
            let teamB = unpairedTeams[i];

            if (!hasPlayed(teamA.teamName, teamB.teamName)) {
                let remaining = unpairedTeams.filter((_, idx) => idx !== 0 && idx !== i);
                let result = findPairings(remaining);

                if (result !== null) {
                    return [[teamA, teamB], ...result];
                }
            }
        }
        
        return null; 
    }

    const finalPairings = findPairings(teams);

    if (finalPairings !== null) {
        let batch = writeBatch(db);
        
        const stageLabel = `Swiss Round ${roundNumber}`;
        
        finalPairings.forEach(pair => {
            const matchRef = doc(collection(db, "league_matches"));
            const teamA = pair[0].teamName;
            const teamB = pair[1].teamName;

            batch.set(matchRef, { 
                leagueId: UCL_LEAGUE_ID, 
                type: 'league', 
                stage: stageLabel,
                teamA: teamA, 
                teamB: teamB, 
                scoreA: 0, 
                scoreB: 0, 
                status: 'pending', 
                events: [], 
                timestamp: Date.now() 
            });

            
        });

        await batch.commit();

                // 👇 NEW BROADCAST TRIGGER
        if (typeof window.sendStageBroadcast === 'function') {
            window.sendStageBroadcast(stageLabel);
            window.createGlobalSidebarAlert(stageLabel);
        }


        logActivity(`⚽ UCL Swiss Round ${roundNumber} Generated Successfully!`);
        notify(`Round ${roundNumber} Generated!`); 
        if(typeof closeSidebar === 'function') closeSidebar();
    } else {
        if (opsCounter > 10000) {
             alert("CRITICAL DEADLOCK: Graph too complex or no valid pairings exist without a rematch. Pair manually.");
        } else {
             alert("MATHEMATICAL IMPOSSIBILITY: No way to pair these teams without rematches based on current standings.");
        }
    }
};

// ==========================================
// 🏆 2. UCL PLAYOFF GENERATOR (RANKS 9-24)
// ==========================================
document.getElementById('btnGenUCLPlayoff').onclick = () => {
    safeGenerate('Play-offs', async () => {
        const pendingMatches = matchesData.filter(m => m.stage === 'Swiss Round 8' && m.status === 'pending');
        if (pendingMatches.length > 0) return alert("Finish Swiss Round 8 first!");
        
        let originalTeams = [...playersData];
        originalTeams.forEach(t => t.buchholz = calculateBuchholz(t.teamName));

        // 🛡️ BULLETPROOF SORTING
        const teams = originalTeams.sort((a,b) => 
            ((b.points || b.pts || 0) - (a.points || a.pts || 0)) || 
            ((b.buchholz || 0) - (a.buchholz || 0)) || 
            ((b.gd || 0) - (a.gd || 0))
        );
        
        let playoffTeams = teams.slice(8, 24); 
        if (playoffTeams.length < 16) return alert("Not enough ranked teams for playoffs! At least 24 needed.");

        const batch = writeBatch(db);
        

        for (let i = 0; i < 8; i++) {
            const matchRef = doc(collection(db, "league_matches"));
            const teamA = playoffTeams[i].teamName;
            const teamB = playoffTeams[15 - i].teamName;

            batch.set(matchRef, { 
                leagueId: UCL_LEAGUE_ID, 
                type: 'knockout', 
                stage: 'Play-offs', 
                teamA: teamA,
                teamB: teamB,
                scoreA: 0, 
                scoreB: 0, 
                status: 'pending', 
                timestamp: Date.now() + i 
            });

            
        }
        
        await batch.commit();

        // 👇 NEW BROADCAST TRIGGER
        if (typeof window.sendStageBroadcast === 'function') {
            window.sendStageBroadcast('Play-offs');
            window.createGlobalSidebarAlert('Play-offs');
        }



        logActivity(`⚡ UCL Play-offs Generated!`);
        notify("Play-offs Generated!"); 
        if(typeof closeSidebar === 'function') closeSidebar();
    });
};

// ==========================================
// 🏆 3. ROUND OF 16 GENERATOR
// ==========================================
document.getElementById('btnPromoteUCLR16').onclick = () => {
    safeGenerate('Round of 16', async () => {
        const pendingPlayoffs = matchesData.filter(m => m.stage === 'Play-offs' && m.status === 'pending');
        if (pendingPlayoffs.length > 0) return alert("Error: Finish all pending Play-off matches first!");

        let originalTeams = [...playersData];
        originalTeams.forEach(t => t.buchholz = calculateBuchholz(t.teamName));

        // 🛡️ BULLETPROOF SORTING
        const sortedTeams = originalTeams.sort((a, b) => 
            ((b.points || b.pts || 0) - (a.points || a.pts || 0)) || 
            ((b.buchholz || 0) - (a.buchholz || 0)) || 
            ((b.gd || 0) - (a.gd || 0))
        );

        if (sortedTeams.length < 16) return alert("Error: At least 16 ranked teams needed.");

        const top8Names = sortedTeams.slice(0, 8).map(t => t.teamName);
        const playoffMatches = matchesData.filter(m => m.stage === 'Play-offs' && m.status === 'completed');
        let playoffWinnerNames = [];

        if (playoffMatches.length === 8) {
            playoffMatches.forEach(m => {
                if (m.scoreA > m.scoreB) playoffWinnerNames.push(m.teamA);
                else if (m.scoreB > m.scoreA) playoffWinnerNames.push(m.teamB);
                else {
                    let adv = prompt(`Play-off Draw Failsafe: ${m.teamA} vs ${m.teamB}\nType EXACT name of team that advanced:`, m.teamA);
                    if (!adv) adv = m.teamA; 
                    playoffWinnerNames.push(adv.trim());
                }
            });
            
            // 🛡️ BULLETPROOF SORTING for mapped array
            playoffWinnerNames = playoffWinnerNames.sort((a, b) => {
                const teamA = originalTeams.find(t => t.teamName === a);
                const teamB = originalTeams.find(t => t.teamName === b);
                
                return ((teamB?.points || teamB?.pts || 0) - (teamA?.points || teamA?.pts || 0)) || 
                       ((teamB?.buchholz || 0) - (teamA?.buchholz || 0)) || 
                       ((teamB?.gd || 0) - (teamA?.gd || 0));
            });
        } else {
            console.warn("Playoffs not found or incomplete. Falling back to Rank 9-16.");
            playoffWinnerNames = sortedTeams.slice(8, 16).map(t => t.teamName);
        }

        if (playoffWinnerNames.length !== 8 || top8Names.length !== 8) {
            return alert("Generation Failed: Data mismatch. Could not isolate exactly 16 teams.");
        }

        const batch = writeBatch(db);
        
        
        for (let i = 0; i < 8; i++) {
            const matchRef = doc(collection(db, "league_matches"));
            const teamA = top8Names[i];
            const teamB = playoffWinnerNames[7 - i];

            batch.set(matchRef, { 
                leagueId: UCL_LEAGUE_ID, 
                type: 'knockout', 
                stage: 'Round of 16', 
                teamA: teamA, 
                teamB: teamB, 
                scoreA: 0, 
                scoreB: 0, 
                status: 'pending', 
                timestamp: Date.now() + i 
            });

        }
        
        await batch.commit();

                    // 👇 NEW BROADCAST TRIGGER
        if (typeof window.sendStageBroadcast === 'function') {
            window.sendStageBroadcast('Round of 16');
            window.createGlobalSidebarAlert('Round of 16');
        }



        logActivity(`🔥 Official Round of 16 Bracket Generated!`);
        notify("Round of 16 Generated Successfully!"); 
        if(typeof closeSidebar === 'function') closeSidebar();
    });
};

// ==========================================
// ⚔️ 4. KNOCKOUT ROUNDS (QF, SF, FINAL)
// ==========================================
document.querySelectorAll('.gen-btn').forEach(btn => {
    btn.onclick = () => {
        const stage = btn.dataset.stage; 
        
        safeGenerate(stage, async () => {
            const pMap = {"Quarter-Finals": "Round of 16", "Semi-Finals": "Quarter-Finals", "Final": "Semi-Finals"}; 
            let wins = []; 
            const pName = pMap[stage];
            
            const pendingCheck = matchesData.filter(m => m.stage === pName && m.status === 'pending');
            if (pendingCheck.length > 0) return alert(`Finish ${pName} matches first!`);

            const pMatch = matchesData
                .filter(m => m.stage === pName && m.status === 'completed')
                .sort((a, b) => a.timestamp - b.timestamp); 

            if (pMatch.length === 0) {
                alert(`Cannot generate. No completed matches found in ${pName}.`);
                return;
            }

            pMatch.forEach(m => { 
                if (m.scoreA > m.scoreB) {
                    wins.push(m.teamA); 
                } else if (m.scoreB > m.scoreA) {
                    wins.push(m.teamB); 
                } else {
                    let advancer = prompt(`Draw detected: ${m.teamA} vs ${m.teamB}. Who advanced on penalties?`, m.teamA);
                    if (!advancer) advancer = m.teamA;
                    wins.push(advancer.trim());
                }
            }); 
            
            // 🛡️ BULLETPROOF: Validate we have an even number of winners to pair up
            if (wins.length % 2 !== 0) {
                return alert(`Error: Found an odd number of winners (${wins.length}). Cannot build bracket correctly.`);
            }

            const batch = writeBatch(db);
            
            
            for (let i = 0; i < wins.length; i += 2) { 
                if (wins[i+1]) {
                    const matchRef = doc(collection(db, "league_matches"));
                    const teamA = wins[i];
                    const teamB = wins[i+1];

                    batch.set(matchRef, { 
                        leagueId: UCL_LEAGUE_ID, 
                        type: 'knockout', 
                        stage: stage, 
                        teamA: teamA, 
                        teamB: teamB, 
                        scoreA: 0, 
                        scoreB: 0, 
                        status: 'pending', 
                        timestamp: Date.now() + i 
                    }); 

                    
                }
            } 
            
            await batch.commit();

            // 👇 NEW BROADCAST TRIGGER
            if (typeof window.sendStageBroadcast === 'function') {
                window.sendStageBroadcast(stage);
                window.createGlobalSidebarAlert(stage);
            }



            logActivity(`⚔️ ${stage} Brackets Set!`);
            notify(`${stage} Generated!`); 
            if(typeof closeSidebar === 'function') closeSidebar();
        });
    };
});



/* =========================================
   📢 PREMIUM ANNOUNCEMENT LOGIC
   ========================================= */

// 1. Post a new announcement
window.postPremiumAnnouncement = async function() {
    const input = document.getElementById('premiumAnnounceInput');
    const btn = document.getElementById('btnPremiumBroadcast');
    
    if (!input || !input.value.trim()) return; // Stop if empty
    
    const text = input.value.trim();
    
    // Change button state so they know it's sending
    const originalText = btn.innerHTML;
    btn.innerHTML = "⏳ Sending...";
    btn.disabled = true;

    try {
        await addDoc(collection(db, "announcements"), { 
            text: text, 
            timestamp: Date.now() 
        });
        
        input.value = ''; // Clear the box
        if (typeof notify === "function") notify("Broadcast Sent!");
        
    } catch (error) {
        console.error("Failed to post:", error);
        alert("Failed to send broadcast. Check your connection.");
    } finally {
        // Reset button
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

let announceListener = null;

window.listenToPremiumAnnouncements = function() {
    if (announceListener) announceListener(); 
    
    announceListener = onSnapshot(query(collection(db, "announcements")), snap => {
        const feed = document.getElementById('premiumAnnouncementsFeed');
        if (!feed) return; 
        
        feed.innerHTML = ''; 
        
        // 🌟 UPDATE: We now grab `id: d.id` from Firestore so we can delete it later!
        const updates = snap.docs.map(d => ({
            id: d.id, 
            ...d.data()
        })).sort((a, b) => b.timestamp - a.timestamp);
        
        

        updates.forEach(update => {
            const timeString = new Date(update.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // 💡 TIP: You can wrap the delete button in an `if (currentUser.uid === "ADMIN_ID")` 
            // check if you only want the trash can to appear on the admin's screen!
            
            feed.innerHTML += `
                <div class="premium-announce-card">
                    <div class="announce-header">
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <span class="announce-badge">📢 Official</span>
                            <span class="announce-time">${timeString}</span>
                        </div>
                        
                        <!-- 🗑️ THE NEW DELETE BUTTON -->
                        <button onclick="deletePremiumAnnouncement('${update.id}')" class="announce-delete-btn" title="Delete Broadcast">
                            🗑️
                        </button>
                    </div>
                    <div class="announce-text">${update.text}</div>
                </div>
            `;
        });
    });
};



// 3. Link the Sidebar Button to the Premium Box
const btnSidebarAnnounce = document.getElementById('btnToggleAnnounce');

if (btnSidebarAnnounce) {
    btnSidebarAnnounce.addEventListener('click', () => {
        // 1. Hide all main screens
        document.querySelectorAll('.view-section').forEach(section => {
            section.classList.add('hidden');
        });
        
        // 2. Open the Admin View (if you keep your admin tools inside this container)
        document.getElementById('viewAdmin')?.classList.remove('hidden');
        
        // 3. Reveal our new Premium Broadcast Center
        const announceBox = document.getElementById('premiumAdminAnnounceBox');
        if (announceBox) {
            // Toggle it on or off
            if (announceBox.style.display === "none") {
                announceBox.style.display = "block";
            } else {
                announceBox.style.display = "none";
            }
        }
        
        // 4. Safely close the mobile sidebar
        if (typeof closeSidebar === "function") closeSidebar();
    });
}

// 3. Delete an Announcement
window.deletePremiumAnnouncement = async function(docId) {
    // 🛡️ Safety check before deleting
    const confirmDelete = confirm("Are you sure you want to delete this announcement?");
    if (!confirmDelete) return;

    try {
        // Find the exact document in Firestore and delete it
        await deleteDoc(doc(db, "announcements", docId));
        
        if (typeof notify === "function") notify("Announcement Deleted");
    } catch (error) {
        console.error("Error deleting announcement:", error);
        alert("Failed to delete announcement. Do you have admin permissions?");
    }
};


// PREDICTIONS, SCHEDULING & COMMENTS
window.submitPrediction = async (matchId, choice) => {
    if(!currentUser) return notify("Login to predict!");
    const ref = doc(db, "league_matches", matchId, "predictions", currentUser.uid);
    await setDoc(ref, { choice });
    
    const tallyRef = doc(db, "predictions_tally", matchId);
    const snap = await getDoc(tallyRef);
    if(snap.exists()){
        let data = snap.data();
        data[choice] = (data[choice] || 0) + 1;
        data.total = (data.total || 0) + 1;
        await updateDoc(tallyRef, data);
    } else {
        await setDoc(tallyRef, { [choice]: 1, total: 1 });
    }
    awardBadge(currentUser.uid, 'oracle', 'Predictor', '🔮');
    notify("Locked in!");
};

window.openScheduleModal = function(matchId) {
    activeScheduleMatchId = matchId;
    document.getElementById('scheduleModal').classList.remove('hidden');
};
document.getElementById('closeScheduleBtn').onclick = () => document.getElementById('scheduleModal').classList.add('hidden');

document.getElementById('saveScheduleBtn').onclick = async () => {
    if(!activeScheduleMatchId) return;
    const dt = document.getElementById('matchDateTimeInput').value;
    if(!dt) return notify("Select date!");
    
    await updateDoc(doc(db, "league_matches", activeScheduleMatchId), { matchTime: dt });
    document.getElementById('scheduleModal').classList.add('hidden');
    notify("Scheduled!");
};



window.openComments = function(matchId) {
    document.getElementById('commentModal').classList.remove('hidden');
    window.currentCommentMatchId = matchId; 
    
    onSnapshot(query(collection(db, "league_matches", matchId, "comments")), snap => {
        const c = document.getElementById('commentsList'); 
        if(!c) return;
        c.innerHTML = '';
        snap.docs.map(d => d.data()).sort((a,b) => a.timestamp - b.timestamp).forEach(m => { 
            c.innerHTML += `<div style="margin-bottom:8px; font-size:1.1rem; padding:8px; background:var(--bg-card-dark); border-radius:5px;"><strong>${m.userName}:</strong> ${m.text}</div>`; 
        });
        c.scrollTop = c.scrollHeight;
    });
};

document.getElementById('closeCommentsBtn').onclick = () => document.getElementById('commentModal').classList.add('hidden');
document.getElementById('sendCommentBtn').onclick = async () => { 
    const inp = document.getElementById('commentInput'); 
    if (!inp.value.trim() || !window.currentCommentMatchId) return; 
    await addDoc(collection(db, "league_matches", window.currentCommentMatchId, "comments"), { userName: userProfileData?.firstName || 'Manager', text: inp.value.trim(), timestamp: Date.now() }); 
    inp.value = ''; 
    awardBadge(currentUser.uid, 'commenter', 'Commentator', '💬');
};

// 🧹 SILENT ADMIN SWEEPER: Auto-resolves expired matches to 0-0 draws
window.autoResolveExpiredMatches = async function() {
    // SECURITY: Only the Admin device can trigger database writes for expired matches
    const ADMIN_EMAIL = "efootballleague369@gmail.com";
    if (!currentUser || currentUser.email !== ADMIN_EMAIL) return;

    const NOW = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    
    // Find LEAGUE matches generated >24 hours ago that are STILL pending
    const expiredPending = matchesData.filter(m => 
        m.type === 'league' && 
        m.status === 'pending' && 
        m.timestamp && 
        (NOW - m.timestamp) >= TWENTY_FOUR_HOURS
    );

    if (expiredPending.length === 0) return; // Clean, nothing to sweep

    try {
        const batch = writeBatch(db);
        let updates = 0;

        expiredPending.forEach(m => {
            // 1. Force the 0-0 Draw and set status to 'completed'
            const matchRef = doc(db, "league_matches", m.id);
            batch.update(matchRef, { scoreA: 0, scoreB: 0, status: 'completed' });

            // 2. Safely find both teams
            const tA = playersData.find(p => p.name === m.teamA || p.teamName === m.teamA);
            const tB = playersData.find(p => p.name === m.teamB || p.teamName === m.teamB);

            // 3. Award 1 point and 1 draw to both teams
            if (tA && tA.id) {
                batch.update(doc(db, "league_players", tA.id), {
                    mp: increment(1), pts: increment(1), d: increment(1) // ✅ MUST BE pts
                });
            } else {
                console.warn("Could not find Team A to update:", m.teamA);
            }
            
            if (tB && tB.id) {
                batch.update(doc(db, "league_players", tB.id), {
                    mp: increment(1), pts: increment(1), d: increment(1) // ✅ MUST BE pts
                });
            } else {
                console.warn("Could not find Team B to update:", m.teamB);
            }


            updates++;
        });

        if (updates > 0) {
            await batch.commit();
            console.log(`🚨 SWEEPER FIRED: Forced ${updates} expired matches to 0-0 draws.`);
        }
    } catch (error) {
        console.error("Auto-resolve sweeper failed:", error);
    }
};


function renderFixtures(filter = 'league') {
    const list = document.getElementById('fixturesList');
    if (!list) return;
    list.innerHTML = '';
    const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL;
    
    // 🚨 1. TRIGGER THE SWEEPER SILENTLY IN THE BACKGROUND
    if (isAdmin) autoResolveExpiredMatches();

    let f = filter === 'league' ? matchesData.filter(m => m.type === 'league') : matchesData.filter(m => m.type === 'knockout');
    
    // ==========================================
    // ⏱️ THE STRICT 24-HOUR LIFESPAN ENFORCER
    // ==========================================
    const NOW = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    if (filter === 'league') {
        // LEAGUE MATCHES: Only survive in UI if generated LESS than 24 hours ago
        f = f.filter(m => {
            if (!m.timestamp) return true; // Failsafe for legacy data missing timestamps
            return (NOW - m.timestamp) < TWENTY_FOUR_HOURS;
        });
        
        const area = document.getElementById('bracketArea');
        if (area) area.classList.add('hidden');
    } else {
        // KNOCKOUT MATCHES: Completely bypass the filter (Stay visible on the tree forever)
        const area = document.getElementById('bracketArea');
        if (area) area.classList.remove('hidden');
        renderVisualBracket(f);
    }
    // ==========================================
    
    
    
    f.forEach(m => {
        const div = document.createElement('div');
        div.className = 'fixture-card';
        let timeGF = m.matchTime ? new Date(m.matchTime).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'TIME TO BE PLAYED';
        
        // 🌟 Lookup team data securely based on the team names inside the match
        const teamA_Data = playersData.find(p => p.name === m.teamA || p.teamName === m.teamA);
        const teamB_Data = playersData.find(p => p.name === m.teamB || p.teamName === m.teamB);
        
        // 🌟 Get the Badges
        const badgeA = (teamA_Data && teamA_Data.teamBadge) ? teamA_Data.teamBadge : "https://cdn-icons-png.flaticon.com/512/5323/5323443.png";
        const badgeB = (teamB_Data && teamB_Data.teamBadge) ? teamB_Data.teamBadge : "https://cdn-icons-png.flaticon.com/512/5323/5323443.png";
        
                // 🌟 FIXED: Look up the manager's real name from the usersData array using their userId!
        const userA = teamA_Data ? usersData.find(u => u.id === teamA_Data.userId) : null;
        const managerA = userA ? userA.firstName : "Manager";

        const userB = teamB_Data ? usersData.find(u => u.id === teamB_Data.userId) : null;
        const managerB = userB ? userB.firstName : "Manager";

        // 🌟 NEW: Create the onclick actions if the team data exists
        const clickA = teamA_Data && teamA_Data.id ? `onclick="window.openManagerCard('${teamA_Data.id}')"` : '';
        const clickB = teamB_Data && teamB_Data.id ? `onclick="window.openManagerCard('${teamB_Data.id}')"` : '';
        
        // 🌟 Injected the <img> tags and Manager Names below
        let html = `
            <div class="fixture-header">${m.stage}</div>
            <div class="match-time">${timeGF}</div>
                        <div class="fixture-body">
                <div class="team-side" style="text-align:right;">
                    <div style="font-weight:bold; display: flex; align-items: center; justify-content: flex-end;">
                        ${m.teamA} 
                        <!-- 🌟 TEAM A BADGE UPGRADED WITH ONCLICK AND HOVER EFFECT -->
                        <img src="${badgeA}" ${clickA} style="width:65px; height:65px; margin-left:12px; object-fit:contain; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.4)); transition: transform 0.2s; cursor: pointer;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                    </div>
                    <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px;">👤 ${managerA}</div>
                </div>
                
                <!-- 🚨 FIX: Changed 'played' to 'completed' so scores show up! -->
                <div class="score-center">${m.status === 'completed' ? `${m.scoreA} - ${m.scoreB}` : 'VS'}</div>
                
                <div class="team-side" style="text-align:left;">
                    <div style="font-weight:bold; display: flex; align-items: center; justify-content: flex-start;">
                        <!-- 🌟 TEAM B BADGE UPGRADED WITH ONCLICK AND HOVER EFFECT -->
                        <img src="${badgeB}" ${clickB} style="width:65px; height:65px; margin-right:12px; object-fit:contain; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.4)); transition: transform 0.2s; cursor: pointer;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'"> 
                        ${m.teamB}
                    </div>
                    <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px;">👤 ${managerB}</div>
                </div>
            </div>
            `;



        
        if (m.status === 'pending') {
            let tally = predictionsData[m.id] || { total: 0, A: 0, D: 0, B: 0 };
            let pA = tally.total ? Math.round((tally.A / tally.total) * 100) : 0;
            let pD = tally.total ? Math.round((tally.D / tally.total) * 100) : 0;
            let pB = tally.total ? Math.round((tally.B / tally.total) * 100) : 0;
            
            
}
        
        html += `<div class="fixture-controls-public">
                    <button class="small-btn" style="background:#475569;" onclick="openComments('${m.id}')">💬 Comments</button>
                 </div>`;
        
        if (isAdmin) {
            html += `<div style="padding:10px; background:#020617; display:flex; gap:5px; justify-content:center; border-top:1px solid #1e293b;">
                <input type="number" id="sA_${m.id}" style="width:40px; background:#1e293b; color:#fff; border:none; text-align:center; border-radius:3px;">
                <input type="number" id="sB_${m.id}" style="width:40px; background:#1e293b; color:#fff; border:none; text-align:center; border-radius:3px;">
                <button class="small-btn" style="background:#22c55e;" onclick="saveScore('${m.id}', '${m.teamA}', '${m.teamB}')">💾 Score</button>
                <button class="small-btn" style="background:#a855f7;" onclick="openScheduleModal('${m.id}')">🕒 Time</button>
                <button class="small-btn danger" onclick="deleteMatch('${m.id}')">🗑️</button>
            </div>`;
        }
        div.innerHTML = html;
        list.appendChild(div);
    });
}

function renderVisualBracket(knockouts) {
    // 1. Clear all NEW HTML slots first
    const slots = ['r16-left', 'r16-right', 'qf-left', 'qf-right', 'sf-left', 'sf-right', 'final-center'];
    slots.forEach(id => {
        const el = document.getElementById(id);
        if(el) el.innerHTML = ''; 
    });

    // 2. Separate matches by their stage
    const r16 = knockouts.filter(m => m.stage === 'Round of 16');
    const qf = knockouts.filter(m => m.stage === 'Quarter-Finals');
    const sf = knockouts.filter(m => m.stage === 'Semi-Finals');
    const final = knockouts.filter(m => m.stage === 'Final');

    // 3. Helper function to build the exact HTML card
    const createCard = (m) => {
        const teamA_Data = playersData.find(p => p.teamName === m.teamA || p.name === m.teamA);
        const teamB_Data = playersData.find(p => p.teamName === m.teamB || p.name === m.teamB);
        
        const badgeA = (teamA_Data && teamA_Data.teamBadge) ? teamA_Data.teamBadge : "https://cdn-icons-png.flaticon.com/512/5323/5323443.png";
        const badgeB = (teamB_Data && teamB_Data.teamBadge) ? teamB_Data.teamBadge : "https://cdn-icons-png.flaticon.com/512/5323/5323443.png";

        // 🌟 NEW: Increased width and height to 35px, added object-fit to prevent stretching, and margin-right for spacing
        const clickA = teamA_Data && teamA_Data.id ? `onclick="window.openManagerCard('${teamA_Data.id}')" style="width: 35px; height: 35px; object-fit: contain; margin-right: 8px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'"` : `style="width: 35px; height: 35px; object-fit: contain; margin-right: 8px;"`;
        const clickB = teamB_Data && teamB_Data.id ? `onclick="window.openManagerCard('${teamB_Data.id}')" style="width: 35px; height: 35px; object-fit: contain; margin-right: 8px; cursor: pointer; transition: 0.2s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'"` : `style="width: 35px; height: 35px; object-fit: contain; margin-right: 8px;"`;

        const winA = m.status === 'completed' && m.scoreA > m.scoreB;
        const winB = m.status === 'completed' && m.scoreB > m.scoreA;
        const isPending = m.status === 'pending';
        
        return `
            <div class="bracket-match-card">
                <div class="b-team ${winA ? 'winner' : ''}">
                    <div class="b-team-info" style="display: flex; align-items: center;">
                        <!-- 🌟 UPGRADED BADGE A SIZING -->
                        <img src="${badgeA}" alt="badge" ${clickA}>
                        <span class="b-name">${m.teamA.substring(0,12)}</span>
                    </div>
                    <div class="b-score">${isPending ? '-' : m.scoreA}</div>
                </div>
                <div class="b-divider"></div>
                <div class="b-team ${winB ? 'winner' : ''}">
                    <div class="b-team-info" style="display: flex; align-items: center;">
                        <!-- 🌟 UPGRADED BADGE B SIZING -->
                        <img src="${badgeB}" alt="badge" ${clickB}>
                        <span class="b-name">${m.teamB.substring(0,12)}</span>
                    </div>
                    <div class="b-score">${isPending ? '-' : m.scoreB}</div>
                </div>
            </div>`;
    };



    // 4. Distribute the cards symmetrically (Left and Right sides)
    
    // Round of 16 (8 Matches -> 4 Left, 4 Right)
    r16.slice(0, 4).forEach(m => { const el = document.getElementById('r16-left'); if(el) el.innerHTML += createCard(m); });
    r16.slice(4, 8).forEach(m => { const el = document.getElementById('r16-right'); if(el) el.innerHTML += createCard(m); });

    // Quarter-Finals (4 Matches -> 2 Left, 2 Right)
    qf.slice(0, 2).forEach(m => { const el = document.getElementById('qf-left'); if(el) el.innerHTML += createCard(m); });
    qf.slice(2, 4).forEach(m => { const el = document.getElementById('qf-right'); if(el) el.innerHTML += createCard(m); });

    // Semi-Finals (2 Matches -> 1 Left, 1 Right)
    sf.slice(0, 1).forEach(m => { const el = document.getElementById('sf-left'); if(el) el.innerHTML += createCard(m); });
    sf.slice(1, 2).forEach(m => { const el = document.getElementById('sf-right'); if(el) el.innerHTML += createCard(m); });

    // Final (1 Match -> Center Top)
    final.forEach(m => { const el = document.getElementById('final-center'); if(el) el.innerHTML += createCard(m); });
}

// ==========================================
// ⚽ SMART MATCH SCORE EDITOR & UPDATER
// ==========================================

// 1. Create a tracking object to lock saves per match
window.lockedMatches = window.lockedMatches || {};

window.saveScore = async (id, tA_name, tB_name) => {
    // 2. 🛑 CHECK LOCK: If this match is already saving, stop immediately
    if (window.lockedMatches[id]) return; 

    let sA = parseInt(document.getElementById(`sA_${id}`).value); 
    let sB = parseInt(document.getElementById(`sB_${id}`).value);
    
    if (isNaN(sA) || isNaN(sB)) return alert("⚠️ Please enter valid scores!");

    const match = matchesData.find(m => m.id === id);
    if (!match) return alert("🚨 Error: Match not found in memory!");

    // 🛑 DOUBLE-CHECK CONFIRMATION FOR ALREADY COMPLETED MATCHES
    const isCompleted = match.status === 'completed';
    if (isCompleted) {
        const isSure = confirm("⚠️ This match has already been updated!\n\nAre you sure you want to overwrite the score?");
        if (!isSure) return; // Stop the function completely if they click Cancel
    }

    // 🏆 KNOCKOUT DRAW HANDLING (Penalties)
    if (sA === sB && match.type === 'knockout') {
        const adv = prompt(`⚖️ Knockout Draw! Who won on Penalties?\nEnter 1 for ${tA_name}\nEnter 2 for ${tB_name}`, "1");
        if (adv === "1") sA++; 
        else if (adv === "2") sB++;
        else return alert("Action canceled. Score not saved.");
    }
    
    // 3. 🔒 APPLY THE LOCK & UPDATE BUTTON UI
    window.lockedMatches[id] = true;
    
    // Assuming your save button in HTML has an ID like id="saveBtn_${match.id}"
    const saveBtn = document.getElementById(`saveBtn_${id}`); 
    let originalBtnText = "Save";
    if (saveBtn) {
        originalBtnText = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = "Saving... ⏳"; 
    }

    try {
        const batch = writeBatch(db);

        // 1. ALWAYS UPDATE THE MATCH ITSELF
        batch.update(doc(db, "league_matches", id), { 
            scoreA: sA, 
            scoreB: sB, 
            status: 'completed',
            completedAt: Date.now()
        });
        
        // 2. 🛡️ ONLY UPDATE THE LEAGUE TABLE IF IT IS A "LEAGUE/SWISS" MATCH
        if (match.type === 'league') {
            const tA = playersData.find(p => p.name === tA_name || p.teamName === tA_name); 
            const tB = playersData.find(p => p.name === tB_name || p.teamName === tB_name);
            
            if (!tA || !tB || !tA.id || !tB.id) {
                // Throwing an error here ensures the lock gets removed in the finally block!
                throw new Error("Could not find teams in the database to update standings!");
            }

            // 🧠 SMART EDITOR: Calculate OLD stats to subtract them if you are editing a mistake
            const old_sA = isCompleted ? parseInt(match.scoreA) || 0 : 0;
            const old_sB = isCompleted ? parseInt(match.scoreB) || 0 : 0;
            const old_ptsA = isCompleted ? (old_sA > old_sB ? 3 : (old_sA === old_sB ? 1 : 0)) : 0;
            const old_ptsB = isCompleted ? (old_sB > old_sA ? 3 : (old_sA === old_sB ? 1 : 0)) : 0;
            const old_wA = isCompleted && old_sA > old_sB ? 1 : 0;
            const old_dA = isCompleted && old_sA === old_sB ? 1 : 0;
            const old_lA = isCompleted && old_sA < old_sB ? 1 : 0;
            const old_wB = isCompleted && old_sB > old_sA ? 1 : 0;
            const old_dB = isCompleted && old_sA === old_sB ? 1 : 0;
            const old_lB = isCompleted && old_sB < old_sA ? 1 : 0;

            // 🧠 SMART EDITOR: Calculate NEW stats
            const new_ptsA = sA > sB ? 3 : (sA === sB ? 1 : 0);
            const new_ptsB = sB > sA ? 3 : (sA === sB ? 1 : 0);
            const new_wA = sA > sB ? 1 : 0;
            const new_dA = sA === sB ? 1 : 0;
            const new_lA = sA < sB ? 1 : 0;
            const new_wB = sB > sA ? 1 : 0;
            const new_dB = sA === sB ? 1 : 0;
            const new_lB = sB < sA ? 1 : 0;

            // 🔄 APPLY THE DIFFERENCE (New minus Old)
            batch.update(doc(db, "league_players", tA.id), { 
                mp: increment(isCompleted ? 0 : 1), // Only add a match played if it wasn't completed before
                pts: increment(new_ptsA - old_ptsA), 
                gf: increment(sA - old_sA), 
                ga: increment(sB - old_sB), 
                gd: increment((sA - sB) - (old_sA - old_sB)),
                w: increment(new_wA - old_wA), 
                d: increment(new_dA - old_dA), 
                l: increment(new_lA - old_lA)
            });

            batch.update(doc(db, "league_players", tB.id), { 
                mp: increment(isCompleted ? 0 : 1),
                pts: increment(new_ptsB - old_ptsB), 
                gf: increment(sB - old_sB), 
                ga: increment(sA - old_sA), 
                gd: increment((sB - sA) - (old_sB - old_sA)),
                w: increment(new_wB - old_wB), 
                d: increment(new_dB - old_dB), 
                l: increment(new_lB - old_lB)
            });
        }
        
        await batch.commit();
        logActivity(`📣 FT: ${tA_name} ${sA}-${sB} ${tB_name}`);
        
        if (typeof notify === "function") {
            notify("✅ Match saved successfully!"); 
        }
        
    } catch (error) {
        alert(`🚨 ERROR: ${error.message || "Database update failed! Check console."}`);
        console.error("Match save error:", error);
    } finally {
        // 4. 🔓 ALWAYS UNLOCK THE MATCH AND RESTORE BUTTON (Even if it fails)
        window.lockedMatches[id] = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = originalBtnText; 
        }
    }
};


window.deleteMatch = async (id) => { if (confirm("Delete?")) await deleteDoc(doc(db, "league_matches", id)); };

document.getElementById('sendChatBtn').onclick = async () => { 
    const inp = document.getElementById('chatInput'); 
    if (!inp.value.trim()) return; 
    const fname = userProfileData?.firstName || 'Manager';
    await addDoc(collection(db, "global_chat"), { uid: currentUser.uid, name: fname, text: inp.value.trim(), timestamp: Date.now() }); 
    inp.value = ''; 
    awardBadge(currentUser.uid, 'chatter', 'Chatter', '💬');
};

// ==========================================
// 🏆 CHECK FINAL WINNER & CELEBRATE & AWARDS
// ==========================================
function checkWinner() { 
    const finalMatch = matchesData.find(m => m.stage === 'Final' && m.status === 'completed'); 
    
    if (finalMatch && finalMatch.scoreA !== finalMatch.scoreB) { 
        // 1. Show the Banner
        document.getElementById('winnerBanner').classList.remove('hidden'); 
        
        // Determine Winner
        const isTeamAWinner = finalMatch.scoreA > finalMatch.scoreB;
        const winnerName = isTeamAWinner ? finalMatch.teamA : finalMatch.teamB;
        document.getElementById('winnerTeamName').textContent = winnerName; 
        
        // 2. 🧠 THE LONG-TERM MEMORY CHECK FOR CELEBRATION
        const memoryKey = `seen_celebration_${finalMatch.id}`;
        if (!localStorage.getItem(memoryKey)) {
            if (typeof window.firePremiumConfetti === "function") window.firePremiumConfetti();
            localStorage.setItem(memoryKey, "true"); 
        }

                // ==========================================
        // 🏅 SMART TOURNAMENT AWARDS SCANNER
        // ==========================================
        if (!currentUser) return; // Make sure a user is logged in
        
        const awardMemoryKey = `awards_processed_${finalMatch.id}`;
        
        // Only run the awards algorithm ONCE when the final is completed
        if (!localStorage.getItem(awardMemoryKey)) {
            
            // 🧠 Smart Award Dispatcher
            const dispatchAward = (userId, badgeId, name, imgUrl, desc) => {
                if (!userId) return;
                
                if (currentUser && currentUser.uid === userId) {
                    // Send it to the queue engine!
                    window.queueAwardPopup(userId, badgeId, name, imgUrl, desc);
                } else {
                    // Someone else won it. Silently save it to their profile.
                    if (typeof awardBadge === "function") {
                        awardBadge(userId, badgeId, name, imgUrl);
                    }
                }
            };

            // --- 🏆 AWARD 1: CHAMPIONS LEAGUE CUP ---
            const winningTeam = playersData.find(p => p.name === winnerName || p.teamName === winnerName);
            if (winningTeam) {
                // 1. Triggers the popup and saves the badge to their profile
                dispatchAward(
                    winningTeam.userId, 
                    'ucl_winner', 
                    'Champions', 
                    'https://i.postimg.cc/d3DH3Kgj/1000005601-removebg-preview.png', 
                    'You have conquered Europe and won the tournament!'
                );

                // 2. 🏆 THE HALL OF FAME FIX: Dual-Save System
                if (winningTeam.id) {
                    // A. Give cup to their active profile (Current Season)
                    updateDoc(doc(db, "league_players", winningTeam.id), {
                        cups: increment(1)
                    }).catch(err => console.error("Error adding cup to profile:", err));

                    // B. 🛡️ THE IMMORTAL VAULT: Save it permanently (Survives Deletion!)
                    setDoc(doc(db, "hall_of_fame", winningTeam.id), {
                        name: winningTeam.name || "Unknown",
                        teamName: winningTeam.teamName || "",
                        cups: increment(1)
                    }, { merge: true }).catch(err => console.error("Error saving to vault:", err));
                }
            }

            // --- 🥾 AWARD 2: GOLDEN BOOT ---
            let goldenBootUserId = null;
            // Check individual scorers first
            if (typeof scorersData !== 'undefined' && scorersData.length > 0) {
                const topScorer = [...scorersData].sort((a, b) => b.goals - a.goals)[0];
                const scorerTeam = playersData.find(p => p.name === topScorer.teamName || p.teamName === topScorer.teamName);
                if (scorerTeam) goldenBootUserId = scorerTeam.userId;
            } 
            // Fallback: If no individual data, use the team with the most Goals For (gf)
            else if (playersData && playersData.length > 0) {
                const topScoringTeam = [...playersData].sort((a, b) => (b.gf || 0) - (a.gf || 0))[0];
                if (topScoringTeam) goldenBootUserId = topScoringTeam.userId;
            }
            
            if (goldenBootUserId) {
                dispatchAward(
                    goldenBootUserId, 
                    'golden_boot', 
                    'Golden Boot', 
                    'https://i.postimg.cc/cLqDFZR9/1000005614-removebg-preview.png', 
                    'Lethal finishing! You produced the most goals in the tournament.'
                );
            }

            // --- 🧤 AWARD 3: CLEAN SHEETS (Best Defense) ---
            if (playersData && playersData.length > 0) {
                // Must have played at least 3 matches to qualify for best defense
                const eligibleTeams = playersData.filter(p => (p.mp || 0) >= 3); 
                if (eligibleTeams.length > 0) {
                    const bestDefense = eligibleTeams.sort((a, b) => (a.ga || 0) - (b.ga || 0))[0];
                    if (bestDefense) {
                        dispatchAward(
                            bestDefense.userId, 
                            'clean_sheet', 
                            'Clean Sheets', 
                            'https://i.postimg.cc/7PGd9Bvq/1000005612-removebg-preview.png', 
                            'A brick wall! Your defense conceded the fewest goals.'
                        );
                    }
                }
            }

            // --- 🥇 AWARD 4: BALLON D'OR (Best Manager OVR) ---
            if (playersData && playersData.length > 0) {
                let ballonDorUserId = null;
                let bestOvr = 0;

                // Re-run the OVR algorithm from the profile logic to find the highest rated manager
                playersData.forEach(team => {
                    let mp = team.mp || 0;
                    if (mp > 0) {
                        let ppg = (team.pts || 0) / mp;
                        let winRate = ((team.w || 0) / mp) * 100;
                        let ovr = Math.round(50 + (ppg * 11) + (winRate * 0.16));
                        
                        if (ovr > bestOvr) {
                            bestOvr = ovr;
                            ballonDorUserId = team.userId;
                        }
                    }
                });

                if (ballonDorUserId) {
                    dispatchAward(
                        ballonDorUserId, 
                        'ballon_dor', 
                        'Ballon d\'Or', 
                        'https://i.postimg.cc/3JCkyFxm/1000005616-removebg-preview.png', 
                        'Master Tactician! You are the best overall manager of the season.'
                    );
                }
            }

            // Lock the awards scan so it doesn't run again if the page refreshes
            localStorage.setItem(awardMemoryKey, "true");
        }
        
    } else {
        document.getElementById('winnerBanner').classList.add('hidden'); 
    }
}




// 🔄 UPDATED: Now supports image URLs!
async function loadBadges(uid) {
    onSnapshot(collection(db, "users", uid, "badges"), snap => {
        const container = document.getElementById('badgesContainer'); 
        if(!container) return;
        container.innerHTML = '';
        
        if(snap.empty) { 
            container.innerHTML = '<p style="opacity:0.5; width: 100%; text-align: center;">Play matches to earn premium awards!</p>'; 
            return; 
        }
        
        snap.docs.forEach(d => {
            const b = d.data();
            
            // Smart check: Is the icon an image URL or a text emoji?
            const iconHtml = b.icon.startsWith('http') 
                ? `<img src="${b.icon}" alt="${b.name}">` 
                : `<span style="font-size: 2.5rem; margin-bottom: 8px; display: block;">${b.icon}</span>`;
            
            container.innerHTML += `
                <div class="badge-item-premium">
                    ${iconHtml}
                    <span>${b.name}</span>
                </div>`;
        });
    });
}

// ==========================================
// 🎆 PREMIUM AWARD QUEUE ENGINE
// ==========================================
window.awardQueue = [];
window.isAwardModalActive = false;

window.processAwardQueue = function() {
    // If the queue is empty, stop and ensure the modal is hidden
    if (window.awardQueue.length === 0) {
        window.isAwardModalActive = false;
        document.getElementById('awardPopupOverlay').classList.remove('show');
        return;
    }

    window.isAwardModalActive = true;
    const nextAward = window.awardQueue.shift(); // Grab the first award in line

    // Populate the modal with the new award
    document.getElementById('awardPopupImg').src = nextAward.imgUrl;
    document.getElementById('awardPopupTitle').innerText = nextAward.name;
    document.getElementById('awardPopupDesc').innerText = nextAward.desc;

    // Show modal and fire confetti
    const overlay = document.getElementById('awardPopupOverlay');
    overlay.classList.add('show');
    if (typeof window.firePremiumConfetti === "function") {
        window.hasFiredConfetti = false; // Reset lock so it fires again for the new award
        window.firePremiumConfetti();
    }

    // Handle the Claim Button
    document.getElementById('btnClaimAward').onclick = () => {
        // Save the badge to the database
        if (typeof awardBadge === "function") {
            awardBadge(nextAward.userId, nextAward.badgeId, nextAward.name, nextAward.imgUrl);
        }
        
        // Hide the modal for a dramatic pause
        overlay.classList.remove('show');
        
        // Wait half a second, then check if they won another award!
        setTimeout(() => {
            window.processAwardQueue();
        }, 600);
    };
};

// This replaces triggerAwardPopup
window.queueAwardPopup = function(userId, badgeId, name, imgUrl, desc) {
    // Push the new award into the waiting line
    window.awardQueue.push({ userId, badgeId, name, imgUrl, desc });
    
    // If no modal is currently showing, start the ceremony!
    if (!window.isAwardModalActive) {
        window.processAwardQueue();
    }
};




function updateProfileUT() { 
    if (!userProfileData || !currentUser) return; 
    const myTeam = playersData.find(p => p.userId === currentUser.uid); 
    if (myTeam) { 
        const badgeImg = myTeam.teamBadge || "https://cdn-icons-png.flaticon.com/512/5323/5323443.png";
        document.getElementById('utTeamName').innerHTML = `<img src="${badgeImg}" style="width:70px; height:70px; vertical-align:middle; margin-right:15px; object-fit:contain; filter: drop-shadow(0 4px 8px rgba(251, 191, 36, 0.4));"> ${myTeam.name}`; 
 
        
        document.getElementById('utW').textContent = myTeam.w; 
        document.getElementById('utD').textContent = myTeam.d; 
        document.getElementById('utL').textContent = myTeam.l; 
        document.getElementById('utPts').textContent = myTeam.pts; 
        
        // UPDATED: Changed 'played' to 'completed'
        const history = matchesData.filter(m => m.status === 'completed' && (m.teamA === myTeam.name || m.teamB === myTeam.name)).slice(0, 5).reverse(); 
        const h2hBox = document.getElementById('h2hContainer'); if(h2hBox) h2hBox.innerHTML = '';
        const chartBox = document.getElementById('formChartContainer'); if(chartBox) chartBox.innerHTML = '';

        
        if (history.length === 0) return;

                history.forEach(m => {
            const isTeamA = m.teamA === myTeam.name;
            const myScore = isTeamA ? m.scoreA : m.scoreB;
            const opScore = isTeamA ? m.scoreB : m.scoreA;
            
            // Default to Draw
            let result = 'D';
            let badgeClass = 'badge-d'; 
            
            if (myScore > opScore) {
                result = 'W';
                badgeClass = 'badge-w';
            } else if (myScore < opScore) {
                result = 'L';
                badgeClass = 'badge-l';
            }

            // 1. INJECT PREMIUM H2H ROW
            if(h2hBox) {
                h2hBox.innerHTML += `
                <div class="premium-h2h-row">
                    <div class="form-badge ${badgeClass}" style="width: 32px; height: 32px; font-size: 0.8rem; box-shadow: none;">${result}</div>
                    <div class="h2h-details">
                        <span class="h2h-matchup">
                            ${isTeamA ? `<span style="color:#00d4ff;">${m.teamA}</span> vs ${m.teamB}` : `${m.teamA} vs <span style="color:#00d4ff;">${m.teamB}</span>`}
                        </span>
                        <div class="h2h-score-box">${m.scoreA} : ${m.scoreB}</div>
                    </div>
                </div>`;
            }
            
            // 2. INJECT PREMIUM FORM BUBBLES
            if(chartBox) {
                chartBox.innerHTML += `<div class="form-badge ${badgeClass}">${result}</div>`;
            }
        });




    // ==========================================
    // ⭐ PREMIUM MANAGER RATING & MOTIVATION
    // ==========================================
    const ratingBox = document.getElementById('ratingContainer');
    
    if (ratingBox) {
        let matchesPlayed = myTeam.mp || 0;
        
        if (matchesPlayed === 0) {
            ratingBox.innerHTML = `
                <div class="rating-showcase">
                    <div class="ovr-badge" style="border-color: #64748b; color: #94a3b8; animation: none; box-shadow: none;">
                        <span class="ovr-value">--</span>
                        <span class="ovr-label">OVR</span>
                    </div>
                    <div class="rating-caption" style="color: #cbd5e1; font-style: italic;">"Ready to start the campaign! 🚀"</div>
                </div>
            `;
        } else {
            let pts = myTeam.pts || 0;
            let wins = myTeam.w || 0;
            let ppg = pts / matchesPlayed;
            let winRate = (wins / matchesPlayed) * 100;
            
            let ratingNum = Math.round(50 + (ppg * 11) + (winRate * 0.16)); 
            if (ratingNum > 99) ratingNum = 99; 

            let caption = "";
            let tierClass = "";

            if (ratingNum >= 95) {
                caption = "Legendary Status! You are in a league of your own! 👑🐐";
                tierClass = "tier-legendary";
            } else if (ratingNum >= 90) {
                caption = "Unstoppable! Absolute Masterclass! 🔥⚽";
                tierClass = "tier-master";
            } else if (ratingNum >= 80) {
                caption = "Title Contender! Exceptional Form! 🏆🚀";
                tierClass = "tier-pro";
            } else if (ratingNum >= 70) {
                caption = "Solid Campaign. Keep climbing the ranks! 💪📈";
                tierClass = "tier-solid";
            } else if (ratingNum >= 60) {
                caption = "Finding your rhythm! The comeback starts now! 🔄👀";
                tierClass = "tier-struggle";
            } else {
                caption = "Push up! Push up! You can do more than the others! 🛡️⚡";
                tierClass = "tier-danger";
            }

            ratingBox.innerHTML = `
                <div class="rating-showcase">
                    <div class="ovr-badge ${tierClass}">
                        <span class="ovr-value">${ratingNum}</span>
                        <span class="ovr-label">OVR</span>
                    </div>
                    <div class="rating-caption">"${caption}"</div>
                    <div class="rating-stats-bar">
                        <span class="rating-stat-item">Win Rate: <span class="rating-stat-highlight">${winRate.toFixed(0)}%</span></span>
                        <span class="rating-stat-item">PPG: <span class="rating-stat-highlight">${ppg.toFixed(2)}</span></span>
                    </div>
                </div>
            `;
        }
    }
}
}// <--- Make sure this function closes properly!




// ONBOARDING TOUR Logic
const tourSteps = [
    { title: "UCL Pro", text: "New Swiss Model format Champions League." },
    { title: "Profile", text: "Check your dynamic form chart & achievement badges." },
    { title: "Match Chat", text: "Global & 1-on-1 DM Chat plus match comments." },
    { title: "Multi-Stream", text: "Watch up to 5 Twitch streams at once in Live!" }
];
let currentTourStep = 0;

function startTour() {
    const overlay = document.getElementById('tourOverlay');
    if(overlay) overlay.classList.remove('hidden');
    renderTourStep();
}

function renderTourStep() {
    document.getElementById('tourTitle').textContent = tourSteps[currentTourStep].title;
    document.getElementById('tourText').textContent = tourSteps[currentTourStep].text;
    const dots = document.getElementById('tourDots'); 
    if(dots) {
        dots.innerHTML = '';
        tourSteps.forEach((s, i) => { dots.innerHTML += `<div class="tour-dot ${i === currentTourStep ? 'active' : ''}"></div>`; });
    }
    document.getElementById('btnTourNext').textContent = currentTourStep === tourSteps.length - 1 ? "Start" : "Next";
}

function endTour() {
    localStorage.setItem('tourCompleted', 'true');
    const overlay = document.getElementById('tourOverlay');
    if(overlay) overlay.classList.add('hidden');
    awardBadge(currentUser.uid, 'onboarded', 'League Veteran', '🎓');
}

// 🏆 LOAD LEADERBOARD & ASSIGN BADGES
async function loadPredictionLeaderboard() {
    const q = query(collection(db, "users"), orderBy("predictionPoints", "desc"), limit(10));
    
    try {
        const querySnapshot = await getDocs(q);
        let leaderboardHTML = '';
        let rank = 1;

        querySnapshot.forEach((docSnap) => {
            const user = docSnap.data();
            const points = user.predictionPoints || 0;
            
            let badgeHTML = '';
            if (rank === 1) {
                badgeHTML = `<span class="badge-icon" title="The Oracle">🔮</span> <span class="badge-title oracle-title">THE ORACLE</span>`;
            } else if (rank === 2) {
                badgeHTML = `<span class="badge-icon" title="Master Tactician">🧠</span>`;
            } else if (rank === 3) {
                badgeHTML = `<span class="badge-icon" title="Sharpshooter">🎯</span>`;
            } else if (points >= 15) {
                badgeHTML = `<span class="badge-icon" title="Rising Star">⭐</span>`; 
            }

            leaderboardHTML += `
                <div class="leaderboard-row">
                    <div style="display: flex; align-items: center;">
                        <span class="rank-number">#${rank}</span>
                        <span style="font-weight:bold; color:#fff; font-size:15px;">${user.firstName || 'Manager'} ${user.lastName || ''}</span>
                        ${badgeHTML}
                    </div>
                    <div class="points-display">
                        ${points} <span>pts</span>
                    </div>
                </div>
            `;
            rank++;
        });

        const listContainer = document.getElementById('predictionList');
        if (listContainer) {
            listContainer.innerHTML = leaderboardHTML || '<p style="color:#94a3b8; text-align:center; padding: 10px;">No predictions yet! Go vote.</p>';
        }
    } catch (error) {
        console.error("Error loading leaderboard:", error);
    }
}

// ⚙️ ADMIN: AWARD POINTS TO WINNERS
window.awardPredictionPoints = async function(matchId, actualWinnerTeamId) {
    try {
        const predictionsRef = collection(db, "league_matches", matchId, "predictions");
        const predsSnap = await getDocs(predictionsRef);
        let correctGuesses = 0;

        for (const predictionDoc of predsSnap.docs) {
            const voteData = predictionDoc.data();
            const managerUserId = predictionDoc.id; 
            
            if (voteData.predictedWinnerId === actualWinnerTeamId) {
                correctGuesses++;
                const userRef = doc(db, "users", managerUserId);
                await updateDoc(userRef, {
                    predictionPoints: increment(3) 
                });
            }
        }
        notify(`Awarded 3 points to ${correctGuesses} managers.`);
        loadPredictionLeaderboard(); 
        
    } catch (error) {
        console.error("Error awarding points:", error);
    }
}


// 🚨 LOAD MATCH OF THE WEEK
async function loadMatchOfTheWeek() {
    const q = query(collection(db, "league_matches"), where("isFeatured", "==", true), limit(1));
    try {
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            document.getElementById('motwBanner').style.display = 'none';
            return;
        }
        const matchDoc = querySnapshot.docs[0];
        const matchData = matchDoc.data();
        
        document.getElementById('motwBanner').style.display = 'block';
        document.getElementById('motwTeamA').innerText = matchData.teamA_Name || "Manager A";
        document.getElementById('motwTeamB').innerText = matchData.teamB_Name || "Manager B";
        
        document.getElementById('motwH2HStats').innerHTML = `
            <span class="h2h-win">${matchData.teamA_Name}: <br><b>${matchData.h2hWinsA || 0} Wins</b></span>
            <span class="h2h-draw">Draws: <br><b>${matchData.h2hDraws || 0}</b></span>
            <span class="h2h-win">${matchData.teamB_Name}: <br><b>${matchData.h2hWinsB || 0} Wins</b></span>
        `;
        
        if (matchData.matchTime) {
            startCountdownTimer(matchData.matchTime.toDate());
        }
    } catch (error) {
        console.error("Error loading Match of the Week:", error);
    }
}

// ⏱️ COUNTDOWN TIMER ENGINE
let motwInterval;

function startCountdownTimer(matchDate) {
    clearInterval(motwInterval);
    const countdownEl = document.getElementById('motwCountdown');
    
    motwInterval = setInterval(() => {
        const now = new Date().getTime();
        const distance = matchDate.getTime() - now;
        
        if (distance < 0) {
            clearInterval(motwInterval);
            countdownEl.innerHTML = "<span class='live-alert'>🚨 LIVE NOW! JOIN THE STREAM 🚨</span>";
            return;
        }
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        countdownEl.innerText = `${days}d ${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
    }, 1000);
}

// ⚙️ ADMIN: SET MATCH OF THE WEEK
window.triggerMOTW = async function() {
    const matchId = document.getElementById('adminMatchId').value;
    const timeInput = document.getElementById('adminMatchTime').value;
    
    if (!matchId || !timeInput) {
        alert("Please fill in both the Match ID and the Time!");
        return;
    }
    
    try {
        const matchesRef = collection(db, "league_matches");
        const oldFeatured = await getDocs(query(matchesRef, where("isFeatured", "==", true)));
        
        oldFeatured.forEach(async (docSnap) => {
            await updateDoc(doc(db, "league_matches", docSnap.id), { isFeatured: false });
        });
        
        const newMatchRef = doc(db, "league_matches", matchId);
        await updateDoc(newMatchRef, {
            isFeatured: true,
            matchTime: new Date(timeInput)
        });
        
        alert("Success! Match of the Week is LIVE!");
        loadMatchOfTheWeek();
        
    } catch (error) {
        console.error("Error setting MOTW:", error);
        alert("Failed to set match. Check console.");
    }
}

/* =========================================
   🎤 PREMIUM VOICE STUDIO (Record, Review, Send)
   ========================================= */
let mediaRecorder;
let audioChunks = [];
let audioStream = null;
let isRecording = false;
let pendingAudioBase64 = null; // Holds the audio while they review it

// 1️⃣ TOGGLE RECORD/STOP
window.toggleVoiceRecord = async function() {
    const btnToggle = document.getElementById("btnVoiceToggle");
    const reviewArea = document.getElementById("voiceReviewArea");

    if (!isRecording) {
        // 🔴 START RECORDING
        try {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(audioStream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = []; // Reset chunks
                
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                
                reader.onloadend = () => {
                    pendingAudioBase64 = reader.result; 

                    if (pendingAudioBase64.length > 950000) {
                        alert("Voice note is too long! Please keep it under 40 seconds.");
                        discardVoiceNote();
                        return;
                    }

                    // 🔄 HIDE RECORD BUTTON, SHOW REVIEW AREA
                    btnToggle.style.display = "none";
                    reviewArea.style.display = "flex";
                    
                    // Load the audio into the mini player so they can hear it
                    document.getElementById("audioPreview").src = pendingAudioBase64;
                };
            };

            mediaRecorder.start();
            isRecording = true;
            
            btnToggle.innerHTML = "⏹️ Stop";
            btnToggle.style.backgroundColor = "#ef4444"; 
            btnToggle.style.color = "#ffffff";
            
        } catch (error) {
            console.error("Mic access denied:", error);
            alert("Please allow microphone access to record.");
        }
    } else {
        // ⏹️ STOP RECORDING (Moves to Review Phase)
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop(); 
        }
        
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
        }

        isRecording = false;
        
        // Reset the toggle button visually (it will be hidden by the review area anyway)
        btnToggle.innerHTML = "🎤 Record";
        btnToggle.style.backgroundColor = ""; 
        btnToggle.style.color = "";
    }
};

// 2️⃣ DISCARD THE AUDIO
window.discardVoiceNote = function() {
    pendingAudioBase64 = null;
    document.getElementById("audioPreview").src = ""; // Clear player
    
    // Hide review area, bring back the record button
    document.getElementById("voiceReviewArea").style.display = "none";
    document.getElementById("btnVoiceToggle").style.display = "inline-block";
};

// 3️⃣ SEND TO FIREBASE
window.sendVoiceNote = async function() {
    if (!pendingAudioBase64) return;
    
    const sendBtn = document.getElementById("btnSendVoice");
    const originalText = sendBtn.innerHTML;
    sendBtn.innerHTML = "⏳..."; // Visual feedback
    sendBtn.disabled = true;

    // 🧠 SMART NAME FINDER
    let senderName = "User"; 
    if (typeof usersData !== 'undefined' && usersData.length > 0) {
        const userProfile = usersData.find(u => u.id === currentUser.uid);
        if (userProfile) senderName = userProfile.firstName || userProfile.name || senderName;
    }
    if (senderName === "User" && currentUser.displayName) senderName = currentUser.displayName;

    try {
        await addDoc(collection(db, "global_chat"), {
            uid: currentUser.uid,                                     
            name: senderName, 
            audioData: pendingAudioBase64, 
            timestamp: serverTimestamp() 
        });
        
        // Success! Clear the studio and go back to normal
        discardVoiceNote(); 
    } catch (error) {
        console.error("Error saving voice note:", error);
        alert("Failed to send voice note. Please try again.");
    } finally {
        sendBtn.innerHTML = originalText;
        sendBtn.disabled = false;
    }
};




/* =========================================
   ADMIN VOICE NOTE CLEANUP
   ========================================= */
const btnClearVoiceNotes = document.getElementById("btnClearVoiceNotes");

if (btnClearVoiceNotes) {
    btnClearVoiceNotes.addEventListener("click", async () => {
        if (!confirm("Are you sure you want to delete all voice notes? Text messages will be kept safe.")) {
            return; 
        }

        try {
            const chatRef = collection(db, "global_chat");
            const snapshot = await getDocs(chatRef);
            
            const batch = writeBatch(db);
            let deleteCount = 0;

            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                // Find only the messages that contain an audio string
                if (data.audioData) {
                    if (deleteCount < 500) { // Protect Firestore 500-batch limit
                        batch.delete(docSnap.ref);
                        deleteCount++;
                    }
                }
            });

            if (deleteCount > 0) {
                await batch.commit();
                
                if (deleteCount === 500) {
                    alert("Deleted 500 voice notes! (Batch limit reached). Click again to delete the rest.");
                } else {
                    alert(`Successfully deleted ${deleteCount} voice notes from the database! 🧹`);
                }
            } else {
                alert("Database is clean! No voice notes found.");
            }

        } catch (error) {
            console.error("Error clearing voice notes:", error);
            alert("Failed to delete voice notes. Make sure you are logged in as Admin.");
        }
    });
}

// ==========================================
// 🏆 STATS & LEADERBOARD SYSTEM (SMART DATA + EMPTY STATE)
// ==========================================

function updateLeaderboards() {
    const goalsBody = document.getElementById("navGoalsTableBody");
    const trophiesBody = document.getElementById("navTrophiesTableBody");

    if (!goalsBody || !trophiesBody) return;

    goalsBody.innerHTML = "";
    trophiesBody.innerHTML = "";

    // ----------------------------------------------------
    // TABLE 1: TEAM GOALS (Linked to playersData)
    // ----------------------------------------------------
    let hasTeamGoals = false;
    
    if (typeof playersData !== 'undefined' && playersData.length > 0) {
        const topScorers = [...playersData]
            .filter(team => (team.gf || 0) > 0)
            .sort((a, b) => b.gf - a.gf);

                if (topScorers.length > 0) {
            hasTeamGoals = true; // We have goals! Hide the empty state.
            topScorers.forEach((team, index) => {
                goalsBody.innerHTML += `
                    <!-- We added the onclick and hover effects here! -->
                    <tr onclick="openManagerCard('${team.id}')" style="cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(251,191,36,0.1)'" onmouseout="this.style.background='transparent'">
                        <td>${index + 1}</td>
                        <td>${team.name}</td>
                        <td><strong>${team.gf}</strong></td>
                    </tr>`;
            });
        }
    }

    // Show Empty State if no team has scored yet
    if (!hasTeamGoals) {
        goalsBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align:center; padding: 50px 20px; background: rgba(15, 23, 42, 0.4);">
                    <i class="fas fa-stopwatch" style="font-size: 2.5rem; color: var(--primary-yellow, #fbbf24); margin-bottom: 15px; opacity: 0.9; display: block; text-shadow: 0 0 10px rgba(251, 191, 36, 0.3);"></i>
                    <span style="font-family: 'Rajdhani', sans-serif; font-size: 1.3rem; font-weight: 700; color: #ffffff; display: block; margin-bottom: 8px; letter-spacing: 1px;">AWAITING KICK-OFF</span>
                    <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 500;">Stats will update live once the Swiss Model league officially begins.</span>
                </td>
            </tr>
        `;
    }

    // ----------------------------------------------------
    // TABLE 2: HALL OF FAME (IMMORTAL VAULT)
    // ----------------------------------------------------
    let hasChampions = false;

    // 🌟 THE FIX: Now it reads from the permanent Vault, not active players!
    if (typeof vaultData !== 'undefined' && vaultData.length > 0) {
        
        // 1. FILTER & SORT
        const champions = [...vaultData]
            .filter(team => Number(team.cups || 0) > 0)
            .sort((a, b) => Number(b.cups || 0) - Number(a.cups || 0));

        if (champions.length > 0) {
            hasChampions = true; // We have champions! Hide the empty state.
            
            champions.forEach((team, index) => {
                
                // 3. VISUALS
                let cupVisual = `<div style="font-size: 1.1rem; margin-top: 4px; filter: drop-shadow(0 2px 4px rgba(251,191,36,0.5));">${"🏆".repeat(team.cups)}</div>`;
                const displayName = team.name || "Unknown";
                const displayTeam = team.teamName ? `<span style="font-size:0.75em; opacity:0.7; color: #94a3b8;">(${team.teamName})</span>` : "";

                trophiesBody.innerHTML += `
                    <tr onclick="openManagerCard('${team.id}')" style="cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(251,191,36,0.1)'" onmouseout="this.style.background='transparent'">

                        <td>${index + 1}</td>
                        <td>
                            <div style="font-weight: bold; color: #fff; font-size: 1.05rem;">${displayName}</div>
                            ${displayTeam}
                            ${cupVisual}
                        </td>
                        <td style="vertical-align: middle; font-size: 1.1rem; color: #fbbf24;">
                            <strong>${team.cups}</strong>
                        </td>
                    </tr>`;
            });
        }
    }

    // Show Premium Empty State if no champions exist yet
    if (!hasChampions) {
        trophiesBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align:center; padding: 50px 20px; background: rgba(15, 23, 42, 0.4);">
                    <i class="fas fa-shield-alt" style="font-size: 2.5rem; color: var(--primary-yellow, #fbbf24); margin-bottom: 15px; opacity: 0.9; display: block; text-shadow: 0 0 10px rgba(251, 191, 36, 0.3);"></i>
                    <span style="font-family: 'Rajdhani', sans-serif; font-size: 1.3rem; font-weight: 700; color: #ffffff; display: block; margin-bottom: 8px; letter-spacing: 1px;">VAULT SECURED</span>
                    <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 500;">Tournament Champions will be immortalized here forever.</span>
                </td>
            </tr>
        `;
    }

}


// ==========================================
// 🚨 ADMIN DATABASE SWEEPER
// ==========================================
const adminWipeBtn = document.getElementById('adminWipeAlertsBtn');

if (adminWipeBtn) {
    adminWipeBtn.addEventListener('click', async () => {
        // 1. Security Check: Ensure user is logged in
        if (!currentUser) {
            alert("You must be logged in to perform this action.");
            return;
        }

        // 2. Role Check: Use your app's built-in Admin Email system!
        const ADMIN_EMAIL = "efootballleague369@gmail.com";
        if (currentUser.email !== ADMIN_EMAIL) {
            alert("Access Denied: Only platform administrators can wipe the system database.");
            return;
        }

        // 3. Double Confirmation
        if (!confirm("⚠️ WARNING: This will delete ALL notifications across the entire app to save database limits. Are you sure?")) return;
        if (!confirm("Are you ABSOLUTELY sure? This action cannot be undone.")) return;

        console.log("🚨 Admin running global database wipe...");
        adminWipeBtn.innerText = "Wiping Database...";

        try {
            // 4. Fetch the entire dm_alerts collection
            const alertsRef = collection(db, "dm_alerts");
            const querySnapshot = await getDocs(alertsRef);

            if (querySnapshot.empty) {
                alert("The database is already clean! No notifications found.");
                adminWipeBtn.innerText = "🚨 Wipe All System Notifications";
                return;
            }

            // 5. Delete everything in one fast batch transaction
            const batch = writeBatch(db);
            querySnapshot.forEach((docSnap) => {
                batch.delete(docSnap.ref);
            });

            await batch.commit();
            alert(`💥 SUCCESS: System cleared! Removed ${querySnapshot.size} notifications from the database.`);
            
        } catch (error) {
            console.error("❌ Error running global wipe:", error);
            alert("Database wipe failed. Check the developer console.");
        } finally {
            // Reset button text
            adminWipeBtn.innerText = "🚨 Clear Notifications";
        }
    });
}




// ==========================================
// 📸 MATCH SCREENSHOTS LOGIC
// ==========================================

// 1. Listen for File Uploads
document.getElementById('screenshotUploadInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const statusText = document.getElementById('uploadScreenshotStatus');
    statusText.innerText = "⏳ Uploading image... please wait.";
    statusText.style.color = "var(--primary-yellow)";

    try {
        const formData = new FormData();
        formData.append("image", file);

        // 🔑 PUT YOUR IMGBB API KEY HERE
        const IMGBB_API_KEY = "b55eed30729b8ef545b033da8c46a9e9"; 
        
        // Upload directly to ImgBB
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            const imageUrl = data.data.url; 
            
            // Save link to your Firebase database
            await addDoc(collection(db, 'screenshots'), {
                url: imageUrl,
                uploaderName: currentUser?.displayName || currentUser?.firstName || (currentUser?.email ? currentUser.email.split('@')[0] : "Manager"),
                timestamp: new Date().toISOString()
            });
            
            statusText.innerText = "✅ Upload successful!";
            statusText.style.color = "#22c55e";
            e.target.value = ''; // Reset input
            
            setTimeout(() => { statusText.innerText = ''; }, 4000);
        } else {
            console.error("ImgBB rejected the upload:", data.error.message);
            throw new Error(`ImgBB Error: ${data.error.message}`);
        }
    } catch (error) {
        console.error("Upload error details:", error);
        statusText.innerText = "❌ Upload failed. Try again.";
        statusText.style.color = "#ef4444";
    }
});

// 2. Load and Display Screenshots
function listenToScreenshots() {
    const screenshotsRef = collection(db, 'screenshots');
    
    onSnapshot(screenshotsRef, (snapshot) => {
        const grid = document.getElementById('screenshotsGrid');
        if (!grid) return;
        
        const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL; 

        if (snapshot.empty) {
            grid.innerHTML = `<p style="color:#94a3b8; text-align:center; grid-column: 1 / -1;">No screenshots uploaded yet.</p>`;
            return;
        }

        grid.innerHTML = ''; // Clear grid

        // Sort by newest first
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
                                 .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        docs.forEach(data => {
            const dateStr = new Date(data.timestamp).toLocaleString(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
            
                        let html = `
            <div style="background:#0f172a; border-radius:8px; overflow:hidden; position:relative; border:1px solid #334155;">
                <div style="padding:8px; font-size:0.8rem; text-align:center; background:#1e293b;">
                    <span style="color:var(--primary-yellow); font-weight:bold;">${data.uploaderName}</span><br>
                    <span style="color:#94a3b8; font-size:0.7rem;">${dateStr}</span>
                </div>
                <!-- MISSING IMAGE TAG ADDED HERE -->
                <img src="${data.url}" alt="Screenshot" style="width:100%; height:150px; object-fit:cover; cursor:pointer;" onclick="openImageModal('${data.url}')">
            `;


            // Admin Delete Button
            if (isAdmin) {
                html += `
                <button onclick="deleteScreenshot('${data.id}')" style="position:absolute; top:5px; right:5px; background:#ef4444; color:white; border:none; border-radius:50%; width:30px; height:30px; cursor:pointer;">
                    <i class="fas fa-trash-alt"></i>
                </button>`;
            }

            html += `</div>`;
            grid.innerHTML += html;
        });
    });
};

// 3. Admin Delete Function
window.deleteScreenshot = async function(docId) {
    if (!confirm("🚨 Admin: Delete this screenshot?")) return;
    try {
        await deleteDoc(doc(db, 'screenshots', docId));
        alert("✅ Screenshot removed.");
    } catch (error) {
        console.error("Delete error:", error);
    }
};

// 📸 KEEP THIS: It handles clicking on screenshots to enlarge them
window.openImageModal = function(imageUrl) {
    // 1. Create the dark background overlay
    const overlay = document.createElement('div');
    overlay.id = 'screenshotModalOverlay';
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(15, 23, 42, 0.9)', // Matches your dark slate theme
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: '9999',
        cursor: 'zoom-out',
        backdropFilter: 'blur(4px)'
    });

    // 2. Create the expanded image
    const img = document.createElement('img');
    img.src = imageUrl;
    Object.assign(img.style, {
        maxWidth: '90%',
        maxHeight: '90vh',
        borderRadius: '8px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
        objectFit: 'contain'
    });

    // 3. Close the modal when the user clicks anywhere on it
    overlay.onclick = () => {
        document.body.removeChild(overlay);
    };

    // 4. Mount it to the screen
    overlay.appendChild(img);
    document.body.appendChild(overlay);
};

// 🛠️ REPLACE THIS: The new centered popup window logic (FIXED)
window.openInAppBrowser = function(url, title) {
    // Set the size of the popup window
    const w = 800;
    const h = 700;
    
    // Calculate the exact center of the screen
    const left = (window.screen.width / 2) - (w / 2);
    const top = (window.screen.height / 2) - (h / 2);
    
    // 🚨 FIX: Browsers break if the window name has spaces. 
    // This removes any spaces from the title (e.g., "Background Remover" -> "BackgroundRemover")
    const safeWindowName = title.replace(/\s+/g, '');
    
    // Open the window with strict parameters to force a popup
    window.open(
        url, 
        safeWindowName, 
        `width=${w},height=${h},top=${top},left=${left},toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes,resizable=yes`
    );
};

// 🧨 TEMPORARY TEST BUTTON LOGIC
window.testCelebration = function() {
    // Reset the lock so you can click it multiple times!
    window.hasFiredConfetti = false; 
    
    // Show banner and set a fake team name
    document.getElementById('winnerBanner').classList.remove('hidden');
    document.getElementById('winnerTeamName').textContent = "DREAM TEAM FC";
    
    // Fire the confetti globally
    window.firePremiumConfetti();
};

// ==========================================
// 🎆 PREMIUM UCL CHAMPIONSHIP FIREWORKS
// ==========================================
window.firePremiumConfetti = function() {
    // 🛑 Ensure it only fires ONCE per session to prevent spamming
    if (window.hasFiredConfetti) return;
    window.hasFiredConfetti = true;

    // 1. MASSIVE GOLDEN CENTER BURST
    confetti({
        particleCount: 150,
        spread: 120,
        origin: { y: 0.6 },
        colors: ['#facc15', '#bf953f', '#fcf6ba', '#ffffff'],
        zIndex: 9999
    });

    // 2. SUSTAINED 5-SECOND SIDE FIREWORKS
    const duration = 5 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };
    
    // Champions League Theme Colors
    const uclColors = ['#facc15', '#ffffff', '#1e3a8a', '#00d4ff', '#bf953f'];

    function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
            return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        
        // Fire from left side
        confetti(Object.assign({}, defaults, { 
            particleCount, 
            colors: uclColors,
            origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } 
        }));
        // Fire from right side
        confetti(Object.assign({}, defaults, { 
            particleCount, 
            colors: uclColors,
            origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } 
        }));
    }, 250);
};

window.zoomBadge = function(imageSrc, title) {
    document.getElementById("zoomedBadgeImg").src = imageSrc;
    document.getElementById("zoomedBadgeTitle").innerText = title;
    document.getElementById("badgeZoomModal").style.display = "flex";
};


// ==========================================
// 🃏 MANAGER PROFILE SYSTEM & HEAD-TO-HEAD
// ==========================================

window.flipManagerCard = function() {
    const card = document.getElementById("managerCardInner");
    if (card.style.transform === "rotateY(180deg)") {
        card.style.transform = "rotateY(0deg)"; // Flip to Front
    } else {
        card.style.transform = "rotateY(180deg)"; // Flip to Back
    }
};

window.openManagerCard = function(playerId) {
    // ALWAYS reset the card to the front face when opening!
    document.getElementById("managerCardInner").style.transform = "rotateY(0deg)";

    // 1. Fetch Data
    const activeData = (typeof playersData !== 'undefined' ? playersData : []).find(p => p.id === playerId);
    const legacyData = (typeof vaultData !== 'undefined' ? vaultData : []).find(v => v.id === playerId);

    // 2. Base Variables
    const name = activeData?.name || legacyData?.name || "Unknown Legend";
    const team = activeData?.teamName || activeData?.name || legacyData?.teamName || "Free Agent";
    const goals = activeData?.gf || activeData?.goals || 0;
    
    // 🏆 SMART CUP COUNTER: Take the highest number between their active profile and the permanent vault
    const activeCups = activeData?.cups || 0;
    const legacyCups = legacyData?.cups || 0;
    const cups = Math.max(activeCups, legacyCups);


        // 3. Smart Form & Playstyle Calculation
    let formText = "N/A", formColor = "#94a3b8", scoutReport = "Awaiting first match...";
    
    // Playstyle defaults
    let playstyleText = "Unknown Tactics";
    let playstyleIcon = "❓";
    let playstyleColor = "#94a3b8"; 

    if (activeData) {
        const wins = Number(activeData.w || activeData.won || 0);
        const draws = Number(activeData.d || activeData.drawn || 0);
        const losses = Number(activeData.l || activeData.lost || 0);
        const played = wins + draws + losses;
        const goalsScored = Number(activeData.gf || activeData.goals || 0);

        if (played > 0) {
            // Form % Calculation
            const formPercent = Math.round((((wins * 3) + (draws * 1)) / (played * 3)) * 100);
            formText = formPercent + "%";
            if (formPercent >= 70) { formColor = "#10b981"; scoutReport = "🔥 On fire and highly dangerous!"; } 
            else if (formPercent >= 40) { formColor = "#fbbf24"; scoutReport = "⚖️ Dropping some points, average form."; } 
            else { formColor = "#ef4444"; scoutReport = "❄️ On a massive losing streak and struggling."; }

            // 🎭 TACTICAL PLAYSTYLE LOGIC
            const goalsPerGame = goalsScored / played;
            const winRate = wins / played;
            const drawRate = draws / played;

            if (goalsPerGame >= 2.5) {
                playstyleText = "All-Out Attack";
                playstyleIcon = "⚔️";
                playstyleColor = "#ef4444"; // Aggressive Red
            } else if (drawRate >= 0.4 && goalsPerGame <= 1.5) {
                playstyleText = "Park the Bus";
                playstyleIcon = "🚌";
                playstyleColor = "#38bdf8"; // Defensive Blue
            } else if (winRate >= 0.6 && goalsPerGame >= 1.5) {
                playstyleText = "Gegenpressing";
                playstyleIcon = "🏃‍♂️💨";
                playstyleColor = "#10b981"; // High Energy Green
            } else if (goalsPerGame <= 1.0 && losses > wins) {
                playstyleText = "Tactical Mess";
                playstyleIcon = "📉";
                playstyleColor = "#94a3b8"; // Struggling Grey
            } else if (winRate >= 0.5) {
                playstyleText = "Pragmatic";
                playstyleIcon = "🧠";
                playstyleColor = "#fbbf24"; // Smart Yellow
            } else {
                playstyleText = "Counter-Attack";
                playstyleIcon = "⚡";
                playstyleColor = "#a855f7"; // Fast Purple
            }
        } else {
            playstyleText = "Pre-Season";
            playstyleIcon = "🛠️";
        }
    }

    
    // 🌟 NEW: CALCULATE THE LAST 5 MATCHES FOR THE COLORED CIRCLES
    let recentFormHTML = "";
    // Filter for completed matches involving this team
    const teamMatches = (typeof matchesData !== 'undefined' ? matchesData : [])
        .filter(m => m.status === 'completed' && (m.teamA === team || m.teamB === team));
    
    // Grab only the last 5 matches played
    const last5Matches = teamMatches.slice(-5);

    if (last5Matches.length === 0) {
        recentFormHTML = `<span style="color: #64748b; font-size: 0.8rem; font-style: italic;">No matches yet</span>`;
    } else {
        last5Matches.forEach(m => {
            let resultChar = "";
            let bgColor = "";
            
            // Check if this manager was Team A or Team B
            const isTeamA = m.teamA === team;
            const myScore = isTeamA ? m.scoreA : m.scoreB;
            const theirScore = isTeamA ? m.scoreB : m.scoreA;

            if (myScore > theirScore) {
                resultChar = "W";
                bgColor = "#10b981"; // Green
            } else if (myScore === theirScore) {
                resultChar = "D";
                bgColor = "#fbbf24"; // Yellow
            } else {
                resultChar = "L";
                bgColor = "#ef4444"; // Red
            }

            // Create the individual colored circle
            recentFormHTML += `<div style="width: 24px; height: 24px; border-radius: 50%; background: ${bgColor}; color: #fff; font-size: 0.75rem; font-weight: bold; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3));">${resultChar}</div>`;
        });
    }

    // 4. Inject Front Details
    document.getElementById("modalManagerName").innerText = name;
    document.getElementById("modalManagerTeam").innerHTML = `Currently managing: <span style="color:#fff; font-weight:bold;">${team}</span>`;
    
    // 🌟 INJECT PLAYSTYLE BADGE (Previous step)
    const badge = document.getElementById("modalManagerPlaystyle");
    badge.innerHTML = `${playstyleIcon} ${playstyleText}`;
    badge.style.color = playstyleColor;
    badge.style.borderColor = playstyleColor;
    badge.style.background = `${playstyleColor}33`; 
    
    console.log("Checking Manager Data for:", name, activeData, legacyData);


            // 🏆 NEW: INJECT TROPHY SHELF (Dynamic Fetch from Users Collection)
    const shelfContainer = document.getElementById("modalManagerBadges");
    
    // 1. Show a quick loading state while we fetch the badges
    shelfContainer.innerHTML = `<span style="color: #64748b; font-size: 0.8rem; font-style: italic;">Loading honours... <i class="fas fa-spinner fa-spin"></i></span>`;

    // 2. Grab the manager's global User ID (uid)
    const managerUid = activeData?.userId || legacyData?.userId;

        if (managerUid) {
        // 3. Reach into their specific "badges" sub-collection
        getDocs(collection(db, "users", managerUid, "badges")).then(snapshot => {
            
            // 🛑 THE FILTER: Only allow these exact 4 badge IDs to show on the card
            const masterBadgeIds = ['ucl_winner', 'ballon_dor', 'golden_boot', 'clean_sheet'];
            
            let badgesHTML = "";
            
            // 4. Loop through every badge they own
            snapshot.forEach(docSnap => {
                const badgeId = docSnap.id; // e.g., 'golden_boot'
                const badgeData = docSnap.data(); 
                
                // Only build the HTML if the badgeId is in our master list!
                if (masterBadgeIds.includes(badgeId)) {
                    badgesHTML += `<img src="${badgeData.icon}" 
                                        alt="${badgeData.name}" 
                                        onclick="window.zoomBadge('${badgeData.icon}', '${badgeData.name}')" 
                                        style="width: 40px; height: 40px; object-fit: contain; cursor: zoom-in; filter: drop-shadow(0 6px 8px rgba(0,0,0,0.5)); transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);" 
                                        onmouseover="this.style.transform='scale(1.3) translateY(-3px)'" 
                                        onmouseout="this.style.transform='scale(1) translateY(0)'" 
                                        title="${badgeData.name}">`;
                }
            });
            
            // 5. Inject the badges, or show the fallback if they didn't have any master badges
            if (badgesHTML === "") {
                shelfContainer.innerHTML = `<span style="color: #64748b; font-size: 0.8rem; font-style: italic; border: 1px dashed rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 12px;">No major honours yet</span>`;
            } else {
                shelfContainer.innerHTML = badgesHTML;
            }
            
        }).catch(err => {
            console.error("Error fetching badges:", err);
            shelfContainer.innerHTML = `<span style="color: #ef4444; font-size: 0.8rem;">Failed to load honours</span>`;
        });
    } else {
        shelfContainer.innerHTML = `<span style="color: #64748b; font-size: 0.8rem; font-style: italic; border: 1px dashed rgba(255,255,255,0.1); padding: 4px 12px; border-radius: 12px;">No major honours yet</span>`;
    }




    
    document.getElementById("modalManagerCups").innerText = cups;
    document.getElementById("modalManagerGoals").innerText = goals;
    document.getElementById("modalManagerForm").innerText = formText;
    document.getElementById("modalManagerForm").style.color = formColor;
    document.getElementById("modalManagerStatus").innerText = scoutReport;
    document.getElementById("modalManagerStatus").style.color = formColor;
    
    // Inject the Form Circles!
    document.getElementById("modalManagerRecentForm").innerHTML = recentFormHTML;

       // ----------------------------------------------------
    // ⚔️ 5. CALCULATE HEAD-TO-HEAD (MATCH HISTORY LOG)
    // ----------------------------------------------------
    const h2hContainer = document.getElementById("h2hStatsContainer");
    
    // Change container styling to allow a scrolling list instead of centered numbers
    h2hContainer.style.display = "block";
    h2hContainer.style.overflowY = "auto";
    h2hContainer.style.maxHeight = "220px"; // Keeps it inside the card perfectly

    const myData = currentUser ? (typeof playersData !== 'undefined' ? playersData : []).find(p => p.userId === currentUser.uid || p.userId === currentUser.id) : null;

    if (!currentUser) {
        h2hContainer.innerHTML = `<div style="color: #ef4444; font-size: 1.1rem; text-align: center; margin-top: 50px;">You must be logged in to view H2H stats!</div>`;
    } else if (!myData) {
        h2hContainer.innerHTML = `<div style="color: #fbbf24; font-size: 1.1rem; text-align: center; margin-top: 50px;">You must join the active league to view Head-to-Head stats!</div>`;
    } else if (myData.id === playerId) {
        h2hContainer.innerHTML = `<div style="color: #94a3b8; font-size: 1.2rem; font-style: italic; text-align: center; margin-top: 50px;">You can't have a rivalry with yourself! 🤷‍♂️</div>`;
    } else {
        const myTeamName = myData.teamName || myData.name;
        const theirTeamName = team; 
        
        let matchHistoryHTML = "";
        let h2hWins = 0, h2hDraws = 0, h2hLosses = 0;

        // 1. Filter out only the matches where YOU played against THEM
        const h2hMatches = (typeof matchesData !== 'undefined' ? matchesData : []).filter(m => 
            m.status === 'completed' && 
            ((m.teamA === myTeamName && m.teamB === theirTeamName) || 
             (m.teamB === myTeamName && m.teamA === theirTeamName))
        );

        // 2. Build the visual list of matches
        if (h2hMatches.length === 0) {
            matchHistoryHTML = `<div style="color: #94a3b8; font-size: 0.95rem; font-style: italic; text-align: center; margin-top: 40px; padding: 20px; background: rgba(0,0,0,0.2); border-radius: 12px;">No matches played against this manager yet!</div>`;
        } else {
            h2hMatches.forEach(m => {
                const isMeA = m.teamA === myTeamName;
                const myScore = isMeA ? m.scoreA : m.scoreB;
                const theirScore = isMeA ? m.scoreB : m.scoreA;
                
                let resultChar = "D";
                let resultColor = "#fbbf24"; // Yellow
                
                if (myScore > theirScore) {
                    resultChar = "W";
                    resultColor = "#10b981"; // Green
                    h2hWins++;
                } else if (myScore < theirScore) {
                    resultChar = "L";
                    resultColor = "#ef4444"; // Red
                    h2hLosses++;
                } else {
                    h2hDraws++;
                }

                // Injecting the gorgeous match log card
                matchHistoryHTML += `
                    <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 10px; margin-bottom: 8px; border-left: 5px solid ${resultColor};">
                        <div style="font-weight: 900; font-size: 1.2rem; color: ${resultColor}; width: 25px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${resultChar}</div>
                        
                        <div style="flex-grow: 1; text-align: center; font-size: 0.85rem; color: #e2e8f0; font-weight: bold; text-transform: uppercase;">
                            ${m.teamA.substring(0,10)} <span style="color:#64748b; font-size:0.7rem; margin:0 4px; font-weight: normal;">VS</span> ${m.teamB.substring(0,10)}
                        </div>
                        
                        <div style="font-weight: 900; font-size: 1.1rem; color: #fff; background: rgba(255,255,255,0.1); padding: 4px 10px; border-radius: 6px; letter-spacing: 2px;">
                            ${m.scoreA}:${m.scoreB}
                        </div>
                    </div>
                `;
            });
        }

        // 3. Inject the Summary AND the Match History Log
        h2hContainer.innerHTML = `
            <div style="display: flex; gap: 15px; justify-content: center; margin-bottom: 12px; font-size: 0.85rem; font-weight: bold; background: rgba(0,0,0,0.2); padding: 5px; border-radius: 20px;">
                <span style="color: #10b981;">${h2hWins} WINS</span>
                <span style="color: #fbbf24;">${h2hDraws} DRAWS</span>
                <span style="color: #ef4444;">${h2hLosses} LOSSES</span>
            </div>
            ${matchHistoryHTML}
        `;
    }

    // ----------------------------------------------------
    // 📢 SEND "PROFILE VIEW" ALERT TO THE MANAGER
    // ----------------------------------------------------
    if (managerUid && currentUser && managerUid !== currentUser.uid) {
        addDoc(collection(db, "dm_alerts"), {
            receiverId: managerUid, 
            message: `${userProfileData?.firstName || 'A manager'} is viewing your profile!`,
            timestamp: Date.now(),
            status: "unread",
            type: "scout" // 👈 ADDED THIS
        }).catch(err => console.error("🚨 Failed to send scout alert:", err));
    }



    // 7. Show Modal
    document.getElementById("managerProfileModal").style.display = "flex";
};




// ==========================================
// 🍞 LIVE ACTIVITY TOAST SYSTEM
// ==========================================

window.showActivityToast = function(icon, message, color = "#38bdf8") {
    const container = document.getElementById("toastContainer");
    
    // Create the toast element
    const toast = document.createElement("div");
    toast.style.background = "rgba(15, 23, 42, 0.85)";
    toast.style.backdropFilter = "blur(10px)";
    toast.style.border = `1px solid ${color}`;
    toast.style.color = "#fff";
    toast.style.padding = "10px 20px";
    toast.style.borderRadius = "30px";
    toast.style.fontFamily = "'Rajdhani', sans-serif";
    toast.style.fontSize = "0.95rem";
    toast.style.fontWeight = "bold";
    toast.style.boxShadow = `0 10px 25px rgba(0,0,0,0.5), 0 0 15px ${color}40`;
    toast.style.display = "flex";
    toast.style.alignItems = "center";
    toast.style.gap = "10px";
    toast.style.opacity = "0";
    toast.style.transform = "translateY(20px)";
    toast.style.transition = "all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
    
    toast.innerHTML = `<span style="font-size: 1.2rem;">${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    // Trigger slide-in animation
    setTimeout(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";
    }, 50);
    
    // Trigger fade-out and remove
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(-20px)";
        setTimeout(() => toast.remove(), 400); // Wait for transition to finish
    }, 4000);
};

// ==========================================
// 🔔 SIDEBAR ACTIVITY FEED SYSTEM
// ==========================================
// Click a notification to mark it as read
window.markSingleRead = function(notiId) {
    // Upgraded to ensure it marks both properties as read to prevent glitches
    updateDoc(doc(db, "dm_alerts", notiId), { status: "read", read: true })
        .catch(err => console.error("Error marking read:", err));
};

// ==========================================
// 🎧 CLEAN SIDEBAR LISTENER
// ==========================================
window.startNotificationHistory = function() {
    if (!currentUser) {
        console.log("🚨 SIDEBAR: No user logged in yet.");
        return;
    }
    
    // Force the ID to perfectly match what the sender uses
    const myUid = String(currentUser.uid).trim();
    console.log(`🎧 SIDEBAR: Listening for alerts for UID: ${myUid}`);
    
    // Inside startNotificationHistory()
const notiQuery = query(
    collection(db, "dm_alerts"),
    where("receiverId", "in", [myUid, "all"]), // <-- Update this line!
    // orderBy("timestamp", "desc"),
    limit(20)
);
    
    onSnapshot(notiQuery, (snapshot) => {
        const notiList = document.getElementById('sidebarNotiList');
        const badge = document.getElementById('sidebarNotiBadge');
        
        if (!notiList) return;
        
        notiList.innerHTML = '';
        let unreadCount = 0;
        
        if (snapshot.empty) {
            notiList.innerHTML = `<div style="padding:15px; text-align:center; color:#64748b; font-size:0.85rem;">No recent notifications</div>`;
            if (badge) badge.style.display = 'none';
            return;
        }
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const notiId = docSnap.id;
            
            if (data.status === "unread") unreadCount++;
            
            // Safely handle Firestore Timestamp objects vs standard dates
            const timeObj = data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp);
            const timeString = timeObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            const bgColor = data.status === "unread" ? "rgba(56, 189, 248, 0.15)" : "transparent";
            const fontWeight = data.status === "unread" ? "bold" : "normal";
            
            // Inside startNotificationHistory() snapshot.forEach loop...
notiList.innerHTML += `
    <div onclick="markSingleRead('${notiId}')" style="padding: 12px; margin-bottom: 6px; cursor: pointer; background: ${bgColor}; border-radius: 8px; display: flex; gap: 10px;">
        <div style="font-size: 1.2rem;">
            ${data.title && data.title.includes('⚽') ? '⚽' : (data.type === 'dm' ? '📩' : '🔔')}
        </div>
        <div style="flex-grow: 1;">
            <div style="font-size: 0.85rem; font-weight: ${fontWeight}; color: #e2e8f0;">
                ${data.message || data.text || 'New direct message received, check notification.'} 
            </div>
            <div style="font-size: 0.7rem; color: #64748b; margin-top: 4px;">${timeString}</div>
        </div>
        ${data.status === "unread" ? '<div style="width: 8px; height: 8px; background: #38bdf8; border-radius: 50%; margin-top: 5px;"></div>' : ''}
    </div>
`;

        });
        
        if (badge) {
            if (unreadCount > 0) {
                badge.innerText = unreadCount;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }, (error) => {
        console.error("❌ SIDEBAR LISTENER ERROR:", error);
    });
};

// ==========================================
// ✅ BATCH UPDATE: MARK ALL READ
// ==========================================
window.markAllNotificationsRead = async function() {
    if (!currentUser) return;
    
    try {
        // Inside markAllNotificationsRead()
const unreadQuery = query(
    collection(db, "dm_alerts"),
    where("receiverId", "in", [currentUser.uid, "all"]), // <-- Update this line!
    where("status", "==", "unread")
);
        
        const snapshot = await getDocs(unreadQuery);
        if (snapshot.empty) return; // Nothing to update
        
        // Use a batch to update all documents in a single network request
        const batch = writeBatch(db);
        
        snapshot.forEach((docSnap) => {
            const docRef = doc(db, "dm_alerts", docSnap.id);
            batch.update(docRef, { status: "read" });
        });
        
        await batch.commit();
        console.log("✅ All notifications marked as read via batch.");
        
    } catch (error) {
        console.error("🚨 Error marking all as read:", error);
    }
};

// ==========================================
// ⚽ CLEAN NOTIFICATION DISPATCHER
// ==========================================
window.sendMatchAlerts = async function(matchList) {
    if (!matchList || matchList.length === 0) return;
    
    try {
        const batch = writeBatch(db);
        let alertsSent = 0;
        
        matchList.forEach(match => {
            // 1. Clean team names
            const tA = String(match.teamA).toLowerCase().trim();
            const tB = String(match.teamB).toLowerCase().trim();
            
            // 2. Map teams to player profiles
            const playerA = typeof playersData !== 'undefined' ? playersData.find(p => String(p.teamName).toLowerCase().trim() === tA) : null;
            const playerB = typeof playersData !== 'undefined' ? playersData.find(p => String(p.teamName).toLowerCase().trim() === tB) : null;
            
            // 3. Extract user IDs
            const uidA = playerA ? (playerA.uid || playerA.userId || playerA.id) : null;
            const uidB = playerB ? (playerB.uid || playerB.userId || playerB.id) : null;
            
            // 4. Trigger background push webhook via Val Town
            if (match.matchId) {
                fetch("https://eLEAGUE--cb9fd17a8c0a11f1854b1607ee4eb77e.web.val.run", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            matchId: match.matchId,
                            uids: [uidA, uidB].filter(Boolean)
                        })
                    })
                    .then(res => console.log(`Val Town webhook triggered for match: ${match.matchId}`))
                    .catch(err => console.error("Val Town webhook failed:", err));
            }
            
            // 5. Create in-app DM Alert for Team A
            if (uidA) {
                const ref = doc(collection(db, "dm_alerts"));
                batch.set(ref, {
                    receiverId: String(uidA).trim(),
                    title: "⚽ New Match!",
                    message: `You have a new match: vs ${match.teamB}`,
                    timestamp: Date.now(),
                    status: "unread",
                    type: "alert"
                });
                alertsSent++;
            }
            
            // 6. Create in-app DM Alert for Team B
            if (uidB) {
                const ref = doc(collection(db, "dm_alerts"));
                batch.set(ref, {
                    receiverId: String(uidB).trim(),
                    title: "⚽ New Match!",
                    message: `You have a new match: vs ${match.teamA}`,
                    timestamp: Date.now(),
                    status: "unread",
                    type: "alert"
                });
                alertsSent++;
            }
        });
        
        if (alertsSent > 0) {
            await batch.commit();
            console.log(`✅ SUCCESS: Fired ${alertsSent} in-app alerts to Firestore!`);
        }
    } catch (error) {
        console.error("❌ ERROR SENDING ALERTS:", error);
    }
};


// ==========================================
// 🔔 NOTIFICATION PERMISSION BUTTON BINDING
// ==========================================
const notifBtn = document.getElementById('enableNotifsBtn');

if (notifBtn) {
    notifBtn.onclick = async () => {
        // 1. Verify the user is logged in
        const uid = currentUser?.uid || currentUser?.id;
        
        if (!uid) {
            return typeof notify === 'function' ? notify("Please log in first!") : alert("Please log in first!");
        }

        // 2. Disable button while processing
        notifBtn.disabled = true;
        notifBtn.innerText = "⌛ Requesting Permission...";

        try {
            // 3. Call your push notification helper
            await enablePushNotifications(uid);
        } catch (err) {
            console.error("Failed to enable notifications:", err);
        } finally {
            // 4. Restore button text
            notifBtn.disabled = false;
            notifBtn.innerText = "🔔 Enable Push Notifications";
        }
    };
}



// ==========================================
// 📋 PREMIUM TACTICS BOARD (IMGBB + FIRESTORE)
// ==========================================

const IMGBB_API_KEY = "b55eed30729b8ef545b033da8c46a9e9";

// 1. Open the Full-Screen Board
document.getElementById('btnOpenTactics').addEventListener('click', () => {
    document.getElementById('premiumTacticsBoard').style.display = 'block';
});

// 2. Open Lightbox (Zoom Image)
window.openLightbox = function(imageUrl) {
    document.getElementById('lightboxImg').src = imageUrl;
    document.getElementById('tacticLightbox').style.display = 'flex';
};

// 3. Admin Post Logic
const postTacticBtn = document.getElementById('postTacticBtn');
if (postTacticBtn) {
    postTacticBtn.addEventListener('click', async () => {
        const text = document.getElementById('tacticText').value.trim();
        const fileInput = document.getElementById('tacticImageInput');
        
        if (!text || fileInput.files.length === 0) return alert("Text and Image are required!");
        
        postTacticBtn.innerText = "Uploading...";
        postTacticBtn.disabled = true;
        
        try {
            const formData = new FormData();
            formData.append("image", fileInput.files[0]);
            
            const imgRes = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
                method: "POST",
                body: formData
            });
            const imgData = await imgRes.json();
            const imageUrl = imgData.data.url;
            
            await addDoc(collection(db, "tactics"), {
                text: text,
                imageUrl: imageUrl,
                timestamp: Date.now(),
                likes: [],
                helpful: [],
                comments: []
            });
            
            document.getElementById('tacticText').value = '';
            fileInput.value = '';
            
        } catch (error) {
            console.error("Error posting tactic:", error);
            alert("Upload failed.");
        } finally {
            postTacticBtn.innerText = "Publish Tactic";
            postTacticBtn.disabled = false;
        }
    });
}



// 4. Live Feed Renderer
window.listenToTactics = function() {
    // 1. Manually turn on the loader before fetching
    NetworkManager.showLoader("LOADING TACTICS...");

    // 🛑 Clear any existing listener so they don't duplicate
    if (tacticsUnsubscribe) {
        tacticsUnsubscribe();
    }

    // 🔄 Add limit() to only pull the specific batch size
    const q = query(
        collection(db, "tactics"), 
        orderBy("timestamp", "desc"),
        limit(currentTacticsLimit)
    );
    
    tacticsUnsubscribe = onSnapshot(q, (snapshot) => {
        const feed = document.getElementById('premiumTacticsFeed');
        if (!feed) return;
        feed.innerHTML = '';
        
        // 2. Hide the loader the moment the data arrives!
        NetworkManager.hideLoader();
        
        if (snapshot.empty) {
            feed.innerHTML = '<div style="color: #64748b; text-align: center; padding: 40px;">No tactics posted yet.</div>';
            return;
        }
        
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const tacticId = docSnap.id;
            
            // 🛡️ SAFETY CHECKS: Prevents crashes if arrays are missing
            const likesArr = data.likes || [];
            const helpfulArr = data.helpful || [];
            const commentsArr = data.comments || [];
            
            const hasLiked = currentUser && likesArr.includes(currentUser.uid);
            const hasHelpful = currentUser && helpfulArr.includes(currentUser.uid);
            
            // 👑 ADMIN CHECK: Is the logged-in user the Admin?
            const isUserAdmin = currentUser && currentUser.email === ADMIN_EMAIL;

            // 🗑️ DELETE BUTTON (Only generated for the Admin)
            const deleteBtnHtml = isUserAdmin ? `
                <button onclick="deleteTactic('${tacticId}')" style="position: absolute; top: 15px; right: 15px; background: rgba(220, 38, 38, 0.85); color: white; border: 1px solid rgba(255,255,255,0.2); padding: 8px 12px; border-radius: 8px; cursor: pointer; font-size: 0.85rem; font-weight: bold; z-index: 10; backdrop-filter: blur(4px); transition: background 0.2s;" onmouseover="this.style.background='rgba(220, 38, 38, 1)'" onmouseout="this.style.background='rgba(220, 38, 38, 0.85)'">
                    🗑️ Delete
                </button>
            ` : '';
            
                        // Format Comments & Tags
            let commentsHtml = '';
            commentsArr.forEach(c => {
                
                // 🎨 SMART TAG RENDERER
                const formattedText = c.text.replace(/@(\w+)/g, (match, name) => {
                    if (name.toLowerCase() === 'all') {
                        // 🏆 BOLD GOLD STYLING FOR @ALL
                        return `<span style="color: #fbbf24; font-weight: bold; background: rgba(251, 191, 36, 0.15); border: 1px solid rgba(251, 191, 36, 0.3); padding: 0 6px; border-radius: 4px; letter-spacing: 0.5px;">@${name}</span>`;
                    } else {
                        // 👤 STANDARD BLUE STYLING FOR USERS
                        return `<span style="color:#38bdf8; font-weight:bold; background: rgba(56, 189, 248, 0.1); padding: 0 4px; border-radius: 4px;">@${name}</span>`;
                    }
                });

                commentsHtml += `
                    <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <strong style="color: #e2e8f0; font-size: 0.9rem;">${c.name}</strong> 
                        <div style="color: #94a3b8; font-size: 0.9rem; margin-top: 4px; line-height: 1.4;">${formattedText}</div>
                    </div>`;
            });

            
            feed.innerHTML += `
                <div style="background: #111827; border: 1px solid #1e293b; border-radius: 20px; margin-bottom: 35px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); position: relative;">
                    
                    <!-- INJECT THE DELETE BUTTON HERE -->
                    ${deleteBtnHtml}

                    <!-- Clickable Image -->
                    <div style="position: relative; cursor: zoom-in;" onclick="openLightbox('${data.imageUrl}')">
                        <img src="${data.imageUrl}" style="width: 100%; max-height: 450px; object-fit: cover; border-bottom: 1px solid #1e293b; transition: opacity 0.3s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                        <div style="position: absolute; bottom: 15px; right: 15px; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); color: white; padding: 6px 12px; border-radius: 50px; font-size: 0.8rem; border: 1px solid rgba(255,255,255,0.2);">
                            🔍 Click to expand
                        </div>
                    </div>
                    
                    <div style="padding: 25px;">
                        <!-- Text -->
                        <p style="color: #cbd5e1; font-size: 1.05rem; line-height: 1.7; margin-top: 0; margin-bottom: 25px; white-space: pre-wrap;">${data.text}</p>
                        
                        <!-- Interactive Counters -->
                        <div style="display: flex; gap: 12px; border-bottom: 1px solid #1e293b; padding-bottom: 20px; margin-bottom: 20px;">
                            <button onclick="toggleTacticAction('${tacticId}', 'likes', ${hasLiked})" style="flex: 1; background: ${hasLiked ? 'rgba(239, 68, 68, 0.15)' : '#1e293b'}; color: ${hasLiked ? '#ef4444' : '#cbd5e1'}; border: 1px solid ${hasLiked ? 'rgba(239,68,68,0.3)' : '#334155'}; padding: 12px; border-radius: 12px; cursor: pointer; font-size: 0.95rem; font-weight: bold; transition: all 0.2s;">
                                ${hasLiked ? '❤️ Liked' : '🤍 Like'} <span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 20px; margin-left: 5px;">${likesArr.length}</span>
                            </button>
                            
                            <button onclick="toggleTacticAction('${tacticId}', 'helpful', ${hasHelpful})" style="flex: 1; background: ${hasHelpful ? 'rgba(16, 185, 129, 0.15)' : '#1e293b'}; color: ${hasHelpful ? '#10b981' : '#cbd5e1'}; border: 1px solid ${hasHelpful ? 'rgba(16,185,129,0.3)' : '#334155'}; padding: 12px; border-radius: 12px; cursor: pointer; font-size: 0.95rem; font-weight: bold; transition: all 0.2s;">
                                ${hasHelpful ? '💡 Helpful' : '💡 Found Helpful?'} <span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 20px; margin-left: 5px;">${helpfulArr.length}</span>
                            </button>
                        </div>

                        <!-- Comments -->
                        <div>
                            <h4 style="color: #94a3b8; font-family: 'Rajdhani', sans-serif; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 15px;">Discussion</h4>
                            <div style="max-height: 250px; overflow-y: auto; margin-bottom: 15px; padding-right: 10px;">
                                ${commentsHtml || '<div style="color: #475569; font-size: 0.9rem; font-style: italic; text-align: center; padding: 20px 0;">No discussion yet. Start the debate!</div>'}
                            </div>
                            
                           <!-- Replace your existing comment input block with this: -->
<div style="position: relative;">
    <div style="display: flex; gap: 10px; background: #1e293b; padding: 6px; border-radius: 50px; border: 1px solid #334155;">
        <!-- Added oninput event to track keystrokes -->
        <input type="text" id="commentInput_${tacticId}" oninput="handleMentionInput(this, '${tacticId}')" autocomplete="off" placeholder="Add a comment... use @name to tag" style="flex-grow: 1; background: transparent; color: white; border: none; padding: 10px 20px; font-size: 0.95rem; outline: none;">
        <button onclick="addTacticComment('${tacticId}')" style="background: #38bdf8; color: #020617; border: none; padding: 10px 25px; border-radius: 50px; cursor: pointer; font-weight: bold;">Post</button>
    </div>
    
    <!-- THE AUTOCOMPLETE PANEL (Pops up above the input) -->
    <div id="mentionPanel_${tacticId}" style="display: none; position: absolute; bottom: 100%; left: 10px; margin-bottom: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 12px; width: 250px; max-height: 180px; overflow-y: auto; z-index: 50; box-shadow: 0 -5px 20px rgba(0,0,0,0.6);">
        <!-- Options injected here via JS -->
    </div>
</div>

                    </div>
                </div>
            `;
        });

        // 🔄 APPEND "LOAD MORE" BUTTON
        // If the number of documents matches our limit, there are probably more in the database to load
        if (snapshot.docs.length === currentTacticsLimit) {
            feed.innerHTML += `
                <div style="text-align: center; margin-top: 20px; margin-bottom: 40px;">
                    <button onclick="loadMoreTactics()" style="background: rgba(56, 189, 248, 0.1); border: 1px solid #38bdf8; color: #38bdf8; padding: 12px 30px; border-radius: 50px; cursor: pointer; font-family: 'Rajdhani', sans-serif; font-size: 1rem; font-weight: bold; transition: all 0.3s;" onmouseover="this.style.background='#38bdf8'; this.style.color='#0f172a'" onmouseout="this.style.background='rgba(56, 189, 248, 0.1)'; this.style.color='#38bdf8'">
                        🔄 Load Older Tactics
                    </button>
                </div>
            `;
        }
    });
};

// ==========================================
// 🔄 LOAD MORE TACTICS LOGIC
// ==========================================
window.loadMoreTactics = function() {
    currentTacticsLimit += 5; // Increase the batch size by 5
    window.listenToTactics(); // Re-run the listener to fetch the new older posts
};


// 5. Counters Logic (Real-Time)
window.toggleTacticAction = async function(tacticId, field, hasInteracted) {
    if (!currentUser) return;
    const tacticRef = doc(db, "tactics", tacticId);
    await updateDoc(tacticRef, {
        [field]: hasInteracted ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid)
    });
};

// ==========================================
// 💬 POST COMMENT (UPGRADED FOR @ALL)
// ==========================================
window.addTacticComment = function(tacticId) {
    const inputField = document.getElementById(`commentInput_${tacticId}`);
    const text = inputField.value.trim();
    
    if (!currentUser || !text) return;

    NetworkManager.loadWithNetworkCheck(async () => {
        const tacticRef = doc(db, "tactics", tacticId);
        
        // 1. Save comment to the UI
        await updateDoc(tacticRef, {
            comments: arrayUnion({
                uid: currentUser.uid,
                name: userProfileData?.firstName || "Manager",
                text: text,
                timestamp: Date.now()
            })
        });
        
        // 2. 🔍 MENTION SCANNER (Using Cache + Batching)
        const mentionedNames = text.match(/@(\w+)/g); 
        
        if (mentionedNames) {
            const hasAll = mentionedNames.includes('@all');
            let receiversToNotify = new Set();
            
            if (hasAll) {
                // If @all is used, add EVERY user (except the sender)
                window.cachedLeagueUsers.forEach(u => {
                    if (u.id !== currentUser.uid) receiversToNotify.add(u.id);
                });
            } else {
                // Otherwise, look for specific names in the cache
                for (let tag of mentionedNames) {
                    let cleanName = tag.replace('@', ''); 
                    const foundUser = window.cachedLeagueUsers.find(u => u.name === cleanName);
                    if (foundUser && foundUser.id !== currentUser.uid) {
                        receiversToNotify.add(foundUser.id);
                    }
                }
            }
            
            // 3. Batch write all notifications at once (Max limit is 500, so we are safe)
            if (receiversToNotify.size > 0) {
                const batch = writeBatch(db);
                receiversToNotify.forEach(id => {
                    const newAlertRef = doc(collection(db, "dm_alerts"));
                    batch.set(newAlertRef, {
                        receiverId: id,
                        senderName: userProfileData?.firstName || "Manager",
                        message: hasAll ? `tagged @all in a tactic comment: "${text.substring(0, 30)}..."` : `tagged you in a tactic comment: "${text.substring(0, 30)}..."`,
                        tacticId: tacticId,
                        timestamp: Date.now(),
                        read: false,
                        type: 'mention'
                    });
                });
                await batch.commit();
            }
        }
        
        inputField.value = '';
        document.getElementById(`mentionPanel_${tacticId}`).style.display = 'none';
        NetworkManager.showToast("Comment posted!", "success");
        
    }, 8000); 
};



// ==========================================
// 7. DELETE TACTIC FUNCTION
// ==========================================
window.deleteTactic = async function(tacticId) {
    const confirmDelete = confirm("Are you sure you want to permanently delete this tactic?");
    if (!confirmDelete) return;

    try {
        await deleteDoc(doc(db, "tactics", tacticId));
    } catch (error) {
        console.error("Error deleting tactic:", error);
        alert("Failed to delete tactic.");
    }
};

// Auto-start listener on login
onAuthStateChanged(auth, async (user) => {
    if (user) window.listenToTactics();
});

// ==========================================
// 🌐 PREMIUM NETWORK & LOADING MANAGER
// ==========================================

const NetworkManager = {
    loaderEl: document.getElementById('premiumLoader'),
    toastEl: document.getElementById('networkToast'),
    msgEl: document.getElementById('networkToastMessage'),
    iconEl: document.getElementById('networkToastIcon'),
    
    showLoader(text = "LOADING DATA...") {
        document.getElementById('loaderText').innerText = text;
        this.loaderEl.style.display = 'flex';
    },

    hideLoader() {
        this.loaderEl.style.display = 'none';
    },

    showToast(message, type = 'warning') {
        this.msgEl.innerText = message;
        
        if (type === 'error') {
            this.toastEl.style.border = '1px solid #dc2626'; // Red
            this.toastEl.style.color = '#f87171';
            this.iconEl.innerText = '❌';
        } else if (type === 'success') {
            this.toastEl.style.border = '1px solid #10b981'; // Green
            this.toastEl.style.color = '#34d399';
            this.iconEl.innerText = '✅';
        } else {
            this.toastEl.style.border = '1px solid #f59e0b'; // Orange
            this.toastEl.style.color = '#fbbf24';
            this.iconEl.innerText = '⚠️';
        }

        // Slide up
        this.toastEl.style.bottom = '30px';
        
        // Auto hide after 5 seconds
        setTimeout(() => {
            this.toastEl.style.bottom = '-100px';
        }, 5000);
    },

    // 🧠 The Smart Network Checker
    async loadWithNetworkCheck(loadFunction, timeoutMs = 10000) {
        // 1. Check if completely offline first
        if (!navigator.onLine) {
            this.showToast("You are offline. Please check your internet connection.", "error");
            return;
        }

        // 2. Check for slow network using Network Information API (Android/Chrome)
        if (navigator.connection) {
            const effectiveType = navigator.connection.effectiveType; // '4g', '3g', '2g', 'slow-2g'
            if (effectiveType === '2g' || effectiveType === 'slow-2g') {
                this.showToast("Slow network detected. Loading might take a moment.", "warning");
            }
        }

        this.showLoader();

        // 3. Setup a timeout to catch hanging requests (Safari fallback)
        let isResolved = false;
        const slowLoadTimer = setTimeout(() => {
            if (!isResolved) {
                this.showToast("This is taking longer than usual. Your connection might be unstable.", "warning");
            }
        }, timeoutMs);

        // 4. Execute the actual Firebase/Loading function
        try {
            await loadFunction();
            isResolved = true;
            clearTimeout(slowLoadTimer);
            this.hideLoader();
        } catch (error) {
            isResolved = true;
            clearTimeout(slowLoadTimer);
            this.hideLoader();
            this.showToast("Failed to load data. Network error.", "error");
            console.error("Load logic error:", error);
        }
    }
};

// ==========================================
// 📡 REAL-TIME OFFLINE/ONLINE LISTENERS
// ==========================================
window.addEventListener('offline', () => {
    NetworkManager.showToast("Internet connection lost. You are offline.", "error");
});

window.addEventListener('online', () => {
    NetworkManager.showToast("Connection restored. You are back online!", "success");
});

// 1. Convert Firebase's first auth check into an awaitable Promise
function waitForInitialAuth() {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, 
            (user) => {
                unsubscribe(); // We only care about the very first check, so we stop listening immediately
                resolve(user);
            }, 
            (error) => {
                reject(error);
            }
        );
    });
}

// 2. The Master Boot Sequence
async function bootUpApp() {
    // We use your NetworkManager to protect the startup!
    NetworkManager.loadWithNetworkCheck(async () => {
        
        NetworkManager.showLoader("VERIFYING SESSION...");
        
        // Wait for Firebase to securely check the user's login state
        const user = await waitForInitialAuth();

        if (user) {
            // User is logged in! 
            NetworkManager.showLoader("LOADING DASHBOARD...");
            
            // Start your live feed (this will handle its own loader too)
            window.listenToTactics();
            window.listenToNotifications();
            window.loadUsersForMentions();
            
            // If you have other startup things (like loading profile data), 
            // you would await them here.
            
        } else {
            // User is NOT logged in. 
            // The NetworkManager will hide the loader automatically after this block finishes.
            
            // document.getElementById('loginScreen').style.display = 'block';
            console.log("No user found. Please log in.");
        }

    }, 15000); // Give Firebase 15 seconds to boot before showing a timeout warning
}

// 3. Trigger the boot sequence the moment the window loads
window.addEventListener('load', () => {
    bootUpApp();
});

// ==========================================
// 🔔 REAL-TIME NOTIFICATION LISTENER
// ==========================================
window.listenToNotifications = function() {
    if (!currentUser) return;

    // 👇 CHANGED THIS LINE: Now listens for personal alerts OR "all" broadcast alerts
    const q = query(
        collection(db, "dm_alerts"), 
        where("receiverId", "in", [currentUser.uid, "all"]), 
        where("read", "==", false)
    );

    onSnapshot(q, (snapshot) => {
        const badge = document.getElementById('sidebarNotificationBadge');
        if (!badge) return;

        // 1. Update Sidebar Badge Count
        const unreadCount = snapshot.docs.length;
        if (unreadCount > 0) {
            badge.innerText = unreadCount;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }

        // 2. Trigger Live Toasts for BRAND NEW notifications only
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const alertData = change.doc.data();
                
                // Only toast if the notification is less than 10 seconds old
                if (Date.now() - alertData.timestamp < 10000) {
                    // Added a fallback for senderName in case it's a system broadcast
                    const sender = alertData.senderName ? `@${alertData.senderName}` : "📢 System";
                    NetworkManager.showToast(`${sender}: ${alertData.message}`, "success");
                }
                // 👇 ADD THIS LINE: Instantly draw it in the sidebar without needing to reload!
if (typeof window.renderSidebarNotification === 'function') {
    window.renderSidebarNotification(alertData.title || "📢 System Alert", alertData.message);
}
            }
        });
    });
};


// ==========================================
// 📜 SIDEBAR NOTIFICATION HISTORY (UPGRADED)
// ==========================================
window.openNotificationHistory = async function() {
    const historyContainer = document.getElementById('sidebarNotificationHistory');
    
    // Toggle the menu open and closed
    if (historyContainer.style.display === 'block') {
        historyContainer.style.display = 'none';
        return;
    }

    historyContainer.style.display = 'block';
    
    // Dynamically increase the height so it takes up more of the screen 
    // without breaking out of the sidebar
    historyContainer.style.maxHeight = '65vh'; 
    
    historyContainer.innerHTML = '<div style="padding: 15px 20px; color: #94a3b8; font-size: 0.9rem;">Loading history...</div>';

    try {
        // 👇 FIXED: Now fetches personal alerts AND global broadcasts
        const q = query(
            collection(db, "dm_alerts"),
            where("receiverId", "in", [currentUser.uid, "all"]),
            orderBy("timestamp", "desc"),
            limit(15) 
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            historyContainer.innerHTML = '<div style="padding: 15px 20px; color: #64748b; font-size: 0.9rem;">No notifications yet.</div>';
            return;
        }

        // 🧹 Add a sticky "Clear All" header at the top
        let html = `
            <div style="padding: 10px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: flex-end; position: sticky; top: 0; background: rgba(15, 23, 42, 0.95); z-index: 10; backdrop-filter: blur(5px);">
                <button onclick="clearAllNotifications()" style="background: transparent; color: #ef4444; border: 1px solid #ef4444; padding: 4px 10px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#ef4444'; this.style.color='white'" onmouseout="this.style.background='transparent'; this.style.color='#ef4444'">
                    🗑️ Clear Personal Alerts
                </button>
            </div>
        `;
        
        const unreadIds = []; 

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const isRead = data.read;
            
            if (!isRead) {
                unreadIds.push(docSnap.id);
            }

            // 👇 FIXED: Added a fallback so broadcasts say "System" instead of undefined
            const senderDisplay = data.senderName ? `@${data.senderName}` : "📢 System";

            html += `
                <div style="padding: 18px 20px; border-bottom: 1px solid rgba(255,255,255,0.05); background: ${isRead ? 'transparent' : 'rgba(56, 189, 248, 0.05)'}; cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='${isRead ? 'transparent' : 'rgba(56, 189, 248, 0.05)'}'">
                    <div style="color: #e2e8f0; font-size: 1rem; line-height: 1.5;">
                        <strong style="color: #38bdf8; font-size: 1.05rem;">${senderDisplay}</strong> ${data.message}
                    </div>
                    <div style="color: #94a3b8; font-size: 0.85rem; margin-top: 8px; font-weight: 500;">
                        ${new Date(data.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                </div>
            `;
        });

        historyContainer.innerHTML = html;

        // Automatically mark all loaded unread notifications as "read" in the database
        if (unreadIds.length > 0) {
            const batch = writeBatch(db);
            unreadIds.forEach(id => {
                batch.update(doc(db, "dm_alerts", id), { read: true });
            });
            await batch.commit();
        }

    } catch (error) {
        console.error("Error loading notifications:", error);
        historyContainer.innerHTML = '<div style="padding: 15px 20px; color: #ef4444; font-size: 0.9rem;">Error loading notifications.</div>';
    }
};

// ==========================================
// 🗑️ CLEAR ALL NOTIFICATIONS (Sidebar Fixed)
// ==========================================
window.clearAllNotifications = async function() {
    if (!confirm("Are you sure you want to delete your personal notifications?")) return;
    
    try {
        const q = query(
            collection(db, "dm_alerts"),
            where("receiverId", "==", currentUser.uid) // Only deletes personal DMs, preserves global broadcasts
        );
        
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
            const batch = writeBatch(db);
            snapshot.forEach(docSnap => {
                batch.delete(docSnap.ref);
            });
            await batch.commit();
            
            // 👇 FIXED: Now correctly updates the sidebar interface, not a modal ID
            const historyContainer = document.getElementById('sidebarNotificationHistory');
            if (historyContainer) {
                historyContainer.innerHTML = '<div style="padding: 50px 20px; text-align: center; color: #64748b; font-size: 1.1rem;">Personal notifications cleared.</div>';
            }
            NetworkManager.showToast("Personal notifications cleared!", "success");
        } else {
            NetworkManager.showToast("No personal notifications to clear.", "info");
        }
    } catch (error) {
        console.error("Error clearing notifications:", error);
        NetworkManager.showToast("Failed to clear notifications.", "error");
    }
};


// ==========================================
// 🔍 MENTION AUTOCOMPLETE LOGIC
// ==========================================
window.handleMentionInput = function(inputElement, tacticId) {
    const panel = document.getElementById(`mentionPanel_${tacticId}`);
    const text = inputElement.value;
    const cursorPosition = inputElement.selectionStart;

    // Grab the text right before the cursor to see if they are typing an @word
    const textBeforeCursor = text.slice(0, cursorPosition);
    const match = textBeforeCursor.match(/@(\w*)$/);

    if (match) {
        const searchString = match[1].toLowerCase();
        let options = [];
        
        // Always show @all as an option if they type 'a', 'l', etc.
        if ("all".startsWith(searchString)) {
            options.push({ name: "all", label: "📢 Everyone (@all)" });
        }

        // Filter the cached users
        window.cachedLeagueUsers.forEach(u => {
            if (u.name.toLowerCase().startsWith(searchString) && u.id !== currentUser.uid) {
                options.push({ name: u.name, label: `👤 ${u.name}` });
            }
        });

        // Render the panel if we have matches
        if (options.length > 0) {
            let html = '';
            options.forEach(opt => {
                html += `
                <div onclick="insertMention('${tacticId}', '${opt.name}')" style="padding: 10px 15px; cursor: pointer; color: #cbd5e1; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.9rem;" onmouseover="this.style.background='rgba(56, 189, 248, 0.1)'; this.style.color='#38bdf8'" onmouseout="this.style.background='transparent'; this.style.color='#cbd5e1'">
                    ${opt.label}
                </div>`;
            });
            panel.innerHTML = html;
            panel.style.display = 'block';
        } else {
            panel.style.display = 'none';
        }
    } else {
        panel.style.display = 'none'; // Hide if they delete the @ symbol
    }
};

window.insertMention = function(tacticId, name) {
    const inputElement = document.getElementById(`commentInput_${tacticId}`);
    const panel = document.getElementById(`mentionPanel_${tacticId}`);
    const text = inputElement.value;
    const cursorPosition = inputElement.selectionStart;

    const textBeforeCursor = text.slice(0, cursorPosition);
    const textAfterCursor = text.slice(cursorPosition);
    
    // Replace the partial @typing with the full name and a trailing space
    const newTextBefore = textBeforeCursor.replace(/@\w*$/, `@${name} `);
    
    inputElement.value = newTextBefore + textAfterCursor;
    
    // Put the user's cursor right after the newly inserted name so they can keep typing!
    inputElement.focus();
    inputElement.setSelectionRange(newTextBefore.length, newTextBefore.length);
    
    panel.style.display = 'none';
};

 // ==========================================
// 📜 POP-UP NOTIFICATION MODAL LOGIC (FULL INTERFACE)
// ==========================================
window.closeNotificationModal = function() {
    document.getElementById('notificationModal').style.display = 'none';
};

// 🗑️ NEW: Individual delete function for the modal
window.deleteNotification = async function(notiId) {
    try {
        await deleteDoc(doc(db, "dm_alerts", notiId));
        // Instantly remove it from the screen without needing a refresh
        const element = document.getElementById(`noti-${notiId}`);
        if (element) element.remove();
    } catch(err) {
        console.error("Error deleting notification:", err);
    }
};

window.openNotificationHistory = async function() {
    const modal = document.getElementById('notificationModal');
    const modalBody = document.getElementById('notificationModalBody');
    
    modal.style.display = 'flex';
    modalBody.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8; font-size: 1.1rem;">Loading notifications...</div>';

    try {
        // 🔥 THE FIX: Using 'in' fetches both personal DMs and Admin 'all' broadcasts
        const q = query(
            collection(db, "dm_alerts"),
            where("receiverId", "in", [currentUser.uid, "all"]),
            orderBy("timestamp", "desc"),
            limit(15) 
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            modalBody.innerHTML = '<div style="padding: 50px 20px; text-align: center; color: #64748b; font-size: 1.1rem;">You have no notifications yet.</div>';
            return;
        }

        let html = '';
        const unreadIds = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const notiId = docSnap.id;
            const isRead = data.read;
            
            if (!isRead) {
                unreadIds.push(notiId);
            }

            // 🔥 Added ID for DOM removal and the missing Delete Button
           // Inside openNotificationHistory() snapshot.forEach loop...
html += `
    <div id="noti-${notiId}" style="padding: 22px 25px; border-bottom: 1px solid rgba(255,255,255,0.05); background: ${isRead ? 'transparent' : 'rgba(56, 189, 248, 0.05)'}; display: flex; justify-content: space-between; align-items: flex-start; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='${isRead ? 'transparent' : 'rgba(56, 189, 248, 0.05)'}'">
        <div>
            <div style="color: #e2e8f0; font-size: 1.05rem; line-height: 1.6;">
                <strong style="color: #38bdf8; font-size: 1.1rem;">
                    @${data.senderName || data.sender || 'Manager'}
                </strong> 
                ${data.message || data.text || 'sent you a message.'}
            </div>
            <div style="color: #94a3b8; font-size: 0.85rem; margin-top: 10px; font-weight: 500;">
                ${new Date(data.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
        </div>
        <button onclick="deleteNotification('${notiId}')" style="background: transparent; border: none; color: #ef4444; font-size: 1.2rem; cursor: pointer; padding: 5px;" title="Delete this alert">
            🗑️
        </button>
    </div>
`;

        });

        modalBody.innerHTML = html;

        if (unreadIds.length > 0) {
            const batch = writeBatch(db);
            unreadIds.forEach(id => {
                // Safely update both properties your app relies on
                batch.update(doc(db, "dm_alerts", id), { read: true, status: "read" });
            });
            await batch.commit();
        }

    } catch (error) {
        console.error("Error loading notifications:", error);
        modalBody.innerHTML = '<div style="padding: 40px; text-align: center; color: #ef4444; font-size: 1.1rem;">Error loading notifications.</div>';
    }
};

// --- CUSTOM INSTALL BUTTON LOGIC (FIXED) ---
let deferredPrompt = null;
const installAppBtn = document.getElementById('installAppBtn');

// 1. Listen for the browser's install event quietly in the background
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default browser popup from appearing
    e.preventDefault();
    // Save the event to use when they click our button
    deferredPrompt = e;
    console.log("Install prompt is ready!");
});

// 2. What happens when they click YOUR permanent button
if (installAppBtn) {
    installAppBtn.addEventListener('click', async () => {
        // Check 1: Are they ALREADY playing inside the installed standalone app?
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

        if (isStandalone) {
            alert("You are currently using the installed version of the app!");
            return;
        }

        // Check 2: Is the browser's install prompt ready?
        if (deferredPrompt) {
            // Trigger the official browser install dialog
            deferredPrompt.prompt();
            
            // Wait to see if they click Install or Cancel
            const { outcome } = await deferredPrompt.userChoice;
            
            if (outcome === 'accepted') {
                deferredPrompt = null;
            }
        } else {
            // Check 3: If deferredPrompt is null, guide the user instead of assuming it's installed
            alert("Install prompt is preparing or not supported. You can also tap Chrome's 3-dot menu (⋮) and tap 'Add to Home screen' to install manually!");
        }
    });
}

// 3. Confirm when the installation finishes successfully
window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    alert("Installation successful! You can now open eFootball UCL from your home screen.");
});



// --- CSS ANIMATION SPLASH SCREEN LOGIC ---
const welcomeScreen = document.getElementById('welcomeScreen');

if (welcomeScreen) {
    // Wait for the 2.5s CSS animation to finish + a tiny 0.5s pause to let the user see it
    setTimeout(() => {
        // Start the fade out
        welcomeScreen.style.opacity = '0';
        welcomeScreen.style.pointerEvents = 'none'; // allow clicking through it
        
        // Remove it from the DOM completely after the fade finishes
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
        }, 1000); 
        
    }, 3000); // 3000 milliseconds = 3 seconds total screen time
}
