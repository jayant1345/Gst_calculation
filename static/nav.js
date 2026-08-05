document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('mobile-menu-toggle');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (!sidebar || !toggle || !backdrop) return;

    function closeSidebar() {
        sidebar.classList.remove('open');
        backdrop.classList.remove('open');
    }

    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        backdrop.classList.toggle('open');
    });

    backdrop.addEventListener('click', closeSidebar);

    sidebar.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', closeSidebar);
    });
});
