import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

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
const db = getFirestore(app);

async function readUserRole(user) {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    // Older accounts used the "agent" role; keep them on the owner workspace.
    return String(snapshot.exists() ? (snapshot.data().role || "owner") : "owner").toLowerCase();
}

document.addEventListener("DOMContentLoaded", () => {
    if (typeof lucide !== "undefined") lucide.createIcons();

    const sidebar = document.querySelector(".sidebar");
    const menuToggle = document.querySelector(".menu-toggle");
    const closeMenu = document.querySelector(".close-menu");
    menuToggle?.addEventListener("click", () => sidebar?.classList.toggle("show-mobile"));
    closeMenu?.addEventListener("click", () => sidebar?.classList.remove("show-mobile"));

    const logoutBtn = document.getElementById("logout-btn");
    logoutBtn?.addEventListener("click", async () => {
        try {
            await signOut(auth);
            window.location.replace("./login.html");
        } catch (error) {
            console.error("Logout error:", error);
            alert("Logout failed. Please try again.");
        }
    });

    onAuthStateChanged(auth, async (user) => {
        const page = window.location.pathname.split("/").pop() || "index.html";
        if (!user) {
            window.location.replace("./login.html");
            return;
        }

        try {
            const role = await readUserRole(user);
            const isAdmin = role === "admin";
            const isAdminPage = page === "admin.html";

            // Admin accounts stay in the admin area and cannot enter owner pages.
            if (isAdmin && !isAdminPage) {
                window.location.replace("./admin.html");
                return;
            }

            // Owners (including legacy "agent" accounts) may open the admin panel.
            if (isAdmin) {
                document.querySelectorAll('.nav-menu a[href="./index.html"], .nav-menu a[href="./leads.html"], .nav-menu a[href="./ai-tools.html"]').forEach(link => link.remove());
            }
        } catch (error) {
            console.error("Account role check failed:", error);
            alert("We could not verify your account role. Please sign in again or contact the workspace owner.");
            await signOut(auth);
            window.location.replace("./login.html");
        }
    });
});
