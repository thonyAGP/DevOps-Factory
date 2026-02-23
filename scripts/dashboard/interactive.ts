export const getInteractiveJS = (): string => `
  <script>
    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('df-theme') || 'dark';
    if (savedTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    if (themeToggle) {
      themeToggle.textContent = savedTheme === 'light' ? 'Dark' : 'Light';
      themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'light' ? '' : 'light';
        document.documentElement.setAttribute('data-theme', next || '');
        localStorage.setItem('df-theme', next || 'dark');
        themeToggle.textContent = next === 'light' ? 'Dark' : 'Light';
      });
    }

    // Search
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase();
        document.querySelectorAll('[data-project]').forEach(el => {
          const name = el.getAttribute('data-project').toLowerCase();
          const stack = el.getAttribute('data-stack') || '';
          el.style.display = (name.includes(q) || stack.includes(q)) ? '' : 'none';
        });
      });
    }

    // Stack filters
    document.querySelectorAll('.filter-btn[data-stack]').forEach(btn => {
      btn.addEventListener('click', () => {
        const isActive = btn.classList.toggle('active');
        const stack = btn.getAttribute('data-stack');

        if (stack === 'all') {
          document.querySelectorAll('.filter-btn[data-stack]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          document.querySelectorAll('[data-project]').forEach(el => el.style.display = '');
          return;
        }

        document.querySelector('.filter-btn[data-stack="all"]')?.classList.remove('active');
        const activeFilters = [...document.querySelectorAll('.filter-btn[data-stack].active')]
          .map(b => b.getAttribute('data-stack'))
          .filter(s => s !== 'all');

        if (activeFilters.length === 0) {
          document.querySelector('.filter-btn[data-stack="all"]')?.classList.add('active');
          document.querySelectorAll('[data-project]').forEach(el => el.style.display = '');
          return;
        }

        document.querySelectorAll('[data-project]').forEach(el => {
          const s = el.getAttribute('data-stack');
          el.style.display = activeFilters.includes(s) ? '' : 'none';
        });
      });
    });

    // Sort
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        const grid = document.querySelector('.ok-grid');
        const alertsContainer = document.querySelector('.alerts');
        if (!grid) return;

        const cards = [...grid.querySelectorAll('[data-project]')];
        const sortBy = sortSelect.value;

        cards.sort((a, b) => {
          if (sortBy === 'name') return a.getAttribute('data-project').localeCompare(b.getAttribute('data-project'));
          if (sortBy === 'health-asc') return Number(a.getAttribute('data-health')) - Number(b.getAttribute('data-health'));
          if (sortBy === 'health-desc') return Number(b.getAttribute('data-health')) - Number(a.getAttribute('data-health'));
          if (sortBy === 'stack') return (a.getAttribute('data-stack') || '').localeCompare(b.getAttribute('data-stack') || '');
          return 0;
        });

        cards.forEach(card => grid.appendChild(card));
      });
    }

    // Export CSV
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const rows = [['Project', 'Stack', 'Health', 'CI Status']];
        document.querySelectorAll('[data-project]').forEach(el => {
          rows.push([
            el.getAttribute('data-project'),
            el.getAttribute('data-stack') || '',
            el.getAttribute('data-health') || '',
            el.getAttribute('data-ci') || '',
          ]);
        });
        const csv = rows.map(r => r.join(',')).join('\\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'devops-factory-export.csv';
        a.click(); URL.revokeObjectURL(url);
      });
    }

    // Back to top
    const backToTop = document.getElementById('backToTop');
    if (backToTop) {
      window.addEventListener('scroll', () => {
        backToTop.classList.toggle('visible', window.scrollY > 400);
      });
      backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  </script>
`;
