import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

// Your web app's Firebase configuration
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
    // 1. Load icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // 2. CHECK LOGIN STATUS (Protect the app)
    onAuthStateChanged(auth, (user) => {
        // If not logged in and not already on the login page, redirect to login
        if (!user && !window.location.pathname.includes('login.html')) {
            window.location.href = "./login.html";
        }
    });

    // 3. Mobile Menu Toggle
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

    // 4. Logout functionality 
    const logoutBtns = document.querySelectorAll('.logout-btn');
    logoutBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            signOut(auth).then(() => {
                window.location.href = "./login.html";
            });
        });
    });
});
