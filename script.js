import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyDDWexZIGRtfkw5unI1jsGzcBS8Ind-dP8",
    authDomain: "agentcopilot-98817.firebaseapp.com",
    projectId: "agentcopilot-98817",
    storageBucket: "agentcopilot-98817.firebasestorage.app",
    messagingSenderId: "1061657518684",
    appId: "1:1061657518684:web:5db7baa214b1d2da08fc99"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

document.addEventListener('DOMContentLoaded', () => {
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // FORCE LOGIN: If not logged in, kick them to login.html
    onAuthStateChanged(auth, (user) => {
        const isLoginPage = window.location.pathname.includes('login.html');
        if (!user && !isLoginPage) {
            window.location.replace("./login.html");
        }
    });

    // MENU TOGGLE LOGIC
    const menuToggle = document.querySelector('.menu-toggle');
    const closeMenuBtn = document.querySelector('.close-menu');
    const sidebar = document.querySelector('.sidebar');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', (e) => {
            e.preventDefault();
            sidebar.classList.add('show-mobile');
        });
    }
    if (closeMenuBtn && sidebar) {
        closeMenuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            sidebar.classList.remove('show-mobile');
        });
    }
});
