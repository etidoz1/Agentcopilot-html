import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
console.log("AGENTCOPILOT SCRIPT IS RUNNING");
const firebaseConfig = {
    apiKey: "AIzaSyDDWexZIGRtfkw5unI1jsGzcBS8Ind-dP8",
    authDomain: "agentcopilot-98817.firebaseapp.com",
    projectId: "agentcopilot-98817",
    storageBucket: "agentcopilot-98817.firebasestorage.app",
    messagingSenderId: "1061657518684",
    appId: "1:1061657518684:web:5db7baa214b1d2da08fc99"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', () => {
    // 1. Load Icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // 2. Force Login Redirect (If not on the login page and not logged in)
    onAuthStateChanged(auth, (user) => {
        const isLoginPage = window.location.pathname.includes('login.html');
        if (!user && !isLoginPage) {
            window.location.replace("./login.html");
        }
    });

    // 3. Mobile Menu Toggle Logic
    const menuToggle = document.querySelector('.menu-toggle');
    const closeMenuBtn = document.querySelector('.close-menu');
    const sidebar = document.querySelector('.sidebar');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.add('show-mobile');
        });
    }

    if (closeMenuBtn && sidebar) {
        closeMenuBtn.addEventListener('click', () => {
            sidebar.classList.remove('show-mobile');
        });
    }
});
