export const DASHBOARD_SCRIPTS = `
    fetch('history.json')
      .then(r => r.ok ? r.json() : [])
      .then(history => {
        if (!history.length) return;
        const last30 = history.slice(-30);
        const labels = last30.map(h => h.date.slice(5));
        const healthData = last30.map(h => h.avgHealth);
        const failData = last30.map(h => h.failingCI);

        new Chart(document.getElementById('trendsChart'), {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Avg Health',
                data: healthData,
                borderColor: '#58a6ff',
                backgroundColor: 'rgba(88,166,255,0.1)',
                fill: true,
                tension: 0.3,
                yAxisID: 'y',
              },
              {
                label: 'Failing CI',
                data: failData,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239,68,68,0.1)',
                fill: true,
                tension: 0.3,
                yAxisID: 'y1',
              },
            ],
          },
          options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y: {
                type: 'linear', position: 'left', min: 0, max: 100,
                title: { display: true, text: 'Health', color: '#8b949e' },
                ticks: { color: '#8b949e' }, grid: { color: '#21262d' },
              },
              y1: {
                type: 'linear', position: 'right', min: 0,
                title: { display: true, text: 'Failing', color: '#8b949e' },
                ticks: { color: '#8b949e', stepSize: 1 }, grid: { drawOnChartArea: false },
              },
              x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
            },
            plugins: { legend: { labels: { color: '#c9d1d9' } } },
          },
        });

        document.querySelectorAll('[data-sparkline]').forEach(canvas => {
          const name = canvas.getAttribute('data-sparkline');
          const last14 = history.slice(-14);
          const data = last14.map(h => {
            const proj = h.perProject.find(p => p.name === name);
            return proj ? proj.health : null;
          }).filter(v => v !== null);
          if (!data.length) return;
          new Chart(canvas, {
            type: 'line',
            data: {
              labels: data.map((_, i) => i),
              datasets: [{ data, borderColor: '#58a6ff', borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 }],
            },
            options: {
              responsive: false,
              plugins: { legend: { display: false }, tooltip: { enabled: false } },
              scales: { x: { display: false }, y: { display: false, min: 0, max: 100 } },
            },
          });
        });
      })
      .catch(() => {});
`;
