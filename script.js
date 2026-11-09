document.addEventListener('DOMContentLoaded', () => {
    // 1. Load icons
    lucide.createIcons();

    // 2. Mobile Menu Toggle
    const menuToggle = document.querySelector('.menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('show-mobile');
        });
    }
});
